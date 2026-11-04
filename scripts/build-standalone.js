// Builds dist/money-jars.html: one file you can save anywhere and double-click to open.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const icon = 'data:image/svg+xml;base64,' + Buffer.from(read('icons/icon.svg')).toString('base64');
let html = read('index.html')
  .replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
  .replace('<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n', '')
  .replace('href="icons/icon.svg"', 'href="' + icon + '"')
  .replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + read('styles.css') + '</style>')
  .replace('<script src="core.js"></script>', () => '<script>\n' + read('core.js') + '</script>')
  .replace('<script src="xlsx.js"></script>', () => '<script>\n' + read('xlsx.js') + '</script>')
  .replace('<script src="statement.js"></script>', () => '<script>\n' + read('statement.js') + '</script>')
  .replace('<script src="app.js"></script>', () => '<script>\n' + read('app.js') + '</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'money-jars.html'), html);
console.log('Wrote dist/money-jars.html (' + Math.round(html.length / 1024) + ' KB)');
