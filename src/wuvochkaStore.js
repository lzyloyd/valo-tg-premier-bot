import { promises as fs } from 'node:fs';
import { config } from './config.js';

function emptyProfile() {
  return { favorites: [], owned: [], avatarCharId: null };
}

async function readAll() {
  try {
    const raw = await fs.readFile(config.wuvochkaDataPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeAll(data) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(config.wuvochkaDataPath, JSON.stringify(data, null, 2));
}

export async function loadProfile(userId) {
  const all = await readAll();
  return all[userId] || emptyProfile();
}

function toggleInList(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export async function toggleFavorite(userId, charId) {
  const all = await readAll();
  const profile = all[userId] || emptyProfile();
  profile.favorites = toggleInList(profile.favorites, charId);
  all[userId] = profile;
  await writeAll(all);
  return profile;
}

export async function toggleOwned(userId, charId) {
  const all = await readAll();
  const profile = all[userId] || emptyProfile();
  profile.owned = toggleInList(profile.owned, charId);
  all[userId] = profile;
  await writeAll(all);
  return profile;
}

export async function setAvatar(userId, charId) {
  const all = await readAll();
  const profile = all[userId] || emptyProfile();
  profile.avatarCharId = charId;
  all[userId] = profile;
  await writeAll(all);
  return profile;
}
