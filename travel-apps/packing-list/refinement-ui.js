"use strict";
// Standalone app: changing assumptions recalculates rules; row edits become explicit persistent overrides.
function refineSetup(t){
  var existing = !!t, old = t, saved = existing ? refineLoad(t) : null, inputs = saved ? saved.inputs : {}, f = el("form","panel form gen-form"), attemptedId=null;
  f.appendChild(el("h2","k",existing ? "Trip basics" : "Generate your first list")); f.appendChild(el("p","muted","Start with the essentials. Refine laundry, weather, quantities and activities on the list afterward."));
  var where = inp("rs-where","text",t ? t.where : "","Destination"), start = inp("rs-start","date",t ? t.start : ""), end = inp("rs-end","date",t ? t.end : ""); [where,start,end].forEach(function(x){ x.required = true; });
  f.appendChild(fieldEl("Destination",where)); var dates = el("div","two"); dates.appendChild(fieldEl("Departure",start)); dates.appendChild(fieldEl("Return",end)); f.appendChild(dates);
  var type = sel("rs-type",[["leisure","Leisure"],["work","Work"],["event","Formal event"],["mixed","Mixed"]],inputs.tripType || "leisure");
  var bag = sel("rs-bag",[["carryon","Carry-on + personal bag"],["checked","Checked bag + personal bag"]],inputs.bag || "carryon");
  var mode = sel("rs-mode",[["fly","Flying"],["drive","Driving"],["other","Train or other"]],inputs.mode || "fly");
  f.appendChild(fieldEl("Trip type",type)); f.appendChild(fieldEl("Baggage",bag));
  var activities = {}, toggles = el("div","refine-toggles"); [["hike","Hiking"],["workout","Workouts"],["water","Swimming"],["fish","Fishing"]].forEach(function(x){ var l = el("label","chipchk"), c = el("input"); c.type = "checkbox"; c.id = "rs-"+x[0]; c.checked = !!(inputs.activities && inputs.activities[x[0]]); l.appendChild(c); l.appendChild(el("span",null,x[1])); toggles.appendChild(l); activities[x[0]] = c; }); f.appendChild(toggles);
  var daypack=inp("rs-daypack","checkbox",null);daypack.checked=!!(saved && saved.refinements.daypack);f.appendChild(fieldEl("I need a daypack",daypack));
  var rugged=inp("rs-rugged","checkbox",null);rugged.checked=!!(saved && saved.refinements.ruggedHike);var ruggedField=fieldEl("Rugged or wet trails",rugged);f.appendChild(ruggedField);
  function hikingVisibility(){ruggedField.style.display=activities.hike.checked ? "":"none";}activities.hike.addEventListener("change",hikingVisibility);hikingVisibility();
  var weather=sel("rs-climate",[["unknown","Unconfirmed — refine later"],["mild","Mild (60–85°F)"],["cool","Cool (40–60°F)"],["cold","Cold (below 40°F)"],["hot","Hot (above 85°F)"]],saved ? saved.refinements.climate : "unknown");f.appendChild(fieldEl("Expected weather (optional)",weather));
  var rain=inp("rs-rain","checkbox",null);rain.checked=!!(saved && saved.refinements.rain);f.appendChild(fieldEl("Rain expected (optional)",rain));
  f.appendChild(el("p","gen-note","Workouts assumes most days and uses your regular T-shirts and shorts. Weather can stay unconfirmed."));
  var extras=el("details"),extraChecks={};extras.appendChild(el("summary",null,"Trip extras (optional)"));
  REFINE_EXTRAS.forEach(function(choice){var input=inp("rs-extra-"+choice.key,"checkbox",null);input.checked=!!(saved && saved.refinements.extraItems[choice.key]);extras.appendChild(fieldEl(choice.label,input));extraChecks[choice.key]=input;});f.appendChild(extras);
  var more = el("details"); more.appendChild(el("summary",null,"Travel details (optional)")); more.appendChild(fieldEl("Travel mode",mode));
  var intl = inp("rs-intl","checkbox",null); intl.checked = !!inputs.intl; more.appendChild(fieldEl("International trip",intl));
  var name = inp("rs-name","text",t ? t.name : "","Leave blank to use destination and dates"); more.appendChild(fieldEl("Trip name",name)); f.appendChild(more);
  var msg = el("p","gen-error"); msg.setAttribute("role","status"); f.appendChild(msg); var actions = el("div","gen-actions"), go = el("button","btn primary",existing ? "Update trip & list" : "Generate my list"); go.type = "submit"; actions.appendChild(go); actions.appendChild(generatorLink("Cancel",existing ? "#"+t.id : "#")); f.appendChild(actions);
  f.addEventListener("submit",function(e){ e.preventDefault(); var span;try{span=refineDays(start.value,end.value);}catch(err){msg.textContent=err.message;return;}
    var record = Object.assign({},old || {},{name:name.value.trim() || where.value.trim()+" · "+fmt(start.value),where:where.value.trim(),start:start.value,end:end.value}); record.id = existing ? t.id : attemptedId || newTripId(record.name,record.where,record.start);attemptedId=record.id;
    var state = saved || refineNewState(record,{tripType:type.value}), before = refineSnapshot(state); state.inputs = {where:record.where,start:record.start,end:record.end,tripType:type.value,bag:bag.value,mode:mode.value,intl:intl.checked,activities:{}};
    Object.keys(activities).forEach(function(k){ state.inputs.activities[k] = activities[k].checked; });
    Object.keys(extraChecks).forEach(function(key){state.refinements.extraItems[key]=extraChecks[key].checked;});
    state.refinements.daypack=daypack.checked; state.refinements.climate=weather.value; state.refinements.rain=rain.checked; state.refinements.ruggedHike=rugged.checked;
    if (!existing){ if (type.value === "work") state.refinements.work = "laptop"; if (type.value === "event") state.refinements.formalDays = 1; }
    if (!existing){ state.reviewed = {Bag:true,Activities:true}; if (weather.value !== "unknown") state.reviewed.Weather = true; if (Object.keys(extraChecks).some(function(k){ return extraChecks[k].checked; })) state.reviewed.Extras = true; if (type.value === "work") state.reviewed.Work = true; if (type.value === "event") state.reviewed.Events = true; }
    state.refinements.formalDays = Math.min(span,state.refinements.formalDays); if (existing) state.undo = before;
    var result = state.legacy ? refineLegacyResult(state) : refineEvaluate(state,generatorPrefs(),null); go.disabled = true;
    var patch = Object.assign({},RAW[record.id] || {},{name:record.name,where:record.where,start:record.start,end:record.end}); if (!existing) Object.assign(patch,{status:"Researching",bookings:{},days:[],createdAt:Date.now()});
    db.doc("trips/"+record.id).set(patch).then(function(){ return refinePersist(record,state,result); }).then(function(){ RAW[record.id] = patch; rebuild(); location.hash = record.id; }).catch(function(){ go.disabled = false; msg.textContent = "Could not save the trip. Check browser storage and try again."; });
  }); return f;
}
function refinePage(t){ var w = el("div","stack"), back = el("a","back","← Packing generator"); back.href = "#"; w.appendChild(back); w.appendChild(el("p","muted",[t.where,fmt(t.start)+" – "+fmt(t.end || t.start)].join(" · "))); var pk = packData(t.id);
  if (!pk.ready){ w.appendChild(el("p",null,"Loading your saved list…")); setTimeout(function(){ if (route().t && route().t.id === t.id) render(); },100); return w; }
  w.appendChild(refineReview(t)); return w;
}
function refineReview(t){
  var state = refineLoad(t), profile = generatorPrefs(), result = state.legacy ? refineLegacyResult(state) : refineEvaluate(state,profile,[]), root = el("div","gen-review"), busy = false;
  var header = el("section","panel"), exportBox = el("section","panel refine-export"), chips = el("div","refine-chips"), summary = el("div","refine-changes"), warnings = el("div"), list = el("div","gen-review"), error = el("p","gen-error"); error.setAttribute("role","status"); summary.setAttribute("role","status");
  header.appendChild(el("h2","k","Refine your list")); header.appendChild(el("p","muted","Your list is generated. Refine further to step through the remaining questions, or skip straight to export. Edit an item only for an exception.")); header.appendChild(chips);
  var actions = el("div","gen-actions"), exportButton = generatorButton("Export to Notes",function(){
    if (busy) return; busy = true; exportButton.disabled = true;
    var groups = result.groups.map(function(g){ return {title:g.title,depart:!!g.depart,items:g.items.map(refineLabel)}; });
    // Existing warnings remain inspectable and explicit removals are never silently reversed at export.
    refinePersist(t,state,result).then(function(){ return generatorSaveDraft(t,groups,{bag:state.inputs.bag}); }).then(function(){ closeSheet(); packExportSheet(t); }).catch(function(){ error.textContent = "Could not save for export. Check browser storage and try again."; }).finally(function(){ busy = false; exportButton.disabled = false; });
  },true); exportButton.id = "rr-export"; exportBox.appendChild(el("h2","k","Export")); exportBox.appendChild(el("p","muted","Packing and checking items off happens in Apple Notes.")); exportBox.appendChild(exportButton); actions.appendChild(generatorLink("Trip basics","#"+t.id+".edit")); actions.appendChild(generatorButton("Packing rules",rules)); actions.appendChild(generatorButton("Defaults & exclusions",refineProfileSheet)); header.appendChild(actions);
  root.appendChild(header); root.appendChild(exportBox); root.appendChild(error); root.appendChild(summary); root.appendChild(warnings); root.appendChild(list);
  var sectionNodes = {}, sectionSignatures = {}, oneOpen = false;
  function failure(message){error.textContent=message;if(sheetBg){var inline=sheetBg.querySelector('.refine-error');if(!inline){inline=el('p','gen-error refine-error');inline.setAttribute('role','alert');sheetBg.querySelector('.sheet-body').appendChild(inline);}inline.textContent=message;}}
  function commit(next,changed,label){
    if (busy) return Promise.resolve(false); busy = true; error.textContent = ""; next.undo = refineSnapshot(state); profile=generatorPrefs();
    var evaluated;
    try { evaluated = next.legacy ? refineLegacyResult(next) : refineEvaluate(next,profile,changed); } catch(e){ busy = false; error.textContent = e.message; return Promise.resolve(false); }
    return refinePersist(t,next,evaluated).then(function(){ var changes = refineChanges(result,evaluated); state = next; result = evaluated; paint(); summary.textContent = ""; summary.appendChild(el("strong",null,label)); var ul = el("ul","gen-summary"); (changes.length ? changes : ["Assumptions updated; your current items already cover this choice."]).slice(0,12).forEach(function(x){ ul.appendChild(el("li",null,x)); }); if (changes.length > 12) ul.appendChild(el("li",null,(changes.length-12)+" more changes shown in the list")); summary.appendChild(ul); summary.appendChild(generatorButton("Undo",undo)); return true; }).catch(function(){ failure("Nothing was applied: browser storage could not save the change."); return false; }).finally(function(){ busy = false; });
  }
  function undo(){ if (!state.undo || busy) return; var previous=clone(state.undo),previousProfile=state.undoProfile; delete previous.undo; busy=true; var start=previousProfile ? db.doc("meta/packing").set(previousProfile) : Promise.resolve(); start.then(function(){profile=generatorPrefs();var evaluated=previous.legacy ? refineLegacyResult(previous) : refineEvaluate(previous,profile,null);return refinePersist(t,previous,evaluated).then(function(){state=previous;result=evaluated;summary.textContent="Last change undone.";paint();});}).catch(function(){error.textContent="Could not save Undo.";}).finally(function(){busy=false;}); }
  function assumptionList(){var r=state.refinements;return [["Laundry",r.laundry.available ? "planned":"none"],["Packing",r.packingMode],["Extras",REFINE_EXTRAS.filter(function(choice){return r.extraItems[choice.key];}).length+" selected"],["Bag",state.inputs.bag==="carryon" ? "carry-on":"checked"],["Weather",r.climate],["Activities",Object.keys(state.inputs.activities).filter(function(k){return state.inputs.activities[k];}).map(function(k){return {hike:"hiking",workout:"workouts",water:"swimming",fish:"fishing"}[k];}).concat(r.daypack ? ["daypack"] : []).join(", ") || "none"],["Events",r.formalDays+" formal / "+r.dinners+" dinners"],["Work",r.work==="work" ? "full setup":r.work],["Flight",r.longFlight ? "long international":"usual"]];}
  function startFlow(){if(state.legacy){assumptions("Laundry");return;}var queue=assumptionList().map(function(x){return x[0];}).filter(function(k){return !(state.reviewed||{})[k];});if(queue.length)assumptions(queue[0],{queue:queue,i:0});}
  function assumptions(focus,flow){
    if(state.legacy && (!t.start || !t.end)){var missing=openSheet("Trip dates needed");missing.appendChild(el("p",null,"Your saved list can still be exported. Set travel dates before enabling automatic quantity calculations."));missing.appendChild(generatorLink("Set trip dates","#"+t.id+".edit",true));return;}
    if (state.legacy){ var body = openSheet("Start automatic refinement"); body.appendChild(el("p",null,"Your existing items stay pinned. Rules will fill missing items; you can return individual rows to automatic quantities afterward.")); body.appendChild(generatorButton("Enable automatic refinement",function(){ var next = clone(state); next.legacy = false; commit(next,null,"Automatic refinement enabled").then(function(ok){ if (ok) closeSheet(); }); },true)); return; }
    var body = openSheet("Refine " + focus.toLowerCase()), f = el("form","form gen-form"), r = state.refinements, n = clone(state), updates = [];
    function select(key,label,options,value,target){var input=sel("rf-"+key,options,value);f.appendChild(fieldEl(label,input));updates.push(function(){target(input.value);});return input;}
    function number(key,label,value,max,target){var input=inp("rf-"+key,"number",value);input.min="0";input.max=String(max);input.required=true;f.appendChild(fieldEl(label,input));updates.push(function(){target(+input.value);});return input;}
    function check(key,label,value,target){var input=inp("rf-"+key,"checkbox",null);input.checked=!!value;f.appendChild(fieldEl(label,input));updates.push(function(){target(input.checked);});return input;}
    var note="";
    if(focus==="Packing"){
      select("packing","Packing mode",[["standard","Standard — daily T-shirts, bottoms every two days"],["extra","Pack extra — one T-shirt, two underwear, two socks and one pair of bottoms"]],r.packingMode,function(v){n.refinements.packingMode=v;});
      note="Recalculates clothing only. Your usual accessories stay included. Laundry adjusts coverage; contacts and medications cover the full trip.";
    }else if(focus==="Extras"){
      REFINE_EXTRAS.forEach(function(choice){check("extra-"+choice.key,choice.label,r.extraItems[choice.key],function(v){n.refinements.extraItems[choice.key]=v;});});
      note="Select extras for this trip. Garmin includes its charger. Turning a choice off removes unedited items; pinned manual items stay. Your snacks, water bottle, battery pack and other usual items remain automatic.";
    }else if(focus==="Bag"){
      select("bag","Baggage constraint",[["carryon","Carry-on + personal bag"],["checked","Checked bag + personal bag"]],state.inputs.bag,function(v){n.inputs.bag=v;});
      note="Flags carry-on space conflicts and updates bag checks. It does not change quantities or move items into Wear to travel.";
    }else if(focus==="Weather"){
      select("climate","Expected weather",[["unknown","Unconfirmed"],["mild","Mild (60–85°F)"],["cool","Cool (40–60°F)"],["cold","Cold (below 40°F)"],["hot","Hot (above 85°F)"]],r.climate,function(v){n.refinements.climate=v;});
      select("thermal","Personal temperature preference",[["neutral","Usual layers"],["hot","I run hot"],["cold","I run cold"]],r.thermal,function(v){n.refinements.thermal=v;});
      check("rain","Rain expected",r.rain,function(v){n.refinements.rain=v;});
      note="Updates clothing, layers and hiking protection. These are your assumptions; no live forecast is used.";
    }else if(focus==="Laundry"){
      var laundry=select("laundry","Laundry",[["no","No planned laundry"],["yes","I have planned laundry"]],r.laundry.available ? "yes":"no",function(v){n.refinements.laundry.available=v==="yes";});
      var first=number("first","First wash after how many days?",r.laundry.firstWash,60,function(v){n.refinements.laundry.firstWash=v;}),interval=number("interval","Then wash every how many days?",r.laundry.interval,60,function(v){n.refinements.laundry.interval=v;});first.min=interval.min="1";
      function laundryVisibility(){[first,interval].forEach(function(input){input.disabled=laundry.value!=="yes";input.parentNode.style.display=input.disabled ? "none":"";});}laundry.addEventListener("change",laundryVisibility);laundryVisibility();
      note="Recalculates clothing for the longest gap between washes plus a spare day. Contacts still cover the full trip.";
    }else if(focus==="Activities"){
      [["hike","Hiking"],["workout","Workouts"],["water","Swimming"],["fish","Fishing"]].forEach(function(x){check(x[0],x[1],state.inputs.activities[x[0]],function(v){n.inputs.activities[x[0]]=v;});});
      check("daypack","I need a daypack",r.daypack,function(v){n.refinements.daypack=v;});
      var hike=f.querySelector("#rf-hike"),rugged=check("rugged","Rugged or wet trails",r.ruggedHike,function(v){n.refinements.ruggedHike=v;});
      function hikingVisibility(){rugged.parentNode.style.display=hike.checked ? "":"none";}hike.addEventListener("change",hikingVisibility);hikingVisibility();
      note="Workouts assumes most days: regular T-shirts daily and shorts for two days each, adjusted for laundry. Brooks cover ordinary hikes; rugged or wet trails add hiking footwear. A daypack is included only when you select I need a daypack.";
    }else if(focus==="Events"){
      number("formal","Formal days",r.formalDays,refineDays(state.inputs.start,state.inputs.end),function(v){n.refinements.formalDays=v;});
      number("dinners","Nice dinners",r.dinners,refineDays(state.inputs.start,state.inputs.end),function(v){n.refinements.dinners=v;});
      note="Updates formal outfits, dinner shirts and their footwear/accessory dependencies.";
    }else if(focus==="Work"){
      select("work","Work setup",[["none","No work laptop"],["laptop","Laptop only / just in case"],["work","Full hotel work setup"]],r.work,function(v){n.refinements.work=v;});
      note="Updates the work kit and power dependencies, and checks baggage conflicts.";
    }else if(focus==="Flight"){
      check("longFlight","Long international flight",r.longFlight,function(v){n.refinements.longFlight=v;});
      note="Adds international flight comfort items when Trip basics specifies international flying.";
    }
    function after(){if(flow && flow.i+1<flow.queue.length)assumptions(flow.queue[flow.i+1],{queue:flow.queue,i:flow.i+1});else closeSheet();}
    if(flow)body.appendChild(el("p","gen-step","Question "+(flow.i+1)+" of "+flow.queue.length));
    f.appendChild(el("p","gen-note",note));var last=!flow || flow.i+1>=flow.queue.length,go=el("button","btn primary",flow ? (last ? "Apply & finish":"Apply & next") : "Apply & recalculate");go.type="submit";f.appendChild(go);
    if(flow){var skip=generatorButton(last ? "Skip & finish":"Skip",after);f.appendChild(skip);}body.appendChild(f);
    f.addEventListener("submit",function(e){e.preventDefault();updates.forEach(function(update){update();});n.reviewed=n.reviewed||{};n.reviewed[focus]=true;
      if(JSON.stringify(n.inputs)===JSON.stringify(state.inputs) && JSON.stringify(n.refinements)===JSON.stringify(state.refinements)){if(state.reviewed && state.reviewed[focus]){after();return;}go.disabled=true;state.reviewed=n.reviewed;refinePersist(t,state,result).then(function(){paint();after();}).catch(function(){go.disabled=false;delete state.reviewed[focus];failure("Could not save this review.");});return;}
      go.disabled=true;commit(n,[],focus+" updated").then(function(ok){if(ok)after();else go.disabled=false;});
    });
  }

  function edit(item){
    var body = openSheet("Edit this item"), f = el("form","form gen-form"), label=inp("ri-label","text",item.label), quantity=inp("ri-quantity","number",item.quantity); label.required=true; quantity.required=true; quantity.min="1"; quantity.max="999";
    f.appendChild(fieldEl("Item",label)); f.appendChild(fieldEl("Quantity",quantity)); f.appendChild(el("p","muted","This creates a pinned manual override. Refinements will preserve it until you choose Return to automatic.")); var go=el("button","btn primary","Save override");go.type="submit";f.appendChild(go);body.appendChild(f);
    f.addEventListener("submit",function(e){e.preventDefault();var next=clone(state); var value=Object.assign({},item,{label:label.value.trim(),quantity:+quantity.value}); if(next.overrides.added[item.id])next.overrides.added[item.id]=value;else next.overrides.edited[item.id]=value;commit(next,[],"Manual item override saved").then(function(ok){if(ok)closeSheet();});});
  }
  function remove(item){ var body=openSheet("Remove "+item.label); body.appendChild(el("p",null,item.critical || item.required ? "This item supports a critical or required need. Removing it will leave a visible warning; account for a replacement." : "Remove only for this trip, or change your future packing defaults."));
    body.appendChild(generatorButton("Remove for this trip",function(){var next=clone(state);next.overrides.removed[item.id]=true;commit(next,[],"Removed for this trip").then(function(ok){if(ok)closeSheet();});},true));
    if(!item.critical && !item.required && !item.manual)body.appendChild(generatorButton("Usually don’t pack this",function(){ if(busy)return;var oldProfile=clone(profile),p=refineExclude(profile,item);db.doc("meta/packing").set(p).then(function(){var next=clone(state);next.undoProfile=oldProfile;next.overrides.removed[item.id]=true;return commit(next,["profile"],"Default exclusion saved; inspect or reset it in Defaults & exclusions");}).then(function(ok){if(ok)closeSheet();else return db.doc("meta/packing").set(oldProfile).then(function(){profile=oldProfile;error.textContent="The trip could not be saved; the default exclusion was rolled back.";}).catch(function(){error.textContent="The default exclusion was saved but the trip change failed. Reset the exclusion in Defaults & exclusions.";});}).catch(function(){error.textContent="Could not save the default exclusion.";}); }));
  }
  function add(){var body=openSheet("Add an edge-case item"),f=el("form","form gen-form"),label=inp("ra-label","text",""),quantity=inp("ra-quantity","number",1),section=sel("ra-section",REFINE_ORDER.filter(function(x){return x!=="Before leaving";}).map(function(x){return [x,x];}),"Personal bag & day gear");label.required=true;quantity.required=true;quantity.min="1";quantity.max="999";f.appendChild(fieldEl("Item",label));f.appendChild(fieldEl("Quantity",quantity));f.appendChild(fieldEl("Section",section));var go=el("button","btn primary","Add item");go.type="submit";f.appendChild(go);body.appendChild(f);f.addEventListener("submit",function(e){e.preventDefault();var next=clone(state),id="manual:"+Date.now().toString(36);next.overrides.added[id]={id:id,label:label.value.trim(),quantity:+quantity.value,section:section.value};commit(next,[],"Manual item added").then(function(ok){if(ok)closeSheet();});});}
  // Standalone app: explanations live in one section, keeping individual list rows compact.
  function rules(){
    var body=openSheet("Packing rules");body.appendChild(el("p","muted","Rules currently applied to this trip. Refinements update these automatically; manual overrides remain pinned. Manage your usual items and exclusions in Defaults & exclusions."));
    result.groups.forEach(function(group){var reasons=[];group.items.forEach(function(item){(item.reasons || []).forEach(function(reason){if(reasons.indexOf(reason)<0)reasons.push(reason);});});
      if(!reasons.length)return;var section=el("section","stack");section.appendChild(el("h3",null,group.title));var list=el("ul","gen-summary");reasons.forEach(function(reason){list.appendChild(el("li",null,reason));});section.appendChild(list);body.appendChild(section);
    });
  }
  function paint(){
    chips.textContent="";var reviewed=state.reviewed||{},groups={todo:[],done:[]};assumptionList().forEach(function(x){groups[reviewed[x[0]] ? "done":"todo"].push(x);});
    if(groups.todo.length){var go=generatorButton("Refine further · "+groups.todo.length+" to go",startFlow,true);go.className="btn primary refine-start";chips.appendChild(go);chips.appendChild(el("p","muted","Steps through: "+groups.todo.map(function(x){return x[0];}).join(", ")+"."));}
    else chips.appendChild(el("p","muted","✓ Every question reviewed."));
    var one=el("details","refine-one");one.open=oneOpen;one.addEventListener("toggle",function(){oneOpen=one.open;});one.appendChild(el("summary",null,"Adjust a single assumption"));[["todo","To review","new"],["done","Reviewed","done"]].forEach(function(g){if(!groups[g[0]].length)return;var box=el("div","refine-group");box.appendChild(el("h3","k",g[1]+" · "+groups[g[0]].length));var row=el("div","refine-toggles");groups[g[0]].forEach(function(x){var b=generatorButton((g[2]==="done" ? "✓ ":"")+x[0]+": "+x[1],function(){assumptions(x[0]);});b.className="btn refine-"+g[2];row.appendChild(b);});box.appendChild(row);one.appendChild(box);});chips.appendChild(one);
    warnings.textContent="";if(result.warnings.length){var warning=el("details","panel refine-warning");warning.open=true;warning.appendChild(el("summary",null,"Check assumptions · "+result.warnings.length));result.warnings.forEach(function(x){var row=el("p",null,x.text);if(x.itemId && state.overrides.removed[x.itemId])row.appendChild(generatorButton("Restore",function(){var next=clone(state);delete next.overrides.removed[x.itemId];commit(next,[],"Required item restored");}));warning.appendChild(row);});warnings.appendChild(warning);}
    if(Object.keys(state.overrides.removed).length){var removed=el("details","panel");removed.appendChild(el("summary",null,"Removed for this trip · "+Object.keys(state.overrides.removed).length));Object.keys(state.overrides.removed).forEach(function(id){var item=result.ruleResults && Object.keys(result.ruleResults).flatMap(function(k){return result.ruleResults[k];}).find(function(x){return x.id===id;}) || state.overrides.added[id];var row=el("div","gen-actions");row.appendChild(el("span",null,item ? item.label : id));row.appendChild(generatorButton("Return to automatic",function(){var next=clone(state);delete next.overrides.removed[id];delete next.overrides.edited[id];commit(next,[],"Trip removal reset (profile exclusions still apply)");}));removed.appendChild(row);});warnings.appendChild(removed);}
    var alive={};result.groups.forEach(function(g){var signature=JSON.stringify(g),node=sectionNodes[g.title];alive[g.title]=true;if(!node){node=el("section","panel");sectionNodes[g.title]=node;}if(sectionSignatures[g.title]!==signature){node.textContent="";node.appendChild(el("h3",null,g.title));g.items.forEach(function(item){var row=el("div","refine-item");row.dataset.itemId=item.id;var copy=el("div","refine-item-copy");copy.appendChild(el("strong",null,refineLabel(item)));if(item.manual)copy.appendChild(el("span","refine-badge","Manual override"));row.appendChild(copy);if(!g.depart){var controls=el("div","gen-actions");controls.appendChild(generatorButton("Edit",function(){edit(item);}));controls.appendChild(generatorButton("Remove",function(){remove(item);}));if(state.overrides.edited[item.id] || (!state.legacy && state.overrides.added[item.id] && state.overrides.added[item.id].legacy && Object.keys(result.ruleResults).some(function(k){return result.ruleResults[k].some(function(x){return x.id===item.id;});})))controls.appendChild(generatorButton("Return to automatic",function(){var next=clone(state);delete next.overrides.edited[item.id];if(next.overrides.added[item.id] && next.overrides.added[item.id].legacy)delete next.overrides.added[item.id];commit(next,[],"Manual override reset");}));row.appendChild(controls);}node.appendChild(row);});sectionSignatures[g.title]=signature;}list.appendChild(node);});Object.keys(sectionNodes).forEach(function(title){if(!alive[title]){sectionNodes[title].remove();delete sectionNodes[title];delete sectionSignatures[title];}});
    if(!root.querySelector("#rr-add")){var addButton=generatorButton("+ Add an edge-case item",add);addButton.id="rr-add";root.appendChild(addButton);} if(state.undo && !summary.childNodes.length)summary.appendChild(generatorButton("Undo last change",undo));
  }
  paint();return root;
}
function refineProfileSheet(){
  var body=openSheet("Refinement defaults & exclusions"),p=generatorPrefs(),excluded=p.refinementProfile && p.refinementProfile.excluded || {};
  body.appendChild(el("p","muted","These are explicit choices you made using Usually don’t pack this. No hidden learning or automatic default changes. Critical and activity-required items cannot be silently excluded. Resetting a profile default does not reset separate trip removals."));
  var status=el("p","gen-error");status.setAttribute("role","status");
  Object.keys(excluded).forEach(function(id){var row=el("div","gen-actions");row.appendChild(el("span",null,excluded[id]));row.appendChild(generatorButton("Reset this default",function(){var next=clone(p);delete next.refinementProfile.excluded[id];db.doc("meta/packing").set(next).then(function(){refineProfileSheet();render();}).catch(function(){status.textContent="Could not reset the default.";});}));body.appendChild(row);});
  if(!Object.keys(excluded).length)body.appendChild(el("p","muted","No learned exclusions. Your original defaults are intact."));
  body.appendChild(generatorButton("My usual items",generatorPreferences));body.appendChild(status);
}
