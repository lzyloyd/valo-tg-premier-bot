import fs from 'node:fs/promises';
import path from 'node:path';
const queues = new Map();
export function serial(key, work) {
  const next = (queues.get(key) || Promise.resolve()).then(work);
  const settled = next.catch(() => {});
  queues.set(key, settled);
  settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return next;
}
export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (err) { if (err.code !== 'ENOENT') throw err; return fallback; }
}
export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive:true});
  await fs.writeFile(file + '.tmp', JSON.stringify(value, null, 2));
  await fs.rename(file + '.tmp', file);
}
