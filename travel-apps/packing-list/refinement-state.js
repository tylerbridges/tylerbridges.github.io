"use strict";
// Standalone app: versioned assumptions and explicit overrides are saved separately from exported list documents.
function refinePath(id){ return "trip/" + id + "/pack_meta/refinement"; }
function refineNewState(t,setup){
  setup = setup || {}; var activities = {}; ["hike","workout","water","fish"].forEach(function(k){ activities[k] = !!setup[k] || (k === "workout" && !!setup.run); });
  return {version:2,inputs:{where:t.where,start:t.start,end:t.end,mode:setup.mode || "fly",tripType:setup.tripType || "leisure",bag:setup.bag || "carryon",intl:!!setup.intl,activities:activities},
    refinements:{climate:setup.climate || "unknown",rain:!!setup.rain,thermal:"neutral",packingMode:"standard",laundry:{available:setup.laundry === "cycle",firstWash:setup.interval || 4,interval:setup.interval || 4},formalDays:setup.formal || 0,dinners:setup.dinners || 0,work:setup.work || "none",workDays:setup.workDays == null ? (setup.work && setup.work!=="none" ? null : 0) : setup.workDays,dinnerTop:null,dinnerBottoms:null,tie:false,alternateKhakis:false,shareSuitShirts:false,shirtOverlap:null,suitOverlap:null,warmWeather:false,extraItems:clone(setup.extraItems || {}),daypack:!!setup.daypack,ruggedHike:!!setup.ruggedHike,longFlight:!!setup.longintl},
    overrides:{removed:{},edited:{},added:{}},reviewed:{},decisionReviews:{},ruleResults:{},history:[],baseline:null};
}
// Standalone app: normalize old assumptions without changing preferences or explicit item overrides.
function refineNormalizeState(state){
  var a=state.inputs.activities;
  if(!Object.prototype.hasOwnProperty.call(a,"workout"))a.workout=!!a.run;
  delete a.run;
  if(state.refinements.packingMode==="light")state.refinements.packingMode="standard";
  if(!state.reviewed)state.reviewed={};
  if(!state.decisionReviews)state.decisionReviews={};
  var r=state.refinements,defaults={workDays:r.work!=="none" ? null:0,dinnerTop:null,dinnerBottoms:null,tie:false,alternateKhakis:false,shareSuitShirts:false,shirtOverlap:null,suitOverlap:null,warmWeather:false};
  Object.keys(defaults).forEach(function(key){if(!Object.prototype.hasOwnProperty.call(r,key))r[key]=defaults[key];});
  if(!state.refinements.extraItems)state.refinements.extraItems={};
  if(state.refinements.daypack == null)state.refinements.daypack=false;
  if(state.refinements.ruggedHike == null)state.refinements.ruggedHike=false;
  return state;
}
// Standalone app: decisions depend on their context, so changing counts/weather reopens relevant questions.
function refineDecisionKey(state,focus){var r=state.refinements;
  var values={Work:[state.inputs.start,state.inputs.end,state.inputs.tripType,r.work,r.workDays],Events:[state.inputs.start,state.inputs.end,state.inputs.tripType,r.formalDays,r.dinners],"Dinner outfit":[r.dinners,r.climate,r.thermal,r.dinnerTop,r.dinnerBottoms],"Suit outfit":[r.formalDays,r.tie,r.alternateKhakis,r.shareSuitShirts],"Shirt sharing":[r.work,r.workDays,r.dinners,r.dinnerTop,r.formalDays,r.shareSuitShirts,r.shirtOverlap,r.suitOverlap]};
  return values[focus] ? JSON.stringify(values[focus]):null;
}
function refinePendingDecisions(state){
  if(state.legacy)return [];var r=state.refinements,w=refineWardrobe(state),pending=[];
  function needs(focus){return (state.decisionReviews || {})[focus]!==refineDecisionKey(state,focus);}
  if((state.inputs.tripType==="work" || r.work!=="none" || w.workDays>0) && (r.workDays==null || needs("Work")))pending.push("Work");
  if(state.inputs.tripType==="event" && needs("Events"))pending.push("Events");
  if(r.dinners>0 && (!r.dinnerTop || !r.dinnerBottoms || needs("Dinner outfit")))pending.push("Dinner outfit");
  if(r.formalDays>0 && needs("Suit outfit"))pending.push("Suit outfit");
  if(w.canShare && needs("Shirt sharing"))pending.push("Shirt sharing");
  return pending;
}
function refineLoad(t){
  var saved = lsGet("ta:" + refinePath(t.id),null); if (saved && saved.version === 2) return refineNormalizeState(saved);
  var state = refineNewState(t,t.generatorSetup), pending = lsGet("ta:trip/" + t.id + "/pack_meta/draft",null), old = pending || generatorSaved(t);
  if (old.groups && old.groups.length){
    // Legacy rows are preserved as explicit overrides, never guessed to be safe to regenerate.
    state.legacy = true; old.groups.forEach(function(g){ if (g.depart) return; g.items.forEach(function(label,index){ var item = refineItem(label,g.title,"Imported from your existing list"); if(state.overrides.added[item.id])item.id += ":legacy:"+normItem(g.title).replace(/ /g,"-")+":"+index;item.legacy=true;state.overrides.added[item.id] = item; }); });
  }
  return state;
}
function refineSnapshot(state){ var copy = clone(state); delete copy.undo; delete copy.undoProfile; return copy; }
function refinePersist(t,state,result){
  state.ruleResults = result.ruleResults; state.ruleKeys = result.ruleKeys || {}; state.profileSignature = result.profileSignature;
  if (!state.baseline) state.baseline = result.items.map(function(x){ return {id:x.id,label:x.label,quantity:x.quantity,reasons:x.reasons}; });
  state.updatedAt = Date.now(); return db.doc(refinePath(t.id)).set(state);
}
function refineLegacyResult(state){
  var items = Object.keys(state.overrides.added).filter(function(id){ return !state.overrides.removed[id]; }).map(function(id){ return Object.assign({},state.overrides.added[id],state.overrides.edited[id] || {},{manual:true,reasons:["Preserved from your existing list"]}); });
  var groups = []; items.forEach(function(item){ var g = groups.find(function(x){ return x.title === item.section; }); if (!g){ g = {title:item.section,items:[]}; groups.push(g); } g.items.push(item); });
  var departing = leavingFor(groups.map(function(g){ return {title:g.title,items:g.items.map(refineLabel)}; }),state.inputs.bag === "checked");
  groups.push({title:"Before leaving",depart:true,items:departing.map(function(label){ return refineItem(label,"Before leaving","Derived from your saved list"); })});
  return {groups:groups,items:items,warnings:[{id:"legacy",text:"Your existing list is preserved. Start automatic refinement when you are ready; old items will remain pinned."}],ruleResults:{},profileSignature:"",ran:[]};
}
function refineChanges(before,after){ var previous = {}, next = {}, changes = []; before.items.forEach(function(x){ previous[x.id] = x; }); after.items.forEach(function(x){ next[x.id] = x; });
  Object.keys(previous).forEach(function(id){ if (!next[id]) changes.push("Removed " + previous[id].label); else if (previous[id].quantity !== next[id].quantity) changes.push(previous[id].label + ": " + previous[id].quantity + " → " + next[id].quantity); else if (previous[id].section !== next[id].section) changes.push(previous[id].label + ": moved to " + next[id].section); else if(previous[id].label!==next[id].label)changes.push(previous[id].label+" → "+next[id].label); });
  Object.keys(next).forEach(function(id){ if (!previous[id]) changes.push("Added " + refineLabel(next[id])); }); return changes;
}
function refineExclude(profile,item){ var p = clone(profile); p.refinementProfile = p.refinementProfile || {excluded:{}}; p.refinementProfile.excluded = p.refinementProfile.excluded || {}; p.refinementProfile.excluded[item.id] = item.label; return p; }
