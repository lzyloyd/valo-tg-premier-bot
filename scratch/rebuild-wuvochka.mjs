import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'D:/Tg-Results-Bot';
const HTML_PATH = `${ROOT}/scratch/wuvochka-concept.html`;
const CHARACTERS = JSON.parse(readFileSync(`${ROOT}/src/miniapp-public/wuwa-assets/characters/index.json`, 'utf8'));

let html = readFileSync(HTML_PATH, 'utf8');
const originalLength = html.length;

// ---------------------------------------------------------------------------
// 1) De-embed base64 data URIs already baked into the prototype, replacing
//    them with relative paths into the asset files that will be published
//    alongside this page. Every occurrence is identified by its surrounding
//    markup (alt="<2-letter code>", or literal context), never guessed.
// ---------------------------------------------------------------------------
const CODE_TO_ID = {
  AE: 1210, JH: 1304, CM: 1603, CL: 1205, SK: 1505, CR: 1107, ZZ: 1105,
  VR: 1503, YL: 1302, CT: 1607, ZN: 1507, PB: 1506, RC: 1606,
};

let replacedPortraits = 0;
html = html.replace(/src="data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+"(\s+alt="([A-Z]{2})")/g, (m, tail, code) => {
  const id = CODE_TO_ID[code];
  if (!id) return m;
  replacedPortraits++;
  return `src="assets/characters/${id}.webp"${tail}`;
});

// App icon (.mark) — user's own commissioned art, keep as its own asset file.
let markReplaced = 0;
html = html.replace(/(<img class="mark" src=)"data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+"/, (m, pre) => {
  markReplaced++;
  return `${pre}"assets/app/icon.webp"`;
});

// mini-stack icons: no alt text, identified positionally by the team-card
// they belong to (order matches the literal "A + B + C" name already in the
// markup right after each mini-stack).
function replaceMiniStack(html, teamNamesInOrder, ids, searchFrom = 0) {
  // Find the mini-stack block (at or after searchFrom) that is immediately
  // followed by a .team-meta whose .desc text matches the given member list,
  // then replace its N mini-img data URIs in order.
  const descNeedle = teamNamesInOrder.join(' + ');
  const stackRe = /<div class="mini-stack">([\s\S]*?)<\/div>\s*<div class="team-meta">/g;
  stackRe.lastIndex = searchFrom;
  let match;
  let count = 0;
  let endIndex = searchFrom;
  while ((match = stackRe.exec(html))) {
    const after = html.slice(match.index, match.index + match[0].length + 400);
    endIndex = match.index + match[0].length;
    if (!after.includes(descNeedle)) continue;
    let block = match[1];
    let i = 0;
    const newBlock = block.replace(/src="data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+"/g, () => {
      const id = ids[i++];
      return `src="assets/characters/${id}.webp"`;
    });
    const newMatch0 = match[0].replace(block, newBlock);
    html = html.slice(0, match.index) + newMatch0 + html.slice(match.index + match[0].length);
    endIndex = match.index + newMatch0.length; // post-edit coordinate space, since html was just shrunk
    count++;
    break;
  }
  return { html, count, endIndex };
}

let miniReplacedTotal = 0;
const miniJobs = [
  { names: ['Aemeath', 'Shorekeeper', 'Verina', 'Yinlin'], ids: [1210, 1505, 1503, 1302] }, // T0 team card
  { names: ['Jinhsi', 'Zhezhi', 'Verina'], ids: [1304, 1105, 1503] }, // T0.5 team card
  { names: ['Camellya', 'Roccia', 'Yinlin'], ids: [1603, 1606, 1302] }, // T1 team card
  { names: ['Aemeath', 'Shorekeeper', 'Verina', 'Yinlin'], ids: [1210, 1505, 1503, 1302] }, // Gameplay tab example team card (2nd occurrence)
];
let cursor = 0;
for (const job of miniJobs) {
  const r = replaceMiniStack(html, job.names, job.ids, cursor);
  html = r.html;
  miniReplacedTotal += r.count;
  cursor = r.endIndex;
}

// Weapon + echo item icons (Build tab) — identified by the item name text
// that follows them in the same item-card.
let weaponIconsReplaced = 0;
function replaceItemIcon(html, nameNeedle, relPath) {
  const re = new RegExp(
    '(<div class="item-icon"><img class="item-icon-img" src=)"data:image\\/[a-z]+;base64,[A-Za-z0-9+/=]+"([^>]*><\\/div><div class="item-info"><div class="iname">' +
      nameNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      ')',
  );
  const before = html;
  html = html.replace(re, (m, pre, post) => {
    weaponIconsReplaced++;
    return `${pre}"${relPath}"${post}`;
  });
  if (html === before) console.error(`  [warn] item icon not found for "${nameNeedle}"`);
  return html;
}
html = replaceItemIcon(html, 'Blazing Brilliance', 'assets/weapons/21020016.webp');
html = replaceItemIcon(html, 'Emerald of Genesis', 'assets/weapons/21020015.webp');

// Echo icon (Molten Rift set) — single occurrence, no per-item name match needed on the icon itself.
let echoReplaced = 0;
html = html.replace(
  /(<div class="item-icon"><img class="item-icon-img" src=)"data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+"([^>]*><\/div><div class="item-info"><div class="iname">Molten Rift)/,
  (m, pre, post) => {
    echoReplaced++;
    return `${pre}"assets/echoes/6000053.webp"${post}`;
  },
);

console.log('portraits replaced:', replacedPortraits, '(expect 30: 13 tierlist/team + 11 grid + 1 hero, roughly)');
console.log('mark replaced:', markReplaced);
console.log('mini-stack blocks touched:', miniReplacedTotal, '/', miniJobs.length);
console.log('weapon icons replaced:', weaponIconsReplaced);
console.log('echo icon replaced:', echoReplaced);

const remaining = (html.match(/data:image\/[a-z]+;base64,/g) || []).length;
console.log('remaining base64 data URIs:', remaining);

// ---------------------------------------------------------------------------
// 2) Expand the character grid ("Персонажи" tab) to all real characters.
// ---------------------------------------------------------------------------
const gridStart = html.indexOf('<div class="char-grid">');
const gridCloseAnchor = '\r\n      </div>\r\n    </div>\r\n  </div>\r\n\r\n  <!-- CHARACTER DETAIL -->';
const gridCloseAt = html.indexOf(gridCloseAnchor, gridStart);
if (gridStart === -1 || gridCloseAt === -1) throw new Error('char-grid block boundaries not found');

const gridItems = CHARACTERS
  .slice()
  .sort((a, b) => (b.rarity - a.rarity) || a.name.localeCompare(b.name))
  .map((c) => {
    const el = c.element.toLowerCase();
    return `        <div class="portrait lg ${el}" data-el="${el}" onclick="openChar(${c.id})"><img class="portrait-img" src="assets/characters/${c.id}.webp" alt=""><span class="ring"></span><span class="el-dot el-${el} p-el"></span><span class="p-name">${c.name}</span></div>`;
  })
  .join('\r\n');

html = html.slice(0, gridStart) + `<div class="char-grid">\r\n${gridItems}` + html.slice(gridCloseAt);

// ---------------------------------------------------------------------------
// 3) Wire up tier-list / team-list portraits to open the right character id
//    (they already show the right person via alt codes; only the onclick
//    needs the id now that openChar() takes an argument).
// ---------------------------------------------------------------------------
html = html.replace(/onclick="openChar\(\)"><img class="portrait-img" src="assets\/characters\/(\d+)\.webp" alt="([A-Z]{2})"/g,
  (m, id) => `onclick="openChar(${id})"><img class="portrait-img" src="assets/characters/${id}.webp" alt=""`);

writeFileSync(HTML_PATH, html, 'utf8');
console.log('done. size:', originalLength, '->', html.length, 'bytes');
