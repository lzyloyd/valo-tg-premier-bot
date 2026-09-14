import { readFileSync, writeFileSync } from 'node:fs';

const ASSETS = 'D:/Tg-Results-Bot/src/miniapp-public/wuwa-assets';
const HTML_PATH = 'D:/Tg-Results-Bot/scratch/wuvochka-concept.html';

function dataUri(relPath) {
  const buf = readFileSync(`${ASSETS}/${relPath}`);
  return `data:image/webp;base64,${buf.toString('base64')}`;
}

// glyph text -> icon file, as they appear in the current mockup
const CHAR_ICONS = {
  AE: 'characters/1210.webp', // Aemeath
  JH: 'characters/1304.webp', // Jinhsi
  CM: 'characters/1603.webp', // Camellya
  CL: 'characters/1205.webp', // Changli
  SK: 'characters/1505.webp', // Shorekeeper
  CR: 'characters/1107.webp', // Carlotta
  ZZ: 'characters/1105.webp', // Zhezhi
  VR: 'characters/1503.webp', // Verina
  YL: 'characters/1302.webp', // Yinlin
  CT: 'characters/1607.webp', // Cantarella
  ZN: 'characters/1507.webp', // Zani
  PB: 'characters/1506.webp', // Phoebe
  RC: 'characters/1606.webp', // Roccia
};

let html = readFileSync(HTML_PATH, 'utf8');

// 1) Big portraits (tier list + character grid + hero): replace
//    <span class="glyph">XX</span> with an <img>. Every glyph in the
//    document is one of these two-letter codes, uniquely tied to one
//    character each, so a global replace-all per code is safe.
for (const [code, rel] of Object.entries(CHAR_ICONS)) {
  const uri = dataUri(rel);
  const needle = `<span class="glyph">${code}</span>`;
  const replacement = `<img class="portrait-img" src="${uri}" alt="${code}">`;
  const count = html.split(needle).length - 1;
  html = html.split(needle).join(replacement);
  console.log(`glyph ${code}: replaced ${count}`);
}

// 2) Team mini-stack icons: <div class="mini" style="background:VAR">AE</div>
for (const [code, rel] of Object.entries(CHAR_ICONS)) {
  const uri = dataUri(rel);
  const re = new RegExp(`(<div class="mini"[^>]*>)${code}(</div>)`, 'g');
  const before = html;
  html = html.replace(re, `$1<img class="mini-img" src="${uri}" alt="">$2`);
  if (html !== before) console.log(`mini ${code}: replaced`);
}

// 3) Weapon + echo item icons (Build tab) — swap the emoji placeholders for real art.
const weaponUri1 = dataUri('weapons/21020016.webp'); // Blazing Brilliance (5* sword)
const weaponUri2 = dataUri('weapons/21020015.webp'); // Emerald of Genesis (5* sword)
const echoUri = dataUri('echoes/6000053.webp'); // Dreamless

html = html.replace(
  '<div class="item-icon">⚔</div><div class="item-info"><div class="iname">Signature Sword</div>',
  `<div class="item-icon"><img class="item-icon-img" src="${weaponUri1}" alt=""></div><div class="item-info"><div class="iname">Blazing Brilliance</div>`,
);
html = html.replace(
  '<div class="item-icon">⚔</div><div class="item-info"><div class="iname">Emerald of Genesis</div>',
  `<div class="item-icon"><img class="item-icon-img" src="${weaponUri2}" alt=""></div><div class="item-info"><div class="iname">Emerald of Genesis</div>`,
);
html = html.replace(
  '<div class="item-icon">◆</div>',
  `<div class="item-icon"><img class="item-icon-img" src="${echoUri}" alt=""></div>`,
);

// 4) CSS for the new <img> tags — fill their container, keep the overlay ring/name/dot on top.
html = html.replace(
  '</style>',
  `.portrait-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top center;}
.mini-img{width:100%;height:100%;object-fit:cover;border-radius:inherit;}
.item-icon-img{width:100%;height:100%;object-fit:cover;border-radius:inherit;}
</style>`,
);

writeFileSync(HTML_PATH, html, 'utf8');
console.log('done, new size:', (html.length / 1024).toFixed(0), 'KB');
