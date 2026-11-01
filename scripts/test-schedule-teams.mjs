import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHmac } from 'node:crypto';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'schedule-teams-'));
Object.assign(process.env, { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: '-1001', SCHEDULE_CHAT_ID: '-1001', SCHEDULE_THREAD_ID: '2', ADMIN_USER_ID: '100', DATA_DIR: dir, MINIAPP_PORT: '0' });
delete process.env.TEAM2_MEMBERS;
delete process.env.TEAM2_ADMIN_USER_ID;
const { teams, withTeam, accessibleTeams } = await import('../src/scheduleTeams.js');
const { setResponse, loadCurrentWeek } = await import('../src/scheduleStore.js');
const { recordMiss, loadAttendance } = await import('../src/attendanceStore.js');
const { resolveLineup } = await import('../src/scheduleModel.js');
const { startMiniAppServer } = await import('../src/miniappServer.js');
const server = startMiniAppServer();
await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const networkFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith('https://api.telegram.org/')) return new Response(JSON.stringify({ok:true,result:{message_id:1}}));
  assert(String(url).startsWith(base), 'Tests must never contact external services');
  return networkFetch(url, options);
};
function signed(id, username) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now()/1000)), user: JSON.stringify({id,username}) });
  const check = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  params.set('hash', createHmac('sha256',createHmac('sha256','WebAppData').update('test-token').digest()).update(check).digest('hex'));
  return params.toString();
}
async function api(route, id, username, teamId, data = {}) {
  const response = await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:signed(id,username),teamId,...(route==='/api/add-time'?{name:'МСК турнир'}:{}),...data})});
  return {status:response.status, body:await response.json()};
}
try {
  const manager = await api('/api/state',200,'Mania_boo','team2');
  assert.equal(manager.status,200); assert.equal(manager.body.me.isAdmin,true);
  assert.equal((await api('/api/state',200,'Mania_boo','ovt')).body.me.isAdmin,false);
  assert.equal((await api('/api/set-day-off',200,'Mania_boo','ovt',{day:'mon',isOff:true})).status,403);
  assert.equal((await api('/api/set-day-off',200,'Mania_boo','team2',{day:'mon',isOff:true})).status,200);
  for (const route of ['/api/send-summary','/api/mark-miss']) assert.equal((await api(route,200,'Mania_boo','ovt')).status,403);
  const player = await api('/api/state',201,'khhhaneul','team2');
  assert.equal(player.status,200); assert.equal(player.body.me.isAdmin,false); assert.equal(player.body.teams.length,1);
  for (const route of ['/api/state','/api/update','/api/set-day-off','/api/mark-miss','/api/send-summary']) assert.equal((await api(route,201,'khhhaneul','ovt')).status,403);
  for (const route of ['/api/set-day-off','/api/mark-miss','/api/send-summary']) assert.equal((await api(route,201,'khhhaneul','team2')).status,403);
  assert.equal((await api('/api/state',100,'manager','team2')).body.me.isAdmin,true);
  assert.equal((await api('/api/state',100,'manager','ovt')).body.me.isAdmin,true);
  assert.equal((await api('/api/update',100,'manager','team2')).status,403);
  assert.equal((await api('/api/state',999,'khhhaneul','team2')).status,403);
  assert.equal((await api('/api/state',200,'renamed_admin','team2')).body.me.isAdmin,true);
  assert.equal((await api('/api/state',999,'outsider','team2')).status,403);
  assert.equal((await fetch(base+'/api/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:'forged',teamId:'team2'})})).status,401);
  // Custom time and roster actions must be scoped to the selected team.
  const before = (await api('/api/state',200,'Mania_boo','team2')).body;
  assert(before.daysOff.includes('sun'));
  assert.deepEqual(before.days.find(d=>d.key==='sun').slots,[]);
  assert.equal((await api('/api/add-time',201,'khhhaneul','ovt',{day:'sun',time:'19:30',weekStart:before.weekStart})).status,403);
  assert.equal((await api('/api/add-time',201,'khhhaneul','team2',{day:'sun',time:'25:30',weekStart:before.weekStart})).status,400);
  assert.equal((await api('/api/add-time',201,'khhhaneul','team2',{day:'sun',time:'19:30',weekStart:'2000-01-03'})).status,400);
  let result = await api('/api/add-time',201,'khhhaneul','team2',{day:'sun',time:'19:30',weekStart:before.weekStart});
  assert.equal(result.status,200); assert(!result.body.daysOff.includes('sun'));
  assert.deepEqual(result.body.days.find(d=>d.key==='sun').slots,['19:30']);
  assert.equal(result.body.days.find(d=>d.key==='sun').kind,'МСК турнир');
  assert((await api('/api/state',200,'Mania_boo','ovt')).body.daysOff.includes('sun'));
  assert.equal((await api('/api/add-time',201,'khhhaneul','team2',{day:'sun',time:'19:30',weekStart:before.weekStart})).status,400);
  assert.equal((await api('/api/update',201,'khhhaneul','team2',{day:'sun',avail:'yes',slots:['19:30']})).status,200);
  assert.equal((await api('/api/add-time',201,'khhhaneul','team2',{day:'wed',time:'19:00',weekStart:before.weekStart,name:''})).status,400);
  assert.equal((await api('/api/add-time',201,'khhhaneul','team2',{day:'wed',time:'19:00',weekStart:before.weekStart,name:'x'.repeat(61)})).status,400);
  const concurrent = await Promise.all(['18:45','20:15'].map(time=>api('/api/add-time',201,'khhhaneul','team2',{day:'tue',time,weekStart:before.weekStart})));
  assert(concurrent.every(r=>r.status===200));
  const after = (await api('/api/state',201,'khhhaneul','team2')).body;
  assert(after.days.find(d=>d.key==='tue').slots.includes('18:45'));
  assert(after.days.find(d=>d.key==='tue').slots.includes('20:15'));
  assert.equal(after.days.find(d=>d.key==='tue').kind,'Праки · МСК турнир');
  assert.equal((await api('/api/state',200,'Mania_boo','ovt')).body.days.find(d=>d.key==='tue').kind,'Праки');
  assert.deepEqual(after.days.find(d=>d.key==='sat').slots,['21:00','23:00']);
  assert.equal((await api('/api/roster',201,'khhhaneul','team2',{action:'add',username:'no_permission',role:'sub'})).status,403);
  assert.equal((await api('/api/roster',200,'Mania_boo','ovt',{action:'remove',username:'qu1ly'})).status,403);
  for (const name of ['new_sub_one','new_sub_two']) assert.equal((await api('/api/roster',200,'Mania_boo','team2',{action:'add',username:'@'+name,role:'sub'})).status,200);
  assert.equal((await api('/api/roster',200,'Mania_boo','team2',{action:'add',username:'new_sub_one',role:'sub'})).status,400);
  result = await api('/api/roster',200,'Mania_boo','team2',{action:'priority',username:'new_sub_two',direction:'up'});
  assert.deepEqual(result.body.members.filter(m=>m.role==='sub').map(m=>m.username),['new_sub_two','new_sub_one']);
  assert.equal((await api('/api/state',333,'new_sub_one','team2')).status,200);
  assert.equal((await api('/api/roster',200,'Mania_boo','team2',{action:'role',username:'new_sub_one',role:'main'})).status,200);
  assert.equal((await api('/api/roster',200,'Mania_boo','team2',{action:'role',username:'new_sub_two',role:'main'})).status,200);
  assert.equal((await api('/api/roster',200,'Mania_boo','team2',{action:'add',username:'sixth_main',role:'main'})).status,400);
  assert.equal((await api('/api/roster',200,'Mania_boo','team2',{action:'role',username:'new_sub_one',role:'sub'})).status,200);
  for (const name of ['new_sub_one','new_sub_two']) assert.equal((await api('/api/roster',200,'Mania_boo','team2',{action:'remove',username:name})).status,200);
  assert.equal((await api('/api/state',333,'new_sub_one','team2')).status,403);
  // Owners can manage Overthinkers too; the changed roster survives a new request.
  assert.equal((await api('/api/roster',100,'manager','ovt',{action:'add',username:'ovt_sub',role:'sub'})).status,200);
  assert((await api('/api/state',100,'manager','ovt')).body.members.some(m=>m.username==='ovt_sub'));
  assert.equal((await api('/api/roster',100,'manager','ovt',{action:'remove',username:'ovt_sub'})).status,200);
  const now = new Date('2026-11-02T08:00:00Z');
  await Promise.all(teams.map((team,i)=>withTeam(team,()=>setResponse('mania_boo','mon',i ? 'no' : 'yes',i ? [] : ['20:00'],now))));
  const weeks = await Promise.all(teams.map(team=>withTeam(team,()=>loadCurrentWeek(now))));
  assert.equal(weeks[0].responses.mania_boo.mon.avail,'yes'); assert.equal(weeks[1].responses.mania_boo.mon.avail,'no');
  await withTeam(teams[1],()=>recordMiss('mania_boo','2026-11-02','mon','20:00',{dateIso:'2026-11-02'}));
  assert.deepEqual(await withTeam(teams[0],loadAttendance),{});
  assert.equal((await withTeam(teams[1],loadAttendance)).mania_boo.count,1);
  assert.equal(withTeam(teams[1],()=>resolveLineup(teams[0].mains)),null);
  assert.deepEqual(teams[1].roster, ['mania_boo','khhhaneul','imgdmtt']);
  assert.deepEqual(teams[1].subs, []);
  assert.equal(withTeam(teams[1],()=>resolveLineup(teams[1].roster)),null);
  const { sendSummary, refreshSummaryMessage } = await import('../src/scheduleNotifications.js');
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, options) => {
    assert(String(url).startsWith('https://api.telegram.org/'));
    sent.push(Object.fromEntries(options.body.entries()));
    return new Response(JSON.stringify({ok:true,result:{message_id:sent.length}}));
  };
  try {
    await withTeam(teams[0],sendSummary);
    await withTeam(teams[1],sendSummary);
    await withTeam(teams[1],refreshSummaryMessage);
    assert.deepEqual(sent.map(m=>m.chat_id),['-1001','-1004419192416','-1004419192416']);
    assert.deepEqual(sent.slice(0,2).map(m=>m.message_thread_id),['2','2']);
    assert.equal(sent[2].message_id,'2');
  } finally { globalThis.fetch = realFetch; }
  assert.equal(teams[1].chatId,'-1004419192416'); assert.equal(teams[1].threadId,'2');
  assert.equal(teams[1].reminderThreadId,'1');
  const permissions = await accessibleTeams({id:200,username:'renamed'});
  assert.deepEqual(permissions.map(p=>[p.team.id,p.isAdmin]),[['ovt',false],['team2',true]]);
  console.log('PASS: team-scoped admin permissions, forged requests, ID binding, independent schedules and attendance.');
} finally {
  globalThis.fetch = networkFetch;
  await new Promise(resolve=>server.close(resolve));
  await fs.rm(dir,{recursive:true,force:true});
}
