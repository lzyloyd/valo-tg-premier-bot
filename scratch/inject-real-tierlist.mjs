import { readFileSync, writeFileSync } from 'node:fs';

// Real current tier-list data transcribed from prydwen.gg (Wuthering Waves
// Tier List + Team Tier List, Tower of Adversity, patch 3.6, last updated
// 10/September/2026). Tier PLACEMENT is used as data (which bucket a
// character/team falls into) — the accompanying prose analysis on prydwen
// is NOT reproduced here, only the ranking itself.

const ROOT = 'D:/Tg-Results-Bot';
const HTML_PATH = `${ROOT}/scratch/wuvochka-concept.html`;
const CHARACTERS = JSON.parse(readFileSync(`${ROOT}/src/miniapp-public/wuwa-assets/characters/index.json`, 'utf8'));

// prydwen name -> our roster name, where they differ
const ALIAS = {
  'The Shorekeeper': 'Shorekeeper',
  'Yangyang Xuanling': 'Yangyang: Xuanling',
  'Rover (Aero)': 'Rover: Aero',
  'Rover (Spectro)': 'Rover: Spectro',
  'Rover (Havoc)': 'Rover: Havoc',
  'Rover (Electro)': 'Rover: Electro',
};

function idsForName(name) {
  const resolved = ALIAS[name] || name;
  const matches = CHARACTERS.filter((c) => c.name === resolved);
  if (matches.length === 0) throw new Error(`Unresolved character name: "${name}" (resolved: "${resolved}")`);
  return matches.map((c) => c.id); // multiple ids for the two Rover skins of one element
}
function firstIdForName(name) {
  return idsForName(name)[0];
}

const CHAR_TIERS = [
  { tier: 'T0', dps: ['Aemeath', 'Hiyuki', 'Jingran', 'Qingxiao', 'Yangyang Xuanling'],
    hybrid: ['Denia', 'Iuno', 'Lucilla', 'Lynae'], support: ['Chisa', 'Mornye', 'Suisui', 'The Shorekeeper'] },
  { tier: 'T0.5', dps: ['Luuk Herssen', 'Sigrika'], hybrid: ['Lupa', 'Qiuyuan', 'Rebecca'], support: ['Verina'] },
  { tier: 'T1', dps: ['Augusta', 'Cartethyia', 'Galbrena', 'Lucy', 'Phrolova'], hybrid: ['Ciaccona', 'Mortefi'], support: [] },
  { tier: 'T1.5', dps: ['Carlotta'], hybrid: ['Brant'], support: ['Rover (Aero)'] },
  { tier: 'T2', dps: ['Jiyan', 'Phoebe', 'Zani'], hybrid: ['Cantarella', 'Changli', 'Sanhua'], support: ['Buling', 'Rover (Spectro)'] },
  { tier: 'T3', dps: ['Camellya', 'Encore', 'Jinhsi', 'Lingyang', 'Xiangli Yao'], hybrid: ['Danjin', 'Roccia', 'Yinlin', 'Zhezhi'], support: ['Baizhi'] },
  { tier: 'T4', dps: ['Calcharo', 'Chixia', 'Rover (Havoc)'], hybrid: ['Aalto', 'Jianxin', 'Lumi', 'Rover (Electro)', 'Taoqi', 'Yangyang'], support: ['Youhu', 'Yuanwu'] },
];

const TEAM_TIERS = [
  { tier: 'T0', teams: [
    ['Aemeath Rupture', ['Aemeath', 'Lynae', 'Mornye', 'The Shorekeeper']],
    ['Hiyuki Hypercarry', ['Hiyuki', 'Lucilla', 'Lynae', 'Suisui']],
    ['Jingran Hypercarry', ['Jingran', 'Iuno', 'Mortefi', 'The Shorekeeper']],
    ['Qingxiao Hypercarry', ['Qingxiao', 'Denia', 'Lynae', 'Mornye']],
    ['Xuanling Hypercarry', ['Yangyang Xuanling', 'Chisa', 'Rebecca', 'Phrolova']],
  ]},
  { tier: 'T0.5', teams: [
    ['Aemeath Fusion Burst', ['Aemeath', 'Denia', 'Chisa', 'Suisui']],
    ['Luuk Hypercarry', ['Luuk Herssen', 'Denia', 'Lynae', 'Sanhua']],
    ['Sigrika Hypercarry', ['Sigrika', 'Qiuyuan', 'Lucilla', 'Ciaccona']],
    ['Aemeath Mono Fusion', ['Aemeath', 'Lupa', 'Mornye', 'Brant']],
  ]},
  { tier: 'T1', teams: [
    ['Augusta Hypercarry', ['Augusta', 'Iuno', 'Lynae', 'Mortefi']],
    ['Cartethyia Hypercarry', ['Cartethyia', 'Ciaccona', 'Chisa', 'Rover (Aero)']],
    ['Galbrena Hypercarry', ['Galbrena', 'Lupa', 'Qiuyuan', 'Lucilla']],
    ['Iuno Hypercarry', ['Iuno', 'Lynae', 'Mornye', 'Ciaccona']],
    ['Lucy Hypercarry', ['Lucy', 'Rebecca', 'Mornye', 'The Shorekeeper']],
    ['Phrolova Echo', ['Phrolova', 'Lucilla', 'Cantarella', 'Sigrika']],
  ]},
  { tier: 'T1.5', teams: [
    ['Carlotta Hypercarry', ['Carlotta', 'Lynae', 'Zhezhi', 'Mornye']],
    ['Tri-DPS Fusion', ['Galbrena', 'Changli', 'Brant', 'Lupa']],
    ['Brant Hypercarry', ['Brant', 'Lupa', 'Mornye', 'The Shorekeeper']],
    ['Jiyan Mono Aero', ['Jiyan', 'Iuno', 'Ciaccona']],
    ['Phoebe Hypercarry', ['Phoebe', 'Lynae', 'Chisa', 'Mortefi']],
    ['Phrolova Dual DPS', ['Phrolova', 'Galbrena', 'Augusta', 'Jiyan']],
    ['Zani Hypercarry', ['Zani', 'Phoebe', 'Rover (Spectro)', 'The Shorekeeper']],
  ]},
  { tier: 'T2', teams: [
    ['Camellya Hypercarry', ['Camellya', 'Lynae', 'Roccia', 'Sanhua']],
    ['Encore Hypercarry', ['Encore', 'Lupa', 'Mornye', 'The Shorekeeper']],
    ['Jinhsi Hypercarry', ['Jinhsi', 'Zhezhi', 'Yinlin', 'Verina']],
    ['Jiyan Dual DPS', ['Jiyan', 'Ciaccona', 'The Shorekeeper', 'Verina']],
    ['Lingyang Hypercarry', ['Lingyang', 'Lynae', 'Zhezhi', 'Mornye']],
    ['Xiangli Yao Hypercarry', ['Xiangli Yao', 'Lynae', 'Yinlin', 'Mornye']],
    ['Calcharo Dual DPS', ['Calcharo', 'Xiangli Yao', 'The Shorekeeper', 'Verina']],
    ['Chixia Mono Fusion', ['Chixia', 'Brant', 'Mornye', 'Lupa']],
    ['Havoc Rover Hypercarry', ['Rover (Havoc)', 'Lynae', 'Roccia', 'Danjin']],
  ]},
];

const idByName = new Map(CHARACTERS.map((c) => [c.id, c]));
const tierClass = (t) => 't' + t.replace('T', '').replace('.', '');

// ---- Build tier-list (characters) markup ----
let tierListHtml = '';
for (const group of CHAR_TIERS) {
  const rowIds = [];
  for (const name of group.dps) for (const id of idsForName(name)) rowIds.push([id, 'dps']);
  for (const name of group.hybrid) for (const id of idsForName(name)) rowIds.push([id, 'hybrid']);
  for (const name of group.support) for (const id of idsForName(name)) rowIds.push([id, 'support']);
  if (rowIds.length === 0) continue;
  const items = rowIds.map(([id, role]) => {
    const c = idByName.get(id);
    const el = c.element.toLowerCase();
    return `          <div class="portrait sm ${el}" data-role="${role}" onclick="openChar(${id})"><img class="portrait-img" src="assets/characters/${id}.webp" alt=""><span class="ring"></span><span class="el-dot el-${el} p-el"></span><span class="p-name">${c.name}</span></div>`;
  }).join('\r\n');
  tierListHtml += `      <div class="tier-row">\r\n        <div class="tier-badge ${tierClass(group.tier)}">${group.tier}</div>\r\n        <div class="tier-items">\r\n${items}\r\n        </div>\r\n      </div>\r\n\r\n`;
}

// ---- Build team-tier-list markup ----
let teamListHtml = '';
for (const group of TEAM_TIERS) {
  for (const [name, members] of group.teams) {
    const memberIds = members.map(firstIdForName);
    const minis = memberIds.map((id) => {
      const c = idByName.get(id);
      const el = c.element.toLowerCase();
      return `            <div class="mini" style="background:var(--el-${el})"><img class="mini-img" src="assets/characters/${id}.webp" alt=""></div>`;
    }).join('\r\n');
    const descNames = memberIds.map((id) => idByName.get(id).name).join(' + ');
    teamListHtml += `      <div class="tier-row">\r\n        <div class="tier-badge ${tierClass(group.tier)}">${group.tier}</div>\r\n        <div class="team-card">\r\n          <div class="mini-stack">\r\n${minis}\r\n          </div>\r\n          <div class="team-meta"><div class="name">${name}</div><div class="desc">${descNames}</div></div>\r\n        </div>\r\n      </div>\r\n`;
  }
}

let html = readFileSync(HTML_PATH, 'utf8');
const NL = '\r\n';

// Replace the whole <div class="screen"> body of view-tierlist (keep the filters block, replace only the tier-row markup after it).
// Discard everything between the filters block and the TEAM TIER LIST comment
// wholesale (old tier-rows AND their closing </div>s), and emit the closing
// </div></div> for .screen/.view ourselves — never try to reuse/splice the
// old trailing close tags, that's what caused a stray extra </div> before.
const filtersCloseAnchor = '<div class="chip" data-val="support">Support</div>\r\n      </div>';
const tierlistFiltersEnd = html.indexOf(filtersCloseAnchor, html.indexOf('data-filter-target="#view-tierlist"'));
const tierlistNextMarker = html.indexOf('<!-- TEAM TIER LIST -->');
if (tierlistFiltersEnd === -1 || tierlistNextMarker === -1) throw new Error('tierlist anchors not found');
html = html.slice(0, tierlistFiltersEnd + filtersCloseAnchor.length) + NL + NL + tierListHtml.trimEnd() + NL
  + '    </div>' + NL + '  </div>' + NL + NL + html.slice(tierlistNextMarker);

// Replace the whole <div class="screen"> body of view-teams.
const teamsScreenStart = html.indexOf('<div class="screen">', html.indexOf('id="view-teams"'));
const teamsScreenStartTagEnd = teamsScreenStart + '<div class="screen">'.length;
const teamsScreenEnd = html.indexOf('</div>\r\n  </div>\r\n\r\n  <!-- CHARACTER LIST -->');
if (teamsScreenStart === -1 || teamsScreenEnd === -1) throw new Error('teams anchors not found');
html = html.slice(0, teamsScreenStartTagEnd) + NL + teamListHtml.trimEnd() + NL + html.slice(teamsScreenEnd);

writeFileSync(HTML_PATH, html, 'utf8');
console.log('tier list characters:', CHAR_TIERS.reduce((n, g) => n + g.dps.length + g.hybrid.length + g.support.length, 0));
console.log('teams:', TEAM_TIERS.reduce((n, g) => n + g.teams.length, 0));
console.log('done, size now', html.length, 'bytes');
