const fs = require('node:fs');
const path = require('node:path');
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    const raw = match[2].trim();
    process.env[match[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw.replace(/^'|'$/g, '');
  }
}
module.exports = {
  sessionFile: path.resolve(
    process.env.ENTREGAR_SESSION_FILE ||
      path.join(__dirname, '..', '.private', 'entregar-session.json')
  ),
};
