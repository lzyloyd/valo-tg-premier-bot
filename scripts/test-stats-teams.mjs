import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stats-teams-'));
Object.assign(process.env,{TELEGRAM_BOT_TOKEN:'test',TELEGRAM_CHAT_ID:'-1001',STATS_CHAT_ID:'-1001',STATS_THREAD_ID:'9',STATS_SPREADSHEET_ID:'ovt-sheet',DATA_DIR:dir,HENRIK_API_KEY:'test'});
const {JWT}=await import('google-auth-library');JWT.prototype.getAccessToken=async()=>({token:'test'});
await fs.writeFile(path.join(dir,'google-service-account.json'),JSON.stringify({client_email:'test@example.com',private_key:'test'}));
const {statsTeams,currentStatsTeam,withStatsTeam,statsTeamForChat,overallPremierTab}=await import('../src/statsTeams.js');
const {currentLabelMap,findOurTeamId}=await import('../src/statsRoster.js');
const {appendMatchToStatsSheet,countAnnouncedPremierWeeks}=await import('../src/sheetsStats.js');
const {saveSeenMatchIds,loadSeenMatchIds}=await import('../src/state.js');
const {fetchPremierHistory}=await import('../src/henrikClient.js');
const {sendSeasonStats}=await import('../src/sheetsAnnounce.js');
const [ovt,clarity]=statsTeams;
assert.equal(statsTeamForChat('-1004419192416'),clarity);assert.equal(statsTeamForChat('-1001'),ovt);assert.equal(statsTeamForChat('999'),null);
const players=[...ovt.roster.filter(r=>r.riotId!=='Mania#uma').slice(0,5).map(r=>({riotId:r.riotId,teamId:'Red'})),...clarity.roster.map(r=>({riotId:r.riotId,teamId:'Blue'}))];
assert.equal(withStatsTeam(ovt,()=>findOurTeamId(players)),'Red');assert.equal(withStatsTeam(clarity,()=>findOurTeamId(players)),'Blue');
assert.equal(withStatsTeam(clarity,()=>currentLabelMap().get('solace')),'solace#0一0');
assert.equal(withStatsTeam(clarity,()=>currentLabelMap().has('space kururugi')),false);
assert.equal(withStatsTeam(ovt,()=>currentLabelMap().get('militantum#bonr')),'ice blue#bonr');
assert.equal(withStatsTeam(ovt,()=>currentLabelMap().get('militantum')),'ice blue#bonr');
assert.equal(withStatsTeam(ovt,()=>currentLabelMap().get('ice blue#bonr')),'ice blue#bonr');
assert.equal(withStatsTeam(ovt,()=>findOurTeamId([{riotId:'Ice blue#bonr',teamId:'Red'}])),'Red');
assert.equal(withStatsTeam(ovt,()=>findOurTeamId([{riotId:'MILITANTUM#bonr',teamId:'Red'}])),'Red');
assert.equal(withStatsTeam(clarity,()=>findOurTeamId([{riotId:'Ice blue#bonr',teamId:'Red'}])),null);
const fixtures=new Map();
function col(text){return [...text].reduce((a,c)=>a*26+c.charCodeAt(0)-64,0)-1;}
function parse(range){const m=/^'([^']+)'!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range);assert(m,range);return {title:m[1],c:col(m[2]),r:Number(m[3])-1,lastC:col(m[4]||m[2]),lastR:Number(m[5]||m[3])-1};}
for(const team of statsTeams){const tabs=new Map();for(const [i,title] of [team.overallTab,'Haven - Premier'].entries()){
 const cells=new Map(),notes=new Map();team.roster.forEach((p,j)=>cells.set(`${1+j*14},16`,p.riotId.split('#')[0]));
 tabs.set(title,{sheetId:i+1,title,index:i,gridProperties:{columnCount:78,rowCount:1000},cells,notes});
}fixtures.set(team.spreadsheetId,tabs);}
const calls=[];let telegramPosts=[];const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 const target=new URL(url);calls.push({url:String(url),body:options.body});
 const json=value=>new Response(JSON.stringify(value),{status:200});
 if(target.hostname==='api.henrikdev.xyz'){assert(target.pathname.includes(currentStatsTeam().premierRosterId));return json({data:{league_matches:[]}});}
 if(target.hostname==='api.telegram.org'){telegramPosts.push(Object.fromEntries(options.body.entries()));return json({ok:true,result:{message_id:1}});}
 assert.equal(target.hostname,'sheets.googleapis.com');const match=/\/spreadsheets\/([^/:]+)(.*)/.exec(target.pathname);const [_,id,suffix]=match;const tabs=fixtures.get(id);assert(tabs,id);
 if(suffix==='' && target.searchParams.get('fields')==='properties.locale')return json({properties:{locale:'en_US'}});
 if(suffix==='' && target.searchParams.get('fields')==='sheets.properties')return json({sheets:[...tabs.values()].map(({cells,notes,...properties})=>({properties}))});
 function read(range,notes=false){const p=parse(range),sheet=tabs.get(p.title),rows=[];assert(sheet,p.title);for(let r=p.r;r<=p.lastR;r++){const row=[];for(let c=p.c;c<=p.lastC;c++)row.push((notes?sheet.notes:sheet.cells).get(`${r},${c}`)??'');while(row.at(-1)==='')row.pop();rows.push(row);}while(rows.at(-1)?.length===0)rows.pop();return rows;}
 if(suffix.startsWith('/values/'))return json({values:read(decodeURIComponent(suffix.slice(8)))});
 if(suffix==='' && target.searchParams.get('fields')==='sheets.data.rowData.values.note')return json({sheets:[{data:[{rowData:read(target.searchParams.get('ranges'),true).map(row=>({values:row.map(note=>({note}))}))}]}]});
 if(suffix==='/developerMetadata:search')return json({matchedDeveloperMetadata:[]});
 const body=JSON.parse(options.body||'{}');
 if(suffix==='/values:batchUpdate'){for(const update of body.data){const p=parse(update.range),sheet=tabs.get(p.title);update.values.forEach((row,y)=>row.forEach((v,x)=>sheet.cells.set(`${p.r+y},${p.c+x}`,v)));}return json({});}
 if(suffix===':batchUpdate'){for(const request of body.requests){if(request.repeatCell?.cell?.note){const {range,cell}=request.repeatCell;const sheet=[...tabs.values()].find(s=>s.sheetId===range.sheetId);sheet.notes.set(`${range.startRowIndex},${range.startColumnIndex}`,cell.note);}}return json({replies:body.requests.map(()=>({}))});}
 throw Error('Unhandled fixture request '+url);
};
const player=(riotId)=>({riotId,perf:200,acs:230,kills:20,deaths:15,assists:8,plusMinus:5,kdRatio:1.33,ddelta:20,adr:160,hsAccuracy:30,kast:75,firstKills:4,firstDeaths:2,multiKills:3});
try {
 const results=await Promise.all(statsTeams.map(team=>withStatsTeam(team,async()=>{
   await new Promise(r=>setTimeout(r,team.id==='ovt'?3:1));assert.equal(currentStatsTeam(),team);
   const options={mapName:'Haven',mode:'Premier',players:team.roster.map(r=>player(r.riotId)),matchId:'same-match-id'};
   const result=await appendMatchToStatsSheet(options);assert.equal(result.written.length,team.roster.length);
   const duplicate=await appendMatchToStatsSheet(options);assert(duplicate.alreadyLogged);
   const overall=await appendMatchToStatsSheet({...options,tabTitle:overallPremierTab()});assert.equal(overall.written.length,team.roster.length);
   assert.equal(await countAnnouncedPremierWeeks(team.spreadsheetId),1);
   await fetchPremierHistory();
   await saveSeenMatchIds(new Set([team.id+'-match']));assert.deepEqual([...await loadSeenMatchIds()],[team.id+'-match']);
   return result;
 })));
 assert.deepEqual(results.map(r=>r.written.length),[8,5]);
 const renamed = await withStatsTeam(ovt,()=>appendMatchToStatsSheet({mapName:'Haven',mode:'Premier',players:[player('MILITANTUM#bonr')],matchId:'historical-nickname'}));
 assert.deepEqual(renamed.written,['MILITANTUM#bonr']);
 assert.deepEqual(renamed.skipped,[]);
 for(const team of statsTeams)assert(fixtures.get(team.spreadsheetId).get(team.overallTab).cells.get('0,17').includes('Game 1'));
 await assert.rejects(withStatsTeam(clarity,()=>appendMatchToStatsSheet({mapName:'Haven',mode:'Premier',players:[player(ovt.roster[0].riotId)],matchId:'wrong-team'})),/нет игроков/);
 const fakeBrowser={newPage:async()=>({setViewport:async()=>{},goto:async()=>{},screenshot:async()=>Buffer.from('image'),close:async()=>{}})};
 // Screenshot render delay is shortened only inside this isolated test process.
 const realTimeout=globalThis.setTimeout;globalThis.setTimeout=(fn,delay,...args)=>realTimeout(fn,delay===1500?0:delay,...args);
 try {await withStatsTeam(clarity,()=>sendSeasonStats(fakeBrowser,{spreadsheetId:clarity.spreadsheetId,sheetId:1,tabTitle:clarity.overallTab}));}finally{globalThis.setTimeout=realTimeout;}
 assert.equal(telegramPosts[0].chat_id,'-1004419192416');assert.equal(telegramPosts[0].message_thread_id,'763');assert(telegramPosts[0].caption.includes('V26A6'));
 console.log('PASS: independent stats sheets, concurrent team contexts, shared Mania identity, Unicode Riot ID, match deduplication, state files, history roster IDs and report topic.');
} finally {globalThis.fetch=originalFetch;await fs.rm(dir,{recursive:true,force:true});}
