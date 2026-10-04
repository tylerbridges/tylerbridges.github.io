"use strict";
// Standalone app: reusable assumptions exclude dates, weather, occasion counts and manual edits.
var PACK_TRIP_STYLES=[
  {id:"weekend",name:"Weekend",inputs:{tripType:"leisure",bag:"carryon",mode:"drive",activities:{}},refinements:{work:"none",packingMode:"standard",laundry:{available:false,firstWash:4,interval:4}}},
  {id:"work-week",name:"Work week",inputs:{tripType:"work",bag:"carryon",mode:"fly",activities:{}},refinements:{work:"laptop",packingMode:"standard",laundry:{available:false,firstWash:4,interval:4}}},
  {id:"longer-trip",name:"Longer trip",inputs:{tripType:"leisure",bag:"checked",mode:"fly",activities:{}},refinements:{work:"none",packingMode:"standard",laundry:{available:true,firstWash:4,interval:4}}}
];
function packingTripStyles(){return PACK_TRIP_STYLES.concat(lsGet("ta:meta/packingStyles",[]));}
function packingTripStyleSheet(state){
  var body=openSheet("Save trip style"),f=el("form","form gen-form"),name=inp("ps-name","text","");name.required=true;name.placeholder="Work week with workouts";f.appendChild(fieldEl("Style name",name));f.appendChild(el("p","gen-note","Reuses trip type, baggage, travel mode, activities, equipment, laundry and optional extras. Each new trip asks for its own dates, weather and occasion counts. Item edits and removals stay with the original trip."));
  var error=el("p","gen-error");error.setAttribute("role","status");var save=el("button","btn primary","Save style");save.type="submit";f.appendChild(error);f.appendChild(save);body.appendChild(f);
  f.addEventListener("submit",function(e){e.preventDefault();if(!name.value.trim()){error.textContent="Enter a style name.";return;}var styles=lsGet("ta:meta/packingStyles",[]),existing=styles.find(function(x){return x.name.toLowerCase()===name.value.trim().toLowerCase();}),r=state.refinements,i=state.inputs,style={id:existing ? existing.id:"style-"+Date.now().toString(36),name:name.value.trim(),inputs:{tripType:i.tripType,bag:i.bag,mode:i.mode,intl:i.intl,occasions:!!(r.workDays>0 || r.formalDays || r.dinners),activities:clone(i.activities)},refinements:{work:r.work,packingMode:r.packingMode,laundry:clone(r.laundry),extraItems:clone(r.extraItems),daypack:r.daypack,ruggedHike:r.ruggedHike,longFlight:r.longFlight,thermal:r.thermal}};
    if(existing)styles=styles.filter(function(x){return x.id!==existing.id;});styles.push(style);save.disabled=true;db.doc("meta/packingStyles").set(styles).then(function(){styleDraft.clear();closeSheet();}).catch(function(){save.disabled=false;error.textContent="Could not save this style. Check browser storage and try again.";});
  });var styleDraft=packingDraftAttach(f,"style:"+state.inputs.where+":"+state.inputs.start);
}
