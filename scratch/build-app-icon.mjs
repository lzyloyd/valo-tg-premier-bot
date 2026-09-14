import { readFileSync, writeFileSync } from 'node:fs';

const HTML_PATH = 'D:/Tg-Results-Bot/scratch/wuvochka-concept.html';
const iconBuf = readFileSync('D:/Tg-Results-Bot/src/miniapp-public/wuwa-assets/app/icon.webp');
const iconUri = `data:image/webp;base64,${iconBuf.toString('base64')}`;

let html = readFileSync(HTML_PATH, 'utf8');

// Replace the small gradient square "mark" with the real app icon image.
const before = html;
html = html.replace(
  '<div class="app-title"><div class="mark"></div><h1>Вувочка</h1></div>',
  `<div class="app-title"><img class="mark" src="${iconUri}" alt=""><h1>Вувочка</h1></div>`,
);
if (html === before) { console.error('marker not found, no change made'); process.exit(1); }

html = html.replace(
  '.app-title .mark{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,var(--accent),var(--el-electro));flex-shrink:0;}',
  '.app-title .mark{width:28px;height:28px;border-radius:8px;flex-shrink:0;object-fit:cover;}',
);
// (the header CSS block already got bumped to 28px .mark sizing earlier — handle both possible widths)
html = html.replace(
  '.app-title .mark{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--el-electro));flex-shrink:0;}',
  '.app-title .mark{width:28px;height:28px;border-radius:8px;flex-shrink:0;object-fit:cover;}',
);

writeFileSync(HTML_PATH, html, 'utf8');
console.log('done');
