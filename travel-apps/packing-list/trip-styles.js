"use strict";
// Standalone app: reusable assumptions exclude dates, weather, occasion counts and manual edits.
// Standalone app: Tyler's built-in styles (Oct 2026); saved custom styles in meta/packingStyles are listed after these.
var PACK_TRIP_STYLES=[
  {id:"weekend",name:"Weekend",inputs:{tripType:"leisure",bag:"carryon",mode:"drive",activities:{}},refinements:{work:"none",packingMode:"standard",laundry:{available:false,firstWash:4,interval:4}}},
  {id:"wedding-weekend",name:"Wedding / event weekend",inputs:{tripType:"event",bag:"carryon",mode:"fly",occasions:true,activities:{}},refinements:{work:"none",packingMode:"standard",laundry:{available:false,firstWash:4,interval:4}}},
  {id:"beach-hawaii",name:"Beach / Hawaii",inputs:{tripType:"leisure",bag:"carryon",mode:"fly",activities:{water:true,hike:true,workout:true}},refinements:{work:"none",packingMode:"standard",laundry:{available:false,firstWash:4,interval:4},ruggedHike:false}},
  {id:"hiking",name:"Hiking (cooler)",inputs:{tripType:"leisure",bag:"carryon",mode:"fly",activities:{hike:true}},refinements:{work:"none",packingMode:"standard",laundry:{available:false,firstWash:4,interval:4},ruggedHike:true,daypack:true}},
  {id:"international",name:"International",inputs:{tripType:"leisure",bag:"carryon",mode:"fly",intl:true,activities:{}},refinements:{work:"none",packingMode:"standard",laundry:{available:false,firstWash:4,interval:4}}}
];
// Standalone app: the reusable part of a trip's state — the same fields Save trip style and Start from a past trip reuse.
function packingStyleFromState(state,id,name){var r=state.refinements,i=state.inputs;return {id:id,name:name,inputs:{tripType:i.tripType,bag:i.bag,mode:i.mode,intl:i.intl,occasions:!!(r.workDays>0 || r.formalDays || r.dinners),activities:clone(i.activities)},refinements:{work:r.work,packingMode:r.packingMode,laundry:clone(r.laundry),extraItems:clone(r.extraItems),daypack:r.daypack,ruggedHike:r.ruggedHike,brooksToo:!!r.brooksToo,longFlight:r.longFlight,thermal:r.thermal}};}
function packingStyleSummary(style){var r=style.refinements || {};return (r.packingMode==="extra" ? "Pack extra":"Standard packing")+", "+(r.laundry && r.laundry.available ? "laundry after "+r.laundry.firstWash+" days, then every "+r.laundry.interval+" days":"no laundry");}
function packingTripStyles(){return PACK_TRIP_STYLES.concat(lsGet("ta:meta/packingStyles",[]));}
function packingTripStyleSheet(state){
  var body=openSheet("Save trip style"),f=el("form","form gen-form"),name=inp("ps-name","text","");name.required=true;name.placeholder="Work week with workouts";f.appendChild(fieldEl("Style name",name));f.appendChild(el("p","gen-note","Reuses trip type, baggage, travel mode, activities, equipment, laundry and optional extras. Each new trip asks for its own dates, weather and occasion counts. Item edits and removals stay with the original trip."));
  var error=el("p","gen-error");error.setAttribute("role","status");var save=el("button","btn primary","Save style");save.type="submit";f.appendChild(error);f.appendChild(save);body.appendChild(f);
  f.addEventListener("submit",function(e){e.preventDefault();if(!name.value.trim()){error.textContent="Enter a style name.";return;}var styles=lsGet("ta:meta/packingStyles",[]),existing=styles.find(function(x){return x.name.toLowerCase()===name.value.trim().toLowerCase();}),style=packingStyleFromState(state,existing ? existing.id:"style-"+Date.now().toString(36),name.value.trim());
    if(existing)styles=styles.filter(function(x){return x.id!==existing.id;});styles.push(style);save.disabled=true;db.doc("meta/packingStyles").set(styles).then(function(){styleDraft.clear();closeSheet();}).catch(function(){save.disabled=false;error.textContent="Could not save this style. Check browser storage and try again.";});
  });var styleDraft=packingDraftAttach(f,"style:"+state.inputs.where+":"+state.inputs.start);
}
// Standalone app: Start from a past trip lists other trips with a generated (non-legacy, not deleted) list, newest first.
function packingPastTrips(excludeId){
  return Object.keys(TRIPS).filter(function(id){return id!==excludeId && !TRIPS[id].packingDeleted;}).map(function(id){var t=TRIPS[id],s=lsGet("ta:"+refinePath(id),null);
    if(!s || s.version!==2 || s.legacy || !s.inputs || !s.refinements || !s.overrides)return null;var start=t.start || s.inputs.start || "",label=t.name || t.where || id;if(start && label.indexOf(fmt(start))<0)label+=" · "+fmt(start);
    return {id:id,label:label,start:start,state:refineNormalizeState(clone(s))};}).filter(Boolean).sort(function(a,b){return String(b.start).localeCompare(String(a.start)) || a.id.localeCompare(b.id);});
}
function packingPastTripStyle(past){return packingStyleFromState(past.state,"trip:"+past.id,past.label);}
function packingPastTripNote(past){
  var probe=clone(past.state),c,parts=[];probe.overrides={removed:{},edited:{},added:{}};try{c=refineCarryOverrides(past.state,probe,generatorPrefs());}catch(e){c={removed:{},edited:{},added:{}};}
  function count(kind,one,many){var n=Object.keys(c[kind]).length;if(n)parts.push(n+" "+(n===1 ? one:many));}
  count("added","added item","added items");count("removed","removal","removals");count("edited","renamed or moved item","renamed or moved items");
  return "Reusing "+past.label+": "+packingStyleSummary(packingPastTripStyle(past))+(parts.length ? "; "+parts.join(", ")+" carry over":"")+". Quantities are recalculated; confirm dates, occasion counts and weather for this trip.";
}
