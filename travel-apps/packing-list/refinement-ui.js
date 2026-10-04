"use strict";
// Standalone app: changing assumptions recalculates rules; row edits become explicit persistent overrides.
function rangePicker(startIn,endIn){
  var box = el("div","rp"), sum = el("div","rp-sum"), head = el("div","rp-head"), grid = el("div","rp-grid"), hint = el("p","rp-hint"), cal = el("div","rp-cal"), foot = el("div","rp-foot"), ok = el("button","btn","OK");
  var sD = el("button"), eD = el("button"); sD.type = eD.type = "button"; sD.appendChild(el("span",null,"Departure")); eD.appendChild(el("span",null,"Return")); var sB = el("b"), eB = el("b"); sD.appendChild(sB); eD.appendChild(eB); sum.appendChild(sD); sum.appendChild(eD);
  var prev = el("button",null,"‹"), next = el("button",null,"›"), title = el("b"); prev.type = next.type = "button"; prev.setAttribute("aria-label","Previous month"); next.setAttribute("aria-label","Next month");
  head.appendChild(prev); head.appendChild(title); head.appendChild(next);
  ok.type = "button"; foot.appendChild(hint); foot.appendChild(ok); cal.appendChild(head); cal.appendChild(grid); cal.appendChild(foot);
  box.appendChild(sum); box.appendChild(cal); var open = false;
  function setOpen(v){ open = v; cal.hidden = !v; box.classList.toggle("open",v); sD.setAttribute("aria-expanded",String(v)); eD.setAttribute("aria-expanded",String(v)); sync(); }
  var mode = ""; sD.addEventListener("click",function(){ mode = "s"; setOpen(true); }); eD.addEventListener("click",function(){ mode = S ? "e" : "s"; setOpen(true); }); ok.addEventListener("click",function(){ setOpen(false); });
  box.openCal = function(){ setOpen(true); };
  var MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  function iso(d){ return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
  var S = startIn.value || "", E = endIn.value || "", base = pd(S) || new Date(), view = new Date(base.getFullYear(), base.getMonth(), 1), todayIso = iso(new Date());
  function label(v){ var d = pd(v); return d ? d.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"}) : "—"; }
  function sync(){ startIn.value = S; endIn.value = E; sB.textContent = label(S); eB.textContent = label(E); var act = mode || (!S ? "s" : (!E ? "e" : "")); sD.className = open && act === "s" ? "on" : ""; eD.className = open && act === "e" ? "on" : "";
    if (act === "s") hint.textContent = "Tap your departure date.";
    else if (act === "e") hint.textContent = "Tap your return date (or the same day for a day trip).";
    else { var n = Math.round((pd(E) - pd(S)) / 86400000) + 1; hint.textContent = n + (n === 1 ? " day" : " days") + " · " + (n - 1) + (n === 2 ? " night" : " nights") + ". Tap a date box to change it, or tap departure on the calendar to start over."; } }
  function pick(v){
    var m = mode; mode = "";
    if (m === "s"){ S = v; if (E && E < v) E = ""; }
    else if (m === "e" && S){ if (v < S){ S = v; E = ""; } else E = v; }
    else if (S && E){ if (v === S){ S = ""; E = ""; } else if (v === E){ E = ""; } else if (v < S){ S = v; } else { E = v; } }
    else if (!S) S = v;
    else if (v < S) S = v;
    else E = v;
    if (S && E && (pd(E) - pd(S)) / 86400000 + 1 > 60){ E = ""; hint.textContent = "Trips can be up to 60 days."; draw(); startIn.value = S; endIn.value = E; return; }
    draw();
  }
  function draw(){
    title.textContent = MON[view.getMonth()] + " " + view.getFullYear(); grid.textContent = "";
    ["S","M","T","W","T","F","S"].forEach(function(d){ grid.appendChild(el("div","dow",d)); });
    var first = view.getDay(), days = new Date(view.getFullYear(), view.getMonth()+1, 0).getDate();
    for (var i = 0; i < first; i++) grid.appendChild(el("div"));
    for (var d = 1; d <= days; d++){ (function(v){ var b = el("button",null,String(+v.slice(8))); b.type = "button"; b.setAttribute("aria-label",label(v));
      var cls = []; if (v === S) cls.push("s"); if (v === E || (v === S && !E)) cls.push("e"); if (S && E && v > S && v < E) cls.push("in"); if (v === todayIso) cls.push("today"); b.className = cls.join(" ");
      if (v === S || v === E) b.setAttribute("aria-pressed","true");
      b.addEventListener("click",function(){ pick(v); }); grid.appendChild(b); })(iso(new Date(view.getFullYear(), view.getMonth(), d))); }
    sync();
  }
  prev.addEventListener("click",function(){ view = new Date(view.getFullYear(), view.getMonth()-1, 1); draw(); });
  next.addEventListener("click",function(){ view = new Date(view.getFullYear(), view.getMonth()+1, 1); draw(); });
  draw(); setOpen(false); return box;
}
function refineSetup(t){
  var existing = !!t, old = t, saved = existing ? refineLoad(t) : null, inputs = saved ? saved.inputs : {}, f = el("form","panel form gen-form rs-form"), attemptedId=null;
  if(PACK_TEST_MODE)f.appendChild(packingTestBanner());
  f.appendChild(el("h2","k",existing ? "Trip basics" : "New trip"));
  var where = el("textarea","grow"); where.id = "rs-where"; where.rows = 1; where.placeholder = "City, state or country"; where.value = t ? (t.where || "") : ""; where.setAttribute("autocomplete","off"); where.addEventListener("keydown",function(e){ if (e.key === "Enter"){ e.preventDefault(); } }); function growWhere(){ where.value = where.value.replace(/\n/g," "); where.style.height = "auto"; where.style.height = where.scrollHeight + 2 + "px"; } where.addEventListener("input",growWhere); requestAnimationFrame(growWhere); var start = inp("rs-start","hidden",t ? t.start : ""), end = inp("rs-end","hidden",t ? t.end : ""); where.required = true;
  function reqMark(l){ var a = el("span","req","*"); a.setAttribute("aria-hidden","true"); l.appendChild(a); l.appendChild(el("span","sr-only"," (required)")); return l; } var whereField = fieldEl("Destination",where); reqMark(whereField.querySelector("label")); f.appendChild(whereField); var datesField = el("div","field"); datesField.appendChild(reqMark(el("label",null,"Dates"))); var picker = rangePicker(start,end); datesField.appendChild(picker); f.appendChild(datesField);
  var type = sel("rs-type",[["leisure","Leisure"],["work","Work"],["event","Formal event"],["mixed","Mixed"]],inputs.tripType || "leisure");
  var bag = sel("rs-bag",[["carryon","Carry-on"],["checked","Checked bag"]],inputs.bag || "carryon");
  var mode = sel("rs-mode",[["fly","Flying"],["drive","Driving"],["other","Train or other"]],inputs.mode || "fly");
  var tb = el("div","two row-gap"); tb.appendChild(fieldEl("Trip type",type)); tb.appendChild(fieldEl("Baggage",bag)); f.appendChild(tb);
  var actField = el("div","field"); actField.appendChild(el("label",null,"Activities"));
  var activities = {}, toggles = el("div","refine-toggles"); [["hike","Hiking"],["workout","Workouts"],["water","Swimming"],["fish","Fishing"]].forEach(function(x){ var l = el("label","chipchk"), c = el("input"); c.type = "checkbox"; c.id = "rs-"+x[0]; c.checked = !!(inputs.activities && inputs.activities[x[0]]); l.appendChild(c); l.appendChild(el("span",null,x[1])); toggles.appendChild(l); activities[x[0]] = c; }); actField.appendChild(toggles);
  var rugged=el("input");rugged.type="checkbox";rugged.id="rs-rugged";rugged.checked=!!(saved && saved.refinements.ruggedHike);var ruggedField=el("label","chipchk");ruggedField.appendChild(rugged);ruggedField.appendChild(el("span",null,"Rugged or wet trails"));ruggedField.style.alignSelf="flex-start";actField.appendChild(ruggedField);
  f.appendChild(actField);
  function hikingVisibility(){ruggedField.style.display=activities.hike.checked ? "":"none";}activities.hike.addEventListener("change",hikingVisibility);hikingVisibility();
  var opt = el("section","gen-opt"); var optHead = el("div","rs-group"); optHead.style.gap = "2px"; optHead.appendChild(el("h3",null,"Optional")); optHead.appendChild(el("p","gen-note","Set these now or later on the list.")); opt.appendChild(optHead);
  var weather=sel("rs-climate",[["unknown","Not sure yet"],["mild","Mild (60–85°F)"],["cool","Cool (40–60°F)"],["cold","Cold (below 40°F)"],["hot","Hot (above 85°F)"]],saved ? saved.refinements.climate : "unknown");
  var wm = el("div","two"); wm.appendChild(fieldEl("Coldest conditions outdoors",weather)); wm.appendChild(fieldEl("Travel mode",mode)); opt.appendChild(wm);
  function chip(id,label,on){ var l = el("label","chipchk"), c = el("input"); c.type = "checkbox"; c.id = id; c.checked = on; l.appendChild(c); l.appendChild(el("span",null,label)); return {label:l,input:c}; }
  var flags = el("div","refine-toggles"), rainC = chip("rs-rain","Rain expected",!!(saved && saved.refinements.rain)), dayC = chip("rs-daypack","Daypack",!!(saved && saved.refinements.daypack)), intlC = chip("rs-intl","International",!!inputs.intl);
  [rainC,dayC,intlC].forEach(function(c){ flags.appendChild(c.label); }); opt.appendChild(flags);
  var rain = rainC.input, daypack = dayC.input, intl = intlC.input;
  var exGroup = el("div","rs-group"); exGroup.appendChild(el("p","sub","Trip extras")); var ex = el("div","refine-toggles"), extraChecks={};
  REFINE_EXTRAS.forEach(function(choice){ var c = chip("rs-extra-"+choice.key,choice.label,!!(saved && saved.refinements.extraItems[choice.key])); ex.appendChild(c.label); extraChecks[choice.key]=c.input; }); exGroup.appendChild(ex); opt.appendChild(exGroup);
  f.appendChild(opt);
  var msg = el("p","gen-error"); msg.setAttribute("role","status"); f.appendChild(msg); var actions = el("div","gen-actions"), go = el("button","btn primary",existing ? "Update trip & list" : "Generate my list"); go.type = "submit"; actions.appendChild(go); actions.appendChild(generatorLink("Cancel",existing ? "#"+t.id : "#")); f.appendChild(actions);
  f.addEventListener("submit",function(e){ e.preventDefault(); if (!start.value || !end.value){ msg.textContent = "Pick a departure and return date."; picker.openCal(); return; } var span;try{span=refineDays(start.value,end.value);}catch(err){msg.textContent=err.message;return;}
    var record = Object.assign({},old || {},{name:(function(){ var auto = where.value.trim()+" · "+fmt(start.value); if (!existing) return auto; var oldAuto = (t.where||"")+" · "+(t.start ? fmt(t.start) : ""); return (!t.name || t.name === oldAuto) ? auto : t.name; })(),where:where.value.trim(),start:start.value,end:end.value}); record.id = existing ? t.id : attemptedId || newTripId(record.name,record.where,record.start);attemptedId=record.id;
    var state = saved || refineNewState(record,{tripType:type.value}), before = refineSnapshot(state); state.inputs = {where:record.where,start:record.start,end:record.end,tripType:type.value,bag:bag.value,mode:mode.value,intl:intl.checked,activities:{}};
    Object.keys(activities).forEach(function(k){ state.inputs.activities[k] = activities[k].checked; });
    Object.keys(extraChecks).forEach(function(key){state.refinements.extraItems[key]=extraChecks[key].checked;});
    state.refinements.daypack=daypack.checked; state.refinements.climate=weather.value; state.refinements.rain=rain.checked; state.refinements.ruggedHike=rugged.checked;
    if (!existing){ if (type.value === "work"){state.refinements.work = "laptop";state.refinements.workDays=null;} if (type.value === "event") state.refinements.formalDays = 1; }
    if (!existing){ state.reviewed = {Bag:true,Activities:true}; if (weather.value !== "unknown") state.reviewed.Weather = true; if (Object.keys(extraChecks).some(function(k){ return extraChecks[k].checked; })) state.reviewed.Extras = true; if (type.value === "work") state.reviewed.Work = true; if (type.value === "event") state.reviewed.Events = true; }
    state.refinements.formalDays = Math.min(span,state.refinements.formalDays); state.refinements.dinners=Math.min(span,state.refinements.dinners);if(state.refinements.workDays!=null)state.refinements.workDays=Math.min(span,state.refinements.workDays); if (existing) state.undo = before;
    var result = state.legacy ? refineLegacyResult(state) : refineEvaluate(state,generatorPrefs(),null); go.disabled = true;
    var patch = Object.assign({},RAW[record.id] || {},{name:record.name,where:record.where,start:record.start,end:record.end}); if (!existing) Object.assign(patch,{status:"Researching",bookings:{},days:[],createdAt:Date.now()});
    db.doc("trips/"+record.id).set(patch).then(function(){ return refinePersist(record,state,result); }).then(function(){ RAW[record.id] = patch; rebuild(); location.hash = record.id; }).catch(function(){ go.disabled = false; msg.textContent = "Could not save the trip. Check browser storage and try again."; });
  }); return f;
}
function refinePage(t){ var w = el("div","stack"), back = el("a","back","← Packing generator"); back.href = "#"; w.appendChild(back); if(PACK_TEST_MODE)w.appendChild(packingTestBanner()); w.appendChild(el("p","muted",[t.where,fmt(t.start)+" – "+fmt(t.end || t.start)].join(" · "))); var pk = packData(t.id);
  if (!pk.ready){ w.appendChild(el("p",null,"Loading your saved list…")); setTimeout(function(){ if (route().t && route().t.id === t.id) render(); },100); return w; }
  w.appendChild(refineReview(t)); return w;
}
function refineReview(t){
  var state = refineLoad(t), profile = generatorPrefs(), result = state.legacy ? refineLegacyResult(state) : refineEvaluate(state,profile,[]), root = el("div","gen-review"), busy = false;
  var header = el("section","panel"), exportBox = el("section","panel refine-export"), chips = el("div","refine-chips"), summary = el("div","refine-changes"), warnings = el("div"), list = el("div","gen-review"), error = el("p","gen-error"); error.setAttribute("role","status"); summary.setAttribute("role","status");
  header.appendChild(el("h2","k","Refine your list")); header.appendChild(el("p","muted","Your first list is ready. Review the trip assumptions, then confirm the outfit choices that apply. Edit individual items only for exceptions.")); header.appendChild(chips);
  var actions = el("div","gen-actions"), exportButton = generatorButton("Export to Notes",function(){
    if (busy) return; if(refinePendingDecisions(state).length){advance({decisionsOnly:true,exportAfter:true,seen:{}});return;} busy = true; exportButton.disabled = true;
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
  function assumptionList(){var r=state.refinements,list=[["Laundry",r.laundry.available ? "planned":"none"],["Packing",r.packingMode],["Extras",REFINE_EXTRAS.filter(function(choice){return r.extraItems[choice.key];}).length+" selected"],["Bag",state.inputs.bag==="carryon" ? "carry-on":"checked"],["Weather",r.climate],["Activities",Object.keys(state.inputs.activities).filter(function(k){return state.inputs.activities[k];}).map(function(k){return {hike:"hiking",workout:"workouts",water:"swimming",fish:"fishing"}[k];}).concat(r.daypack ? ["daypack"] : []).join(", ") || "none"],["Events",r.formalDays+" suit days / "+r.dinners+" dinners"],["Work",r.work+" · "+(r.workDays==null ? "workdays to confirm":r.workDays+" video-call days")],["Flight",r.longFlight ? "long international":"usual"]];
    if(r.dinners>0)list.push(["Dinner outfit",r.dinnerTop && r.dinnerBottoms ? r.dinnerTop+" / "+r.dinnerBottoms:"choose top and bottoms"]);
    if(r.formalDays>0)list.push(["Suit outfit",r.alternateKhakis ? "suit + khakis":"reusable suit"]);
    if(refineWardrobe(state).canShare)list.push(["Shirt sharing","check shared days"]);return list;
  }
  function advance(flow){var pending=refinePendingDecisions(state),next=pending[0];
    if(!next && !flow.decisionsOnly)next=assumptionList().map(function(x){return x[0];}).find(function(k){return !(state.reviewed||{})[k] && !flow.seen[k];});
    if(next){assumptions(next,flow);return;}closeSheet();if(flow.exportAfter)exportButton.click();
  }
  function startFlow(){if(state.legacy){assumptions("Laundry");return;}advance({seen:{}});}
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
      select("climate","Coldest conditions you expect outdoors",[["unknown","Unconfirmed"],["mild","Mild (60–85°F)"],["cool","Cool (40–60°F)"],["cold","Cold (below 40°F)"],["hot","Hot (above 85°F)"]],r.climate,function(v){n.refinements.climate=v;});
      select("thermal","Personal temperature preference",[["neutral","Usual layers"],["hot","I run hot"],["cold","I run cold"]],r.thermal,function(v){n.refinements.thermal=v;});
      check("rain","Rain expected",r.rain,function(v){n.refinements.rain=v;});
      check("warmWeather","Also spending time in warmer weather",r.warmWeather,function(v){n.refinements.warmWeather=v;});
      note="The coldest outdoor conditions drive layers. Warmer weather adds shorts if needed. These are your assumptions; no live forecast is used.";
    }else if(focus==="Laundry"){
      var laundry=select("laundry","Laundry",[["no","No planned laundry"],["yes","I have planned laundry"]],r.laundry.available ? "yes":"no",function(v){n.refinements.laundry.available=v==="yes";});
      var first=number("first","First wash after how many days?",r.laundry.firstWash,60,function(v){n.refinements.laundry.firstWash=v;}),interval=number("interval","Then wash every how many days?",r.laundry.interval,60,function(v){n.refinements.laundry.interval=v;});first.min=interval.min="1";
      function laundryVisibility(){[first,interval].forEach(function(input){input.disabled=laundry.value!=="yes";input.parentNode.style.display=input.disabled ? "none":"";});}laundry.addEventListener("change",laundryVisibility);laundryVisibility();
      note="Recalculates clothing for the longest gap between washes plus a spare day. Pack extra uses this same buffer, rather than adding a second one. Contacts cover the full trip; work, dinner and suit shirts stay at full-trip quantities.";
    }else if(focus==="Activities"){
      [["hike","Hiking"],["workout","Workouts"],["water","Swimming"],["fish","Fishing"]].forEach(function(x){check(x[0],x[1],state.inputs.activities[x[0]],function(v){n.inputs.activities[x[0]]=v;});});
      check("daypack","I need a daypack",r.daypack,function(v){n.refinements.daypack=v;});
      var hike=f.querySelector("#rf-hike"),rugged=check("rugged","Rugged or wet trails",r.ruggedHike,function(v){n.refinements.ruggedHike=v;});
      function hikingVisibility(){rugged.parentNode.style.display=hike.checked ? "":"none";}hike.addEventListener("change",hikingVisibility);hikingVisibility();
      note="Workouts assumes most days: regular T-shirts daily and shorts for two days each, adjusted for laundry. Brooks cover ordinary hikes; rugged or wet trails add hiking footwear. A daypack is included only when you select I need a daypack.";
    }else if(focus==="Events"){
      number("formal","Full suit days",r.formalDays,refineDays(state.inputs.start,state.inputs.end),function(v){n.refinements.formalDays=v;});
      number("dinners","Nice dinners (complete outfit)",r.dinners,refineDays(state.inputs.start,state.inputs.end),function(v){n.refinements.dinners=v;});
      note="Suit days mean jacket, suit trousers, dress shoes, belt and fresh dress shirts/socks—no undershirt. Dinner outfits are separate. After applying, we’ll walk through the outfit choices that apply.";
    }else if(focus==="Work"){
      var work=select("work","Work equipment",[["none","No work laptop"],["laptop","Laptop only / just in case"],["work","Full hotel work setup"]],r.work,function(v){n.refinements.work=v;});
      var workDays=number("workDays","Days visible on video (fresh button-up each day)",r.workDays,refineDays(state.inputs.start,state.inputs.end),function(v){n.refinements.workDays=v;});
      work.addEventListener("change",function(){if(r.work==="none" && work.value!=="none" && workDays.value==="0")workDays.value="";});
      note="Video-call days need tops only, with no dedicated bottoms. Enter zero if you don’t need work tops. Laundry does not reduce these shirts. Equipment and work tops are separate choices.";
    }else if(focus==="Dinner outfit"){
      var top=select("dinnerTop","Top for each nice dinner",[["","Choose a dinner top"],["polo","Fresh polo"],["buttonup","Fresh long-sleeve button-up"]],r.dinnerTop || "",function(v){n.refinements.dinnerTop=v;});top.required=true;
      var bottoms=select("dinnerBottoms","Suitable dinner bottoms",[["","Choose dinner bottoms"],["shorts","Reuse suitable regular Lulu shorts"],["jeans","Jeans + belt"],["khakis","Khakis + belt"]],r.dinnerBottoms || "",function(v){n.refinements.dinnerBottoms=v;});bottoms.required=true;
      note="Reuse a suitable pair already on the list; add one only if missing. Jeans/khakis share one belt with suit attire. Button-ups can share a work shirt on the same day. Choose for the coldest outdoor conditions: "+r.climate+".";
    }else if(focus==="Suit outfit"){
      check("tie","Include ties ("+Math.min(2,r.formalDays)+" different)",r.tie,function(v){n.refinements.tie=v;});
      check("alternateKhakis","Alternate suit trousers with khakis ("+Math.min(2,r.formalDays)+" pairs)",r.alternateKhakis,function(v){n.refinements.alternateKhakis=v;});
      check("shareSuitShirts","My solid-color shirts work for both suit and work/dinner",r.shareSuitShirts,function(v){n.refinements.shareSuitShirts=v;});
      note="One reusable suit jacket, suit trousers, dress shoes and belt. Fresh white dress shirts and dress socks per suit day; no undershirt. For multiple professional dress days, the usual rotation is two different ties and two pairs of khakis; for one day, one of each. Suit shirts stay separate from patterned work/dinner shirts unless you confirm compatibility. Khakis and the belt are shared with dinners when appropriate.";
    }else if(focus==="Shirt sharing"){
      var w=refineWardrobe(state);
      function sharing(key,label,max,value){var automatic=check(key+"Auto",label+": assume maximum overlap",value==null,function(v){n.refinements[key]=v ? null:+count.value;});var count=number(key,"How many days share a shirt?",value==null ? max:Math.min(max,value),max,function(v){if(!automatic.checked)n.refinements[key]=v;});
        function visibility(){count.disabled=automatic.checked;count.parentNode.style.display=automatic.checked ? "none":"";}automatic.addEventListener("change",visibility);visibility();f.appendChild(el("p","gen-note","Maximum shared days: "+max+". Uncheck to correct the assumption."));}
      if(w.overlapMax>0)sharing("shirtOverlap","Button-up dinners share work shirts",w.overlapMax,r.shirtOverlap);
      if(w.suitMax>0)sharing("suitOverlap","Compatible suit shirts share work/dinner days",w.suitMax,r.suitOverlap);
      note="Shared shirts count once for the same day. Maximum overlap is an assumption, not a known schedule; correct it when dinners or suit days need different shirts. Laundry does not reduce these quantities.";
    }else if(focus==="Flight"){
      check("longFlight","Long international flight",r.longFlight,function(v){n.refinements.longFlight=v;});
      note="Adds international flight comfort items when Trip basics specifies international flying.";
    }
    var decision=refineDecisionKey(state,focus)!==null,requiredStep=refinePendingDecisions(state).indexOf(focus)>=0;
    function after(){if(flow){flow.seen[focus]=true;advance(flow);}else if(["Events","Work","Weather","Dinner outfit","Suit outfit","Shirt sharing"].indexOf(focus)>=0 && refinePendingDecisions(state).length)advance({decisionsOnly:true,seen:{}});else closeSheet();}
    if(requiredStep)body.appendChild(el("p","gen-step","Confirm this outfit decision before export."));else if(flow)body.appendChild(el("p","gen-step","Review one assumption at a time. Relevant outfit questions appear next."));
    f.appendChild(el("p","gen-note",note));var go=el("button","btn primary",flow ? "Apply & next":"Apply & recalculate");go.type="submit";f.appendChild(go);
    if(flow && !requiredStep)f.appendChild(generatorButton("Skip for now",after));body.appendChild(f);
    f.addEventListener("submit",function(e){e.preventDefault();updates.forEach(function(update){update();});n.reviewed=n.reviewed||{};n.reviewed[focus]=true;
      if(decision)n.decisionReviews[focus]=refineDecisionKey(n,focus);
      if(JSON.stringify(n.inputs)===JSON.stringify(state.inputs) && JSON.stringify(n.refinements)===JSON.stringify(state.refinements)){
        if(state.reviewed && state.reviewed[focus] && (!decision || state.decisionReviews[focus]===n.decisionReviews[focus])){after();return;}
        go.disabled=true;refinePersist(t,n,result).then(function(){state=n;result=state.legacy ? refineLegacyResult(state):refineEvaluate(state,profile,[]);paint();after();}).catch(function(){go.disabled=false;failure("Could not save this review.");});return;
      }
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
    chips.textContent="";var reviewed=state.reviewed||{},pending=refinePendingDecisions(state),groups={todo:[],done:[]};assumptionList().forEach(function(x){groups[reviewed[x[0]] && pending.indexOf(x[0])<0 ? "done":"todo"].push(x);});
    if(pending.length){var required=el("div","refine-required");required.appendChild(el("strong",null,"Outfit decisions to confirm · "+pending.length));required.appendChild(el("p",null,pending.join(" → ")));required.appendChild(generatorButton("Complete outfit decisions",function(){advance({decisionsOnly:true,seen:{}});},true));chips.appendChild(required);}
    if(groups.todo.length){var go=generatorButton("Refine further · "+groups.todo.length+" to go",startFlow,true);go.className="btn primary refine-start";chips.appendChild(go);chips.appendChild(el("p","muted","Steps through: "+groups.todo.map(function(x){return x[0];}).join(", ")+"."));}
    else chips.appendChild(el("p","muted","✓ Every question reviewed."));
    var one=el("details","refine-one");one.open=oneOpen;one.addEventListener("toggle",function(){oneOpen=one.open;});one.appendChild(el("summary",null,"Adjust a single assumption"));[["todo","To review","new"],["done","Reviewed","done"]].forEach(function(g){if(!groups[g[0]].length)return;var box=el("div","refine-group");box.appendChild(el("h3","k",g[1]+" · "+groups[g[0]].length));var row=el("div","refine-toggles");groups[g[0]].forEach(function(x){var b=generatorButton((g[2]==="done" ? "✓ ":"")+x[0]+": "+x[1],function(){assumptions(x[0]);});b.className="btn refine-"+g[2];row.appendChild(b);});box.appendChild(row);one.appendChild(box);});chips.appendChild(one);
    warnings.textContent="";if(result.warnings.length){var warning=el("details","panel refine-warning");warning.open=true;warning.appendChild(el("summary",null,"Check assumptions · "+result.warnings.length));result.warnings.forEach(function(x){var row=el("p",null,x.text);if(x.decision)row.appendChild(generatorButton("Confirm",function(){assumptions(x.decision,{decisionsOnly:true,seen:{}});}));if(x.itemId && state.overrides.removed[x.itemId])row.appendChild(generatorButton("Restore",function(){var next=clone(state);delete next.overrides.removed[x.itemId];commit(next,[],"Required item restored");}));warning.appendChild(row);});warnings.appendChild(warning);}
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
