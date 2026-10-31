import fs from 'node:fs';

const echoData = JSON.parse(fs.readFileSync('src/miniapp-public/wuvochka/echo-data.json', 'utf8'));
const catalogResponse = await fetch('https://api-v2.encore.moe/api/en/echo');
if (!catalogResponse.ok) throw new Error(`Echo catalog: HTTP ${catalogResponse.status}`);
const { Echo: catalog } = await catalogResponse.json();

function stripHtml(s) {
  if (!s) return '';
  return s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
}

function idFromName(name) {
  // Artwork filenames can point at event variants with unrelated skill data.
  // Prefer the normal echo; a few event-only echoes have no normal version.
  const candidates = catalog.filter((e) => e.Name === name);
  return (candidates.find((e) => e.PhantomType === 1) || candidates[0])?.Id ?? null;
}

const out = {};
const skipped = [];
let i = 0;
for (const item of echoData.items) {
  i++;
  const id = idFromName(item.name);
  if (!id) {
    skipped.push(item.name);
    process.stderr.write(`${i}/${echoData.items.length} SKIP (no catalog match) ${item.name}\n`);
    continue;
  }
  let j;
  try {
    const res = await fetch(`https://api-v2.encore.moe/api/en/echo/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    j = await res.json();
    if (j.MonsterName !== item.name) throw new Error(`Name mismatch: ${j.MonsterName}`);
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
    // Some event records have inconsistent SkillCD; the skill text is explicit.
    cd: Number(j.Skill.DescriptionEx.match(/(?:CD|Cooldown):\s*(\d+)s/i)?.[1] ?? j.Skill.SkillCD) || null,
  };
  process.stderr.write(`${i}/${echoData.items.length} ${item.name}\n`);
}

fs.writeFileSync('scratch/echo-skill-facts-raw.json', JSON.stringify(out, null, 2), 'utf8');
fs.writeFileSync('scratch/echo-skill-facts-skipped.json', JSON.stringify(skipped, null, 2), 'utf8');
console.error(`done. ${Object.keys(out).length} ok, ${skipped.length} skipped`);
