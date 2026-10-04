import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

// Exercise the real Store and test-mode namespace, rather than substituting a fake learning backend.
const memory=new Map();let storageBlocked=false;
function environment(test=false){
  const c=vm.createContext({console,URLSearchParams,location:{search:test ? '?test=1':''},setTimeout,clearTimeout,
    document:{getElementById(){return null;},addEventListener(){}},addEventListener(){},
    localStorage:{getItem(k){return memory.get(k)||null;},setItem(k,v){if(storageBlocked)throw Error('blocked');memory.set(k,v);},removeItem(k){memory.delete(k);},key(i){return [...memory.keys()][i];},get length(){return memory.size;}}});
  c.window=c;
  for(const name of ['shared/core.js','packing-list/test-flow.js','shared/store.js','packing-list/preferences.js','packing-list/packing.js','packing-list/generator.js','packing-list/refinement-engine.js','packing-list/refinement-state.js','packing-list/learning.js'])vm.runInContext(readFileSync(new URL('../'+name,import.meta.url),'utf8'),c);
  c.isoToday=()=> '2026-10-04';return c;
}
const c=environment(),profile=JSON.parse(JSON.stringify(c.PACK_PREFS));
function fixture(id,setup={}){const t={id,name:'Trip '+id,where:'Destination',start:'2026-09-01',end:'2026-09-04'},state=c.refineNewState(t,{climate:'mild',...setup}),result=c.refineEvaluate(state,profile,[]);return {t,state,result};}
const itemId='pack:wrinkle-release';
const f=fixture('BASE');
const snapshot=c.packingLearningSnapshot(f.t,f.state,f.result);
assert(snapshot.items[itemId].safe);
assert(!snapshot.items['pack:contacts'].safe);
assert(!snapshot.items['pack:snacks'].safe,'Snacks are a confirmed always-bring item');
assert(!snapshot.items['pack:tshirts'].safe,'Clothing is refined through assumptions');
assert(!Object.values(snapshot.items).some(x=>x.id.startsWith('before:')));
assert.throws(()=>c.packingLearningReport(snapshot,[],false),/Add an exception/);
assert.throws(()=>c.packingLearningReport(snapshot,[{id:'unknown',status:'used'}],false),/Choose an item/);
assert.throws(()=>c.packingLearningReport(snapshot,[{id:itemId,status:'whatever'}],false),/feedback result/);
const partial=c.packingLearningReport(snapshot,[{id:itemId,status:'unneeded'}],false);
assert.equal(Object.keys(partial.feedback).length,1,'Unreviewed items are not assumed used');
assert.equal(partial.confirmedRemainingUsed,false);
const confirmed=c.packingLearningReport(snapshot,[{id:itemId,status:'unneeded'}],true);
assert.equal(confirmed.feedback['pack:contacts'],'used');
assert.equal(confirmed.feedback[itemId],'unneeded');
const missing=c.packingLearningReport(snapshot,[{label:'Camera',status:'missing'}],true);
assert.equal(missing.feedback['missing:camera'],'missing');
assert(!missing.items['missing:camera'].safe);
assert.equal(c.packingLearningReport(missing,[],true).feedback['missing:camera'],undefined,'Removing a missing-item report does not invent a used opportunity');
const ledger={version:1,trips:{}};
function evidence(id,status,setup={}){const g=fixture(id,setup),s=c.packingLearningSnapshot(g.t,g.state,g.result);s.end='2026-09-'+String(+id.replace(/\D/g,'')+4).padStart(2,'0');return c.packingLearningReport(s,[{id:itemId,status}],false);}
for(let i=1;i<=4;i++)ledger.trips['T'+i]=evidence('T'+i,'unneeded');
assert.equal(c.packingLearningRecommendations(ledger,profile).length,0,'Four reviews are not five opportunities');
ledger.trips.UNREVIEWED=snapshot;
assert.equal(c.packingLearningRecommendations(ledger,profile).length,0,'Capturing/exporting does not constitute review');
ledger.trips.T5=evidence('T5','used');
let suggestions=c.packingLearningRecommendations(ledger,profile);
assert.equal(suggestions.length,1);assert.equal(suggestions[0].kind,'exclude');assert.equal(suggestions[0].count,4);assert.equal(suggestions[0].total,5);
const conflicting={version:1,trips:{...ledger.trips,COLD:evidence('COLD1','used',{climate:'cold'})}};
assert.equal(c.packingLearningRecommendations(conflicting,profile)[0].kind,'review','Useful in another context must not become a global exclusion');
assert.equal(c.packingLearningRecommendations(conflicting,profile)[0].contrary.length,1);
ledger.trips.T1=evidence('T1','used');
assert.equal(c.packingLearningRecommendations(ledger,profile).length,0,'Updating feedback replaces evidence for that trip');
ledger.trips.T1=evidence('T1','unneeded');
ledger.trips.T6=evidence('T6','used');
assert.equal(c.packingLearningRecommendations(ledger,profile).length,0,'The most recent five opportunities drive suggestions');
delete ledger.trips.T6;
const excluded=c.refineExclude(profile,{id:itemId,label:'Wrinkle release'});
assert.equal(c.packingLearningRecommendations(ledger,excluded).length,0,'An explicit exclusion is not suggested again');
for(const setup of [{climate:'cold'},{hike:true},{bag:'checked'},{workout:true},{work:'laptop'},{climate:'unknown'}]){
  const contextual={version:1,trips:{...ledger.trips,T5:evidence('T5','used',setup)}};
  assert.equal(c.packingLearningRecommendations(contextual,profile).length,0,'Different context cannot complete the five-trip denominator');
}
const protectedLedger={version:1,trips:{}};
for(let i=1;i<=5;i++){
  const g=fixture('P'+i,{climate:'cold',hike:true});
  protectedLedger.trips[g.t.id]=c.packingLearningReport(c.packingLearningSnapshot(g.t,g.state,g.result),['pack:contacts','pack:light-packable-puffer-jacket','pack:tshirts','pack:water-bottle','pack:snacks'].map(id=>({id,status:'unneeded'})),false);
}
assert.equal(c.packingLearningRecommendations(protectedLedger,profile).length,5);
assert(c.packingLearningRecommendations(protectedLedger,profile).every(x=>x.kind==='review'),'Critical/required/clothing/confirmed snacks only prompt review');
const manualLedger={version:1,trips:{}};
for(let i=1;i<=5;i++){
  const g=fixture('M'+i);g.state.overrides.edited[itemId]={...g.result.items.find(x=>x.id===itemId),quantity:2};g.result=c.refineEvaluate(g.state,profile,[]);
  manualLedger.trips[g.t.id]=c.packingLearningReport(c.packingLearningSnapshot(g.t,g.state,g.result),[{id:itemId,status:'unneeded'}],false);
}
assert(c.packingLearningRecommendations(manualLedger,profile).every(x=>x.kind==='review'),'Manual edge cases never become blanket defaults');
const missingLedger={version:1,trips:{}};
for(let i=1;i<=5;i++){const g=fixture('F'+i);missingLedger.trips[g.t.id]=c.packingLearningReport(c.packingLearningSnapshot(g.t,g.state,g.result),[{label:'Camera',status:'missing'}],false);}
assert.equal(c.packingLearningRecommendations(missingLedger,profile)[0].kind,'missing');
assert.equal(c.packingLearningRecommendations(missingLedger,profile)[0].count,5);

// Storage, actual trip completion, repeated exports, and rule revalidation on application.
await c.packingLearningCapture(f.t,f.state,f.result);
await c.packingLearningCapture(f.t,f.state,f.result);
assert.equal(Object.keys(c.packingLearningLoad().trips).length,1,'Repeated exports are not additional trips');
await c.packingLearningCapture({...f.t,id:'LEGACY'},{...f.state,legacy:true},f.result);
assert(!c.packingLearningLoad().trips.LEGACY,'Legacy imports do not invent rule opportunities');
await assert.rejects(c.packingLearningSaveReport(f.t,{...f.state,legacy:true},f.result,[],true),/automatic refinement/);
await c.packingLearningSaveReport(f.t,f.state,f.result,[{id:itemId,status:'unneeded'}],false);
const captured=c.packingLearningLoad().trips.BASE;
f.state.refinements.climate='cold';f.result=c.refineEvaluate(f.state,profile,[]);
await c.packingLearningCapture(f.t,f.state,f.result);
assert.equal(c.packingLearningLoad().trips.BASE.assumptions.refinements.climate,'mild','Re-exporting a reviewed trip does not alter its historical opportunity');
assert.equal(c.packingLearningLoad().trips.BASE.reviewedAt,captured.reviewedAt);
await assert.rejects(c.packingLearningSaveReport({...f.t,end:'2026-10-05'},f.state,f.result,[{id:itemId,status:'used'}],true),/after the trip/);
await assert.rejects(c.packingLearningSaveReport(f.t,f.state,f.result,[],false),/Add an exception/);
await c.db.doc(c.PACK_LEARNING_PATH).set(ledger);
let key=c.packingLearningRecommendations(ledger,profile)[0].key;
await c.packingLearningApply(key);
assert.equal(c.generatorPrefs().refinementProfile.excluded[itemId],'Wrinkle release');
await assert.rejects(c.packingLearningApply(key),/no longer eligible/);
await c.db.doc('meta/packing').set({...profile,generatorExtras:['Wrinkle release']});
await assert.rejects(c.packingLearningApply(key),/current rules protect/,'Safety is checked again against current rules, not stale historical flags');
await c.db.doc('meta/packing').set(profile);
storageBlocked=true;
await assert.rejects(c.packingLearningSaveReport(f.t,f.state,f.result,[{id:itemId,status:'used'}],true),/Storage is full or blocked/);
storageBlocked=false;
const realLedger=memory.get('ta:'+c.PACK_LEARNING_PATH),realProfile=memory.get('ta:meta/packing');
const test=environment(true),g=fixture('SANDBOX');
await test.packingLearningCapture({...g.t,end:'2026-10-10'},g.state,g.result);
await test.packingLearningSaveReport({...g.t,end:'2026-10-10'},g.state,g.result,[{id:itemId,status:'unneeded'}],false);
assert(memory.has('packing-test:ta:'+c.PACK_LEARNING_PATH));
assert.equal(Object.keys(test.packingLearningLoad().trips).length,1);
assert.equal(memory.get('ta:'+c.PACK_LEARNING_PATH),realLedger,'Sandbox feedback cannot become real evidence');
await test.db.doc(test.PACK_LEARNING_PATH).set(ledger);
await test.packingLearningApply(key);
assert.equal(memory.get('ta:meta/packing'),realProfile,'Applying a sandbox suggestion changes only sandbox preferences');
await test.packingLearningReset();
assert.equal(Object.keys(test.packingLearningLoad().trips).length,0);
assert.equal(memory.get('ta:'+c.PACK_LEARNING_PATH),realLedger);
await c.packingLearningForgetTrip('T1');
assert(!c.packingLearningLoad().trips.T1);
await c.packingLearningReset();
assert.equal(Object.keys(c.packingLearningLoad().trips).length,0);
assert.equal(memory.get('ta:meta/packing'),realProfile,'Resetting learning does not reset applied preferences');
console.log('OK: local packing learning, explicit evidence, context, protected items, rule revalidation and sandbox isolation');
