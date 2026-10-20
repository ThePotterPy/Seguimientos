const fs = require('node:fs');
const path = require('node:path');
const { Gate, requestText } = require('./runtime');

function createSessionStore(file, envCookie = '', request = requestText) {
  let cached;
  let lastPing = null, lastPingStatus = null;
  const updateGate = new Gate(1, 3);
  function getCookie() {
    if (cached !== undefined) return cached;
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      cached = typeof parsed.cookie === 'string' ? parsed.cookie.trim() : '';
    } else cached = envCookie.trim();
    return cached;
  }
  async function verify(cookie = getCookie()) {
    if (!cookie) return { ok: false };
    try {
      const result = await request('https://svr.entregar.net.ar/e_transport/MenuPrincipal/MenuPrincipal_pag_ini.php', {
        headers: { Cookie: cookie, 'User-Agent': 'Seguimiento-BGH/1.1' }, timeout: 8000
      });
      // An empty page or generic 200 is not evidence of an authenticated session.
      const ok = result.statusCode === 200 && !/app_Login|session_timeout/i.test(result.body) && /(?:MenuPrincipal|menu_principal|cerrar\s+sesi[oó]n|logout|e_transport)/i.test(result.body);
      return { ok, statusCode: result.statusCode };
    } catch { return { ok: false }; }
  }
  async function ping() {
    const result = await verify();
    lastPing = new Date().toISOString(); lastPingStatus = result.ok;
    return result;
  }
  async function update(cookie) {
    const release = await updateGate.acquire();
    try {
      const checked = await verify(cookie);
      if (!checked.ok) return { success: false, verified: false, status: 422, message: 'No se pudo verificar la nueva sesión. Se conservó la sesión anterior.' };
      const dir = path.dirname(file); const temporary = file + '.tmp';
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(temporary, JSON.stringify({ cookie, updatedAt: new Date().toISOString() }), { mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch {
        try { fs.unlinkSync(temporary); } catch {}
        return { success: false, verified: true, status: 500, message: 'No se pudo guardar la sesión. Se conservó la anterior.' };
      }
      cached = cookie; lastPing = new Date().toISOString(); lastPingStatus = true;
      return { success: true, verified: true };
    } finally { release(); }
  }
  return { getCookie, ping, update, status: () => ({ hasCookie: Boolean(getCookie()), lastPing, lastPingStatus }) };
}
module.exports = { createSessionStore };
