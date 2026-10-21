const https = require('node:https');
const { AsyncLocalStorage } = require('node:async_hooks');

const context = new AsyncLocalStorage();
class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}
class Gate {
  constructor(limit, maxQueue = 40) {
    this.limit = limit;
    this.maxQueue = maxQueue;
    this.active = 0;
    this.queue = [];
  }
  acquire(signal) {
    if (signal?.aborted)
      return Promise.reject(new AppError('Consulta cancelada.', 499, 'CANCELLED'));
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve(() => this.release());
    }
    if (this.queue.length >= this.maxQueue)
      return Promise.reject(
        new AppError('Servidor ocupado. Reintentá en unos instantes.', 503, 'BUSY')
      );
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal };
      entry.abort = () => {
        this.queue = this.queue.filter((x) => x !== entry);
        reject(new AppError('Consulta cancelada.', 499, 'CANCELLED'));
      };
      signal?.addEventListener('abort', entry.abort, { once: true });
      this.queue.push(entry);
    });
  }
  release() {
    const next = this.queue.shift();
    if (!next) {
      this.active--;
      return;
    }
    next.signal?.removeEventListener('abort', next.abort);
    next.resolve(() => this.release());
  }
}
const gates = new Map();
function requestText(target, options = {}) {
  const signal = options.signal || context.getStore()?.signal;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AppError('Consulta cancelada.', 499, 'CANCELLED'));
    let settled = false,
      timer;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      err ? reject(err) : resolve(value);
    };
    const req = https.request(
      target,
      {
        method: options.method || 'GET',
        headers: options.headers,
        ...(options.connectAddress
          ? { hostname: options.connectAddress, servername: new URL(target).hostname }
          : {}),
        timeout: options.timeout || 10000,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            finish(
              new AppError(
                'Respuesta del transportista demasiado grande.',
                502,
                'UPSTREAM_RESPONSE'
              )
            );
            res.destroy();
            req.destroy();
          } else chunks.push(chunk);
        });
        res.on('error', (err) => finish(err));
        res.on('aborted', () =>
          finish(
            new AppError('Respuesta del transportista interrumpida.', 502, 'UPSTREAM_RESPONSE')
          )
        );
        res.on('end', () =>
          finish(null, { statusCode: res.statusCode, body: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    const abort = () => req.destroy(new AppError('Consulta cancelada.', 499, 'CANCELLED'));
    timer = setTimeout(
      () =>
        req.destroy(
          new AppError('El transportista agotó el tiempo de espera.', 504, 'UPSTREAM_TIMEOUT')
        ),
      options.timeout || 10000
    );
    signal?.addEventListener('abort', abort, { once: true });
    req.on('timeout', () =>
      req.destroy(
        new AppError('El transportista agotó el tiempo de espera.', 504, 'UPSTREAM_TIMEOUT')
      )
    );
    req.on('error', (err) => finish(err));
    req.end(options.body);
  });
}
async function upstreamFetch(target, options) {
  const result = await requestText(target, options);
  return {
    ok: result.statusCode >= 200 && result.statusCode < 300,
    status: result.statusCode,
    text: async () => result.body,
  };
}
function detectCarrier(order) {
  const code = order.toUpperCase();
  if (code.includes('-0') || /^(ZRE|ZECH|ZECO)/.test(code)) return 'entregar';
  if (/^(2000|4004)/.test(code) || /^\d{15,16}$/.test(code)) return 'andreani';
  return 'urbano';
}
function inputString(value, name, max = 120) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new AppError(`El campo ${name} debe ser un texto válido de hasta ${max} caracteres.`);
  return value.trim();
}
function quantity(value, fallback = '1') {
  const text = String(value ?? '').trim();
  return /^\d{1,6}$/.test(text) && Number(text) > 0 ? String(Number(text)) : fallback;
}
function normalizeQuantities(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(normalizeQuantities);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      key === 'bultos' ? quantity(entry) : normalizeQuantities(entry),
    ])
  );
}
async function runTracking(adapters, order, shipper, carrier = 'auto', signal) {
  carrier = carrier === 'auto' ? detectCarrier(order) : carrier;
  if (!gates.has(carrier)) gates.set(carrier, new Gate(carrier === 'entregar' ? 1 : 3));
  const release = await gates.get(carrier).acquire(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 25000);
  try {
    return normalizeQuantities(
      await context.run({ signal: controller.signal }, () => adapters[carrier](order, shipper))
    );
  } catch (err) {
    return {
      success: false,
      carrier,
      order,
      errorCode: err.code || 'UPSTREAM_UNAVAILABLE',
      message: 'No se pudo completar la consulta al transportista. Reintentá en unos instantes.',
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    release();
  }
}
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index], index);
      }
    })
  );
  return results;
}
module.exports = {
  AppError,
  Gate,
  requestText,
  upstreamFetch,
  detectCarrier,
  inputString,
  quantity,
  runTracking,
  mapLimit,
};
