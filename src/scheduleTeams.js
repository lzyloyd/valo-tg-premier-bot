import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from './config.js';

const context = new AsyncLocalStorage();
const roster = ['qu1ly', 'toshir0000', 'men4ikcs', 'kitkatfn', 'bonrik1', 'deadqq', 'mania_boo', 'lzyloyd'];
const members = JSON.parse(process.env.TEAM2_MEMBERS || JSON.stringify([{username:'mania_boo',role:'main',admin:true},{username:'khhhaneul',role:'main'},{username:'imgdmtt',role:'main'}]));
if (!Array.isArray(members) || members.some(m => (m.id != null && (!Number.isSafeInteger(m.id) || m.id <= 0)) || !/^[a-z0-9_]+$/i.test(m.username || '') || !['main', 'sub'].includes(m.role))) {
  throw new Error('TEAM2_MEMBERS must contain {optional id: positive Telegram ID, username, role: main|sub}');
}
if (new Set(members.filter(m => m.id != null).map(m => m.id)).size !== members.filter(m => m.id != null).length || new Set(members.map(m => m.username.toLowerCase())).size !== members.length) throw new Error('Duplicate TEAM2_MEMBERS');
const secondAdmin = Number(process.env.TEAM2_ADMIN_USER_ID) || null;
export const teams = [
  { id: 'ovt', name: 'Overthinkers', roster, mains: ['qu1ly', 'toshir0000', 'bonrik1', 'kitkatfn', 'lzyloyd'], subs: ['deadqq', 'men4ikcs', 'mania_boo'],
    members: [], adminIds: [config.adminUserId].filter(Boolean), chatId: config.scheduleChatId, threadId: config.scheduleThreadId,
    get schedulePath() { return config.scheduleDataPath; }, get attendancePath() { return config.attendanceDataPath; }, enabled: true },
  { id: 'team2', name: process.env.TEAM2_NAME || 'Clarity', roster: members.map(m => m.username.toLowerCase()),
    mains: members.filter(m => m.role === 'main').map(m => m.username.toLowerCase()), subs: members.filter(m => m.role === 'sub').map(m => m.username.toLowerCase()),
    members, adminIds: [config.adminUserId, secondAdmin].filter(Boolean), chatId: '-1004419192416', threadId: '11',
    schedulePath: path.join(config.dataDir, 'schedule-team2.json'), attendancePath: path.join(config.dataDir, 'attendance-team2.json'),
    enabled: members.length > 0 },
];
export function currentTeam() { return context.getStore() || teams[0]; }
export function withTeam(team, work) { return context.run(team, work); }
// Pin configured usernames to verified Telegram IDs on first login. Serialize
// registration so simultaneous requests cannot overwrite another binding.
let identityQueue = Promise.resolve();
export function accessibleTeams(user) {
  const work = identityQueue.then(async () => {
    const file = path.join(config.dataDir, 'schedule-identities.json');
    let bindings;
    try { bindings = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (err) { if (err.code !== 'ENOENT') throw err; bindings = {}; }
    let changed = false;
    const allowed = [];
    for (const team of teams.filter(t => t.enabled)) {
      const entries = team.id === 'ovt' ? team.roster.map(username => ({username})) : team.members;
      bindings[team.id] ??= {};
      const known = bindings[team.id];
      let member = entries.find(m => (m.id ?? known[m.username.toLowerCase()]) === user.id);
      if (!member) {
        const name = (user.username || '').toLowerCase();
        member = entries.find(m => m.username.toLowerCase() === name && m.id == null && known[name] == null);
        if (member) { known[name] = user.id; changed = true; }
      }
      const isAdmin = team.adminIds.includes(user.id) || member?.admin === true;
      if (member || isAdmin) allowed.push({ team, username: member?.username.toLowerCase() || '', isAdmin });
    }
    if (changed) {
      await fs.mkdir(config.dataDir, { recursive: true });
      await fs.writeFile(file + '.tmp', JSON.stringify(bindings, null, 2));
      await fs.rename(file + '.tmp', file);
    }
    return allowed;
  });
  identityQueue = work.catch(() => {});
  return work;
}
