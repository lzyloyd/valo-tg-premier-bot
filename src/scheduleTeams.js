import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { config } from './config.js';
import { serial, atomicJson, readJson } from './schedulePersistence.js';

const context = new AsyncLocalStorage();
const firstMains = ['qu1ly', 'toshir0000', 'bonrik1', 'kitkatfn', 'lzyloyd'];
const firstSubs = ['deadqq', 'men4ikcs', 'mania_boo'];
const secondMembers = JSON.parse(process.env.TEAM2_MEMBERS || JSON.stringify([
  { username: 'mania_boo', role: 'main', admin: true },
  { username: 'khhhaneul', role: 'main' }, { username: 'imgdmtt', role: 'main' },
]));
function validateMembers(members) {
  if (!Array.isArray(members) || members.some(m => !m || (m.id != null && (!Number.isSafeInteger(m.id) || m.id <= 0)) || !/^[a-z0-9_]{1,32}$/i.test(m.username || '') || !['main', 'sub'].includes(m.role))) throw new Error('Некорректный состав команды.');
  if (new Set(members.map(m => m.username.toLowerCase())).size !== members.length) throw new Error('Игрок уже в команде.');
  const ids = members.filter(m => m.id != null).map(m => m.id);
  if (new Set(ids).size !== ids.length) throw new Error('Telegram ID уже в команде.');
  if (members.filter(m => m.role === 'main').length > 5) throw new Error('В основе уже 5 игроков. Сначала переведи одного в запас.');
}
validateMembers(secondMembers);
function makeTeam(options) {
  return { ...options,
    get roster() { return this.members.map(m => m.username); },
    get mains() { return this.members.filter(m => m.role === 'main').map(m => m.username); },
    get subs() { return this.members.filter(m => m.role === 'sub').map(m => m.username); },
  };
}
export const teams = [
  makeTeam({ id: 'ovt', name: 'Overthinkers', members: [...firstMains.map(username => ({username, role:'main'})), ...firstSubs.map(username => ({username, role:'sub'}))],
    adminMembers: [], adminIds: [config.adminUserId].filter(Boolean), chatId: config.scheduleChatId, threadId: config.scheduleThreadId, reminderThreadId: null, enabled: true }),
  makeTeam({ id: 'team2', name: process.env.TEAM2_NAME || 'Clarity', members: secondMembers.map(m=>({...m,username:m.username.toLowerCase()})),
    adminMembers: secondMembers.filter(m => m.admin === true).map(m=>({...m,username:m.username.toLowerCase()})),
    adminIds: [config.adminUserId, Number(process.env.TEAM2_ADMIN_USER_ID) || null].filter(Boolean), chatId: '-1004419192416', threadId: '2',
    // Topic 1 is the forum's General topic: Telegram rejects message_thread_id=1, so General = no thread id.
    reminderThreadId: null,
    days: [
      { key: 'mon', label: 'Понедельник', kind: 'Сборы', slots: [] },
      { key: 'tue', label: 'Вторник', kind: 'Сборы', slots: [] },
      { key: 'wed', label: 'Среда', kind: 'Сборы', slots: [] },
      { key: 'thu', label: 'Четверг', kind: 'Праки', slots: ['20:00'] },
      { key: 'fri', label: 'Пятница', kind: 'Сборы', slots: [] },
      { key: 'sat', label: 'Суббота', kind: 'Премьер', slots: ['21:00'] },
      { key: 'sun', label: 'Воскресенье', kind: 'Праки', slots: ['20:00'] },
    ], enabled: secondMembers.length > 0 }),
];
for (const team of teams) {
  Object.defineProperties(team, {
    schedulePath: { get() { return this.id === 'ovt' ? config.scheduleDataPath : path.join(config.dataDir, 'schedule-team2.json'); } },
    attendancePath: { get() { return this.id === 'ovt' ? config.attendanceDataPath : path.join(config.dataDir, 'attendance-team2.json'); } },
  });
  team.defaults = structuredClone(team.members);
}
export function currentTeam() { return context.getStore() || teams[0]; }
export function withTeam(team, work) { return context.run(team, work); }
function rosterPath(team) { return path.join(config.dataDir, `roster-${team.id}.json`); }
export async function refreshTeamRoster(team = currentTeam()) {
  const members = await readJson(rosterPath(team), team.defaults);
  validateMembers(members);
  team.members = structuredClone(members);
  return team.members;
}
export async function changeRoster({ action, username, role, direction }) {
  const team = currentTeam();
  const file = rosterPath(team);
  return serial(file, async () => {
    const members = structuredClone(await readJson(file, team.defaults));
    username = typeof username === 'string' ? username.trim().replace(/^@/, '').toLowerCase() : '';
    if (!/^[a-z0-9_]{1,32}$/.test(username)) throw new Error('Укажи Telegram-ник без ссылки, например @player.');
    const index = members.findIndex(m => m.username === username);
    if (action === 'add') {
      if (index !== -1) throw new Error('Игрок уже в команде.');
      if (!['main','sub'].includes(role)) throw new Error('Выбери основу или запас.');
      members.push({username, role});
    } else {
      if (index === -1) throw new Error('Игрок уже удалён из команды.');
      if (action === 'remove') members.splice(index, 1);
      else if (action === 'role') {
        if (!['main','sub'].includes(role)) throw new Error('Выбери основу или запас.');
        const [member] = members.splice(index, 1);
        members.push({...member, role}); // New substitutes go to the end of the priority list.
      } else if (action === 'priority') {
        if (!['up','down'].includes(direction) || members[index].role !== 'sub') throw new Error('Некорректный приоритет.');
        const indices = members.flatMap((m,i)=>m.role === 'sub' ? [i] : []);
        const target = indices[indices.indexOf(index) + (direction === 'up' ? -1 : 1)];
        if (target != null) [members[index],members[target]] = [members[target],members[index]];
      } else throw new Error('Неизвестное действие.');
    }
    validateMembers(members);
    await atomicJson(file, members);
    team.members = members;
    return members;
  });
}
// IDs are pinned on the first verified Telegram login. Admin assignments are
// independent from the playing roster, so removing a player never grants or revokes admin access.
export async function accessibleTeams(user) {
  const file = path.join(config.dataDir, 'schedule-identities.json');
  return serial(file, async () => {
    const bindings = await readJson(file, {});
    let changed = false;
    const allowed = [];
    for (const base of teams.filter(t => t.enabled)) {
      const team = Object.create(base);
      await refreshTeamRoster(team);
      bindings[team.id] ??= {};
      const known = bindings[team.id];
      const find = entries => {
        let member = entries.find(m => (m.id ?? known[m.username]) === user.id);
        if (!member) {
          const name = (user.username || '').toLowerCase();
          member = entries.find(m => m.username === name && m.id == null && known[name] == null);
          if (member) { known[name] = user.id; changed = true; }
        }
        return member;
      };
      const member = find(team.members);
      const isAdmin = team.adminIds.includes(user.id) || !!find(team.adminMembers);
      if (member || isAdmin) allowed.push({team, username: member?.username || '', isAdmin});
    }
    if (changed) await atomicJson(file, bindings);
    return allowed;
  });
}
