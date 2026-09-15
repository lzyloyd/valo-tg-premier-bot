import fs from 'node:fs';

const weapons = JSON.parse(fs.readFileSync('src/miniapp-public/wuwa-assets/weapons/index.json', 'utf8'));

function valueAt90(prop) {
  if (!prop || !prop.GrowthValues) return null;
  const g = prop.GrowthValues.find((x) => x.Level === 90);
  return g ? g.Value : null;
}

const out = {};
let i = 0;
for (const w of weapons) {
  i++;
  const res = await fetch(`https://api-v2.encore.moe/api/en/weapon/${w.id}`);
  const j = await res.json();
  const [mainProp, subProp] = j.Properties || [];
  out[w.id] = {
    mainStatName: mainProp ? mainProp.Name : null,
    mainStatValue90: valueAt90(mainProp),
    subStatName: subProp ? subProp.Name : null,
    subStatValue90: valueAt90(subProp),
  };
  process.stderr.write(`${i}/${weapons.length} ${w.id} ${j.WeaponName} main=${out[w.id].mainStatName}:${out[w.id].mainStatValue90} sub=${out[w.id].subStatName}:${out[w.id].subStatValue90}\n`);
}

fs.writeFileSync('scratch/weapon-stats90-raw.json', JSON.stringify(out, null, 2), 'utf8');
console.error('done');
