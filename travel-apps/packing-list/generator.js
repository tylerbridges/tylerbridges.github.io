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
  var nav = el("div","gen-nav"); nav.appendChild(generatorLink("Generate a packing list","#new",true)); nav.appendChild(generatorButton("Packing preferences",function(){ generatorPreferences(); }));
  nav.appendChild(generatorButton("Packing learning",packingLearningSheet));nav.appendChild(generatorButton("Test flow",packingTestMenu));
  hero.appendChild(nav); w.appendChild(hero);

  var visible=ORDER.filter(function(id){return !TRIPS[id].packingDeleted;});
  if(visible.length){w.appendChild(el("h2","k","Previous trip setups"));visible.forEach(function(id){w.appendChild(generatorListRow(TRIPS[id]));});}
  return w;
}
function generatorRulesPage(){
  var p = clone(generatorPrefs()), w = el("div","stack"), back = el("a","back","← Packing generator"); back.href = "#"; w.appendChild(back);
  w.appendChild(el("p","muted","The rules that set quantities and item choices for every new list. Quantity formulas are fixed; item defaults are managed under Packing preferences."));
  var rules = el("section","panel stack"); rules.appendChild(el("h2","k","Current rules and quantities"));
  rules.appendChild(el("p",null,"Socks and underwear: 2 per travel day. T-shirts: 1 per day. Bottoms: days ÷ 2, rounded up. Contacts: full trip + 2 days, rounded up to a multiple of 5. Clothes worn on departure are included in clothing totals."));
  // Standalone app: describe the active refinement rules without rewriting saved profile data.
  var currentRules={liquids:"Liquids are already in travel containers; no liquids-bag item or departure check. Dry and liquid toiletries pack in separate bags (deodorant/lip balm assumed solid; change an item’s section if needed).",planeComfort:"Kindle is opt-in in Trip extras; neck pillow, earplugs and eye mask only on long international flights",formalDays:"Suit attire only for selected full suit days; video workdays and nice dinners have separate outfit decisions",hot:"Warm weather uses shorts; weather changes item choices, not daily shirt or underwear needs",shoes:"Brooks for ordinary hikes and workouts; hiking footwear for rugged/wet trails; dress shoes for formal events",jacket:"Hoodie and puffer for cool/cold weather, even when you run hot; rain adds separate weather protection",cooler:"Joggers replace half the shorts in cool/cold weather; workouts keep enough shorts for two days per pair",workouts:"Workouts most days use regular T-shirts and Lulu shorts; no separate workout outfit"};
  rules.appendChild(el("p",null,"Laundry: first wash day + wash interval, with one spare clothing day. Pack extra uses the same buffer when laundry is planned; otherwise it adds one T-shirt, two underwear, two pairs of socks and one pair of bottoms. Carry-on flags capacity conflicts without moving or reducing items. The collapsible daypack is added only via I need a daypack in trip setup or Activities. Kindle, Hotspot, Belkin charging pad, Garmin + charger and extra phone case are optional selections in Trip extras during setup or Extras after generation."));
  rules.appendChild(el("p",null,"Use the coldest expected outdoor weather; warmer-weather needs can be added separately. Suit days: one reusable suit, fresh white dress shirts and socks, no undershirts; ties and alternating khakis default to one each for one suit day or two each for multiple days, confirmed in the suit step. Video workdays: fresh long-sleeve tops only. Dinner tops and suitable bottoms are confirmed separately; shared work/dinner shirts and compatible suit shirts count once on shared days. Laundry never reduces work, dinner or suit shirts. Relevant outfit choices must be confirmed before export."));
  Object.keys(PREF_LABELS).forEach(function(k){ var row = el("div","gen-rule"); row.appendChild(el("b",null,PREF_LABELS[k])); row.appendChild(el("span",null,currentRules[k] || p[k] || PACK_PREFS[k])); rules.appendChild(row); }); w.appendChild(rules);
  var acts = el("div","gen-nav"); acts.appendChild(generatorButton("Packing preferences",function(){ generatorPreferences(); })); w.appendChild(acts);
  return w;
}
function generatorPreferences(suggestedItem){
  var p = clone(generatorPrefs()), body = openSheet("Packing preferences");
  body.appendChild(el("p","muted","These defaults are saved in this browser. Trip-specific choices come later. Uncheck usual extras you no longer want; core clothing and quantity rules stay in place."));
  var rules = generatorLink("Current rules and quantities →","#rules"); rules.style.display = "inline-block"; body.appendChild(rules);
  var savedGroups = Array.isArray(p.extras) ? p.extras : PACK_PREFS.extras, removed = Array.isArray(p.prefRemoved) ? p.prefRemoved.slice() : [], groups = [], idx = {};
  function gOf(title){ if (idx[title] == null){ idx[title] = groups.length; groups.push({title:title,items:[]}); } return groups[idx[title]]; }
  function hidden(item){ return refineId(item) === "daypack" || !!refineOptionalKey(item); }
  function defaultKey(title,label){var g=PACK_PREFS.extras.find(function(d){return (d.title===title || d.title==="Toiletries" && toiletryBagSection(label)===title) && d.items.indexOf(label)>=0;});return g ? g.title+"|"+label:null;}
  function putItem(title,label,on,always){var g=gOf(title),item=g.items.find(function(x){return x.label===label;});if(item){if(always)item.always=true;return;}g.items.push({label:label,on:on,always:!!always});}
  if (Array.isArray(p.prefItems)){ p.prefItems.forEach(function(g){ gOf(g.title); (g.items || []).forEach(function(x){ putItem(g.title,x.label,!!x.on,!!x.always); }); }); }
  else { savedGroups.forEach(function(g){ gOf(g.title); (g.items || []).forEach(function(item){ putItem(g.title,item,true); }); }); }
  PACK_PREFS.extras.forEach(function(g){ gOf(g.title); (g.items || []).forEach(function(item){ if (g.title==="Toiletries" && groups.some(function(existing){return existing.items.some(function(x){return x.label===item;});}))return;if (removed.indexOf(g.title + "|" + item) < 0) putItem(g.title,item,false); }); });
  p.refinementProfile=p.refinementProfile || {};p.refinementProfile.excluded=p.refinementProfile.excluded || {};
  function importAlways(labels){(labels || []).forEach(function(label){var group=groups.find(function(g){return g.items.some(function(x){return refineId(x.label)===refineId(label);});});var item=group && group.items.find(function(x){return refineId(x.label)===refineId(label);});if(item){item.always=true;item.on=true;}else putItem("Personal bag & day gear",label,true,true);});}
  importAlways(p.generatorExtras);
  if(typeof suggestedItem==="string" && suggestedItem.trim())importAlways([suggestedItem.trim()]);
  groups=splitToiletryGroups(groups);idx={};groups.forEach(function(g,index){idx[g.title]=index;});
  var list = el("div"),excludedBox=el("details","panel");
  function textIn(value,label,cls){ var i = el("input",cls); i.type = "text"; i.value = value; i.setAttribute("aria-label",label); i.style.fontSize = "16px"; return i; }
  function iconBtn(text,label,fn){ var b = el("button","btn",text); b.type = "button"; b.setAttribute("aria-label",label); b.addEventListener("click",fn); return b; }
  function draw(){
    list.textContent = "";
    groups.forEach(function(g,gi){
      var head = el("div","gen-item"), ht = textIn(g.title,"Section header"); ht.style.fontWeight = "600";
      ht.addEventListener("change",function(){ var v = ht.value.trim(); if (!v){ ht.value = g.title; return; } if (groups.some(function(x,i){ return i !== gi && x.title === v; })){ status.textContent = "A section named “" + v + "” already exists."; ht.value = g.title; return; } status.textContent = ""; g.title = v; });
      head.appendChild(ht);
      head.appendChild(iconBtn("Delete section","Delete section " + g.title,function(){ g.items.forEach(function(x){ var key=defaultKey(g.title,x.label);if(key)removed.push(key); }); groups.splice(gi,1); draw(); }));
      list.appendChild(head);
      g.items.forEach(function(x,xi){
        if (hidden(x.label) && !x.always) return;
        var row = el("div","gen-item gen-pref-row"), c = el("input"); c.type = "checkbox"; c.checked = x.on && !p.refinementProfile.excluded[refineItem(x.label,g.title,"").id]; c.setAttribute("aria-label","Include " + x.label);
        c.addEventListener("change",function(){x.on=c.checked;if(c.checked)delete p.refinementProfile.excluded[refineItem(x.label,g.title,"").id];if(exclusionNote)exclusionNote.hidden=!p.refinementProfile.excluded[refineItem(x.label,g.title,"").id];drawExcluded();});
        var t = textIn(x.label,"Item name"); t.addEventListener("change",function(){ var v = t.value.trim(); if (!v){ t.value = x.label; return; } if (g.items.some(function(y,i){ return i !== xi && y.label === v; })){ status.textContent = "“" + v + "” is already in " + g.title + "."; t.value = x.label; return; } status.textContent="";var oldId=refineItem(x.label,g.title,"").id;if(p.refinementProfile.excluded[oldId]){delete p.refinementProfile.excluded[oldId];p.refinementProfile.excluded[refineItem(v,g.title,"").id]=v;}x.label=v;drawExcluded(); });
        row.appendChild(c);row.appendChild(t);if(x.always || !defaultKey(g.title,x.label)){var always=el("input");always.type="checkbox";always.checked=!!x.always;always.setAttribute("aria-label","Always bring "+x.label);always.addEventListener("change",function(){x.always=always.checked;});var alwaysLabel=el("label","chipchk");alwaysLabel.appendChild(always);alwaysLabel.appendChild(el("span",null,"Always bring"));row.appendChild(alwaysLabel);}var exclusionNote=el("span","gen-note","Excluded by your default");exclusionNote.hidden=!p.refinementProfile.excluded[refineItem(x.label,g.title,"").id];row.appendChild(exclusionNote);
        row.appendChild(iconBtn("Delete","Delete " + x.label,function(){ var key=defaultKey(g.title,x.label);if(key)removed.push(key); g.items.splice(xi,1); draw(); }));
        list.appendChild(row);
      });
    });
    var nh = el("div","gen-item"), ni = textIn("","New section header"); ni.placeholder = "Enter section name";
    function addHeader(){ var v = ni.value.trim(); if (!v) return; if (idx[v] != null || groups.some(function(x){ return x.title === v; })){ status.textContent = "A section named “" + v + "” already exists."; return; } status.textContent = ""; groups.push({title:v,items:[]}); draw(); }
    ni.addEventListener("keydown",function(e){ if (e.key === "Enter"){ e.preventDefault(); addHeader(); } });
    nh.appendChild(ni);nh.appendChild(iconBtn("Add section","Add section header",addHeader));list.appendChild(nh);drawExcluded();refreshSections();
  }
  var status=el("p","muted");status.setAttribute("role","status");
  body.appendChild(el("p","gen-note","Include usual items with the checkbox. Always bring protects an item during automatic generation. Required trip rules may still keep an item you exclude. Changes apply only when you save."));
  var addBox=el("details","panel"),ai=inp("gp-addName","text","","Enter item name"),section=sel("gp-addSection",[],""),alwaysNew=inp("gp-addAlways","checkbox",null);addBox.appendChild(el("summary",null,"Add usual item"));addBox.appendChild(fieldEl("Item name",ai));addBox.appendChild(fieldEl("Section",section));addBox.appendChild(fieldEl("Always bring",alwaysNew));
  function refreshSections(){if(!section)return;var selected=section.value;section.textContent="";groups.forEach(function(g){var option=el("option",null,g.title);option.value=g.title;section.appendChild(option);});section.value=groups.some(function(g){return g.title===selected;}) ? selected:groups.some(function(g){return g.title==="Personal bag & day gear";}) ? "Personal bag & day gear":groups[0] ? groups[0].title:"";}
  function addUsual(){var label=ai.value.trim();if(!label){status.textContent="Enter an item name.";return;}if(!section.value){status.textContent="Add a section first.";return;}if(groups.some(function(g){return g.items.some(function(x){return refineId(x.label)===refineId(label);});})){status.textContent="This item already exists. Change its Include or Always bring choice instead.";return;}putItem(section.value,label,true,alwaysNew.checked);ai.value="";alwaysNew.checked=false;status.textContent="Item added to preferences. Save to apply.";draw();}
  addBox.appendChild(generatorButton("Add item",addUsual));body.appendChild(addBox);body.appendChild(list);body.appendChild(excludedBox);
  function drawExcluded(){excludedBox.textContent="";var excluded=p.refinementProfile.excluded;excludedBox.appendChild(el("summary",null,"Excluded defaults · "+Object.keys(excluded).length));Object.keys(excluded).forEach(function(id){var row=el("div","gen-actions");row.appendChild(el("span",null,excluded[id]));row.appendChild(generatorButton("Reset this default",function(){delete p.refinementProfile.excluded[id];draw();status.textContent="Exclusion reset in this form. Save to apply.";}));excludedBox.appendChild(row);});excludedBox.appendChild(el("p","gen-note","Profile defaults apply to future generation. Separate trip removals and manual edits stay intact."));}
  // Keep old pending textarea drafts readable while the visible editor uses one add path.
  var custom=el("textarea");custom.id="gp-custom";custom.hidden=true;body.appendChild(custom);draw();
  if(typeof suggestedItem==="string")body.appendChild(el("p","gen-note","Suggested item added with Always bring selected. Review it, then save to change your defaults."));
  body.appendChild(generatorButton("Save my preferences",function(){
    if(ai.value.trim()){status.textContent="Add the entered item before saving preferences.";addBox.open=true;return;}
    p.prefItems = groups.map(function(g){ return {title:g.title,items:g.items.filter(function(x){ return !hidden(x.label) || x.always; }).map(function(x){ return {label:x.label,on:!!x.on,always:!!x.always}; })}; });
    p.prefRemoved = removed;
    p.extras = groups.map(function(g){ return {title:g.title,items:g.items.filter(function(x){ return x.on && !x.always && !hidden(x.label); }).map(function(x){ return x.label; })}; }).filter(function(g){ return g.items.length; });
    p.generatorExtras=groups.flatMap(function(g){return g.items.filter(function(x){return x.on && x.always;}).map(function(x){return x.label;});}); p.generatorConfirmedAt = isoToday();
    db.doc("meta/packing").set(p).then(function(){ preferenceDraft.clear();EXTRAS = p.extras; MAYBE = p.maybe; closeSheet(); render(); }).catch(function(){ status.textContent = "Preferences could not be saved. Storage may be full or blocked."; });
  },true)); body.appendChild(status);
  var preferenceDraft=packingDraftAttach(body,"preferences",JSON.stringify(generatorPrefs()),{saveClicks:true,restoreEvents:false,allowCustomLegacy:true,capture:function(){return {groups:groups,removed:removed,excluded:clone(p.refinementProfile.excluded)};},beforeRestore:function(data){if(data.custom){groups=clone(data.custom.groups);removed=data.custom.removed.slice();if(data.custom.excluded)p.refinementProfile.excluded=clone(data.custom.excluded);else if(!data.fields["gp-custom"])importAlways(p.generatorExtras);}var old=data.fields["gp-custom"];if(old && old.value)importAlways(old.value.split(/\r?\n/).map(function(x){return x.trim();}).filter(Boolean));},onRestore:function(){custom.value="";draw();}});
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
  groups=splitToiletryGroups(groups);var departure = leavingFor(groups,s.bag === "checked");
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
  // Standalone app: re-rendering an unchanged list must not rewrite its export copy.
  var pk0 = packData(t.id), luggage = setup ? setup.bag : "carryon", total = groups.reduce(function(n,g){ return n + g.items.length; },0);
  return db.doc("trip/" + t.id + "/pack_meta/original").get().then(function(snap){ var o = snap && snap.exists !== false && snap.data ? snap.data() : null;
    if (o && pk0.ready && JSON.stringify(o.groups) === JSON.stringify(groups) && o.context && o.context.luggage === luggage && Object.keys(pk0.sections).length === groups.length && Object.keys(pk0.items).length === total) return;
    return generatorWriteDraft(t,groups,setup);
  });
}
function generatorWriteDraft(t,groups,setup){
  var pk = packData(t.id), sections = {}, items = {}, prefix = "gen-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,8), backup = Store.exportAll();
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

// Standalone app: list deletion owns packing documents only; itinerary/bookings stay intact.
var GEN_DELETED_LIST=null,GEN_OPEN_ROW=null;
function generatorDeletionToast(message){
  var deleted=GEN_DELETED_LIST;
  undoToast(message || "List deleted",function(){generatorRestoreList().then(render).catch(function(){generatorDeletionToast("Could not restore. Try Undo.");});},function(){if(GEN_DELETED_LIST===deleted)GEN_DELETED_LIST=null;});
  UNDO.box.classList.add("packing-delete-toast");
}
function generatorPackingKeys(id){
  var prefix=(window.PACK_TEST_PREFIX||"")+"ta:",base=prefix+"trip/"+id+"/",draft=prefix+"meta/packingFormDrafts/",keys=[];
  for(var i=0;i<localStorage.length;i++){var key=localStorage.key(i),owned=["pack_sections/","pack_items/","pack_meta/"].some(function(part){return key.indexOf(base+part)===0;});
    if(key.indexOf(draft)===0){var scope=decodeURIComponent(key.slice(draft.length));owned=owned || ["setup:","trip-details:","feedback:","add:"].some(function(part){return scope===part+id;}) || ["refine:","edit:"].some(function(part){return scope.indexOf(part+id+":")===0;});}if(owned)keys.push(key);
  }return keys;
}
function generatorRestoreRaw(values){Object.keys(values).forEach(function(key){if(values[key]===null)localStorage.removeItem(key);else localStorage.setItem(key,values[key]);if(localStorage.getItem(key)!==values[key])throw new Error("Storage blocked");});}
function generatorDeleteList(t){
  var prefix=(window.PACK_TEST_PREFIX||"")+"ta:",header=prefix+"trips/"+t.id,values={},original=localStorage.getItem(header);
  try{var trip=JSON.parse(original);if(!trip)throw new Error("Trip missing");generatorPackingKeys(t.id).forEach(function(key){values[key]=localStorage.getItem(key);});
    Object.keys(values).forEach(function(key){localStorage.removeItem(key);if(localStorage.getItem(key)!==null)throw new Error("Storage blocked");});trip.packingDeleted=true;
    return db.doc("trips/"+t.id).set(trip).then(function(){GEN_DELETED_LIST={id:t.id,values:values,flag:JSON.parse(original).packingDeleted};generatorDeletionToast();RAW[t.id]=trip;rebuild();if(PACK[t.id]){PACK[t.id].sections={};PACK[t.id].items={};}return true;}).catch(function(e){generatorRestoreRaw(values);throw e;});
  }catch(e){try{generatorRestoreRaw(values);}catch(rollback){}return Promise.reject(e);}
}
function generatorRestoreList(){
  var saved=GEN_DELETED_LIST;if(!saved)return Promise.resolve();var prefix=(window.PACK_TEST_PREFIX||"")+"ta:",before={};
  try{var trip=JSON.parse(localStorage.getItem(prefix+"trips/"+saved.id));if(!trip)throw new Error("Trip missing");Object.keys(saved.values).forEach(function(key){before[key]=localStorage.getItem(key);});generatorRestoreRaw(saved.values);if(saved.flag===undefined)delete trip.packingDeleted;else trip.packingDeleted=saved.flag;
    return db.doc("trips/"+saved.id).set(trip).then(function(){Store.importAll(Object.keys(saved.values).reduce(function(o,key){o[key.slice(prefix.length)]=JSON.parse(saved.values[key]);return o;},{}));RAW[saved.id]=trip;rebuild();GEN_DELETED_LIST=null;}).catch(function(e){generatorRestoreRaw(before);throw e;});
  }catch(e){try{generatorRestoreRaw(before);}catch(rollback){}return Promise.reject(e);}
}
function generatorListRow(t){
  var row=el("div","packing-list-row"),front=el("div","panel packing-list-front"),a=el("a","tripcard"),error=el("p","gen-error"),opened=false,drag=null,suppressUntil=0;
  a.href="#"+t.id;a.draggable=false;a.appendChild(el("h3",null,t.name));a.appendChild(el("p","muted",[t.where,t.start?fmt(t.start)+" – "+fmt(t.end||t.start):"Dates needed"].filter(Boolean).join(" · ")));
  var remove=generatorButton("Delete",function(){if(remove.disabled)return;remove.disabled=true;generatorDeleteList(t).then(render).catch(function(){remove.disabled=false;error.textContent="Could not delete. Storage is full or blocked; try again.";});});remove.className="packing-list-delete";remove.setAttribute("aria-label","Delete packing list "+t.name);
  // Touch browsers can suppress the first compatibility click after a swipe.
  // Activate only a stationary tap begun on Delete; native clicks still cover mouse/keyboard.
  var deleteTap=null;
  remove.addEventListener("pointerdown",function(e){if(e.isPrimary && e.pointerType==="touch")deleteTap={id:e.pointerId,x:e.clientX,y:e.clientY};});
  remove.addEventListener("pointermove",function(e){if(deleteTap && (Math.abs(e.clientX-deleteTap.x)>10 || Math.abs(e.clientY-deleteTap.y)>10))deleteTap=null;});
  remove.addEventListener("pointercancel",function(){deleteTap=null;});
  remove.addEventListener("pointerup",function(e){var tap=deleteTap;deleteTap=null;if(!tap || tap.id!==e.pointerId || remove.disabled || Math.abs(e.clientX-tap.x)>10 || Math.abs(e.clientY-tap.y)>10)return;var bounds=remove.getBoundingClientRect();if(e.clientX>=bounds.left && e.clientX<=bounds.right && e.clientY>=bounds.top && e.clientY<=bounds.bottom){e.preventDefault();remove.click();}});
  var more=generatorButton("⋯",function(){reveal(!opened);});more.className="packing-list-actions";more.setAttribute("aria-label","List actions for "+t.name);
  function reveal(value){if(value && GEN_OPEN_ROW && GEN_OPEN_ROW!==reveal)GEN_OPEN_ROW(false);opened=value;GEN_OPEN_ROW=value?reveal:null;row.classList.toggle("revealed",value);front.style.transform="";remove.hidden=!value;more.setAttribute("aria-expanded",String(value));}
  reveal(false);front.appendChild(a);front.appendChild(more);row.appendChild(remove);row.appendChild(front);row.appendChild(error);
  front.addEventListener("pointerdown",function(e){if(!e.isPrimary || e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,offset:opened?-88:0,horizontal:false};});
  front.addEventListener("pointermove",function(e){if(!drag || drag.id!==e.pointerId)return;var dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(!drag.horizontal){if(Math.abs(dy)>12 && Math.abs(dy)>Math.abs(dx)){drag=null;return;}if(Math.abs(dx)<12 || Math.abs(dx)<Math.abs(dy)*1.2)return;drag.horizontal=true;front.setPointerCapture(e.pointerId);row.classList.add("dragging");}front.style.transform="translateX("+Math.max(-88,Math.min(0,drag.offset+dx))+"px)";});
  function end(e){if(!drag || drag.id!==e.pointerId)return;var d=drag;drag=null;row.classList.remove("dragging");if(d.horizontal){suppressUntil=Date.now()+400;reveal(e.type==="pointercancel"?opened:d.offset+e.clientX-d.x<-35);}}
  front.addEventListener("pointerup",end);front.addEventListener("pointercancel",end);front.addEventListener("click",function(e){if(Date.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}else if(opened && e.target.closest("a")){e.preventDefault();reveal(false);}},true);row.addEventListener("keydown",function(e){if(e.key==="Escape"){reveal(false);more.focus();}});return row;
}
