const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = path.join(root, 'node_modules', '@fortawesome', 'fontawesome-free');
const destination = path.join(root, 'public', 'vendor', 'fontawesome');
fs.mkdirSync(path.join(destination, 'css'), { recursive: true });
fs.copyFileSync(path.join(source, 'css', 'all.min.css'), path.join(destination, 'css', 'all.min.css'));
fs.cpSync(path.join(source, 'webfonts'), path.join(destination, 'webfonts'), { recursive: true });
fs.copyFileSync(path.join(source, 'LICENSE.txt'), path.join(destination, 'LICENSE.txt'));
