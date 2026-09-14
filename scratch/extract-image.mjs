import { readFileSync, writeFileSync } from 'node:fs';

const path = 'C:/Users/14785/.claude/projects/D--Tg-Results-Bot/88981203-6f3f-4bac-9d91-b85c9e08e529.jsonl';
const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);

let found = null;
for (const line of lines) {
  if (!line.includes('"type":"image"')) continue;
  try {
    const obj = JSON.parse(line);
    const content = obj?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'image' && block.source?.type === 'base64') {
        found = block.source; // keep overwriting -> ends up with the LAST occurrence
      }
    }
  } catch { /* skip unparsable lines */ }
}

if (!found) {
  console.error('no image found');
  process.exit(1);
}
const ext = found.media_type.split('/')[1] || 'png';
const buf = Buffer.from(found.data, 'base64');
const out = `D:/Tg-Results-Bot/scratch/app-icon-source.${ext}`;
writeFileSync(out, buf);
console.log('saved', out, buf.length, 'bytes');
