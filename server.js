const http = require('http');
const { sessionFile } = require('./lib/config');
const { createSessionStore } = require('./lib/session');
const { createHandler } = require('./lib/router');
const { upstreamFetch, requestText, quantity } = require('./lib/runtime');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

// Convierte el texto recibido de los portales a texto plano.
function cleanHtml(str) {
  if (!str) return '';
  return decodeHtmlEntities(String(str))
    .replace(/<br\s*[\/]?>/gi, ' - ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Urbano publica un resumen en HTML y un controlador separado para el detalle.
async function trackUrbano(rawOrder, rawShipper = '004185') {
  let shipper = (rawShipper || '004185').trim();
  let order = (rawOrder || '').trim();

  // Si el usuario incluyó el shipper dentro del código de pedido, normalizar
  if (order.startsWith(shipper)) {
    order = order.slice(shipper.length);
  } else if (order.startsWith('4185') && shipper === '004185') {
    order = order.slice(4);
  } else if (order.startsWith('00') && order.length > 6) {
    const potentialShipper = order.slice(0, 6);
    if (potentialShipper === shipper) {
      order = order.slice(6);
    }
  }

  const fullTracking = `${shipper}${order}`;
  const officialUrl = `https://apis.urbano.com.ar/cespecifica/?tracking=${encodeURIComponent(fullTracking)}`;

  try {
    const pageRes = await upstreamFetch(officialUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (!pageRes.ok) {
      throw new Error(`Error en servidor de Urbano (${pageRes.status})`);
    }

    const html = await pageRes.text();

    const rowMatch = html.match(/<tr[^>]*data=([\"\'])(.*?)\1[^>]*>/i);
    if (!rowMatch) {
      return {
        success: false,
        carrier: 'urbano',
        order,
        shipper,
        fullTracking,
        officialUrl,
        message: 'No se encontró ningún envío asociado a este número de pedido en Urbano.',
      };
    }

    const decodedJsonStr = decodeHtmlEntities(rowMatch[2]);
    let rowData = {};
    try {
      rowData = JSON.parse(decodedJsonStr);
    } catch (e) {
      throw new Error('Respuesta inválida recibida desde Urbano.');
    }

    if (
      !rowData ||
      (!rowData.gui_numero && !rowData.cliId) ||
      (rowData.cliId === '0' &&
        !rowData.gui_numero &&
        (!rowData.estado || rowData.estado.includes('Sin informaci')))
    ) {
      return {
        success: false,
        carrier: 'urbano',
        order,
        shipper,
        fullTracking,
        officialUrl,
        message: 'No se encontró ningún envío registrado en Urbano con este número de pedido.',
        summary: rowData,
      };
    }

    let movements = [];
    let detailInfo = {};

    try {
      const form = new URLSearchParams();
      form.append('accion', 'getDetalle');
      form.append('param1', decodedJsonStr);

      const detailRes = await upstreamFetch(
        'https://apis.urbano.com.ar/cespecifica/class/especifica_controller.php',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            Referer: officialUrl,
          },
          body: form.toString(),
        }
      );

      if (detailRes.ok) {
        const detailHtml = await detailRes.text();

        const extractField = (fieldName) => {
          const regex = new RegExp(
            `${fieldName}:[\\s\\S]*?<span[^>]*>([\\s\\S]*?)(?:<\\/span>|<\\/div>|\\r?\\n)`,
            'i'
          );
          const m = detailHtml.match(regex);
          return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
        };

        detailInfo = {
          producto: extractField('Producto'),
          ciclo: extractField('Ciclo'),
          servicio: extractField('Servicio'),
          direccion: extractField('Dirección'),
          distrito: extractField('Distrito'),
          referencia: extractField('Referencia'),
          telefono: extractField('Teléfono'),
        };

        const tbodyMatch = detailHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
        if (tbodyMatch) {
          const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/gi) || [];
          for (const r of rows) {
            const cells = Array.from(r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((c) =>
              c[1].replace(/<[^>]+>/g, '').trim()
            );
            if (cells.length >= 4) {
              movements.push({
                num: cells[0],
                status: cells[1],
                date: cells[2],
                time: cells[3],
                agency: cells[4] || '',
                zone: cells[5] || '',
                courier: cells[6] || '',
              });
            }
          }
        }
      }
    } catch (errDetail) {
      console.warn('Could not fetch detail timeline for Urbano:', errDetail.message);
    }

    let cleanEstado = (rowData.estado || '').replace(/u00f3/gi, 'ó').trim();
    const rawEstadoUpper = cleanEstado.toUpperCase();
    let statusCategory = 'in_transit';
    let statusLabel = cleanEstado || 'En proceso';

    if (
      /NO ENTREGAD|NO SE PUDO|NO PUDO|RECHAZ|INCIDENCIA|FALLID|DEVUELT|SINIESTRO/.test(
        rawEstadoUpper
      )
    ) {
      statusCategory = 'incident';
      statusLabel = cleanEstado;
    } else if (rawEstadoUpper.startsWith('DL') || rawEstadoUpper.includes('ENTREGADO')) {
      statusCategory = 'delivered';
      statusLabel = 'Entregado';
    } else if (
      rawEstadoUpper.startsWith('LD') ||
      rawEstadoUpper.includes('CAMINO') ||
      rawEstadoUpper.includes('DISTRIBUCION')
    ) {
      statusCategory = 'out_for_delivery';
      statusLabel = 'En camino / Distribución';
    } else if (
      rawEstadoUpper.startsWith('AR') ||
      rawEstadoUpper.startsWith('AS') ||
      rawEstadoUpper.includes('SUCURSAL')
    ) {
      statusCategory = 'branch';
      statusLabel = 'En sucursal de destino';
    } else if (rawEstadoUpper.startsWith('CO') || rawEstadoUpper.includes('CONTENERIZADO')) {
      statusCategory = 'in_transit';
      statusLabel = 'En tránsito entre centros';
    } else if (
      rawEstadoUpper.startsWith('PI') ||
      rawEstadoUpper.startsWith('IF') ||
      rawEstadoUpper.startsWith('GE')
    ) {
      statusCategory = 'received';
      statusLabel = 'Recibido en depósito Urbano';
    } else if (rawEstadoUpper.includes('SIN INFORMACI') || rawEstadoUpper.includes('SIN ESTADO')) {
      statusCategory = 'received';
      statusLabel = 'Orden registrada (esperando retiro / escaneo inicial)';
    }

    return {
      success: true,
      carrier: 'urbano',
      order,
      guiaNumero: rowData.gui_numero || rowData.cliId || '',
      referenciaEnvio: order,
      shipper,
      fullTracking,
      officialUrl,
      statusCategory,
      statusLabel,
      summary: {
        guiaNumero: rowData.gui_numero || '',
        clienteCodigo: rowData.cliCodigo || order,
        remitente: `Cuenta ${shipper}`,
        linea: rowData.linea || 'Urbano Express',
        producto: rowData.proCodigo || '',
        servicio:
          [rowData.servicio, rowData.linea].filter(Boolean).join(' • ') || 'Distribución Estándar',
        ciclo: rowData.ciclo || '',
        estadoRaw: rowData.estado || '',
        fechaEstado: rowData.fechaEstado || '',
      },
      detail: {
        ...detailInfo,
        bultos: rowData.gui_bultos || '1',
        peso: rowData.gui_kilos || '',
        products: [
          {
            codigo: rowData.proCodigo || '',
            descripcion: detailInfo.producto || rowData.proCodigo || 'Paquetería Urbano',
            bultos: rowData.gui_bultos || '1',
            peso: rowData.gui_kilos || '',
            volumen: '',
          },
        ],
      },
      products: [
        {
          codigo: rowData.proCodigo || '',
          descripcion: detailInfo.producto || rowData.proCodigo || 'Paquetería Urbano',
          bultos: rowData.gui_bultos || '1',
          peso: rowData.gui_kilos || '',
          volumen: '',
        },
      ],
      bultos: rowData.gui_bultos || '1',
      peso: rowData.gui_kilos || '',
      movements,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'upstream_error',
        carrier: 'urbano',
        code: err.code || 'UPSTREAM_RESPONSE',
      })
    );
    return {
      success: false,
      carrier: 'urbano',
      order,
      shipper,
      fullTracking,
      officialUrl,
      errorCode: err.code || 'UPSTREAM_UNAVAILABLE',
      message: 'No se pudo completar la consulta a Urbano. Reintentá en unos instantes.',
    };
  }
}

// Andreani espera el payload cifrado y devuelve una respuesta JSON.
function encryptAES(text, keyStr, ivStr) {
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(keyStr, 'utf8'),
    Buffer.from(ivStr, 'utf8')
  );
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

async function fetchAndreani(encryptedPayload) {
  const target = `https://tracking-api.andreani.com/api/v3/Tracking?payload=${encodeURIComponent(encryptedPayload)}`;
  const addresses = [undefined, '104.18.22.26', '104.18.23.26'];
  for (let attempt = 0; attempt < addresses.length; attempt++) {
    try {
      const result = await requestText(target, {
        connectAddress: addresses[attempt],
        headers: {
          Host: 'tracking-api.andreani.com',
          Authorization: process.env.ANDREANI_AUTHORIZATION,
          'User-Agent': 'Seguimiento-BGH/1.1',
        },
        timeout: 7500,
      });
      if (
        (result.statusCode < 500 && result.statusCode !== 403) ||
        attempt === addresses.length - 1
      )
        return result;
    } catch (err) {
      if (attempt === addresses.length - 1 || err.code === 'CANCELLED') throw err;
    }
  }
}

async function trackAndreani(rawOrder) {
  const code = (rawOrder || '').trim();
  const apiKey = process.env.ANDREANI_AES_KEY || '';
  const apiIv = process.env.ANDREANI_AES_IV || '';
  if (
    Buffer.byteLength(apiKey) !== 32 ||
    Buffer.byteLength(apiIv) !== 16 ||
    !process.env.ANDREANI_AUTHORIZATION
  ) {
    return {
      success: false,
      carrier: 'andreani',
      order: code,
      errorCode: 'CONFIG_REQUIRED',
      message: 'Falta configurar la conexión privada de Andreani en el servidor.',
    };
  }

  const payloadObj = {
    idReceptor: '1',
    idSistema: '1',
    userData: '{}',
    numeroAndreani: code,
  };

  const encrypted = encryptAES(JSON.stringify(payloadObj), apiKey, apiIv);

  try {
    const res = await fetchAndreani(encrypted);
    if (res.statusCode !== 200 && res.statusCode !== 404 && res.statusCode !== 206) {
      return {
        success: false,
        carrier: 'andreani',
        order: code,
        errorCode: 'UPSTREAM_UNAVAILABLE',
        message: `Andreani no pudo responder la consulta (HTTP ${res.statusCode}). Reintentá más tarde.`,
      };
    }
    if (
      res.statusCode === 404 ||
      res.statusCode === 206 ||
      !res.body ||
      res.body.trim() === 'null'
    ) {
      return {
        success: false,
        carrier: 'andreani',
        order: code,
        officialUrl: `https://www.andreani.com/envio/${encodeURIComponent(code)}`,
        message:
          'No se encontró ningún envío registrado en Andreani con este número de pedido o guía.',
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(res.body);
    } catch (e) {
      return {
        success: false,
        carrier: 'andreani',
        order: code,
        officialUrl: `https://www.andreani.com/envio/${encodeURIComponent(code)}`,
        message: 'Respuesta inválida recibida desde Andreani.',
      };
    }

    if (!parsed || !parsed.numeroAndreani) {
      return {
        success: false,
        carrier: 'andreani',
        order: code,
        officialUrl: `https://www.andreani.com/envio/${encodeURIComponent(code)}`,
        message: 'No se encontró ningún envío asociado a este número en Andreani.',
      };
    }

    // Extraer y procesar movimientos
    const movements = [];
    if (Array.isArray(parsed.timelines)) {
      for (const t of parsed.timelines) {
        if (Array.isArray(t.traducciones)) {
          for (const ev of t.traducciones) {
            if (!ev.fechaEvento) continue;
            const dateStr = ev.fechaEvento.split('T')[0];
            const timeStr = ev.fechaEvento.split('T')[1]?.split('.')[0]?.slice(0, 5) || '';
            movements.push({
              phase: t.titulo || '',
              status: cleanHtml(ev.traduccion),
              date: dateStr,
              time: timeStr,
              agency: ev.sucursal?.nombre || 'Planta Andreani',
              rawDate: ev.fechaEvento,
            });
          }
        }
      }
    }

    // Orden cronológico (más antiguo al más reciente)
    movements.sort((a, b) => new Date(a.rawDate) - new Date(b.rawDate));

    // Determinar categoría normalizada de estado
    const tituloUpper = (parsed.procesoActual?.titulo || '').toUpperCase();
    let statusCategory = 'in_transit';
    let statusLabel = parsed.procesoActual?.titulo || 'En tránsito';

    if (
      tituloUpper.includes('NO ENTREGADO') ||
      tituloUpper.includes('NO PUDO') ||
      tituloUpper.includes('VISITADO') ||
      tituloUpper.includes('INCIDENCIA') ||
      tituloUpper.includes('RECHAZ') ||
      tituloUpper.includes('DEVUELTO') ||
      tituloUpper.includes('SINIESTRO') ||
      tituloUpper.includes('FALLID')
    ) {
      statusCategory = 'incident';
      statusLabel = parsed.procesoActual?.titulo || 'No entregado';
    } else if (tituloUpper.includes('ENTREGADO')) {
      statusCategory = 'delivered';
      statusLabel = 'Entregado';
    } else if (tituloUpper.includes('CAMINO') || tituloUpper.includes('DISTRIBUCI')) {
      statusCategory = 'out_for_delivery';
      statusLabel = 'En camino';
    } else if (tituloUpper.includes('SUCURSAL')) {
      statusCategory = 'branch';
      statusLabel = 'En sucursal';
    } else if (tituloUpper.includes('INGRESADO') || tituloUpper.includes('PREPARACI')) {
      statusCategory = 'received';
      statusLabel = parsed.procesoActual?.titulo || 'Ingresado en Andreani';
    } else if (tituloUpper.includes('PENDIENTE')) {
      statusCategory = 'received';
      statusLabel = 'Pendiente de ingreso';
    }

    // Doble verificación con el último movimiento real registrado en Andreani
    if (movements.length > 0) {
      const latestMov = movements[movements.length - 1];
      const latestPhaseUpper = (latestMov.phase || '').toUpperCase();
      const latestStatusUpper = (latestMov.status || '').toUpperCase();
      if (
        latestPhaseUpper.includes('NO ENTREGADO') ||
        latestStatusUpper.includes('NO LOGRAMOS') ||
        latestStatusUpper.includes('NO SE PUDO')
      ) {
        statusCategory = 'incident';
        statusLabel = latestMov.phase || 'No entregado';
      }
    }

    const guia = parsed.numeroAndreani || code;
    const officialUrl = `https://www.andreani.com/envio/${encodeURIComponent(guia)}`;
    const remitente =
      parsed.nombreRemitente || parsed.cliente?.nombreFantasia || parsed.cliente?.nombre || '';
    const contratoDesc = parsed.cliente?.contrato?.descripcion || '';
    const tipoEntrega = parsed.cliente?.contrato?.tipoDeEntrega || '';
    const servicioStr =
      [contratoDesc, tipoEntrega].filter(Boolean).join(' • ') || 'Distribución Andreani';

    return {
      success: true,
      carrier: 'andreani',
      order: code,
      guiaNumero: guia,
      referenciaEnvio: code,
      officialUrl,
      statusCategory,
      statusLabel,
      summary: {
        guiaNumero: guia,
        clienteCodigo: code, // Referencia de envío (ej: Mercado Libre)
        remitente: remitente,
        linea: 'Correo Andreani',
        producto: remitente ? `Remitente: ${remitente}` : 'Paquetería',
        servicio: servicioStr,
        fechaEstado: parsed.procesoActual?.fechaUltimoEvento
          ? parsed.procesoActual.fechaUltimoEvento.replace('T', ' ').slice(0, 16)
          : '',
      },
      detail: {
        referencia: code,
        remitente: remitente,
        observaciones: cleanHtml(parsed.procesoActual?.observaciones || ''),
        direccion: parsed.ultimaMilla?.domicilioDestino || 'Nacional',
        bultos: '1',
        products: [
          {
            codigo: '',
            descripcion: parsed.cliente?.contrato?.descripcion || 'Paquetería Andreani',
            bultos: '1',
            peso: '',
            volumen: '',
          },
        ],
      },
      products: [
        {
          codigo: '',
          descripcion: parsed.cliente?.contrato?.descripcion || 'Paquetería Andreani',
          bultos: '1',
          peso: '',
          volumen: '',
        },
      ],
      bultos: '1',
      movements,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'upstream_error',
        carrier: 'andreani',
        code: err.code || 'UPSTREAM_RESPONSE',
      })
    );
    return {
      success: false,
      carrier: 'andreani',
      order: code,
      officialUrl: `https://www.andreani.com/envio/${encodeURIComponent(code)}`,
      errorCode: err.code || 'UPSTREAM_UNAVAILABLE',
      message: 'No se pudo completar la consulta a Andreani. Reintentá en unos instantes.',
    };
  }
}

// Entregar requiere una sesión vigente para consultar la grilla de pedidos.
const session = createSessionStore(sessionFile, process.env.ENTREGAR_COOKIE || '');
function getEntregarCookie() {
  return session.getCookie();
}
function pingEntregar() {
  return session.ping();
}

function getShortRef(ref) {
  if (!ref) return '';
  const match = String(ref)
    .trim()
    .match(/^(ZECO|ZECH|ZRE7|ZRE2)_0*(\d+)/i);
  if (match) {
    return `${match[1].toUpperCase()} ${match[2]}`;
  }
  return String(ref).trim();
}

function classifyEntregarRef(ref, aux1, aux2) {
  const r = (ref || '').toUpperCase();
  const shortRef = getShortRef(ref);
  if (r.startsWith('ZECO')) {
    return {
      code: 'ZECO',
      type: 'original',
      label: 'Entrega Original',
      badgeText: '📦 Entrega Original (ZECO)',
      shortRef,
      description: 'Envío inicial de la compra por primera vez al cliente.',
      isExchange: false,
    };
  }
  if (r.startsWith('ZECH')) {
    return {
      code: 'ZECH',
      type: 'swap_dispatch',
      label: 'Despacho por Cambio',
      badgeText: '🔄 Despacho Cambio (ZECH)',
      shortRef,
      description:
        'Despacho de producto nuevo por cambio contra entrega (se entrega el nuevo y se retira el producto anterior).',
      isExchange: true,
      linkedInfo: aux2 || '',
    };
  }
  if (r.startsWith('ZRE7')) {
    return {
      code: 'ZRE7',
      type: 'swap_pickup',
      label: 'Retiro por Cambio',
      badgeText: '🔄 Retiro Cambio (ZRE7)',
      shortRef,
      description:
        'Retiro de producto defectuoso/dañado por cambio contra entrega (debe realizarse junto con la entrega del nuevo).',
      isExchange: true,
      linkedInfo: aux2 || '',
    };
  }
  if (r.startsWith('ZRE2')) {
    return {
      code: 'ZRE2',
      type: 'return_pickup',
      label: 'Retiro por Devolución Directa',
      badgeText: '↩️ Devolución Directa (ZRE2)',
      shortRef,
      description:
        'Retiro del producto devuelto por el cliente sin entrega de producto de reemplazo.',
      isExchange: false,
    };
  }
  return {
    code: 'OTRO',
    type: 'general',
    label: 'Envío General',
    badgeText: 'Envío General',
    shortRef,
    description: '',
    isExchange: false,
  };
}

function exchangeId(text, code) {
  const match = String(text || '').match(new RegExp(`\\b${code}[ _-]*0*(\\d+)\\b`, 'i'));
  return match ? match[1].replace(/^0+/, '') || '0' : null;
}
function linkExchangePairs(pedidos) {
  for (const p of pedidos) {
    if (!p.classification?.isExchange) continue;
    delete p.classification.pairedOrder;
    const own = p.classification.code;
    const target = own === 'ZECH' ? 'ZRE7' : 'ZECH';
    const ownId = exchangeId(p.referencia, own);
    const targetId = exchangeId(p.campoAuxiliar2, target);
    const candidates = pedidos
      .map((other, index) => ({ other, index }))
      .filter(({ other }) => {
        if (other === p || other.classification?.code !== target) return false;
        const otherId = exchangeId(other.referencia, target);
        const reverseId = exchangeId(other.campoAuxiliar2, own);
        if (targetId && otherId !== targetId) return false;
        if (reverseId && ownId !== reverseId) return false;
        return Boolean((targetId && otherId === targetId) || (ownId && reverseId === ownId));
      });
    if (candidates.length !== 1) continue;
    const { other: partner, index } = candidates[0];
    const partnerId = exchangeId(partner.referencia, target);
    const claims = pedidos.filter(
      (other) =>
        other.classification?.code === own &&
        partnerId &&
        exchangeId(other.campoAuxiliar2, target) === partnerId
    );
    if (claims.length > 1) continue;
    p.classification.pairedOrder = {
      index,
      idpedido: partner.idpedido,
      referencia: partner.referencia,
      shortRef: getShortRef(partner.referencia),
      remito: partner.remito,
      operacion: partner.operacion,
      status: partner.status,
      statusLabel: partner.statusLabel,
      code: partner.classification.code,
      type: partner.classification.type,
      badgeText: partner.classification.badgeText,
    };
  }
}

function parseEntregarHtml(content) {
  const rowMatches = [...content.matchAll(/id_sc_field_idempresa_(\d+)/g)];
  if (!rowMatches.length) return [];

  const pedidos = [];

  for (let idx = 0; idx < rowMatches.length; idx++) {
    const rowNum = rowMatches[idx][1];
    const startIndex = content.lastIndexOf('<td', rowMatches[idx].index);
    const endIndex =
      idx + 1 < rowMatches.length
        ? content.lastIndexOf('<td', rowMatches[idx + 1].index)
        : content.length;
    const rowChunk = content.substring(startIndex, endIndex);

    const getField = (name) => {
      const regex = new RegExp(
        `(<td[^>]*>[\\s\\S]*?id_sc_field_${name}_${rowNum}[^>]*>([\\s\\S]*?)<\\/(?:span|a)>[\\s\\S]*?<\\/td>)`,
        'gi'
      );
      const matches = [...rowChunk.matchAll(regex)];
      if (!matches.length) return '';
      const mainCell =
        matches.find((m) => !m[1].includes('grid_evento_pedido')) || matches[matches.length - 1];
      const tagMatch = mainCell[1].match(
        new RegExp(`id_sc_field_${name}_${rowNum}[^>]*>([\\s\\S]*?)<\\/(?:span|a)>`, 'i')
      );
      return tagMatch ? cleanHtml(tagMatch[1]) : '';
    };

    // Eventos
    const events = [];
    const eventTableMatch = rowChunk.match(
      /<table[^>]*grid_evento_pedido[^>]*>([\s\S]*?)<\/table>/i
    );
    if (eventTableMatch) {
      const eventTableHtml = eventTableMatch[1];
      const evMatches = [
        ...eventTableHtml.matchAll(/id_sc_field_idevento_\d+[^>]*>([\s\S]*?)<\/span>/g),
      ];
      const dateMatches = [
        ...eventTableHtml.matchAll(/id_sc_field_fecha_evento_\d+[^>]*>([\s\S]*?)<\/span>/g),
      ];
      const motivoMatches = [
        ...eventTableHtml.matchAll(/id_sc_field_idmotivo_\d+[^>]*>([\s\S]*?)<\/span>/g),
      ];
      const obsMatches = [
        ...eventTableHtml.matchAll(/id_sc_field_observaciones_\d+[^>]*>([\s\S]*?)<\/span>/g),
      ];

      evMatches.forEach((evM, eIdx) => {
        const estado = cleanHtml(evM[1]);
        const fecha = dateMatches[eIdx] ? cleanHtml(dateMatches[eIdx][1]) : '';
        const motivo = motivoMatches[eIdx] ? cleanHtml(motivoMatches[eIdx][1]) : '';
        const obs = obsMatches[eIdx] ? cleanHtml(obsMatches[eIdx][1]) : '';
        if (estado) {
          events.push({
            phase: motivo && motivo !== '&nbsp;' ? motivo : 'Entregar',
            status: estado,
            date: fecha,
            time: '',
            agency: getField('idexpreso') || 'Transportes Entregar',
            description: obs && obs !== '&nbsp;' ? obs : '',
          });
        }
      });
    }

    const rawStatus = getField('idstatus') || '';
    const rawStatusUpper = rawStatus.toUpperCase();
    let statusCategory = 'in_transit';
    let statusLabel = rawStatus || 'En proceso';

    if (
      rawStatusUpper.includes('NO ENTREGADO') ||
      rawStatusUpper.includes('INCIDENCIA') ||
      rawStatusUpper.includes('RECHAZ') ||
      rawStatusUpper.includes('SINIESTRO') ||
      rawStatusUpper.includes('FALLID')
    ) {
      statusCategory = 'incident';
      statusLabel = rawStatus || 'Con incidencia';
    } else if (rawStatusUpper.includes('ENTREGADO')) {
      statusCategory = 'delivered';
      statusLabel = 'Entregado';
    } else if (rawStatusUpper.includes('RECIBIDO DC')) {
      statusCategory = 'received';
      statusLabel = 'Recibido en depósito central';
    } else if (rawStatusUpper.includes('RENDIDO')) {
      statusCategory = 'administrative';
      statusLabel = 'Rendido (cierre administrativo)';
    } else if (
      rawStatusUpper.includes('TRANSITO') ||
      rawStatusUpper.includes('CABECERA') ||
      rawStatusUpper.includes('TERMINAL') ||
      rawStatusUpper.includes('EXPRESO')
    ) {
      statusCategory = 'in_transit';
      statusLabel = 'En tránsito';
    } else if (
      rawStatusUpper.includes('STOCK') ||
      rawStatusUpper.includes('PROCESO') ||
      rawStatusUpper.includes('PREPARADO') ||
      rawStatusUpper.includes('CARTA PORTE')
    ) {
      statusCategory = 'received';
      statusLabel = 'En preparación / depósito';
    } else if (rawStatusUpper.includes('PENDIENTE')) {
      statusCategory = 'received';
      statusLabel = 'Pendiente de retiro';
    }

    const refCode = getField('idreferencia') || '';
    const aux1 = getField('varchar_aux1') || '';
    const aux2 = getField('varchar_aux2') || '';
    const classification = classifyEntregarRef(refCode, aux1, aux2);

    // Extraer productos detallados de la sub-tabla grid_detalle_pedido
    const products = [];
    const prodTableMatch =
      rowChunk.match(
        new RegExp('<table[^>]*apl_grid_detalle_pedido#\\?#' + rowNum + '[\\s\\S]*?<\\/table>', 'i')
      ) || rowChunk.match(/<table[^>]*grid_detalle_pedido[^>]*>([\s\S]*?)<\/table>/i);

    if (prodTableMatch) {
      const tableHtml = prodTableMatch[0];
      const prodMatches = [
        ...tableHtml.matchAll(/id_sc_field_idproducto_\d+[^>]*>([\s\S]*?)<\/span>/g),
      ];
      const descMatches = [
        ...tableHtml.matchAll(/id_sc_field_descripcion_\d+[^>]*>([\s\S]*?)<\/span>/g),
      ];
      const cantMatches = [
        ...tableHtml.matchAll(/id_sc_field_cantidad_\d+[^>]*>([\s\S]*?)<\/span>/g),
      ];
      const pesoMatches = [
        ...tableHtml.matchAll(/id_sc_field_peso_kg_\d+[^>]*>([\s\S]*?)<\/span>/g),
      ];
      const volMatches = [
        ...tableHtml.matchAll(/id_sc_field_volumen_m3_\d+[^>]*>([\s\S]*?)<\/span>/g),
      ];

      prodMatches.forEach((p, pIdx) => {
        const pCode = cleanHtml(p[1]);
        const desc = cleanHtml(descMatches[pIdx]?.[1]);
        const cant = cleanHtml(cantMatches[pIdx]?.[1]);
        const pKg = cleanHtml(pesoMatches[pIdx]?.[1]);
        const vol = cleanHtml(volMatches[pIdx]?.[1]);

        if (pCode || desc) {
          products.push({
            codigo: pCode,
            descripcion: desc,
            bultos: quantity(cant),
            peso: pKg || '',
            volumen: vol || '',
          });
        }
      });
    }

    if (products.length === 0 && getField('descripcion')) {
      products.push({
        codigo: '',
        descripcion: getField('descripcion'),
        bultos: quantity(getField('cantidad_bultos')),
        peso: getField('peso_total_kg') || '',
        volumen: '',
      });
    }

    let bultosVal = getField('cantidad_bultos');
    if (!bultosVal && products.length > 0) {
      const sumBultos = products.reduce((acc, p) => acc + (parseInt(p.bultos, 10) || 0), 0);
      if (sumBultos > 0) bultosVal = sumBultos.toString();
    }

    pedidos.push({
      idpedido: getField('idpedido'),
      empresa: getField('idempresa'),
      operacion: getField('idtipo_operacion'),
      operacionActual: getField('idtipo_operacion_actual'),
      referencia: refCode || aux2,
      remito: getField('nro_remito'),
      servicio: getField('idtipo_servicio'),
      destinatario: getField('nombre'),
      fechaInterfaz: getField('fecha_interfaz'),
      zona: getField('zona'),
      expreso: getField('idexpreso'),
      status: rawStatus,
      statusCategory,
      statusLabel,
      fechaStatus: getField('fecha_status'),
      direccion: [getField('direccion'), getField('idlocalidad'), getField('idprovincia')]
        .filter(Boolean)
        .join(', '),
      bultos: quantity(bultosVal),
      peso: getField('peso_total_kg'),
      producto:
        products.length > 0
          ? products.map((p) => `${p.bultos || 1}x ${p.descripcion || p.codigo}`).join(' • ')
          : getField('descripcion'),
      products,
      campoAuxiliar1: aux1,
      campoAuxiliar2: aux2,
      classification,
      events,
    });
  }

  // Vincular tramos de cambio (ZECH con ZRE7)
  linkExchangePairs(pedidos);

  return pedidos;
}

async function trackEntregar(rawOrder) {
  const code = (rawOrder || '').trim();
  const cookie = getEntregarCookie();
  const searchPostUrl = 'https://svr.entregar.net.ar/e_transport/grid_view_consulta_pedidos/';
  const fallbackBghUrl = `https://svr.entregar.net.ar/tracking_bgh/landingPage.php?numero_orden=${encodeURIComponent(code)}&numero_hash=&boton=Consultar`;

  const postData = `nmgp_fast_search=SC_all_Cmp&nmgp_cond_fast_search=qp&nmgp_arg_fast_search=${encodeURIComponent(code)}&script_case_init=491&nmgp_opcao=fast_search`;

  if (!cookie)
    return {
      success: false,
      carrier: 'entregar',
      order: code,
      needSession: true,
      message: 'Configurá una sesión de Entregar para consultar.',
    };
  try {
    const response = await requestText(
      'https://svr.entregar.net.ar/e_transport/grid_view_consulta_pedidos/index.php',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Cookie: cookie,
          Referer: searchPostUrl,
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: postData,
      }
    );
    const body = response.body;
    if ([301, 302, 303, 307, 308, 401, 403].includes(response.statusCode))
      return {
        success: false,
        carrier: 'entregar',
        order: code,
        needSession: true,
        message: 'Entregar requiere renovar o verificar la sesión de acceso.',
      };
    if (response.statusCode !== 200)
      return {
        success: false,
        carrier: 'entregar',
        order: code,
        errorCode: 'UPSTREAM_UNAVAILABLE',
        message: `Entregar no pudo responder (HTTP ${response.statusCode}). Reintentá más tarde.`,
      };
    if (
      body.includes('app_Login') ||
      body.includes('id="id_form_app_Login"') ||
      body.includes('session_timeout')
    ) {
      return {
        success: false,
        carrier: 'entregar',
        order: code,
        officialUrl: fallbackBghUrl,
        needSession: true,
        message: 'La sesión de Entregar ha expirado. Es necesario renovar la cookie de acceso.',
      };
    }

    if (
      !/id_sc_field_idempresa_|grid_view_consulta_pedidos|scGrid|no se encontraron|sin registros/i.test(
        body
      )
    ) {
      return {
        success: false,
        carrier: 'entregar',
        order: code,
        errorCode: 'UPSTREAM_RESPONSE',
        message: 'Entregar devolvió una página inesperada. Reintentá o verificá la sesión.',
      };
    }
    const pedidos = parseEntregarHtml(body);
    if (!pedidos || pedidos.length === 0) {
      return {
        success: false,
        carrier: 'entregar',
        order: code,
        officialUrl: fallbackBghUrl,
        message: 'No se encontró ningún envío asociado a este código en Entregar.',
      };
    }

    const primary = pedidos[0];
    const primaryRef = primary.referencia || code;
    const primaryOfficialUrl = `https://svr.entregar.net.ar/tracking_bgh/landingPage.php?numero_orden=${encodeURIComponent(primaryRef)}&numero_hash=&boton=Consultar`;

    return {
      success: true,
      carrier: 'entregar',
      order: code,
      guiaNumero: primary.remito || primary.idpedido,
      referenciaEnvio: primary.referencia || code,
      officialUrl: primaryOfficialUrl,
      statusCategory: primary.statusCategory,
      statusLabel: primary.statusLabel,
      classification: primary.classification,
      campoAuxiliar1: primary.campoAuxiliar1,
      campoAuxiliar2: primary.campoAuxiliar2,
      summary: {
        guiaNumero: primary.remito || primary.idpedido,
        clienteCodigo: primary.destinatario || code,
        remitente: primary.empresa ? `Empresa ${primary.empresa}` : 'BGH / Entregar',
        linea: primary.expreso || 'Transportes Entregar',
        producto: primary.producto || 'Mercadería general',
        servicio:
          [primary.servicio, primary.operacion].filter(Boolean).join(' • ') ||
          'Distribución Entregar',
        fechaEstado: primary.fechaStatus,
      },
      detail: {
        referencia: primary.referencia,
        remito: primary.remito,
        operacion: primary.operacion,
        destinatario: primary.destinatario,
        direccion: primary.direccion,
        bultos: primary.bultos,
        peso: primary.peso,
        zona: primary.zona,
        products: primary.products || [],
      },
      products: primary.products || [],
      bultos: primary.bultos,
      peso: primary.peso,
      movements: primary.events,
      allOrders: pedidos.map((p) => {
        const pRef = p.referencia || code;
        return {
          idpedido: p.idpedido,
          empresa: p.empresa,
          operacion: p.operacion,
          referencia: p.referencia,
          remito: p.remito,
          destinatario: p.destinatario,
          officialUrl: `https://svr.entregar.net.ar/tracking_bgh/landingPage.php?numero_orden=${encodeURIComponent(pRef)}&numero_hash=&boton=Consultar`,
          status: p.status,
          statusCategory: p.statusCategory,
          statusLabel: p.statusLabel,
          fechaStatus: p.fechaStatus,
          direccion: p.direccion,
          expreso: p.expreso,
          servicio: p.servicio,
          bultos: p.bultos,
          peso: p.peso,
          producto: p.producto,
          products: p.products || [],
          campoAuxiliar1: p.campoAuxiliar1,
          campoAuxiliar2: p.campoAuxiliar2,
          classification: p.classification,
          movements: p.events,
        };
      }),
    };
  } catch (err) {
    return {
      success: false,
      carrier: 'entregar',
      order: code,
      errorCode: err.code || 'UPSTREAM_UNAVAILABLE',
      message: 'No se pudo conectar con Entregar. Reintentá en unos instantes.',
    };
  }
}

// Servidor HTTP.
const adapters = { urbano: trackUrbano, andreani: trackAndreani, entregar: trackEntregar };
const server = http.createServer(
  createHandler({
    publicDir: PUBLIC_DIR,
    adapters,
    getSession: session.status,
    updateSession: session.update,
    mimeTypes: MIME_TYPES,
  })
);
server.requestTimeout = 240000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 50;
let keepalive;
function startServer(port) {
  server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`SEGUIMIENTO BGH disponible en http://localhost:${server.address().port}`);
    keepalive = setInterval(() => pingEntregar().catch(() => {}), 10 * 60 * 1000);
    keepalive.unref();
  });
}
if (require.main === module) {
  startServer(Number(process.env.PORT || 3333));
  server.on('error', (err) => {
    console.error(JSON.stringify({ event: 'server_error', code: err.code }));
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      clearInterval(keepalive);
      server.close(() => {
        process.exitCode = 0;
      });
      const timer = setTimeout(() => {
        server.closeAllConnections();
      }, 10000);
      timer.unref();
    });
}
module.exports = {
  server,
  trackUrbano,
  trackAndreani,
  trackEntregar,
  parseEntregarHtml,
  classifyEntregarRef,
  linkExchangePairs,
  cleanHtml,
};
