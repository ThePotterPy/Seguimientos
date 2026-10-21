const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AppError, inputString, runTracking, mapLimit } = require('./runtime');

function json(res, status, body) {
  if (!res.destroyed && !res.writableEnded) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  }
}
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384)
      throw new AppError('La solicitud supera el máximo de 16 KB.', 413, 'BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    return parsed;
  } catch {
    throw new AppError('Se requiere un objeto JSON válido.');
  }
}
function carrierValue(value = 'auto') {
  if (typeof value !== 'string' || !['auto', 'urbano', 'andreani', 'entregar'].includes(value))
    throw new AppError('Transportista inválido.');
  return value;
}
function createHandler({
  publicDir,
  adapters,
  getSession,
  updateSession,
  mimeTypes,
  logger = console,
}) {
  const quotas = new Map();
  function charge(req, units) {
    const ip = req.socket.remoteAddress || 'local';
    const now = Date.now();
    let bucket = quotas.get(ip);
    if (!bucket || now > bucket.until) {
      if (quotas.size >= 5000)
        for (const [key, value] of quotas) if (now > value.until) quotas.delete(key);
      if (!bucket && quotas.size >= 5000) throw new AppError('Servidor ocupado.', 503, 'BUSY');
      bucket = { until: now + 60000, used: 0 };
      quotas.set(ip, bucket);
    }
    if (bucket.used + units > 120)
      throw new AppError('Límite de consultas alcanzado. Esperá un minuto.', 429, 'RATE_LIMIT');
    bucket.used += units;
  }
  return async function handler(req, res) {
    const requestId = randomUUID();
    const started = Date.now();
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    res.on('finish', () =>
      logger.log(
        JSON.stringify({
          event: 'http',
          requestId,
          method: req.method,
          status: res.statusCode,
          durationMs: Date.now() - started,
        })
      )
    );
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // CORS para clientes externos.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    try {
      const rawPath = req.url.split('?')[0];
      let pathname;
      try {
        pathname = decodeURIComponent(rawPath);
      } catch {
        throw new AppError('Ruta inválida.');
      }
      if (
        !pathname.startsWith('/') ||
        pathname.includes('\\') ||
        pathname.includes('\0') ||
        pathname.split('/').some((part) => part === '..' || part === '.')
      )
        throw new AppError('Ruta no permitida.', 403);
      const parsed = new URL(req.url, 'http://localhost');
      for (const key of ['order', 'carrier', 'shipper'])
        if (parsed.searchParams.getAll(key).length > 1)
          throw new AppError(`El parámetro ${key} no se puede repetir.`);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (pathname === '/api/health' && req.method === 'GET') {
        json(res, 200, { success: true, status: 'ok' });
        return;
      }
      if (pathname.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        charge(req, 1);
        if (pathname === '/api/entregar/session' && req.method === 'GET') {
          json(res, 200, { success: true, ...getSession() });
          return;
        }
        if (pathname === '/api/entregar/session' && req.method === 'POST') {
          const { cookie } = await readJson(req);
          const value = inputString(cookie, 'cookie', 4096);
          if (!/(?:^|;\s*)PHPSESSID_?=[A-Za-z0-9,_-]+(?:;|$)/.test(value))
            throw new AppError('La cookie debe incluir PHPSESSID o PHPSESSID_.');
          const result = await updateSession(value);
          json(res, result.status || (result.success ? 200 : 422), result);
          return;
        }
        if (pathname === '/api/track' && req.method === 'GET') {
          const order = inputString(parsed.searchParams.get('order'), 'order');
          const shipper = inputString(
            parsed.searchParams.get('shipper') || '004185',
            'shipper',
            20
          );
          const carrier = carrierValue(parsed.searchParams.get('carrier') || 'auto');
          json(res, 200, await runTracking(adapters, order, shipper, carrier, controller.signal));
          return;
        }
        if (pathname === '/api/track-batch' && req.method === 'POST') {
          const body = await readJson(req);
          if (!Array.isArray(body.orders) || body.orders.length < 1 || body.orders.length > 20)
            throw new AppError(
              'Ingresá entre 1 y 20 códigos por lote. No se procesó ningún pedido.'
            );
          const orders = body.orders.map((value) => inputString(value, 'order'));
          const shipper = inputString(
            body.shipper === undefined ? '004185' : body.shipper,
            'shipper',
            20
          );
          const carrier = carrierValue(body.carrier);
          charge(req, orders.length - 1);
          const results = await mapLimit(orders, 3, (order) =>
            runTracking(adapters, order, shipper, carrier, controller.signal)
          );
          json(res, 200, { success: true, count: results.length, results });
          return;
        }
        const known = [
          '/api/track',
          '/api/track-batch',
          '/api/entregar/session',
          '/api/health',
        ].includes(pathname);
        json(res, known ? 405 : 404, {
          success: false,
          message: known ? 'Método no permitido.' : 'API inexistente.',
        });
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new AppError('Método no permitido.', 405);
      const candidate = path.resolve(
        publicDir,
        '.' + (pathname === '/' ? '/index.html' : pathname)
      );
      const relative = path.relative(publicDir, candidate);
      if (relative.startsWith('..') || path.isAbsolute(relative))
        throw new AppError('Ruta no permitida.', 403);
      let file;
      try {
        const realRoot = await fs.realpath(publicDir);
        file = await fs.realpath(candidate);
        const realRelative = path.relative(realRoot, file);
        if (realRelative.startsWith('..') || path.isAbsolute(realRelative))
          throw new AppError('Ruta no permitida.', 403);
        if (!(await fs.stat(file)).isFile()) throw new AppError('Archivo inexistente.', 404);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError('Archivo inexistente.', 404);
      }
      const ext = path.extname(file).toLowerCase();
      if (!mimeTypes[ext]) throw new AppError('Archivo no permitido.', 403);
      const content = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (err) {
      if (err.status === 429) res.setHeader('Retry-After', '60');
      if (!(err instanceof AppError))
        logger.error(
          JSON.stringify({ event: 'request_error', requestId, code: err.code || 'INTERNAL' })
        );
      json(res, err.status || 500, {
        success: false,
        errorCode: err.code || 'INTERNAL',
        message: err instanceof AppError ? err.message : 'Error interno al procesar la solicitud.',
      });
    }
  };
}
module.exports = { createHandler, readJson };
