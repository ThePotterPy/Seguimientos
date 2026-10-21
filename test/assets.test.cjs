const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyAssets } = require('../scripts/verify-assets.cjs');

test('la verificación recorre los recursos que usa la página', () => {
  const files = verifyAssets();
  assert.ok(files.includes('app.js'));
  assert.ok(files.includes('tailwind.css'));
  assert.ok(files.some((file) => file.endsWith('fa-solid-900.woff2')));
});

test('un recurso ausente falla la verificación', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgh-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'public', 'index.html'), '<script src="missing.js"></script>');
  assert.throws(() => verifyAssets(root), { code: 'ENOENT' });
});

test('la verificación rechaza recursos que salen de public', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgh-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(
    path.join(root, 'public', 'index.html'),
    '<script src="../private.js"></script>'
  );
  assert.throws(() => verifyAssets(root), /fuera de public/);
});
