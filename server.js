const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3333;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Helper: Limpiar entidades y tags HTML
function cleanHtml(str) {
  if (!str) return '';
  return str
    .replace(/<br\s*[\/]?>/gi, ' - ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
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

// -------------------------------------------------------------
// TRACKING URBANO EXPRESS
// -------------------------------------------------------------
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
    const pageRes = await fetch(officialUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
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
        message: 'No se encontró ningún envío asociado a este número de pedido en Urbano.'
      };
    }

    const decodedJsonStr = decodeHtmlEntities(rowMatch[2]);
    let rowData = {};
    try {
      rowData = JSON.parse(decodedJsonStr);
    } catch (e) {
      console.error('Error parsing JSON from row:', e.message);
    }

    if (!rowData || (rowData.cliId === '0' && !rowData.gui_numero && (!rowData.estado || rowData.estado.includes('Sin informaci')))) {
      return {
        success: false,
        carrier: 'urbano',
        order,
        shipper,
        fullTracking,
        officialUrl,
        message: 'No se encontró ningún envío registrado en Urbano con este número de pedido.',
        summary: rowData
      };
    }

    let movements = [];
    let detailInfo = {};

    try {
      const form = new URLSearchParams();
      form.append('accion', 'getDetalle');
      form.append('param1', decodedJsonStr);

      const detailRes = await fetch('https://apis.urbano.com.ar/cespecifica/class/especifica_controller.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Referer': officialUrl
        },
        body: form.toString()
      });

      if (detailRes.ok) {
        const detailHtml = await detailRes.text();

        const extractField = (fieldName) => {
          const regex = new RegExp(`${fieldName}:[\\s\\S]*?<span[^>]*>([\\s\\S]*?)(?:<\\/span>|<\\/div>|\\r?\\n)`, 'i');
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
          telefono: extractField('Teléfono')
        };

        const tbodyMatch = detailHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
        if (tbodyMatch) {
          const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/gi) || [];
          for (const r of rows) {
            const cells = Array.from(r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map(c => 
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
                courier: cells[6] || ''
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

    if (rawEstadoUpper.startsWith('DL') || rawEstadoUpper.includes('ENTREGADO')) {
      statusCategory = 'delivered';
      statusLabel = 'Entregado';
    } else if (rawEstadoUpper.startsWith('LD') || rawEstadoUpper.includes('CAMINO') || rawEstadoUpper.includes('DISTRIBUCION')) {
      statusCategory = 'out_for_delivery';
      statusLabel = 'En camino / Distribución';
    } else if (rawEstadoUpper.startsWith('AR') || rawEstadoUpper.startsWith('AS') || rawEstadoUpper.includes('SUCURSAL')) {
      statusCategory = 'branch';
      statusLabel = 'En sucursal de destino';
    } else if (rawEstadoUpper.startsWith('CO') || rawEstadoUpper.includes('CONTENERIZADO')) {
      statusCategory = 'in_transit';
      statusLabel = 'En tránsito entre centros';
    } else if (rawEstadoUpper.startsWith('PI') || rawEstadoUpper.startsWith('IF') || rawEstadoUpper.startsWith('GE')) {
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
        servicio: [rowData.servicio, rowData.linea].filter(Boolean).join(' • ') || 'Distribución Estándar',
        ciclo: rowData.ciclo || '',
        estadoRaw: rowData.estado || '',
        fechaEstado: rowData.fechaEstado || ''
      },
      detail: detailInfo,
      movements
    };
  } catch (err) {
    console.error('Error tracking Urbano:', err);
    return {
      success: false,
      carrier: 'urbano',
      order,
      shipper,
      fullTracking,
      officialUrl,
      message: `Error al consultar Urbano: ${err.message}`
    };
  }
}

// -------------------------------------------------------------
// TRACKING ANDREANI (Conexión directa a API oficial vía Cloudflare)
// -------------------------------------------------------------
function encryptAES(text, keyStr, ivStr) {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(keyStr, 'utf8'), Buffer.from(ivStr, 'utf8'));
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function fetchAndreaniFromCF(encryptedPayload) {
  return new Promise((resolve, reject) => {
    const authHeader = "XqPMiwXzTRKHH0mF3gmtPtQt3LNGIuqCTdgaUHINMdmlaFid0x9MzlYTKXPxluYQ";
    const ips = ['104.18.22.26', '104.18.23.26'];
    let attempt = 0;

    function tryConnect() {
      const ip = ips[attempt % ips.length];
      const req = https.request({
        hostname: ip,
        port: 443,
        path: `/api/v3/Tracking?payload=${encodeURIComponent(encryptedPayload)}`,
        method: 'GET',
        headers: {
          'Host': 'tracking-api.andreani.com',
          'Authorization': authHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        servername: 'tracking-api.andreani.com',
        timeout: 9000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        if (++attempt < ips.length) {
          tryConnect();
        } else {
          reject(new Error('Timeout al consultar los servidores de Andreani'));
        }
      });

      req.on('error', (err) => {
        if (++attempt < ips.length) {
          tryConnect();
        } else {
          reject(err);
        }
      });

      req.end();
    }

    tryConnect();
  });
}

async function trackAndreani(rawOrder) {
  const code = (rawOrder || '').trim();
  const apiKey = "12345678901234567890123456789012";
  const apiIv = "1234567890123456";

  const payloadObj = {
    idReceptor: "1",
    idSistema: "1",
    userData: "{}",
    numeroAndreani: code
  };

  const encrypted = encryptAES(JSON.stringify(payloadObj), apiKey, apiIv);

  try {
    const res = await fetchAndreaniFromCF(encrypted);
    if (res.statusCode !== 200 || !res.body) {
      return {
        success: false,
        carrier: 'andreani',
        order: code,
        officialUrl: `https://www.andreani.com/envio/${encodeURIComponent(code)}`,
        message: 'No se encontró ningún envío registrado en Andreani con este número de pedido o guía.'
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
        message: 'Respuesta inválida recibida desde Andreani.'
      };
    }

    if (!parsed || !parsed.numeroAndreani) {
      return {
        success: false,
        carrier: 'andreani',
        order: code,
        officialUrl: `https://www.andreani.com/envio/${encodeURIComponent(code)}`,
        message: 'No se encontró ningún envío asociado a este número en Andreani.'
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
              rawDate: ev.fechaEvento
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

    if (tituloUpper.includes('NO ENTREGADO') || tituloUpper.includes('NO PUDO') || tituloUpper.includes('VISITADO') || tituloUpper.includes('INCIDENCIA') || tituloUpper.includes('RECHAZ') || tituloUpper.includes('DEVUELTO') || tituloUpper.includes('SINIESTRO') || tituloUpper.includes('FALLID')) {
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
      if (latestPhaseUpper.includes('NO ENTREGADO') || latestStatusUpper.includes('NO LOGRAMOS') || latestStatusUpper.includes('NO SE PUDO')) {
        statusCategory = 'incident';
        statusLabel = latestMov.phase || 'No entregado';
      }
    }

    const guia = parsed.numeroAndreani || code;
    const officialUrl = `https://www.andreani.com/envio/${encodeURIComponent(guia)}`;
    const remitente = parsed.nombreRemitente || parsed.cliente?.nombreFantasia || parsed.cliente?.nombre || '';
    const contratoDesc = parsed.cliente?.contrato?.descripcion || '';
    const tipoEntrega = parsed.cliente?.contrato?.tipoDeEntrega || '';
    const servicioStr = [contratoDesc, tipoEntrega].filter(Boolean).join(' • ') || 'Distribución Andreani';

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
        fechaEstado: parsed.procesoActual?.fechaUltimoEvento ? parsed.procesoActual.fechaUltimoEvento.replace('T', ' ').slice(0, 16) : ''
      },
      detail: {
        referencia: code,
        remitente: remitente,
        observaciones: cleanHtml(parsed.procesoActual?.observaciones || ''),
        direccion: parsed.ultimaMilla?.domicilioDestino || 'Nacional'
      },
      movements
    };
  } catch (err) {
    console.error('Error tracking Andreani:', err);
    return {
      success: false,
      carrier: 'andreani',
      order: code,
      officialUrl: `https://www.andreani.com/envio/${encodeURIComponent(code)}`,
      message: `Error al consultar Andreani: ${err.message}`
    };
  }
}

// -------------------------------------------------------------
// TRACKING ENTREGAR (Scriptcase e_transport)
// -------------------------------------------------------------
const SESSION_FILE = path.join(__dirname, 'entregar_session.json');
let cachedEntregarCookie = null;
let lastEntregarPing = null;
let lastEntregarPingStatus = null;

function getEntregarCookie() {
  if (process.env.ENTREGAR_COOKIE) return process.env.ENTREGAR_COOKIE.trim();
  if (cachedEntregarCookie) return cachedEntregarCookie;
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      if (parsed && parsed.cookie) {
        cachedEntregarCookie = parsed.cookie.trim();
        return cachedEntregarCookie;
      }
    }
  } catch (e) {
    console.error('Error reading session file:', e.message);
  }
  return 'PHPSESSID_=bmV0bWFrZT9hMzgwYTZkNmYxYjU1NTUz; PHPSESSID=mjbp0gbjgrfvn8chubmp9kjgtj; sc_actual_lang_GT_TMS=es';
}

function saveEntregarCookie(cookie) {
  cachedEntregarCookie = (cookie || '').trim();
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({
      cookie: cachedEntregarCookie,
      updatedAt: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving entregar_session.json:', e.message);
  }
}

function pingEntregar() {
  return new Promise((resolve) => {
    const cookie = getEntregarCookie();
    const req = https.get('https://svr.entregar.net.ar/e_transport/MenuPrincipal/MenuPrincipal_pag_ini.php', {
      headers: {
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 8000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        lastEntregarPing = new Date().toISOString();
        lastEntregarPingStatus = res.statusCode === 200 && !body.includes('app_Login');
        resolve({ ok: lastEntregarPingStatus, statusCode: res.statusCode });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, error: err.message });
    });
  });
}

function getShortRef(ref) {
  if (!ref) return '';
  const match = String(ref).trim().match(/^(ZECO|ZECH|ZRE7|ZRE2)_0*(\d+)/i);
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
      isExchange: false
    };
  }
  if (r.startsWith('ZECH')) {
    return {
      code: 'ZECH',
      type: 'swap_dispatch',
      label: 'Despacho por Cambio',
      badgeText: '🔄 Despacho Cambio (ZECH)',
      shortRef,
      description: 'Despacho de producto nuevo por cambio contra entrega (se entrega el nuevo y se retira el producto anterior).',
      isExchange: true,
      linkedInfo: aux2 || ''
    };
  }
  if (r.startsWith('ZRE7')) {
    return {
      code: 'ZRE7',
      type: 'swap_pickup',
      label: 'Retiro por Cambio',
      badgeText: '🔄 Retiro Cambio (ZRE7)',
      shortRef,
      description: 'Retiro de producto defectuoso/dañado por cambio contra entrega (debe realizarse junto con la entrega del nuevo).',
      isExchange: true,
      linkedInfo: aux2 || ''
    };
  }
  if (r.startsWith('ZRE2')) {
    return {
      code: 'ZRE2',
      type: 'return_pickup',
      label: 'Retiro por Devolución Directa',
      badgeText: '↩️ Devolución Directa (ZRE2)',
      shortRef,
      description: 'Retiro del producto devuelto por el cliente sin entrega de producto de reemplazo.',
      isExchange: false
    };
  }
  return {
    code: 'OTRO',
    type: 'general',
    label: 'Envío General',
    badgeText: 'Envío General',
    shortRef,
    description: '',
    isExchange: false
  };
}

function linkExchangePairs(pedidos) {
  if (!Array.isArray(pedidos) || pedidos.length < 2) return;

  for (let i = 0; i < pedidos.length; i++) {
    const p = pedidos[i];
    if (!p.classification) continue;
    p.classification.shortRef = getShortRef(p.referencia);

    if (!p.classification.isExchange) continue;

    const myCode = p.classification.code; // 'ZECH' or 'ZRE7'
    const targetCode = myCode === 'ZECH' ? 'ZRE7' : 'ZECH';
    const aux2 = (p.campoAuxiliar2 || '').toUpperCase();

    // 1. Extraer número objetivo de aux2 (ej: "1665981227714-01 ZRe7 60090180" -> "60090180")
    const targetMatch = aux2.match(new RegExp(`${targetCode}\\s*(\\d+)`, 'i'));
    const targetNum = targetMatch ? targetMatch[1] : null;

    let partner = null;
    let partnerIdx = -1;

    if (targetNum) {
      for (let j = 0; j < pedidos.length; j++) {
        if (i === j) continue;
        const other = pedidos[j];
        if (other.classification && other.classification.code === targetCode) {
          const otherRef = (other.referencia || '').toUpperCase();
          if (otherRef.includes(targetNum)) {
            partner = other;
            partnerIdx = j;
            break;
          }
        }
      }
    }

    // 2. Si no se encontró por aux2 propio, buscar si algún otro pedido menciona el número de este en su aux2
    if (!partner) {
      const myRef = (p.referencia || '').toUpperCase();
      const myNumMatch = myRef.match(/(?:ZECH|ZRE7)_0*(\d+)/i);
      const myNum = myNumMatch ? myNumMatch[1] : null;

      if (myNum) {
        for (let j = 0; j < pedidos.length; j++) {
          if (i === j) continue;
          const other = pedidos[j];
          if (other.classification && other.classification.code === targetCode) {
            const otherAux2 = (other.campoAuxiliar2 || '').toUpperCase();
            if (otherAux2.includes(myNum)) {
              partner = other;
              partnerIdx = j;
              break;
            }
          }
        }
      }
    }

    // 3. Fallback: Si sólo hay exactamente un pedido candidato con el targetCode opuesto, se asocian
    if (!partner) {
      const candidates = pedidos
        .map((op, oIdx) => ({ op, oIdx }))
        .filter(({ op, oIdx }) => oIdx !== i && op.classification && op.classification.code === targetCode);
      if (candidates.length === 1) {
        partner = candidates[0].op;
        partnerIdx = candidates[0].oIdx;
      }
    }

    if (partner && partnerIdx !== -1) {
      p.classification.pairedOrder = {
        index: partnerIdx,
        idpedido: partner.idpedido,
        referencia: partner.referencia,
        shortRef: getShortRef(partner.referencia),
        remito: partner.remito,
        operacion: partner.operacion,
        status: partner.status,
        statusLabel: partner.statusLabel,
        code: partner.classification.code,
        type: partner.classification.type,
        badgeText: partner.classification.badgeText
      };
    }
  }
}

function parseEntregarHtml(content) {
  const rowMatches = [...content.matchAll(/id_sc_field_idempresa_(\d+)/g)];
  if (!rowMatches.length) return [];

  const pedidos = [];

  for (let idx = 0; idx < rowMatches.length; idx++) {
    const rowNum = rowMatches[idx][1];
    const startIndex = rowMatches[idx].index;
    const endIndex = idx + 1 < rowMatches.length ? rowMatches[idx + 1].index : content.length;
    const rowChunk = content.substring(startIndex, endIndex);

    const getField = (name) => {
      const regex = new RegExp(`(<td[^>]*>[\\s\\S]*?id_sc_field_${name}_${rowNum}[^>]*>([\\s\\S]*?)<\\/(?:span|a)>[\\s\\S]*?<\\/td>)`, 'gi');
      const matches = [...rowChunk.matchAll(regex)];
      if (!matches.length) return '';
      const mainCell = matches.find(m => !m[1].includes('grid_evento_pedido')) || matches[matches.length - 1];
      const tagMatch = mainCell[1].match(new RegExp(`id_sc_field_${name}_${rowNum}[^>]*>([\\s\\S]*?)<\\/(?:span|a)>`, 'i'));
      return tagMatch ? cleanHtml(tagMatch[1]) : '';
    };

    // Eventos
    const events = [];
    const eventTableMatch = rowChunk.match(/<table[^>]*grid_evento_pedido[^>]*>([\s\S]*?)<\/table>/i);
    if (eventTableMatch) {
      const eventTableHtml = eventTableMatch[1];
      const evMatches = [...eventTableHtml.matchAll(/id_sc_field_idevento_\d+[^>]*>([\s\S]*?)<\/span>/g)];
      const dateMatches = [...eventTableHtml.matchAll(/id_sc_field_fecha_evento_\d+[^>]*>([\s\S]*?)<\/span>/g)];
      const motivoMatches = [...eventTableHtml.matchAll(/id_sc_field_idmotivo_\d+[^>]*>([\s\S]*?)<\/span>/g)];
      const obsMatches = [...eventTableHtml.matchAll(/id_sc_field_observaciones_\d+[^>]*>([\s\S]*?)<\/span>/g)];

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
            description: obs && obs !== '&nbsp;' ? obs : ''
          });
        }
      });
    }

    const rawStatus = getField('idstatus') || '';
    const rawStatusUpper = rawStatus.toUpperCase();
    let statusCategory = 'in_transit';
    let statusLabel = rawStatus || 'En proceso';

    if (rawStatusUpper.includes('NO ENTREGADO') || rawStatusUpper.includes('INCIDENCIA') || rawStatusUpper.includes('RECHAZ') || rawStatusUpper.includes('SINIESTRO') || rawStatusUpper.includes('FALLID')) {
      statusCategory = 'incident';
      statusLabel = rawStatus || 'Con incidencia';
    } else if (rawStatusUpper.includes('ENTREGADO') || rawStatusUpper.includes('RECIBIDO DC') || rawStatusUpper.includes('RENDIDO')) {
      statusCategory = 'delivered';
      statusLabel = rawStatusUpper.includes('RECIBIDO DC') ? 'Recibido en depósito central' : 'Entregado';
    } else if (rawStatusUpper.includes('TRANSITO') || rawStatusUpper.includes('CABECERA') || rawStatusUpper.includes('TERMINAL') || rawStatusUpper.includes('EXPRESO')) {
      statusCategory = 'in_transit';
      statusLabel = 'En tránsito';
    } else if (rawStatusUpper.includes('STOCK') || rawStatusUpper.includes('PROCESO') || rawStatusUpper.includes('PREPARADO') || rawStatusUpper.includes('CARTA PORTE')) {
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
      direccion: [getField('direccion'), getField('idlocalidad'), getField('idprovincia')].filter(Boolean).join(', '),
      bultos: getField('cantidad_bultos'),
      peso: getField('peso_total_kg'),
      producto: getField('descripcion'),
      campoAuxiliar1: aux1,
      campoAuxiliar2: aux2,
      classification,
      events
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

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'svr.entregar.net.ar',
      port: 443,
      path: '/e_transport/grid_view_consulta_pedidos/index.php',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Content-Length': Buffer.byteLength(postData),
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://svr.entregar.net.ar',
        'Referer': searchPostUrl,
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (body.includes('app_Login') || body.includes('id="id_form_app_Login"') || body.includes('session_timeout')) {
          return resolve({
            success: false,
            carrier: 'entregar',
            order: code,
            officialUrl: fallbackBghUrl,
            needSession: true,
            message: 'La sesión de Entregar ha expirado. Es necesario renovar la cookie de acceso.'
          });
        }

        const pedidos = parseEntregarHtml(body);
        if (!pedidos || pedidos.length === 0) {
          return resolve({
            success: false,
            carrier: 'entregar',
            order: code,
            officialUrl: fallbackBghUrl,
            message: 'No se encontró ningún envío asociado a este código en Entregar.'
          });
        }

        const primary = pedidos[0];
        const primaryRef = primary.referencia || code;
        const primaryOfficialUrl = `https://svr.entregar.net.ar/tracking_bgh/landingPage.php?numero_orden=${encodeURIComponent(primaryRef)}&numero_hash=&boton=Consultar`;

        resolve({
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
            servicio: [primary.servicio, primary.operacion].filter(Boolean).join(' • ') || 'Distribución Entregar',
            fechaEstado: primary.fechaStatus
          },
          detail: {
            referencia: primary.referencia,
            remito: primary.remito,
            operacion: primary.operacion,
            destinatario: primary.destinatario,
            direccion: primary.direccion,
            bultos: primary.bultos,
            peso: primary.peso,
            zona: primary.zona
          },
          movements: primary.events,
          allOrders: pedidos.map(p => {
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
              campoAuxiliar1: p.campoAuxiliar1,
              campoAuxiliar2: p.campoAuxiliar2,
              classification: p.classification,
              movements: p.events
            };
          })
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        carrier: 'entregar',
        order: code,
        officialUrl: fallbackBghUrl,
        message: 'Tiempo de espera agotado al consultar los servidores de Entregar.'
      });
    });

    req.on('error', (err) => {
      resolve({
        success: false,
        carrier: 'entregar',
        order: code,
        officialUrl: fallbackBghUrl,
        message: `Error de red al conectar con Entregar: ${err.message}`
      });
    });

    req.write(postData);
    req.end();
  });
}

// -------------------------------------------------------------
// SERVIDOR HTTP
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: GET /api/entregar/session
  if (req.method === 'GET' && pathname === '/api/entregar/session') {
    const hasCookie = Boolean(getEntregarCookie());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      hasCookie,
      lastPing: lastEntregarPing,
      lastPingStatus: lastEntregarPingStatus
    }));
    return;
  }

  // API: POST /api/entregar/session
  if (req.method === 'POST' && pathname === '/api/entregar/session') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { cookie } = JSON.parse(body || '{}');
        if (!cookie || typeof cookie !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Se requiere la cookie en el body' }));
          return;
        }
        saveEntregarCookie(cookie);
        const testRes = await pingEntregar();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, verified: testRes.ok }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Error procesando solicitud' }));
      }
    });
    return;
  }

  // API: GET /api/track
  if (req.method === 'GET' && pathname === '/api/track') {
    const order = (parsedUrl.query.order || '').trim();
    const shipper = parsedUrl.query.shipper || '004185';
    let carrier = (parsedUrl.query.carrier || '').toLowerCase();

    if (!order) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Falta el parámetro ?order' }));
      return;
    }

    // Auto-detección inteligente si no viene forzado
    if (!carrier) {
      if (order.includes('-0') || /^\d{13}-\d{2}$/.test(order) || order.startsWith('ZRE') || order.startsWith('ZECH') || order.startsWith('ZECO')) {
        carrier = 'entregar';
      } else if (order.startsWith('2000') || order.startsWith('4004') || (/^\d{15,16}$/.test(order))) {
        carrier = 'andreani';
      } else {
        carrier = 'urbano';
      }
    }

    let result;
    if (carrier === 'andreani') {
      result = await trackAndreani(order);
    } else if (carrier === 'entregar') {
      result = await trackEntregar(order);
    } else {
      result = await trackUrbano(order, shipper);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // API: POST /api/track-batch
  if (req.method === 'POST' && pathname === '/api/track-batch') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { orders, shipper = '004185', carrier = 'urbano' } = JSON.parse(body || '{}');
        if (!Array.isArray(orders) || orders.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: 'Se espera un array "orders"' }));
          return;
        }

        const limited = orders.slice(0, 25).filter(o => typeof o === 'string' && o.trim().length > 0);
        const results = [];

        for (const ord of limited) {
          const cleanOrd = ord.trim();
          let r;
          if (carrier === 'entregar' || cleanOrd.includes('-0') || cleanOrd.startsWith('ZRE') || cleanOrd.startsWith('ZECH') || cleanOrd.startsWith('ZECO')) {
            r = await trackEntregar(cleanOrd);
          } else if (carrier === 'andreani' || cleanOrd.startsWith('2000') || cleanOrd.startsWith('4004')) {
            r = await trackAndreani(cleanOrd);
          } else {
            r = await trackUrbano(cleanOrd, shipper);
          }
          results.push(r);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: results.length, results }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'JSON inválido' }));
      }
    });
    return;
  }

  // Archivos estáticos
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(fallback, (err2, content) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          res.end(content);
        }
      });
      return;
    }

    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err3, content) => {
      if (err3) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error interno del servidor');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });
});

const DEFAULT_PORT = parseInt(process.env.PORT || '3333', 10);
const HOST = '0.0.0.0';

function startServer(port) {
  const s = server.listen(port, HOST, () => {
    console.log(`====================================================`);
    console.log(`  Página sin nombre - Seguimiento Urbano, Andreani & Entregar`);
    console.log(`  👉 Servidor listo en: http://localhost:${port}`);
    console.log(`====================================================`);

    // Iniciar ping de keepalive para mantener activa la sesión de Entregar (cada 10 minutos)
    setInterval(() => {
      pingEntregar().then(res => {
        if (!res.ok) console.log('[Entregar] Keepalive aviso: sesión requiere renovación');
      }).catch(() => {});
    }, 10 * 60 * 1000);
  });

  s.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && !process.env.PORT) {
      console.log(`Puerto ${port} ocupado localmente, probando con ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Error en el servidor:', err);
      process.exit(1);
    }
  });
}

startServer(DEFAULT_PORT);
