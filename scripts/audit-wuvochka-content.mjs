import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only coverage/reference audit. Editorial accuracy requires source review.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'src/miniapp-public');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, ''));
const data = Object.fromEntries(['builds', 'gameplay', 'reviews', 'kit', 'bosses', 'tierlist', 'teams', 'echo-data', 'echo-skill-facts', 'weapon-facts'].map(n => [n, read(`src/miniapp-public/wuvochka/${n}.json`)]));
const chars = read('src/miniapp-public/wuwa-assets/characters/index.json');
const weapons = read('src/miniapp-public/wuwa-assets/weapons/index.json');
const html = fs.readFileSync(path.join(pub, 'wuvochka/index.html'), 'utf8');
const groups = chars.reduce((groups, c) => {
  (groups[c.name] ||= []).push(c);
  return groups;
}, {});
const characters = Object.entries(groups).map(([name, entries]) => ({name, ids: entries.map(c => c.id), sections: Object.fromEntries(['builds','gameplay','reviews','kit'].map(section => [section, entries.some(c => data[section][c.id]) || (section === 'kit' && entries.some(c => c.id === 1210))]))}));
const missingFiles = [];
function walk(value, at) {
  if (typeof value === 'string' && value.startsWith('/wuwa-assets/') && !fs.existsSync(path.join(pub, value))) missingFiles.push({at, value});
  else if (Array.isArray(value)) value.forEach((v,i) => walk(v, `${at}[${i}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k,v]) => walk(v, `${at}.${k}`));
}
Object.entries(data).forEach(([k,v]) => walk(v,k));
for (const [category, entries] of [['characters',chars],['weapons',weapons]]) for (const e of entries) if (!fs.existsSync(path.join(pub,'wuwa-assets',category,e.file))) missingFiles.push({at:category,value:e.file});
for (const [id,boss] of Object.entries(data.bosses)) if (!fs.existsSync(path.join(pub,'wuwa-assets/bosses',boss.icon))) missingFiles.push({at:`bosses.${id}`,value:boss.icon});
const knownChars = new Set(chars.map(c=>String(c.id)));
const knownWeapons = new Set(weapons.map(w=>String(w.id)));
const invalidReferences = [];
function ids(v, at) {
  if (Array.isArray(v)) return v.forEach((x,i)=>ids(x,`${at}[${i}]`));
  if (!v || typeof v !== 'object') return;
  for (const [k,x] of Object.entries(v)) {
    if (['charId','weaponId'].includes(k) && !(k==='charId'?knownChars:knownWeapons).has(String(x))) invalidReferences.push({at:`${at}.${k}`,id:x});
    if (k==='charIds' || k==='slots') for(const n of JSON.stringify(x).match(/\d+/g)||[]) if(!knownChars.has(n)) invalidReferences.push({at:`${at}.${k}`,id:n});
    ids(x,`${at}.${k}`);
  }
}
Object.entries(data).forEach(([k,v])=>ids(v,k));
const sets = new Set(data['echo-data'].sets.map(x=>x.name));
const echoes = data['echo-data'].items;
const report = {
  checkedAt: new Date().toISOString(), scope:'Local repository; external editorial accuracy is not certified by this script',
  counts:{characterAssetEntries:chars.length,uniqueCharacterForms:characters.length,weapons:weapons.length,weaponFacts:Object.keys(data['weapon-facts']).length,echoSets:sets.size,echoItems:echoes.length,echoSkills:Object.keys(data['echo-skill-facts']).length,bosses:Object.keys(data.bosses).length,teams:data.teams.tiers.reduce((n,t)=>n+t.teams.length,0)},
  characters,
  missingWeaponFacts:weapons.filter(w=>!data['weapon-facts'][w.id]).map(w=>({id:w.id,name:w.name})),
  missingEchoSkills:echoes.filter(e=>!data['echo-skill-facts'][e.name]).map(e=>e.name),
  unknownEchoSets:echoes.flatMap(e=>(e.sets||[]).filter(s=>!sets.has(s)).map(s=>({echo:e.name,set:s}))),
  missingFiles,invalidReferences,
  tierCoverage: Object.fromEntries(['toa','ww'].map(mode => {
    const placed = new Set(data.tierlist[mode].tiers.flatMap(t => Object.values(t.roles).flat()).map(String));
    return [mode, characters.filter(c => !c.ids.some(id => placed.has(String(id)))).map(c => c.name)];
  })),
  missingBuildFields:Object.entries(data.builds).flatMap(([id,b])=>['weapons','echoStatPriority','stats','skillPriority'].filter(k=>!b[k]?.length).map(field=>({id,field}))),
  gameplayCoverage:Object.entries(data.gameplay).map(([id,g])=>({id,rotations:g.rotations?.length||0,synergies:g.synergies?.length||0,teams:g.teams?.length||0,calculations:!!g.calculations})),
  modes:Object.fromEntries(['boss-modes','mode-details'].map(n=>[n,read(`data/wuvochka-${n}.json`)])),
  showcaseKitIsInline:!data.kit[1210] && html.includes('id="sub-kit"'),
};
console.log(JSON.stringify(report,null,2));
