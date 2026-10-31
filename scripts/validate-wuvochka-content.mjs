import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pub=path.join(root,'src/miniapp-public');
const read=p=>JSON.parse(fs.readFileSync(path.join(pub,p),'utf8'));
const files=['builds','gameplay','reviews','kit','bosses','tierlist','teams','echo-data','echo-skill-facts','weapon-facts'];
const d=Object.fromEntries(files.map(n=>[n,read(`wuvochka/${n}.json`)]));
const characters=read('wuwa-assets/characters/index.json');
const weapons=read('wuwa-assets/weapons/index.json');
const chars=new Set(characters.map(c=>String(c.id))),weaponIds=new Set(weapons.map(w=>String(w.id)));
const sets=new Set(d['echo-data'].sets.map(s=>s.name)),echoes=new Set(d['echo-data'].items.map(e=>e.name));
const problems=[];
const check=(condition,message)=>{if(!condition)problems.push(message);};
const team=(t,at)=>{
 check(Array.isArray(t.slots)&&t.slots.length===3,`${at}: expected 3 team slots`);
 for(const slot of t.slots||[]){check(Array.isArray(slot)&&slot.length>0,`${at}: empty team slot`);for(const id of slot)check(chars.has(String(id)),`${at}: unknown character ${id}`);}
};
function walk(v,at){
 if(typeof v==='string'&&v.startsWith('/wuwa-assets/'))check(fs.existsSync(path.join(pub,v)),`${at}: missing image ${v}`);
 if(!v||typeof v!=='object')return;
 if(Array.isArray(v)){v.forEach((x,i)=>walk(x,`${at}[${i}]`));return;}
 if(v.charId!=null)check(chars.has(String(v.charId)),`${at}: unknown character ${v.charId}`);
 if(v.weaponId!=null)check(weaponIds.has(String(v.weaponId)),`${at}: unknown weapon ${v.weaponId}`);
 if(v.echoSet)check(sets.has(v.echoSet),`${at}: unknown echo set ${v.echoSet}`);
 for(const s of v.echoSets||[])check(sets.has(s),`${at}: unknown mixed echo set ${s}`);
 if(v.echoItemName)check(echoes.has(v.echoItemName),`${at}: unknown echo ${v.echoItemName}`);
 if(v.charIds)for(const id of v.charIds)check(chars.has(String(id)),`${at}: unknown synergy ${id}`);
 if(v.slots)team(v,at);
 Object.entries(v).forEach(([k,x])=>walk(x,`${at}.${k}`));
}
Object.entries(d).forEach(([n,v])=>walk(v,n));
for(const c of characters.filter(c=>![1502,1605,1408,1310].includes(c.id)))for(const n of ['builds','gameplay','reviews','kit'])check(!!d[n][c.id],`${c.name}: missing ${n}`);
for(const [id,b]of Object.entries(d.builds)){
 check(b.weapons.length>0,`${id}: empty weapon ranking`);
 const variants=b.variants?.map(v=>v.id)||['default'];
 for(const w of b.weapons){check(weaponIds.has(String(w.id)),`${id}: unknown ranking weapon ${w.id}`);for(const v of variants)check(w.scores[v]===null||Number.isFinite(w.scores[v]),`${id}/${w.id}: invalid score for ${v}`);}
}
for(const [id,g]of Object.entries(d.gameplay))if(g.calculations){
 check(g.calculations.variants.length>0,`${id}: empty calculations`);
 for(const v of g.calculations.variants){check(v.sequences.length===7,`${id}/${v.id}: expected S0-S6`);v.sequences.forEach((s,i)=>{check(s.seq===`S${i}`,`${id}/${v.id}: wrong sequence order`);check(Number.isFinite(s.pct),`${id}/${v.id}: invalid percentage`);check(/^\d[\d ]*$/.test(String(s.dmg))&&/^\d[\d ]*$/.test(String(s.dps)),`${id}/${v.id}: invalid damage or DPS`);});}
}
for(const w of weapons)check(!!d['weapon-facts'][w.id],`${w.name}: missing weapon detail`);
for(const e of d['echo-data'].items)check(!!d['echo-skill-facts'][e.name]?.skillDesc,`${e.name}: missing echo skill`);
for(const [id,b]of Object.entries(d.bosses)){for(const k of ['location','summary','counterTeams','guide'])check(b[k]?.length>0,`${id}: missing boss ${k}`);check(fs.existsSync(path.join(pub,'wuwa-assets/bosses',b.icon)),`${id}: missing boss art`);}
for(const mode of ['toa','ww'])for(const tier of d.tierlist[mode].tiers)for(const list of Object.values(tier.roles))for(const id of list)check(chars.has(String(id)),`${mode}: unknown tier character ${id}`);
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}else console.log(`Content valid: ${characters.length-4} character forms, ${weapons.length} weapons, ${echoes.size} echoes, ${Object.keys(d.bosses).length} bosses.`);
