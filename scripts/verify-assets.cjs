const fs = require('node:fs');
const path = require('node:path');

function verifyAssets(root = path.join(__dirname, '..')) {
  const publicDir = path.resolve(root, 'public');
  const visited = new Set();

  function visit(file) {
    if (visited.has(file)) return;
    const relative = path.relative(publicDir, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Un recurso estático apunta fuera de public.');
    }
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(`Recurso vacío o inválido: ${relative}`);
    }
    visited.add(file);

    const extension = path.extname(file);
    if (!['.html', '.css'].includes(extension)) return;
    const source = fs.readFileSync(file, 'utf8');
    const references =
      extension === '.html'
        ? [
            ...source.matchAll(
              /<(?:script|link|img)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi
            ),
          ].map((match) => match[1])
        : [...source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)].map((match) => match[1]);

    for (const reference of references) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) continue;
      const resource = reference.split(/[?#]/)[0];
      if (!resource) continue;
      visit(
        path.resolve(
          resource.startsWith('/') ? publicDir : path.dirname(file),
          resource.replace(/^\//, '')
        )
      );
    }
  }

  visit(path.join(publicDir, 'index.html'));
  visit(path.join(publicDir, 'vendor', 'fontawesome', 'LICENSE.txt'));
  return [...visited].map((file) => path.relative(publicDir, file));
}

if (require.main === module) {
  try {
    const files = verifyAssets();
    console.log(`Recursos estáticos verificados: ${files.length}.`);
  } catch (error) {
    console.error(`No se pudieron verificar los recursos: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { verifyAssets };
