const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { createRequire } = require('node:module');
const { createHandler } = require('../lib/router');
const runtime = require('../lib/runtime');
const { createSessionStore } = require('../lib/session');
const root = path.join(__dirname, '..');
function loadAdapters({ status = 200, body = '', detailStatus = 200, request } = {}) {
  const localRequire = createRequire(path.join(root, 'server.js'));
  let calls = 0;
  const exported = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'server.js'), 'utf8'),
    {
      module: exported,
      require: (name) =>
        name === './lib/runtime'
          ? {
              ...runtime,
              upstreamFetch: async () => ({
                ok: (++calls === 1 ? status : detailStatus) === 200,
                status: calls === 1 ? status : detailStatus,
                text: async () => body,
              }),
              requestText: request || (async () => ({ statusCode: status, body })),
            }
          : localRequire(name),
      __dirname: root,
      process: {
        env: {
          ANDREANI_AES_KEY: '1'.repeat(32),
          ANDREANI_AES_IV: '1'.repeat(16),
          ANDREANI_AUTHORIZATION: 'SYNTHETIC',
        },
      },
      Buffer,
      URLSearchParams,
      console: { log() {}, warn() {}, error() {} },
      setInterval,
      clearInterval,
      setTimeout,
    },
    { filename: 'server.js' }
  );
  return exported.exports;
}
async function fixtureServer(t, options = {}) {
  const calls = [];
  const adapters = Object.fromEntries(
    ['urbano', 'andreani', 'entregar'].map((carrier) => [
      carrier,
      async (order) => {
        calls.push({ carrier, order });
        return { success: true, carrier, order };
      },
    ])
  );
  const server = http.createServer(
    createHandler({
      publicDir: path.join(root, 'public'),
      adapters,
      getSession: () => ({ hasCookie: false }),
      updateSession: async () => ({ success: true, verified: true }),
      mimeTypes: {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
      },
      logger: { log() {}, error() {} },
      ...options,
    })
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const port = server.address().port;
  async function request(target, method = 'GET', body) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: target,
          method,
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              text,
              headers: res.headers,
              json: () => JSON.parse(text),
            })
          );
        }
      );
      req.on('error', reject);
      req.end(
        body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
      );
    });
  }
  return { request, calls };
}
test('rechaza recorridos de ruta, variantes codificadas y barras de Windows', async (t) => {
  const { request } = await fixtureServer(t);
  for (const route of [
    '/../server.js',
    '/%2e%2e/server.js',
    '/..%5cserver.js',
    '/../entregar_session.json',
    '/%00',
  ])
    assert.equal((await request(route)).status, 403, route);
});
test('sirve la portada y devuelve 404 para archivos y APIs desconocidas', async (t) => {
  const { request } = await fixtureServer(t);
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/missing.js')).status, 404);
  assert.equal((await request('/api/missing')).status, 404);
  assert.equal((await request('/api/health')).json().status, 'ok');
  assert.equal((await request('/style.css', 'POST')).status, 405);
});
test('no sigue enlaces de directorio fuera de public', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'urbano-static-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'public'));
  fs.mkdirSync(path.join(dir, 'outside'));
  fs.writeFileSync(path.join(dir, 'outside', 'test.js'), 'PRIVATE TEST');
  fs.symlinkSync(
    path.join(dir, 'outside'),
    path.join(dir, 'public', 'link'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  const { request } = await fixtureServer(t, { publicDir: path.join(dir, 'public') });
  assert.equal((await request('/link/test.js')).status, 403);
});
test('parámetros repetidos y tipos inválidos dan 400 sin caer el servidor', async (t) => {
  const { request } = await fixtureServer(t);
  for (const query of [
    'order=a&order=b',
    'order=a&carrier=x&carrier=y',
    'order=a&shipper=a&shipper=b',
    'order=a&carrier=unknown',
    'order=',
  ])
    assert.equal((await request('/api/track?' + query)).status, 400);
  assert.equal((await request('/api/health')).status, 200);
});
test('API sigue sin autenticación, incluida renovación de sesión', async (t) => {
  const { request } = await fixtureServer(t);
  assert.equal((await request('/api/track?order=TEST')).status, 200);
  assert.equal(
    (await request('/api/entregar/session', 'POST', { cookie: 'PHPSESSID=SYNTHETIC' })).json()
      .success,
    true
  );
});
test('individual y lote comparten detección y respetan transportista explícito', async (t) => {
  const { request } = await fixtureServer(t);
  const orders = ['123456789012345', 'ZECH_000123', '2745ICBC'];
  const batch = await request('/api/track-batch', 'POST', { orders });
  assert.deepEqual(
    batch.json().results.map((x) => x.carrier),
    ['andreani', 'entregar', 'urbano']
  );
  for (let i = 0; i < orders.length; i++)
    assert.equal(
      (await request('/api/track?order=' + orders[i])).json().carrier,
      batch.json().results[i].carrier
    );
  const explicit = await request('/api/track-batch', 'POST', { orders, carrier: 'urbano' });
  assert.ok(explicit.json().results.every((x) => x.carrier === 'urbano'));
});
test('rechaza el lote completo si excede 20 o contiene entradas inválidas', async (t) => {
  const { request, calls } = await fixtureServer(t);
  assert.equal(
    (await request('/api/track-batch', 'POST', { orders: Array(21).fill('TEST') })).status,
    400
  );
  assert.equal((await request('/api/track-batch', 'POST', { orders: ['TEST', 25] })).status, 400);
  assert.equal(calls.length, 0);
});
test('limita el tamaño de cuerpos y distingue JSON inválido', async (t) => {
  const { request } = await fixtureServer(t);
  assert.equal(
    (await request('/api/track-batch', 'POST', '{"x":"' + 'x'.repeat(17000) + '"}')).status,
    413
  );
  assert.equal((await request('/api/track-batch', 'POST', '{')).status, 400);
});
test('limita consultas sin exigir identificación', async (t) => {
  const { request } = await fixtureServer(t);
  let response;
  for (let i = 0; i < 121; i++) response = await request('/api/entregar/session');
  assert.equal(response.status, 429);
  assert.equal(response.headers['retry-after'], '60');
});
test('Urbano no convierte estados negativos en entregados', async () => {
  for (const status of ['NO ENTREGADO', 'NO SE PUDO ENTREGAR', 'RECHAZADO']) {
    const app = loadAdapters({
      body: `<tr data='{"estado":"${status}","gui_numero":"TEST"}'></tr>`,
    });
    assert.equal((await app.trackUrbano('TEST')).statusCategory, 'incident');
  }
  const app = loadAdapters({ body: `<tr data='{"estado":"ENTREGADO","gui_numero":"TEST"}'></tr>` });
  assert.equal((await app.trackUrbano('TEST')).statusCategory, 'delivered');
});
function row(status, reference = 'ZECO_001') {
  return (
    '<td><span id="id_sc_field_idempresa_1">TESTCO</span></td>' +
    [
      ['idstatus', status],
      ['idreferencia', reference],
    ]
      .map(([key, value]) => `<td><span id="id_sc_field_${key}_1">${value}</span></td>`)
      .join('')
  );
}
test('parser conserva empresa y separa depósito/cierre administrativo de entrega', () => {
  const app = loadAdapters();
  const depot = app.parseEntregarHtml(row('RECIBIDO DC'))[0];
  assert.equal(depot.empresa, 'TESTCO');
  assert.equal(depot.statusCategory, 'received');
  assert.equal(app.parseEntregarHtml(row('RENDIDO'))[0].statusCategory, 'administrative');
  assert.equal(app.parseEntregarHtml(row('ENTREGADO'))[0].statusCategory, 'delivered');
});
test('vincula referencias exactas; no une órdenes ajenas, parciales o contradictorias', () => {
  const app = loadAdapters();
  const make = (referencia, campoAuxiliar2 = '') => ({
    referencia,
    campoAuxiliar2,
    classification: app.classifyEntregarRef(referencia, '', campoAuxiliar2),
  });
  const unrelated = [make('ZECH_000123'), make('ZRE7_000999')];
  app.linkExchangePairs(unrelated);
  assert.equal(unrelated[0].classification.pairedOrder, undefined);
  const exact = [make('ZECH_000123', 'ZRE7 999'), make('ZRE7_000999')];
  app.linkExchangePairs(exact);
  assert.equal(exact[0].classification.pairedOrder.index, 1);
  assert.equal(exact[1].classification.pairedOrder.index, 0);
  const partial = [make('ZECH_000123', 'ZRE7 99'), make('ZRE7_000999')];
  app.linkExchangePairs(partial);
  assert.equal(partial[0].classification.pairedOrder, undefined);
  const conflicting = [make('ZECH_000123', 'ZRE7 999'), make('ZRE7_000999', 'ZECH 456')];
  app.linkExchangePairs(conflicting);
  assert.equal(conflicting[0].classification.pairedOrder, undefined);
});
test('cantidades externas no pueden convertirse en HTML', () => {
  for (const value of ['<img src=x onerror=alert(1)>', '&lt;img&gt;', '-1', 'abc'])
    assert.equal(runtime.quantity(value), '1');
  assert.equal(runtime.quantity('003'), '3');
});
test('sesión inválida no reemplaza la existente ni crea archivo', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'urbano-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.json');
  const store = createSessionStore(file, 'PHPSESSID=OLD', async () => ({
    statusCode: 200,
    body: 'app_Login',
  }));
  const result = await store.update('PHPSESSID=NEW');
  assert.equal(result.success, false);
  assert.equal(store.getCookie(), 'PHPSESSID=OLD');
  assert.equal(fs.existsSync(file), false);
});
test('sesión verificada se persiste y prevalece sobre valor inicial del entorno', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'urbano-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.json');
  const observed = [];
  const store = createSessionStore(file, 'PHPSESSID=OLD', async (url, options) => {
    observed.push(options.headers.Cookie);
    return { statusCode: 200, body: 'MenuPrincipal' };
  });
  assert.equal((await store.update('PHPSESSID=NEW')).success, true);
  assert.equal(store.getCookie(), 'PHPSESSID=NEW');
  assert.equal(observed[0], 'PHPSESSID=NEW');
  assert.equal(createSessionStore(file, 'PHPSESSID=OLD').getCookie(), 'PHPSESSID=NEW');
});
test('fallo de persistencia conserva la sesión anterior', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'urbano-session-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const blocker = path.join(dir, 'not-a-directory');
  fs.writeFileSync(blocker, 'TEST');
  const store = createSessionStore(
    path.join(blocker, 'session.json'),
    'PHPSESSID=OLD',
    async () => ({ statusCode: 200, body: 'MenuPrincipal' })
  );
  assert.equal((await store.update('PHPSESSID=NEW')).success, false);
  assert.equal(store.getCookie(), 'PHPSESSID=OLD');
});
test('mapLimit preserva orden y limita concurrencia', async () => {
  let active = 0,
    max = 0;
  const result = await runtime.mapLimit([1, 2, 3, 4], 2, async (x) => {
    active++;
    max = Math.max(max, active);
    await new Promise((r) => setTimeout(r, 8));
    active--;
    return x * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8]);
  assert.equal(max, 2);
});
test('errores externos no se presentan como pedidos inexistentes', async () => {
  const app = loadAdapters({ status: 503 });
  const result = await app.trackAndreani('123456789012345');
  assert.equal(result.errorCode, 'UPSTREAM_UNAVAILABLE');
  assert.doesNotMatch(result.message, /No se encontró/);
});
test('Andreani responde HTTP 206 cuando el envio no existe y se interpreta como no encontrado', async () => {
  const app = loadAdapters({ status: 206, body: 'null' });
  const result = await app.trackAndreani('2000018896871244');
  assert.equal(result.success, false);
  assert.match(result.message, /No se encontró ningún envío/);
});
test('limpieza HTML quita etiquetas codificadas antes del uso como texto', () => {
  assert.equal(loadAdapters().cleanHtml('&lt;b&gt;TEST&lt;/b&gt;'), 'TEST');
});
test('cola cancelada libera su lugar sin dejar tareas pendientes', async () => {
  const gate = new runtime.Gate(1, 1);
  const release = await gate.acquire();
  const controller = new AbortController();
  const waiting = gate.acquire(controller.signal);
  controller.abort();
  await assert.rejects(waiting, { code: 'CANCELLED' });
  assert.equal(gate.queue.length, 0);
  release();
  assert.equal(gate.active, 0);
});
test('respuesta externa se limita por bytes y el plazo absoluto destruye una petición colgada', async (t) => {
  const https = require('node:https');
  const { EventEmitter } = require('node:events');
  const original = https.request;
  t.after(() => {
    https.request = original;
  });
  let huge = false;
  https.request = (target, options, callback) => {
    const req = new EventEmitter();
    req.destroy = (err) => {
      if (err) req.emit('error', err);
    };
    req.end = () => {
      if (huge)
        process.nextTick(() => {
          const res = new EventEmitter();
          res.statusCode = 200;
          res.destroy = () => {};
          callback(res);
          res.emit('data', Buffer.alloc(2 * 1024 * 1024 + 1));
        });
    };
    return req;
  };
  await assert.rejects(runtime.requestText('https://example.invalid', { timeout: 10 }), {
    code: 'UPSTREAM_TIMEOUT',
  });
  huge = true;
  await assert.rejects(runtime.requestText('https://example.invalid', { timeout: 50 }), {
    code: 'UPSTREAM_RESPONSE',
  });
});
test('proveedor sin configuración devuelve error explícito en vez de lanzar excepción', async () => {
  const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(!/const apiKey = ["']/.test(source));
  const { trackAndreani } = require('../server');
  const previous = process.env.ANDREANI_AES_KEY;
  delete process.env.ANDREANI_AES_KEY;
  try {
    assert.equal((await trackAndreani('TEST')).errorCode, 'CONFIG_REQUIRED');
  } finally {
    if (previous !== undefined) process.env.ANDREANI_AES_KEY = previous;
  }
});
