import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const saved=new Map();
const c=vm.createContext({document:{getElementById(){return null;},addEventListener(){}},window:{addEventListener(){}},localStorage:{getItem(k){return saved.get(k)||null;}},console,setTimeout,clearTimeout});
for(const name of ["shared/core.js","packing-list/preferences.js","packing-list/packing.js","packing-list/generator.js","packing-list/refinement-engine.js","packing-list/refinement-state.js"]){vm.runInContext(readFileSync(new URL('../'+name,import.meta.url),'utf8'),c);}
const trip={id:"TEST",name:"Test",where:"Phoenix",start:"2026-10-08",end:"2026-10-14"};
assert.equal(c.refineDays('2026-10-31','2026-11-02'),3);assert.throws(()=>c.refineDays('2026-02-30','2026-03-02'),/valid calendar/);assert.throws(()=>c.refineDays('2026-10-01','2026-12-01'),/1–60/);
const profile=JSON.parse(JSON.stringify(c.PACK_PREFS));
let state=c.refineNewState(trip,{});
function run(changed=null,p=profile){const r=c.refineEvaluate(state,p,changed);state.ruleResults=r.ruleResults;state.ruleKeys=r.ruleKeys;state.profileSignature=r.profileSignature;return r;}
function item(result,id){return result.items.find(x=>x.id===id);}
let r=run();assert.equal(item(r,'pack:socks').quantity,13);assert.equal(item(r,'wear:socks').quantity,1);assert.equal(item(r,'pack:tshirts').quantity,6);assert.equal(item(r,'pack:contacts').quantity,10);assert(r.warnings.some(x=>x.id==='weather'));
state.refinements.laundry={available:true,firstWash:2,interval:2};r=run(['laundry']);assert.equal(item(r,'pack:socks').quantity,5);assert.equal(item(r,'pack:tshirts').quantity,2);assert.equal(item(r,'pack:contacts').quantity,10);assert.deepEqual(Array.from(r.ran),['clothing','activities']);
state.refinements.laundry={available:true,firstWash:2,interval:30};r=run([]);assert.equal(item(r,'pack:socks').quantity,11);assert.deepEqual(Array.from(r.ran),['clothing','activities']);
state.refinements.laundry={available:true,firstWash:6,interval:2};r=run(['laundry']);assert.equal(item(r,'pack:socks').quantity,13);
state.refinements.packingMode='light';r=run(['packingMode']);assert(!item(r,'pack:kindle'));assert(item(r,'pack:whoop-charger'));assert(item(r,'pack:contacts'));assert.equal(item(r,'pack:socks').quantity,13);
state.refinements.rain=true;state.refinements.climate='hot';r=run(['rain','climate']);assert(item(r,'pack:rain-jacket'));assert(!item(r,'pack:light-packable-puffer-jacket'));assert(!item(r,'pack:lulu-joggers'));
state.inputs.activities.hike=true;r=run(['activities']);assert(item(r,'pack:hiking-footwear'));assert(item(r,'pack:daypack'));assert.equal(r.items.filter(x=>x.id==='pack:daypack').length,1);assert(item(r,'pack:daypack').required);
state.overrides.removed['pack:rain-jacket']=true;r=run([]);assert(!item(r,'pack:rain-jacket'));assert(r.warnings.some(x=>x.id==='hiking-rain'));
state.overrides.edited['pack:socks']={...item(r,'pack:socks'),quantity:8};state.refinements.packingMode='extra';r=run(['packingMode']);assert.equal(item(r,'pack:socks').quantity,8);assert(item(r,'pack:socks').manual);assert(item(r,'pack:socks').reasons.some(x=>x.includes('extra clothing day')));
delete state.overrides.edited['pack:socks'];r=run([]);assert.equal(item(r,'pack:socks').quantity,15);
state.overrides.added['manual:test']={id:'manual:test',label:'Camera',quantity:2,section:'Gear'};r=run([]);assert.equal(item(r,'manual:test').quantity,2);
state.refinements.work='work';r=run([]);assert.deepEqual(Array.from(r.ran),['work']);assert(item(r,'pack:work-computer-charger'));assert(r.warnings.some(x=>x.id==='work-baggage'));
state.overrides.removed['pack:work-computer']=true;r=run([]);assert(r.warnings.some(x=>x.id==='removed:pack:work-computer'));assert(!r.groups.at(-1).items.some(x=>x.label==='Work computer packed?'));
state.overrides.edited['pack:contacts']={...item(r,'pack:contacts'),quantity:5};r=run([]);assert(r.warnings.some(x=>x.id==='quantity:pack:contacts'));
state.refinements.climate='cold';state.refinements.thermal='hot';r=run(['climate','thermal']);assert(item(r,'pack:gloves'));assert(item(r,'pack:light-packable-puffer-jacket'));
const excluded=c.refineExclude(profile,{id:'pack:kindle',label:'Kindle'});state.refinements.packingMode='standard';r=run(['packingMode'],excluded);assert(!item(r,'pack:kindle'));
excluded.refinementProfile.excluded['pack:contacts']='Contacts';r=run(['profile'],excluded);assert(item(r,'pack:contacts'));assert(r.warnings.some(x=>x.id==='excluded:pack:contacts'));
assert.equal(r.groups.at(-1).title,'Before leaving');
r=run([],excluded);assert.deepEqual(Array.from(r.ran),[]);
state.overrides.edited['pack:light-packable-puffer-jacket']={...item(r,'pack:light-packable-puffer-jacket'),section:'Clothing'};r=run([],excluded);assert.equal(item(r,'pack:light-packable-puffer-jacket').section,'Clothing');
state.inputs.bag='checked';r=run([],excluded);assert.deepEqual(Array.from(r.ran),[]);
state.refinements.formalDays=1;r=run([],excluded);assert.deepEqual(Array.from(r.ran),['events']);
const snapshot=c.refineSnapshot({...state,undo:{something:true},undoProfile:{something:true}});assert(!snapshot.undo);assert(!snapshot.undoProfile);
saved.set('ta:trip/OLD/pack_meta/draft',JSON.stringify({groups:[{title:'Clothing',items:['Socks ×3','Special shirt ×2']},{title:'Before leaving',depart:true,items:['Grab wallet']}]}));
c.generatorSaved=()=>({groups:[]});const legacy=c.refineLoad({...trip,id:'OLD'});assert(legacy.legacy);let old=c.refineLegacyResult(legacy);assert.equal(item(old,'pack:socks').quantity,3);assert.equal(old.items.length,2);
legacy.legacy=false;old=c.refineEvaluate(legacy,profile,null);assert.equal(item(old,'pack:socks').quantity,3);assert.equal(old.items.filter(x=>x.id==='pack:socks').length,1);assert(item(old,'pack:special-shirt'));
console.log('OK: selective rules, interactions, override persistence, critical protection, defaults, legacy migration, and export dependencies');
