import assert from 'node:assert/strict';
import { modeDetailsNeedRefresh } from './wuvochka-mode-refresh.mjs';
const current={tower:{label:'Season 42'},wastes:{label:'Season 23'},dpm:{label:'S2 Phase 3'}};
assert.equal(modeDetailsNeedRefresh(null,current),true,'Missing details must refresh');
assert.equal(modeDetailsNeedRefresh(current,current),false,'Unchanged complete details need no refresh');
for(const mode of ['tower','wastes','dpm']){
 const old=structuredClone(current);old[mode].label='previous rotation';
 assert.equal(modeDetailsNeedRefresh(old,current),true,`Retry failed ${mode} details even after boss list was written`);
}
const incomplete=structuredClone(current);delete incomplete.wastes;
assert.equal(modeDetailsNeedRefresh(incomplete,current),true,'Partial details must refresh');
console.log('Mode refresh checks passed (6 cases).');
