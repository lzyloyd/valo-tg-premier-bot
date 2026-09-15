import fs from 'node:fs';

const weapons = JSON.parse(fs.readFileSync('src/miniapp-public/wuwa-assets/weapons/index.json', 'utf8'));

function stripHtml(s) {
  if (!s) return '';
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

const out = {};
let i = 0;
for (const w of weapons) {
  i++;
  const res = await fetch(`https://api-v2.encore.moe/api/en/weapon/${w.id}`);
  const j = await res.json();
  out[w.id] = {
    name: j.WeaponName,
    weaponType: w.weaponType,
    rarity: w.rarity,
    passiveName: j.ResonName,
    passiveDesc: stripHtml(j.Desc),
    flavor: stripHtml(j.AttributesDescription || j.BgDescription || ''),
  };
  process.stderr.write(`${i}/${weapons.length} ${w.id} ${j.WeaponName}\n`);
}

fs.writeFileSync('scratch/weapon-facts-raw.json', JSON.stringify(out, null, 2), 'utf8');
console.error('done');
