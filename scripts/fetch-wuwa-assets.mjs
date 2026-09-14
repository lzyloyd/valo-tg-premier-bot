import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// One-time (re-runnable) fetch of Wuthering Waves character/weapon/echo
// icons from the Encore API (https://api-v2.encore.moe) — the same public
// data source several open-source WuWa companion tools already rely on
// (e.g. github.com/ryanbenson/wuthering-waves-assets). Assets are downloaded
// once and committed into the repo, served locally by the mini-app's own
// static server — not hotlinked from a third party at runtime.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'src', 'miniapp-public', 'wuwa-assets');

const API_BASE = 'https://api-v2.encore.moe/api/en';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function downloadTo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buf);
}

function extOf(url) {
  return path.extname(new URL(url).pathname) || '.webp';
}

async function processCategory(name, listUrl, pick) {
  const dir = path.join(OUT_DIR, name);
  await fs.mkdir(dir, { recursive: true });
  const data = await fetchJson(listUrl);
  const items = pick(data);
  const index = [];
  let ok = 0;
  let failed = 0;
  for (const item of items) {
    if (!item.iconUrl) continue;
    const fileName = `${item.id}${extOf(item.iconUrl)}`;
    const dest = path.join(dir, fileName);
    try {
      await downloadTo(item.iconUrl, dest);
      ok++;
    } catch (err) {
      console.error(`  [${name}] failed ${item.id} (${item.name}): ${err.message}`);
      failed++;
      continue;
    }
    index.push({ id: item.id, name: item.name, file: fileName, ...item.extra });
  }
  await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`[${name}] saved ${ok}, failed ${failed} -> ${dir}`);
}

await processCategory('characters', `${API_BASE}/character?v=Beta`, (data) =>
  data.roleList.map((r) => ({
    id: r.Id,
    name: r.Name,
    iconUrl: r.RoleHeadIcon,
    extra: { element: r.Element?.Name ?? null, weaponType: r.WeaponType?.Name ?? null, rarity: r.QualityId },
  })),
);

await processCategory('weapons', `${API_BASE}/weapon?v=Beta`, (data) =>
  data.weapons.map((w) => ({
    id: w.Id,
    name: w.Name,
    iconUrl: w.Icon,
    extra: { weaponType: w.TypeName ?? null, rarity: w.QualityId },
  })),
);

await processCategory('echoes', `${API_BASE}/echo?v=Beta`, (data) =>
  data.Echo.map((e) => ({
    id: e.Id,
    name: e.Name,
    iconUrl: e.Icon,
    extra: { element: e.Element?.Name ?? null, rarity: e.Rarity },
  })),
);

console.log('done.');
