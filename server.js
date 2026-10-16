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

    if (tituloUpper.includes('ENTREGADO')) {
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
      if (order.startsWith('2000') || order.startsWith('4004') || (/^\d{15,16}$/.test(order))) {
        carrier = 'andreani';
      } else {
        carrier = 'urbano';
      }
    }

    let result;
    if (carrier === 'andreani') {
      result = await trackAndreani(order);
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
          if (carrier === 'andreani' || cleanOrd.startsWith('2000') || cleanOrd.startsWith('4004')) {
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
    console.log(`  Página sin nombre - Seguimiento Urbano & Andreani`);
    console.log(`  👉 Servidor listo en: http://localhost:${port}`);
    console.log(`====================================================`);
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
