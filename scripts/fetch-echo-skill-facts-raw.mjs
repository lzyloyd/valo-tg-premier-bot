import fs from 'node:fs';

const echoData = JSON.parse(fs.readFileSync('src/miniapp-public/wuvochka/echo-data.json', 'utf8'));

function stripHtml(s) {
  if (!s) return '';
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

function idFromIcon(icon) {
  if (!icon) return null;
  const m = icon.match(/(\d+)\.webp$/);
  return m ? m[1] : null;
}

const out = {};
const skipped = [];
let i = 0;
for (const item of echoData.items) {
  i++;
  const id = idFromIcon(item.icon);
  if (!id) {
    skipped.push(item.name);
    process.stderr.write(`${i}/${echoData.items.length} SKIP (no icon/id) ${item.name}\n`);
    continue;
  }
  let j;
  try {
    const res = await fetch(`https://api-v2.encore.moe/api/en/echo/${id}`);
    j = await res.json();
  } catch (err) {
    skipped.push(item.name);
    process.stderr.write(`${i}/${echoData.items.length} FETCH ERROR ${item.name}: ${err.message}\n`);
    continue;
  }
  if (!j || !j.Skill || !j.Skill.DescriptionEx) {
    skipped.push(item.name);
    process.stderr.write(`${i}/${echoData.items.length} NO SKILL ${item.name}\n`);
    continue;
  }
  out[item.name] = {
    id,
    skillDesc: stripHtml(j.Skill.DescriptionEx),
    cd: j.Skill.SkillCD ?? null,
  };
  process.stderr.write(`${i}/${echoData.items.length} ${item.name}\n`);
}

fs.writeFileSync('scratch/echo-skill-facts-raw.json', JSON.stringify(out, null, 2), 'utf8');
fs.writeFileSync('scratch/echo-skill-facts-skipped.json', JSON.stringify(skipped, null, 2), 'utf8');
console.error(`done. ${Object.keys(out).length} ok, ${skipped.length} skipped`);
