"use strict";
// Standalone app: pure rule groups return item contributions; display text is never the source of quantities.
var REFINE_ORDER = ["Wear to travel","Clothing","Personal bag & day gear","Toiletries","Formal wear","Work","Gear","Before leaving"];
function refineDays(start,end){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(end || ""))throw new Error("Set valid trip dates before generating.");
  var a=Date.parse(start+"T00:00:00Z"),b=Date.parse(end+"T00:00:00Z");
  if(!Number.isFinite(a) || !Number.isFinite(b) || new Date(a).toISOString().slice(0,10)!==start || new Date(b).toISOString().slice(0,10)!==end)throw new Error("Set valid calendar dates.");
  var days=(b-a)/86400000+1;if(days<1 || days>60)throw new Error("Choose dates in order, spanning 1–60 travel days.");return days;
}
function refineId(label){
  var key = normItem(label);
  var aliases = {"shirt":"tshirts","t shirts":"tshirts","t shirt":"tshirts","socks":"socks","underwear":"underwear","contacts":"contacts","small collapsible backpack":"daypack","rain jacket umbrella":"rain-protection","hiking boots trail shoes":"hiking-footwear"};
  return aliases[key] || key.replace(/ /g,"-");
}
function refineItem(label,section,reason,options){
  options = options || {}; var match = String(label).match(/\s*[×x]\s*(\d+)\s*$/i), base = match ? label.slice(0,match.index).trim() : label;
  var critical = /^(contacts|glasses|passport|.*medication|medicine pouch|.*prescription|zyrtec|ibuprofen|prep h|whoop charger|work computer)$/.test(normItem(base));
  return {id:(section === "Wear to travel" ? "wear:" : "pack:") + refineId(base),label:base,quantity:options.quantity != null ? options.quantity : match ? +match[1] : 1,
    section:section,reasons:[reason],critical:critical || !!options.critical,optional:!!options.optional,required:!!options.required,category:options.category || (qtyKey(base) && qtyKey(base)!=="contacts" ? "clothing":"gear")};
}
function refineContext(state){
  var i = state.inputs, r = state.refinements, days = refineDays(i.start,i.end);
  var laundry = r.laundry, firstGap = Math.min(days,laundry.firstWash), laterGap = Math.min(Math.max(0,days-firstGap),laundry.interval);
  var clothingDays = laundry.available ? Math.min(days,Math.max(firstGap,laterGap) + 1) : days;
  var climate = r.climate, cool = climate === "cool" || climate === "cold";
  if (r.thermal === "cold" && climate === "mild") cool = true;
  // Standalone app: running hot never removes cool/cold-weather clothing protection.
  return {days:days,clothingDays:clothingDays,cool:cool,cold:climate === "cold",unknown:climate === "unknown",inputs:i,r:r};
}
function refineClothing(state,profile,c){
  var r = c.r, d = c.clothingDays, extra = r.packingMode === "extra" ? 1 : 0;
  var shirts = d + extra, bottoms = Math.ceil(d / 2) + extra;
  var jog = c.cool || c.cold ? Math.ceil((c.inputs.activities.workout ? Math.ceil(d / 2) : bottoms) / 2) : 0, out = [];
  ["Shirt","Pants","Underwear","Socks"].forEach(function(x){ out.push(refineItem(x,"Wear to travel","Departure outfit counts toward clothing totals",{category:"clothing"})); });
  [["T-shirts",shirts - 1],["Underwear",2*d - 1 + 2*extra],["Socks",2*d - 1 + 2*extra],["Lulu shorts",bottoms-jog],["Lulu joggers",jog]].forEach(function(x){ if (x[1]) out.push(refineItem(x[0],"Clothing",(r.laundry.available ? "Laundry coverage: " + d + " days" : "Full-trip clothing: " + d + " days") + (extra ? "; one extra clothing day" : ""),{quantity:x[1],category:"clothing"})); });
  return out;
}
function refineDefaults(state,profile,c){
  var out = [];
  var optional = /^(kindle|snacks|extra phone case|hotspot|belkin charging pad|wrinkle release|lint roller)$/i;
  (profile.extras || PACK_PREFS.extras).forEach(function(g){ (g.items || []).forEach(function(label){
    if (qtyKey(label)) return;
    var item = refineItem(label,g.title,"Your usual packing preferences",{optional:optional.test(qtyBase(label))});
    out.push(item);
  }); });
  (profile.generatorExtras || []).forEach(function(label){ out.push(refineItem(label,"Personal bag & day gear","Your always-bring items",{required:true})); });
  return out;
}
function refineLayers(state,profile,c){
  var out = [], r = c.r;
  if (c.cool || c.cold){
    out.push(refineItem("Sweatshirt / hoodie","Wear to travel","Hoodie and puffer for cool/cold weather, including when you run hot",{required:true}));
    out.push(refineItem("Light packable puffer jacket","Clothing","Hoodie and puffer for cool/cold weather, including when you run hot",{required:true}));
  }
  if (c.cold) ["Gloves","Beanie","Thermal base layers"].forEach(function(x){ out.push(refineItem(x,"Clothing","Cold-weather protection",{required:true})); });
  if (r.rain) out.push(refineItem("Rain jacket","Clothing","Rain protection; rain does not change temperature",{required:true}));
  return out;
}
function refineActivities(state,profile,c){
  var a = c.inputs.activities, out = [], maybe = profile.maybe || PACK_PREFS.maybe;
  ["hike","water","fish"].forEach(function(tag){ if (!a[tag]) return;
    maybe.filter(function(g){ return g.tag === tag; }).forEach(function(g){ g.items.forEach(function(label){ if(tag === "hike" && refineId(label) === "hiking-footwear" && !c.r.ruggedHike)return;out.push(refineItem(label,g.title,"Required for " + tag,{required:true})); }); });
  });
  if (a.hike){
    out.push(refineItem(c.r.ruggedHike ? "Hiking boots / trail shoes" : "Brooks running shoes",c.r.ruggedHike ? "Clothing" : "Wear to travel",c.r.ruggedHike ? "Rugged or wet trails require hiking footwear" : "Your Brooks cover ordinary hikes",{required:true}));
    [["Small collapsible backpack","Personal bag & day gear"],["Water bottle","Personal bag & day gear"],["Hat","Wear to travel"]].forEach(function(x){ out.push(refineItem(x[0],x[1],"Hiking dependency",{required:true})); });
    if (c.unknown) out.push(refineItem("Rain jacket","Clothing","Hiking weather is unconfirmed; conservative weather protection",{required:true}));
    if (c.cool || c.cold) out.push(refineItem("Light packable puffer jacket","Clothing","Hiking insulation",{required:true}));
  }
  if (a.workout){
    out.push(refineItem("Brooks running shoes","Wear to travel","Workouts use your usual shoes",{required:true}));
    out.push(refineItem("Water bottle","Personal bag & day gear","Workout hydration",{required:true}));
    out.push(refineItem("Shirt","Wear to travel","Workouts use regular T-shirts; the travel shirt counts",{required:true,category:"clothing"}));
    var extra=c.r.packingMode === "extra" ? 1 : 0, shirts=c.clothingDays-1+extra;
    if(shirts>0)out.push(refineItem("T-shirts","Clothing","Workouts most days: a fresh regular T-shirt daily; laundry and travel shirt count",{quantity:shirts,required:true,category:"clothing"}));
    out.push(refineItem("Lulu shorts","Clothing","Workouts most days: regular shorts cover two days per pair, including in cool weather; laundry counts",{quantity:Math.ceil(c.clothingDays/2)+extra,required:true,category:"clothing"}));
  }
  if (c.inputs.intl){ maybe.filter(function(g){ return g.tag === "intl"; }).forEach(function(g){ g.items.forEach(function(x){ out.push(refineItem(x,g.title,"International travel",{required:true})); }); }); }
  if (c.inputs.intl && c.inputs.mode === "fly" && c.r.longFlight) maybe.filter(function(g){ return g.tag === "longintl"; }).forEach(function(g){ g.items.forEach(function(x){ out.push(refineItem(x,g.title,"Long international flight")); }); });
  return out;
}
function refineEvents(state,profile,c){
  var out = [], r = c.r, maybe = profile.maybe || PACK_PREFS.maybe;
  if (r.formalDays){ maybe.filter(function(g){ return g.tag === "formal"; }).forEach(function(g){ g.items.forEach(function(x){ var n = /dress socks|white shirt|undershirt/i.test(x) ? r.formalDays : undefined; out.push(refineItem(x,g.title,"Formal event: " + r.formalDays + " day(s)",{quantity:n,required:true})); }); }); out.push(refineItem("Dress pants","Formal wear","Reusable formal trousers",{required:true})); out.push(refineItem("Belt","Formal wear","Formal outfit dependency",{required:true})); }
  if (r.dinners){ maybe.filter(function(g){ return g.tag === "dinner"; }).forEach(function(g){ g.items.forEach(function(x){ out.push(refineItem(x,g.title,"One button-up per nice dinner",{quantity:r.dinners,required:true})); }); }); }
  return out;
}
function refineWork(state,profile,c){
  var out=[],r=c.r,maybe=profile.maybe || PACK_PREFS.maybe;
  if (r.work !== "none"){
    maybe.filter(function(g){ return g.tag === r.work; }).forEach(function(g){ g.items.forEach(function(x){ out.push(refineItem(x,g.title,"Selected work setup",{required:true})); }); });
    out.push(refineItem("Work computer charger","Work","Laptop power dependency",{required:true}));
    if (r.work === "work") out.push(refineItem("Logitech mouse dongle","Work","Full work setup dependency",{required:true}));
  }
  return out;
}
function refineConsumables(state,profile,c){ return [refineItem("Contacts","Toiletries","Full trip plus two days, rounded to a multiple of five",{quantity:5*Math.ceil((c.days+2)/5),critical:true}),refineItem("Liquids quart bag (travel-size)","Toiletries","Your travel-size liquids rule applies on every trip",{required:true})]; }
var REFINE_RULES = {
  clothing:{deps:["dates","laundry","packingMode","climate","thermal","activities"],run:refineClothing},
  defaults:{deps:["profile"],run:refineDefaults},
  layers:{deps:["climate","thermal","rain"],run:refineLayers},
  activities:{deps:["activities","climate","thermal","rain","dates","laundry","packingMode","intl","mode","longFlight","ruggedHike","profile"],run:refineActivities},
  events:{deps:["formalDays","dinners","profile"],run:refineEvents},
  work:{deps:["work","profile"],run:refineWork},
  consumables:{deps:["dates"],run:refineConsumables}
};
function refineLabel(item){ return item.label + (item.quantity > 1 || item.category === "clothing" || item.id === "pack:contacts" ? " ×" + item.quantity : ""); }
function refineEvaluate(state,profile,changed){
  refineNormalizeState(state);
  var c = refineContext(state), signature = JSON.stringify(profile), cache = {}, keys = {}, ran = [];
  // Standalone app: cache validity comes from actual dependency values, never caller hints alone.
  Object.keys(REFINE_RULES).forEach(function(id){var rule=REFINE_RULES[id];
    keys[id]="preferences-2026-10-v1:"+JSON.stringify(rule.deps.map(function(key){if(key==="profile")return profile;if(key==="dates")return [state.inputs.start,state.inputs.end];return Object.prototype.hasOwnProperty.call(state.inputs,key) ? state.inputs[key] : state.refinements[key];}));
    if(!state.ruleResults || !state.ruleResults[id] || !state.ruleKeys || state.ruleKeys[id]!==keys[id]){cache[id]=rule.run(state,profile,c);ran.push(id);}else cache[id]=state.ruleResults[id];
  });
  var merged = {}, order = [], excluded = profile.refinementProfile && profile.refinementProfile.excluded || {};
  Object.keys(cache).forEach(function(rule){ cache[rule].forEach(function(source){ var item = clone(source); item.rule = rule;
    if (excluded[item.id] && !item.critical && !item.required) return;
    if (!merged[item.id]){ merged[item.id] = item; order.push(item.id); } else { var old = merged[item.id]; old.quantity = Math.max(old.quantity,item.quantity); old.critical = old.critical || item.critical; old.required = old.required || item.required; old.reasons = old.reasons.concat(item.reasons); }
  }); });
  var warnings = [], items = [], overrides = state.overrides;
  order.forEach(function(id){ var item = merged[id];
    if (excluded[id] && (item.critical || item.required)) warnings.push({id:"excluded:"+id,itemId:id,text:item.label + " is excluded in your profile but required here; it has been kept."});
    if (overrides.removed[id]){ if (item.critical || item.required) warnings.push({id:"removed:"+id,itemId:id,text:item.label + " was removed manually but is required by this trip. Restore it or account for a replacement."}); return; }
    if (overrides.edited[id]){ var edit = overrides.edited[id]; if ((item.critical || item.required) && edit.quantity < item.quantity) warnings.push({id:"quantity:"+id,itemId:id,text:item.label + " is pinned below the calculated requirement (" + edit.quantity + " vs " + item.quantity + "). Check that the need is covered."}); item = Object.assign({},item,{label:edit.label,quantity:edit.quantity,section:edit.section || item.section,manual:true,reasons:item.reasons.concat(["Your pinned manual edit; automatic quantities do not replace it"])}); }
    if (item.quantity > 0) items.push(item);
  });
  // Pinned edits and manual additions stay visible even when their generating rule is no longer active.
  Object.keys(overrides.edited).forEach(function(id){ if (!merged[id] && !overrides.removed[id]) items.push(Object.assign({},overrides.edited[id],{id:id,manual:true,reasons:["Your pinned manual edit"]})); });
  Object.keys(overrides.added).forEach(function(id){ if (!overrides.removed[id]){ var original=merged[id];if(original && (original.critical || original.required) && overrides.added[id].quantity<original.quantity)warnings.push({id:"quantity:"+id,itemId:id,text:original.label+" is pinned below the calculated requirement ("+overrides.added[id].quantity+" vs "+original.quantity+"). Check coverage."}); items = items.filter(function(x){return x.id!==id;}); items.push(Object.assign({},overrides.added[id],{id:id,manual:true,reasons:[overrides.added[id].legacy ? "Preserved legacy item" : "Your pinned item"]})); } });
  if (c.inputs.bag === "carryon"){
    if (items.some(function(x){ return /monitors/.test(x.id); })) warnings.push({id:"work-baggage",text:"Full work setup includes monitors. Check carry-on capacity or switch to laptop only; nothing was silently removed."});
    var shoes = items.filter(function(x){ return /shoes|footwear/.test(x.id); }); if (shoes.length > 2) warnings.push({id:"shoes-baggage",text:"Hiking and formal events require extra footwear. Check bag space; your running shoes are worn in transit."});
  }
  if (c.unknown) warnings.push({id:"weather",text:"Weather is unconfirmed. Choose expected conditions; no forecast has been inferred from the destination."});
  if(c.r.longFlight && (!c.inputs.intl || c.inputs.mode!=="fly"))warnings.push({id:"long-flight",text:"Long international flight comfort is selected, but this trip is not marked as international flying. Update Trip basics; those comfort items have not been added."});
  if (c.days > 10 && !c.r.laundry.available) warnings.push({id:"long-trip",text:"Long trip without laundry: quantities cover every day. Add a laundry plan or explicitly edit quantities; no silent quantity cap was applied."});
  if ((c.inputs.activities.workout || (c.inputs.activities.hike && !c.r.ruggedHike)) && !items.some(function(x){ return x.id === "wear:brooks-running-shoes"; })) warnings.push({id:"activity-shoes",text:"Workouts or ordinary hiking are selected, but your Brooks are missing."});
  if(c.inputs.activities.hike && c.r.ruggedHike && !items.some(function(x){return x.id === "pack:hiking-footwear";}))warnings.push({id:"hiking-footwear",text:"Rugged or wet trails are selected, but hiking footwear is missing."});
  if (c.r.work !== "none" && !items.some(function(x){ return x.id === "pack:work-computer-charger"; })) warnings.push({id:"work-power",text:"Work is selected, but laptop power is missing."});
  if (c.inputs.activities.hike && !items.some(function(x){ return /rain-jacket|rain-protection/.test(x.id); }) && (c.r.rain || c.unknown)) warnings.push({id:"hiking-rain",text:"Hiking weather protection is missing for wet or unconfirmed conditions."});
  var groups = REFINE_ORDER.filter(function(title){ return title !== "Before leaving"; }).map(function(title){ return {title:title,items:items.filter(function(x){ return x.section === title; })}; }).filter(function(g){ return g.items.length; });
  // Preserve custom section titles from old lists and manual overrides.
  items.forEach(function(item){ if (!groups.some(function(g){ return g.title === item.section; })){ groups.push({title:item.section,items:items.filter(function(x){ return x.section === item.section; })}); } });
  var departure = leavingFor(groups.map(function(g){ return {title:g.title,items:g.items.map(refineLabel)}; }),c.inputs.bag === "checked");
  groups.push({title:"Before leaving",depart:true,items:departure.map(function(label){ return refineItem(label,"Before leaving","Derived from your final list",{required:true}); })});
  return {groups:groups,items:items,warnings:warnings,ruleResults:cache,ruleKeys:keys,profileSignature:signature,ran:ran,coverage:c.clothingDays};
}
