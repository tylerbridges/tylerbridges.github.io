"use strict";
// Standalone app: versioned assumptions and explicit overrides are saved separately from exported list documents.
function refinePath(id){ return "trip/" + id + "/pack_meta/refinement"; }
function refineNewState(t,setup){
  setup = setup || {}; var activities = {}; ["hike","workout","water","fish"].forEach(function(k){ activities[k] = !!setup[k] || (k === "workout" && !!setup.run); });
  return {version:2,inputs:{where:t.where,start:t.start,end:t.end,mode:setup.mode || "fly",tripType:setup.tripType || "leisure",bag:setup.bag || "carryon",intl:!!setup.intl,activities:activities},
    refinements:{climate:setup.climate || "unknown",rain:!!setup.rain,thermal:"neutral",packingMode:"standard",laundry:{available:setup.laundry === "cycle",firstWash:setup.interval || 4,interval:setup.interval || 4},formalDays:setup.formal || 0,dinners:setup.dinners || 0,work:setup.work || "none",workDays:setup.workDays == null ? (setup.work && setup.work!=="none" ? null : 0) : setup.workDays,dinnerTop:null,dinnerOtherTop:"",dinnerBottoms:null,dinnerOtherBottoms:"",dinnerOtherBelt:true,tie:true,alternateKhakis:true,shareSuitShirts:false,shirtOverlap:null,suitOverlap:null,warmWeather:false,extraItems:clone(setup.extraItems || {}),daypack:!!setup.daypack,ruggedHike:!!setup.ruggedHike,brooksToo:!!setup.brooksToo,longFlight:!!setup.longintl},
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
  var r=state.refinements,defaults={workDays:r.work!=="none" ? null:0,dinnerTop:null,dinnerOtherTop:"",dinnerBottoms:null,dinnerOtherBottoms:"",dinnerOtherBelt:true,tie:true,alternateKhakis:true,shareSuitShirts:false,shirtOverlap:null,suitOverlap:null,warmWeather:false};
  Object.keys(defaults).forEach(function(key){if(!Object.prototype.hasOwnProperty.call(r,key))r[key]=defaults[key];});
  if(!state.refinements.extraItems)state.refinements.extraItems={};
  if(state.refinements.daypack == null)state.refinements.daypack=false;
  if(state.refinements.ruggedHike == null)state.refinements.ruggedHike=false;
  if(state.refinements.brooksToo == null)state.refinements.brooksToo=false;
  return state;
}
// Standalone app: decisions depend on their context, so changing counts/weather reopens relevant questions.
function refineDecisionKey(state,focus){var r=state.refinements;
  var values={Work:[state.inputs.start,state.inputs.end,state.inputs.tripType,r.work,r.workDays],Events:[state.inputs.start,state.inputs.end,state.inputs.tripType,r.formalDays,r.dinners],"Dinner outfit":[r.dinners,r.climate,r.thermal,r.dinnerTop,r.dinnerBottoms],"Suit outfit":["professional-rotation-v2",r.formalDays,r.tie,r.alternateKhakis,r.shareSuitShirts],"Shirt sharing":[r.work,r.workDays,r.dinners,r.dinnerTop,r.formalDays,r.shareSuitShirts,r.shirtOverlap,r.suitOverlap]};
  // Standalone app: long trips without laundry need an explicit laundry answer; trip length and laundry inputs reopen it.
  if(focus==="Laundry"){var days=null;try{days=refineDays(state.inputs.start,state.inputs.end);}catch(e){}values[focus]=["long-trip-laundry-v1",days,!!r.laundry.available,r.laundry.firstWash,r.laundry.interval];}
  if(focus==="Dinner outfit"){if(r.dinnerTop==="other")values[focus].push(["other-top",r.dinnerOtherTop]);if(r.dinnerBottoms==="other")values[focus].push(["other-bottoms",r.dinnerOtherBottoms,r.dinnerOtherBelt]);}
  return values[focus] ? JSON.stringify(values[focus]):null;
}
var REFINE_LONG_TRIP_DAYS=8;
// Standalone app: same day count the engine uses for full-trip clothing quantities.
function refineLongTripNoLaundry(state){if(state.legacy || state.refinements.laundry.available)return false;try{return refineDays(state.inputs.start,state.inputs.end)>=REFINE_LONG_TRIP_DAYS;}catch(e){return false;}}
function refinePendingDecisions(state){
  if(state.legacy)return [];var r=state.refinements,w=refineWardrobe(state),pending=[];
  function needs(focus){return (state.decisionReviews || {})[focus]!==refineDecisionKey(state,focus);}
  if((state.inputs.tripType==="work" || r.work!=="none" || w.workDays>0) && (r.workDays==null || needs("Work")))pending.push("Work");
  if(state.inputs.tripType==="event" && needs("Events"))pending.push("Events");
  if(r.dinners>0 && (!r.dinnerTop || !r.dinnerBottoms || (r.dinnerTop==="other" && !String(r.dinnerOtherTop || "").trim()) || (r.dinnerBottoms==="other" && !String(r.dinnerOtherBottoms || "").trim()) || needs("Dinner outfit")))pending.push("Dinner outfit");
  if(r.formalDays>0 && needs("Suit outfit"))pending.push("Suit outfit");
  if(w.canShare && needs("Shirt sharing"))pending.push("Shirt sharing");
  if(refineLongTripNoLaundry(state) && needs("Laundry"))pending.push("Laundry");
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
// Standalone app: a failed second write restores the trip header to its original dates.
function refineSaveTrip(record,patch,state,result){
  var doc=db.doc("trips/"+record.id),previous;
  return doc.get().then(function(snap){previous=snap;return doc.set(patch);}).then(function(){
    return refinePersist(record,state,result).catch(function(error){
      var restore=previous.exists ? doc.set(previous.data()) : doc.delete();
      return restore.then(function(){throw error;});
    });
  });
}
function refineLegacyResult(state){
  var items = Object.keys(state.overrides.added).filter(function(id){ return !state.overrides.removed[id]; }).map(function(id){ return Object.assign({},state.overrides.added[id],state.overrides.edited[id] || {},{manual:true,reasons:["Preserved from your existing list"]}); });
  items.forEach(function(item){if(item.section==="Toiletries")item.section=toiletryBagSection(item.label);});
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
// Standalone app: Start from a past trip carries its explicit added items, removals and label/section edits onto a new trip's
// fresh rules — never quantity edits. Removals of items this trip requires or no longer generates, adds the rules now cover and
// legacy rows are skipped. Carried ids are listed in state.carried until the new list is exported or the edit is redone.
function refineCarryOverrides(past,state,profile){
  var auto=clone(state),items={},o=past.overrides || {},removed=o.removed || {},edited=o.edited || {},added=o.added || {},carried={from:past.inputs ? past.inputs.where:null,removed:{},edited:{},added:{}};
  auto.overrides={removed:{},edited:{},added:{}};auto.ruleResults={};auto.ruleKeys={};
  refineEvaluate(auto,profile,null).items.forEach(function(x){items[x.id]=x;});
  Object.keys(removed).forEach(function(id){var x=items[id];if(!removed[id] || added[id] || !x || x.critical || x.required)return;state.overrides.removed[id]=true;carried.removed[id]=true;});
  Object.keys(edited).forEach(function(id){var e=edited[id],x=items[id];if(!e || removed[id] || !x || state.overrides.removed[id])return;var label=String(e.label || "").trim() || x.label,section=e.section || x.section;if(section==="Toiletries")section=toiletryBagSection(label);
    if(label===x.label && section===x.section)return;state.overrides.edited[id]={id:id,label:label,section:section};carried.edited[id]=true;});
  Object.keys(added).forEach(function(id){var a=added[id],label=a && String(a.label || "").trim();if(!label || removed[id] || a.legacy || state.overrides.added[id])return;var key=refineId(label);if(items["pack:"+key] || items["wear:"+key])return;
    state.overrides.added[id]={id:id,label:label,quantity:a.quantity>0 ? a.quantity:1,section:a.section==="Toiletries" ? toiletryBagSection(label):a.section || "Personal bag & day gear"};carried.added[id]=true;});
  state.carried=carried;return carried;
}
// Redoing, reverting or restoring a carried override makes it this trip's own edit.
function refineCarriedPrune(prev,next){var c=next.carried;if(!c)return next;
  ["removed","edited","added"].forEach(function(kind){Object.keys(c[kind] || {}).forEach(function(id){if(JSON.stringify(((prev.overrides || {})[kind] || {})[id])!==JSON.stringify((next.overrides[kind] || {})[id]))delete c[kind][id];});});
  if(!["removed","edited","added"].some(function(kind){return Object.keys(c[kind] || {}).length;}))delete next.carried;return next;
}
