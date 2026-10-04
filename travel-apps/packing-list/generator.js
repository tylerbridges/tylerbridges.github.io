"use strict";
// Standalone app: setup and review generate a portable list; Notes owns the packing checklist.
var GEN_PENDING = {};
function generatorPage(t){ var w = el("div","stack"), back = el("a","back","← Packing generator"); back.href = "#"; w.appendChild(back); w.appendChild(el("p","muted",[t.where,t.start ? fmt(t.start) + " – " + fmt(t.end || t.start) : "Dates needed"].filter(Boolean).join(" · "))); w.appendChild(generatorReview(t)); return w; }
function generatorPrefs(){ return lsGet("ta:meta/packing", null) || PACK_PREFS; }
function generatorButton(label, action, primary){ var b = el("button",primary ? "btn primary" : "btn",label); b.type = "button"; b.addEventListener("click",action); return b; }
function generatorLink(label, hash, primary){ var a = el("a",primary ? "btn primary" : "btn",label); a.href = hash; a.style.textDecoration = "none"; return a; }
function generatorHome(){
  if(PACK_TEST_MODE)return packingTestHome();
  var w = el("div","stack"), hero = el("section","panel gen-hero");
  var nav = el("div","gen-nav"); nav.appendChild(generatorLink("Generate a packing list","#new",true)); nav.appendChild(generatorButton("My preferences",function(){ generatorPreferences(); }));
  nav.appendChild(generatorButton("Test flow",packingTestMenu));
  hero.appendChild(nav); w.appendChild(hero);
  if (ORDER.length){ w.appendChild(el("h2","k","Previous trip setups")); ORDER.forEach(function(id){ var t = TRIPS[id], a = el("a","panel tripcard"); a.href = "#" + id;
    a.appendChild(el("h3",null,t.name)); a.appendChild(el("p","muted",[t.where,t.start ? fmt(t.start) + " – " + fmt(t.end || t.start) : "Dates needed"].filter(Boolean).join(" · "))); w.appendChild(a); }); }
  return w;
}
function generatorRulesPage(){
  var p = clone(generatorPrefs()), w = el("div","stack"), back = el("a","back","← Packing generator"); back.href = "#"; w.appendChild(back);
  w.appendChild(el("p","muted","The rules that set quantities and item choices for every new list. Quantity formulas are fixed; item defaults are managed under My usual items."));
  var rules = el("section","panel stack"); rules.appendChild(el("h2","k","Current rules and quantities"));
  rules.appendChild(el("p",null,"Socks and underwear: 2 per travel day. T-shirts: 1 per day. Bottoms: days ÷ 2, rounded up. Contacts: full trip + 2 days, rounded up to a multiple of 5. Clothes worn on departure are included in clothing totals."));
  // Standalone app: describe the active refinement rules without rewriting saved profile data.
  var currentRules={shoes:"Brooks for ordinary hikes and workouts; hiking footwear for rugged/wet trails; dress shoes for formal events",jacket:"Hoodie and puffer for cool/cold weather, even when you run hot; rain adds separate weather protection",cooler:"Joggers replace half the shorts in cool/cold weather; workouts keep enough shorts for two days per pair",workouts:"Workouts most days use regular T-shirts and Lulu shorts; no separate workout outfit"};
  rules.appendChild(el("p",null,"Laundry: first wash day + wash interval, with one spare clothing day. Pack extra uses the same buffer when laundry is planned; otherwise it adds one T-shirt, two underwear, two pairs of socks and one pair of bottoms. Carry-on flags capacity conflicts without moving or reducing items. The collapsible daypack is added only via I need a daypack in trip setup or Activities. Kindle, Hotspot, Belkin charging pad, Garmin + charger and extra phone case are optional selections in Trip extras during setup or Extras after generation."));
  rules.appendChild(el("p",null,"Use the coldest expected outdoor weather; warmer-weather needs can be added separately. Suit days: one reusable suit, fresh white dress shirts and socks, no undershirts; ties and alternating khakis default to one each for one suit day or two each for multiple days, confirmed in the suit step. Video workdays: fresh long-sleeve tops only. Dinner tops and suitable bottoms are confirmed separately; shared work/dinner shirts and compatible suit shirts count once on shared days. Laundry never reduces work, dinner or suit shirts. Relevant outfit choices must be confirmed before export."));
  Object.keys(PREF_LABELS).forEach(function(k){ var row = el("div","gen-rule"); row.appendChild(el("b",null,PREF_LABELS[k])); row.appendChild(el("span",null,currentRules[k] || p[k] || PACK_PREFS[k])); rules.appendChild(row); }); w.appendChild(rules);
  var acts = el("div","gen-nav"); acts.appendChild(generatorButton("My usual items",function(){ generatorPreferences(); })); acts.appendChild(generatorButton("Refinement exclusions",refineProfileSheet)); w.appendChild(acts);
  return w;
}
function generatorPreferences(){
  var p = clone(generatorPrefs()), body = openSheet("My packing preferences");
  body.appendChild(el("p","muted","These defaults are saved in this browser. Trip-specific choices come later. Uncheck usual extras you no longer want; core clothing and quantity rules stay in place."));
  var rules = generatorLink("Current rules and quantities →","#rules"); rules.style.display = "inline-block"; body.appendChild(rules);
  var savedGroups = Array.isArray(p.extras) ? p.extras : PACK_PREFS.extras, removed = Array.isArray(p.prefRemoved) ? p.prefRemoved.slice() : [], groups = [], idx = {};
  function gOf(title){ if (idx[title] == null){ idx[title] = groups.length; groups.push({title:title,items:[]}); } return groups[idx[title]]; }
  function hidden(item){ return refineId(item) === "daypack" || !!refineOptionalKey(item); }
  function putItem(title,label,on){ var g = gOf(title); if (g.items.some(function(x){ return x.label === label; })) return; g.items.push({label:label,on:on}); }
  if (Array.isArray(p.prefItems)){ p.prefItems.forEach(function(g){ gOf(g.title); (g.items || []).forEach(function(x){ putItem(g.title,x.label,!!x.on); }); }); }
  else { savedGroups.forEach(function(g){ gOf(g.title); (g.items || []).forEach(function(item){ putItem(g.title,item,true); }); }); }
  PACK_PREFS.extras.forEach(function(g){ gOf(g.title); (g.items || []).forEach(function(item){ if (removed.indexOf(g.title + "|" + item) < 0) putItem(g.title,item,false); }); });
  var list = el("div");
  function textIn(value,label,cls){ var i = el("input",cls); i.type = "text"; i.value = value; i.setAttribute("aria-label",label); i.style.fontSize = "16px"; return i; }
  function iconBtn(text,label,fn){ var b = el("button","btn",text); b.type = "button"; b.setAttribute("aria-label",label); b.addEventListener("click",fn); return b; }
  function draw(){
    list.textContent = "";
    groups.forEach(function(g,gi){
      var head = el("div","gen-item"), ht = textIn(g.title,"Section header"); ht.style.fontWeight = "600";
      ht.addEventListener("change",function(){ var v = ht.value.trim(); if (!v){ ht.value = g.title; return; } if (groups.some(function(x,i){ return i !== gi && x.title === v; })){ status.textContent = "A section named “" + v + "” already exists."; ht.value = g.title; return; } status.textContent = ""; g.title = v; });
      head.appendChild(ht);
      head.appendChild(iconBtn("Delete section","Delete section " + g.title,function(){ g.items.forEach(function(x){ if (PACK_PREFS.extras.some(function(d){ return d.title === g.title && d.items.indexOf(x.label) >= 0; })) removed.push(g.title + "|" + x.label); }); groups.splice(gi,1); draw(); }));
      list.appendChild(head);
      g.items.forEach(function(x,xi){
        if (hidden(x.label)) return;
        var row = el("div","gen-item"), c = el("input"); c.type = "checkbox"; c.checked = x.on; c.setAttribute("aria-label","Include " + x.label);
        c.addEventListener("change",function(){ x.on = c.checked; });
        var t = textIn(x.label,"Item name"); t.addEventListener("change",function(){ var v = t.value.trim(); if (!v){ t.value = x.label; return; } if (g.items.some(function(y,i){ return i !== xi && y.label === v; })){ status.textContent = "“" + v + "” is already in " + g.title + "."; t.value = x.label; return; } status.textContent = ""; x.label = v; });
        row.appendChild(c); row.appendChild(t);
        row.appendChild(iconBtn("Delete","Delete " + x.label,function(){ if (PACK_PREFS.extras.some(function(d){ return d.title === g.title && d.items.indexOf(x.label) >= 0; })) removed.push(g.title + "|" + x.label); g.items.splice(xi,1); draw(); }));
        list.appendChild(row);
      });
      var add = el("div","gen-item gen-add"), ai = textIn("","Add item to " + g.title); ai.placeholder = "Add item to this section"; 
      function doAdd(){ var v = ai.value.trim(); if (!v) return; if (g.items.some(function(y){ return y.label === v; })){ status.textContent = "“" + v + "” is already in " + g.title + "."; return; } status.textContent = ""; var k = removed.indexOf(g.title + "|" + v); if (k >= 0) removed.splice(k,1); g.items.push({label:v,on:true}); draw(); }
      ai.addEventListener("keydown",function(e){ if (e.key === "Enter"){ e.preventDefault(); doAdd(); } });
      add.appendChild(el("span","gen-spacer")); add.appendChild(ai); add.appendChild(iconBtn("Add","Add item to " + g.title,doAdd)); list.appendChild(add);
    });
    var nh = el("div","gen-item"), ni = textIn("","New section header"); ni.placeholder = "New section header";
    function addHeader(){ var v = ni.value.trim(); if (!v) return; if (idx[v] != null || groups.some(function(x){ return x.title === v; })){ status.textContent = "A section named “" + v + "” already exists."; return; } status.textContent = ""; groups.push({title:v,items:[]}); draw(); }
    ni.addEventListener("keydown",function(e){ if (e.key === "Enter"){ e.preventDefault(); addHeader(); } });
    nh.appendChild(ni); nh.appendChild(iconBtn("Add section","Add section header",addHeader)); list.appendChild(nh);
  }
  var status = el("p","muted"); status.setAttribute("role","status");
  body.appendChild(el("p","gen-note","Check or uncheck to include an item in new lists. Edit a name or header in place, delete with the button, or add items and new sections. Quantity formulas above stay fixed."));
  body.appendChild(list); draw();
  var custom = el("textarea"); custom.id = "gp-custom"; custom.rows = 3; custom.placeholder = "One extra item per line"; custom.value = (p.generatorExtras || []).join("\n"); body.appendChild(fieldEl("Additional items to always bring",custom));
  body.appendChild(generatorButton("Save my preferences",function(){
    p.prefItems = groups.map(function(g){ return {title:g.title,items:g.items.filter(function(x){ return !hidden(x.label); }).map(function(x){ return {label:x.label,on:!!x.on}; })}; });
    p.prefRemoved = removed;
    p.extras = groups.map(function(g){ return {title:g.title,items:g.items.filter(function(x){ return x.on && !hidden(x.label); }).map(function(x){ return x.label; })}; }).filter(function(g){ return g.items.length; });
    p.generatorExtras = custom.value.split(/\r?\n/).map(function(s){ return s.trim(); }).filter(Boolean); p.generatorConfirmedAt = isoToday();
    db.doc("meta/packing").set(p).then(function(){ EXTRAS = p.extras; MAYBE = p.maybe; closeSheet(); render(); }).catch(function(){ status.textContent = "Preferences could not be saved. Storage may be full or blocked."; });
  },true)); body.appendChild(status); body.appendChild(generatorButton("Inspect refinement exclusions",refineProfileSheet));
}
function generatorSetup(t){
  var original = t, existing = !!t, s = t && t.generatorSetup || {}, f = el("form","panel form gen-form"), step = 0;
  t = t || {name:"",where:"",start:"",end:""};
  var progress = el("p","gen-step"), title = el("h2","k"), content = el("div"), actions = el("div","gen-actions"), status = el("p","gen-error"); status.setAttribute("role","status");
  var name = inp("gs-name","text",t.name,"e.g. Phoenix weekend"), where = inp("gs-where","text",t.where,"City, state or country"), start = inp("gs-start","date",t.start), end = inp("gs-end","date",t.end);
  name.required = true; where.required = true; start.required = true; end.required = true;
  var mode = sel("gs-mode",[["fly","Flying"],["drive","Driving"],["other","Train or other"]],s.mode || "fly");
  var bag = sel("gs-bag",[["carryon","Carry-on + personal bag"],["checked","Checked bag + personal bag"]],s.bag || "carryon");
  var climate = sel("gs-climate",[["mild","Mild (60–85°F)"],["cool","Cool (40–60°F)"],["cold","Cold (below 40°F)"],["hot","Hot (above 85°F)"]],s.climate || "mild");
  var laundry = sel("gs-laundry",[["none","No laundry — pack for the full trip"],["cycle","Planned laundry — pack by wash interval"]],s.laundry || "none");
  var interval = inp("gs-interval","number",s.interval || 4); interval.min = "1"; interval.max = "60";
  var dinners = inp("gs-dinners","number",s.dinners || 0), formal = inp("gs-formal","number",s.formal || 0); [dinners,formal].forEach(function(i){ i.min = "0"; i.max = "60"; });
  var work = sel("gs-work",[["none","No work laptop"],["laptop","Laptop just in case"],["work","Working — full hotel work setup"]],s.work || "none");
  var extra = el("textarea"); extra.id = "gs-extra"; extra.rows = 3; extra.value = s.extra || ""; extra.placeholder = "One additional item per line; include a quantity if needed";
  var toggles = {};
  [["rain","Rain expected"],["water","Pool or beach"],["hike","Hiking"],["fish","Fishing"],["intl","International trip"],["longintl","Long international flight"]].forEach(function(x){ var c = el("input"); c.type = "checkbox"; c.id = "gs-" + x[0]; c.checked = !!s[x[0]]; var l = el("label","gen-choice"); l.appendChild(c); l.appendChild(el("span",null,x[1])); toggles[x[0]] = {input:c,label:l}; });
  var pages = [el("div"),el("div"),el("div")];
  pages[0].appendChild(fieldEl("Trip name",name)); pages[0].appendChild(fieldEl("Destination",where));
  var dates = el("div","two"); dates.appendChild(fieldEl("Departure date",start)); dates.appendChild(fieldEl("Return date",end)); pages[0].appendChild(dates);
  pages[0].appendChild(el("p","gen-note","Both travel days count. Same-day trips are supported; maximum 60 days.")); pages[0].appendChild(fieldEl("Travel mode",mode)); pages[0].appendChild(fieldEl("Luggage",bag)); pages[0].appendChild(toggles.intl.label); pages[0].appendChild(toggles.longintl.label);
  pages[1].appendChild(fieldEl("Expected weather",climate,"Choose the coldest conditions you expect. Weather is your selection, not a live forecast."));
  ["rain","water","hike","fish"].forEach(function(k){ pages[1].appendChild(toggles[k].label); });
  pages[1].appendChild(fieldEl("Formal days",formal,"Use 1 for a wedding or funeral day; otherwise 0.")); pages[1].appendChild(fieldEl("Nice dinners",dinners,"One button-up shirt per dinner.")); pages[1].appendChild(fieldEl("Work gear",work));
  pages[2].appendChild(fieldEl("Laundry plan",laundry)); var wash = fieldEl("Wash clothes every how many days?",interval,"Clothing covers this interval plus one spare day. Contacts still cover the full trip."); pages[2].appendChild(wash); pages[2].appendChild(fieldEl("Extra items for this trip",extra,"These are literal items, not instructions to an AI."));
  var summary = el("ul","gen-summary"); pages[2].appendChild(summary);
  function conditions(){ wash.hidden = laundry.value !== "cycle"; toggles.longintl.label.hidden = mode.value !== "fly" || !toggles.intl.input.checked; }
  [mode, laundry, toggles.intl.input].forEach(function(i){ i.addEventListener("change",conditions); }); conditions();
  function validate(){
    if (step === 0){
      for (var i = 0, inputs = [name,where,start,end]; i < inputs.length; i++){ if (!inputs[i].reportValidity()) return false; }
      var days = (pd(end.value) - pd(start.value)) / 86400000 + 1;
      if (!Number.isFinite(days) || days < 1 || days > 60){ status.textContent = "Choose valid dates in order, spanning 1–60 days."; return false; }
    }
    if (step === 1 && (!formal.reportValidity() || !dinners.reportValidity())) return false;
    if (step === 1 && +formal.value > tripDates({start:start.value,end:end.value}).length){ status.textContent = "Formal days cannot exceed the trip length."; return false; }
    if (step === 2 && laundry.value === "cycle" && !interval.reportValidity()) return false;
    return true;
  }
  function show(){ status.textContent = ""; progress.textContent = "Step " + (step + 1) + " of 3 · " + ["Trip basics","Weather & activities","Laundry & generate"][step]; title.textContent = ["Where are you going?","What will you do?","Ready to generate"][step]; content.textContent = ""; content.appendChild(pages[step]); actions.textContent = "";
    if (step){ actions.appendChild(generatorButton("Back",function(){ step--; show(); })); } else actions.appendChild(generatorLink("Cancel",existing ? "#" + t.id : "#"));
    if (step === 2){ summary.textContent = ""; var days = tripDates({start:start.value,end:end.value}).length; [days + " travel days · " + (days - 1) + " nights",bag.options[bag.selectedIndex].text,"Your saved usual items and rules", "Review quantities before exporting to Notes"].forEach(function(x){ summary.appendChild(el("li",null,x)); }); }
    var next = el("button","btn primary",step === 2 ? "Generate my list" : "Continue"); next.type = "submit"; actions.appendChild(next);
  }
  f.appendChild(progress); f.appendChild(title); f.appendChild(content); f.appendChild(status); f.appendChild(actions);
  f.addEventListener("submit",function(e){ e.preventDefault(); if (!validate()) return; if (step < 2){ step++; show(); return; }
    var setup = {mode:mode.value,bag:bag.value,climate:climate.value,laundry:laundry.value,interval:+interval.value,formal:+formal.value,dinners:+dinners.value,work:work.value,extra:extra.value.trim()};
    Object.keys(toggles).forEach(function(k){ setup[k] = toggles[k].input.checked; }); setup.longintl = setup.longintl && setup.intl && setup.mode === "fly";
    var record = Object.assign({},original || {},{name:name.value.trim(),where:where.value.trim(),start:start.value,end:end.value,generatorSetup:setup});
    record.id = existing ? t.id : newTripId(record.name,record.where,record.start);
    var prefs = generatorPrefs(), draft;
    try { draft = generatorBuild(record,setup,prefs); } catch(err){ status.textContent = err.message; return; }
    var button = actions.querySelector('button[type="submit"]'); button.disabled = true;
    var patch = {name:record.name,where:record.where,start:record.start,end:record.end,generatorSetup:setup};
    if (!existing){ patch.status = "Researching"; patch.bookings = {}; patch.days = []; patch.createdAt = Date.now(); }
    // Save directly so a blocked local write cannot replace the last visible trip record.
    db.doc("trips/" + record.id).set(Object.assign({},RAW[record.id] || {},patch)).then(function(){ return db.doc("trip/" + record.id + "/pack_meta/draft").set(draft); }).then(function(){
      GEN_PENDING[record.id] = draft; RAW[record.id] = Object.assign({},RAW[record.id] || {},patch); rebuild(); if (location.hash === "#" + record.id) render(); else location.hash = record.id;
    }).catch(function(){ button.disabled = false; status.textContent = "Could not save this trip. Storage may be full or blocked."; });
  }); show(); return f;
}
function generatorBuild(t, s, prefs){
  var days = tripDates(t).length;
  if (!days || !t.start || !t.end || t.end < t.start) throw new Error("Set valid trip dates before generating quantities.");
  var clothingDays = s.laundry === "cycle" ? Math.min(days,Math.max(1,s.interval || 1) + 1) : days, bottoms = Math.ceil(clothingDays / 2);
  var cool = s.climate === "cold" || s.climate === "cool" || s.rain, joggers = cool ? Math.ceil(bottoms / 2) : 0;
  var groups = [], byTitle = {}, seen = {};
  function add(title,label){ label = String(label || "").trim(); if (!label) return; var key = normItem(label), section = title === "Wear to travel" ? "wear:" : "packed:";
    if (seen[section + key]) return; seen[section + key] = true;
    if (!byTitle[title]){ byTitle[title] = {title:title,items:[]}; groups.push(byTitle[title]); } byTitle[title].items.push(label);
  }
  ["Shirt ×1","Pants ×1","Underwear ×1","Socks ×1"].forEach(function(x){ add("Wear to travel",x); });
  var counts = {socks:2 * clothingDays - 1,underwear:2 * clothingDays - 1,tshirts:Math.max(0,clothingDays - 1),bottoms:bottoms - joggers,joggers:joggers,contacts:5 * Math.ceil((days + 2) / 5)};
  function quantity(label,title){ var k = qtyKey(label); if (!k) return label; if (title === "Wear to travel") return qtyBase(label) + " ×1";
    if (!counts[k]) return ""; return qtyName(k,label) + " ×" + counts[k]; }
  ["T-shirts","Underwear","Socks","Lulu shorts"].forEach(function(x){ add("Clothing",quantity(x,"Clothing")); });
  if (joggers) add("Clothing","Lulu joggers ×" + joggers);
  add("Toiletries","Liquids quart bag (travel-size)");
  (Array.isArray(prefs.extras) ? prefs.extras : PACK_PREFS.extras).forEach(function(g){ (g.items || []).forEach(function(x){ add(g.title,quantity(x,g.title)); }); });
  var tags = [s.climate]; ["rain","water","hike","fish","intl","longintl"].forEach(function(k){ if (s[k] && (k !== "longintl" || s.intl && s.mode === "fly")) tags.push(k); });
  if (s.rain && tags.indexOf("cool") < 0 && tags.indexOf("cold") < 0) tags.push("cool");
  if (s.formal) tags.push("formal"); if (s.dinners) tags.push("dinner"); if (s.work !== "none") tags.push(s.work);
  (Array.isArray(prefs.maybe) ? prefs.maybe : PACK_PREFS.maybe).forEach(function(g){ if (tags.indexOf(g.tag) < 0) return;
    (g.items || []).forEach(function(x){ var label = quantity(x,g.title); if (g.tag === "dinner" && /button-up/i.test(x)) label = qtyBase(x) + " ×" + s.dinners;
      if (g.tag === "formal" && /dress socks|white shirt|undershirt/i.test(x)) label = qtyBase(x) + " ×" + s.formal; add(g.title,label); }); });
  if (s.formal){ add("Formal wear","Dress pants ×1"); add("Formal wear","Belt"); }
  if (s.work === "work"){ add("Work","Work computer charger"); add("Work","Logitech mouse dongle"); }
  (prefs.generatorExtras || []).concat(String(s.extra || "").split(/\r?\n/)).forEach(function(x){ add("Personal bag & day gear",quantity(x,"Personal bag & day gear")); });
  var departure = leavingFor(groups,s.bag === "checked");
  groups.push({title:"Before leaving",depart:true,items:departure});
  return {groups:groups,setup:clone(s),explanation:[days + " travel days; " + clothingDays + " days of clothing" + (s.laundry === "cycle" ? " (wash interval + one spare day)" : ""),"Departure outfit counts toward socks, underwear and T-shirts", "Contacts cover all " + days + " days plus the saved two-day buffer", cool ? "Joggers replace half the shorts, rounded up" : "Shorts are the packed bottoms; travel pants are worn", "Before leaving checks follow the items you keep"]};
}
function generatorSaved(t){ var pk = packData(t.id); return {groups:Object.keys(pk.sections).map(function(id){ var s = pk.sections[id]; return {id:id,title:s.title,order:s.order || 0,depart:!!s.depart}; }).sort(secSort).map(function(s){ return {title:s.title,depart:s.depart,items:Object.keys(pk.items).map(function(id){ return pk.items[id]; }).filter(function(i){ return i.section === s.id; }).sort(function(a,b){ return (a.order || 0) - (b.order || 0); }).map(function(i){ return i.label; })}; }),setup:t.generatorSetup || null,explanation:[]}; }
function generatorReview(t){
  var w = el("div","gen-review"), pk = packData(t.id);
  if (!pk.ready){ w.appendChild(el("p","muted","Loading your draft…")); setTimeout(function(){ if (route().t && route().t.id === t.id) render(); },100); return w; }
  var pending = GEN_PENDING[t.id] || lsGet("ta:trip/" + t.id + "/pack_meta/draft",null), fresh = !!pending, draft = pending || generatorSaved(t), groups = draft.groups;
  if (!groups.length){ w.appendChild(el("p","muted","Set up this trip to generate an accurate packing list.")); w.appendChild(generatorLink("Set up & generate","#" + t.id + ".edit",true)); return w; }
  w.appendChild(el("h2","k","Review, then export")); w.appendChild(el("p","muted","Adjust item names and quantities here. Packing and checking items off happens in Notes."));
  var nav = el("div","gen-actions"), msg = el("p","gen-error"); msg.setAttribute("role","status");
  var exportButton = generatorButton(fresh ? "Save draft & export to Notes" : "Export to Notes",function(){
    var output = groups.map(function(g){ return {title:g.title,depart:!!g.depart,items:g.items.filter(Boolean)}; });
    if (draft.setup){ output = output.filter(function(g){ return !g.depart; }); output.push({title:"Before leaving",depart:true,items:leavingFor(output,draft.setup.bag === "checked")}); }
    exportButton.disabled = true; generatorSaveDraft(t,output,draft.setup).then(function(){ return db.doc("trip/" + t.id + "/pack_meta/draft").delete(); }).then(function(){ delete GEN_PENDING[t.id]; render(); packExportSheet(t); }).catch(function(){ exportButton.disabled = false; msg.textContent = "Could not save the draft. Check that browser storage is available and try again."; });
  },true); exportButton.id = "gr-export"; nav.appendChild(exportButton); nav.appendChild(generatorLink("Change trip setup","#" + t.id + ".edit")); w.appendChild(nav); w.appendChild(msg);
  if (fresh && Object.keys(pk.items).length) w.appendChild(el("p","gen-note","Saving this regenerated draft replaces the app’s previous draft for this trip. Your exported Notes copy is separate."));
  if (draft.explanation.length){ var why = el("details","panel"); why.appendChild(el("summary",null,"How this list was calculated")); var ul = el("ul","gen-summary"); draft.explanation.forEach(function(x){ ul.appendChild(el("li",null,x)); }); why.appendChild(ul); w.appendChild(why); }
  // A separate draft preserves review edits across reloads without replacing the last exported list.
  GEN_PENDING[t.id] = draft;
  function saveEdit(){ db.doc("trip/" + t.id + "/pack_meta/draft").set(draft).then(function(){ msg.textContent = ""; }).catch(function(){ msg.textContent = "This edit is only in memory: browser storage could not save it."; }); }
  groups.forEach(function(g){ var box = el("section","panel"); box.appendChild(el("h3",null,g.title));
    if (g.depart && draft.setup){ box.appendChild(el("p","gen-note","These checks are recalculated from the items you keep when you export.")); g.items.forEach(function(label){ box.appendChild(el("p",null,label)); }); }
    else { var rows = el("div"); function row(label,index){ var line = el("div","gen-item"), input = inp("gr-" + groups.indexOf(g) + "-" + index,"text",label); input.setAttribute("aria-label",g.title + " item " + (index + 1)); input.addEventListener("input",function(){ g.items[index] = input.value.trim(); saveEdit(); }); var remove = generatorButton("Remove",function(){ g.items[index] = ""; saveEdit(); line.remove(); }); remove.setAttribute("aria-label","Remove " + label); line.appendChild(input); line.appendChild(remove); rows.appendChild(line); }
      g.items.forEach(function(label,index){ if (label) row(label,index); }); box.appendChild(rows); box.appendChild(generatorButton("+ Add item",function(){ var index = g.items.length; g.items.push(""); saveEdit(); row("",index); rows.lastChild.querySelector("input").focus(); })); }
    w.appendChild(box);
  }); return w;
}
function generatorSaveDraft(t,groups,setup){
  var pk = packData(t.id), sections = {}, items = {}, prefix = "gen-" + Date.now().toString(36), backup = Store.exportAll();
  groups.forEach(function(g,index){ var sid = prefix + "-s" + index; sections[sid] = {title:g.title,depart:!!g.depart,order:g.depart ? 9999 : (index + 1) * 10,note:""};
    g.items.forEach(function(label,i){ items[prefix + "-i" + index + "-" + i] = {label:label,section:sid,order:(i + 1) * 10,checked:false,at:Date.now()}; }); });
  var writes = []; Object.keys(sections).forEach(function(id){ writes.push(db.doc("trip/" + t.id + "/pack_sections/" + id).set(sections[id])); }); Object.keys(items).forEach(function(id){ writes.push(db.doc("trip/" + t.id + "/pack_items/" + id).set(items[id])); });
  return Promise.all(writes).then(function(){
    var deletes = []; Object.keys(backup).forEach(function(path){ if (path.indexOf("trip/" + t.id + "/pack_sections/") === 0 || path.indexOf("trip/" + t.id + "/pack_items/") === 0) deletes.push(db.doc(path).delete()); });
    return Promise.all(deletes);
  }).then(function(){ pk.sections = sections; pk.items = items; pk.ready = true;
    return db.doc("trip/" + t.id + "/pack_meta/original").set({at:Date.now(),context:packContext(t,{source:"generator",luggage:setup ? setup.bag : "carryon"}),groups:groups});
  }).catch(function(err){
    // Roll back only this trip's packing documents if storage rejects any part of a save.
    Object.keys(sections).forEach(function(id){ localStorage.removeItem("ta:trip/" + t.id + "/pack_sections/" + id); }); Object.keys(items).forEach(function(id){ localStorage.removeItem("ta:trip/" + t.id + "/pack_items/" + id); });
    Object.keys(backup).forEach(function(path){ if (path.indexOf("trip/" + t.id + "/pack_") === 0) localStorage.setItem("ta:" + path,JSON.stringify(backup[path])); });
    pk.sections = {}; pk.items = {}; Object.keys(backup).forEach(function(path){ var id = path.slice(path.lastIndexOf("/") + 1); if (path.indexOf("trip/" + t.id + "/pack_sections/") === 0) pk.sections[id] = backup[path]; if (path.indexOf("trip/" + t.id + "/pack_items/") === 0) pk.items[id] = backup[path]; }); throw err;
  });
}
