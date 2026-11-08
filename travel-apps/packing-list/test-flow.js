"use strict";
// Standalone app: run the production UI against isolated local data.
var PACK_TEST_MODE = new URLSearchParams(location.search).get("test") === "1";
var PACK_TEST_PREFIX = PACK_TEST_MODE ? "packing-test:" : "";
if(PACK_TEST_MODE)(function(){var get=lsGet,set=lsSet;lsGet=function(k,d){return get(PACK_TEST_PREFIX+k,d);};lsSet=function(k,v){set(PACK_TEST_PREFIX+k,v);};})();
var PACK_TEST_SCENARIOS=[
  {id:"professional",label:"Professional · 7 days",days:7,setup:{tripType:"work",work:"laptop",formal:3,dinners:3,workout:true,climate:"cool"},hint:"Confirm workdays, dinner outfits, suit rotation and shirt sharing. Change suit days and sharing; check white shirts, ties, khakis and one shared belt."},
  {id:"laundry",label:"Laundry + workouts · 14 days",days:14,setup:{workout:true,climate:"cool",laundry:"cycle",interval:4},hint:"Change laundry timing, then select Pack extra. Check the single buffer. Edit a quantity and recalculate to check that your override stays."},
  {id:"activities",label:"Warm weather + activities · 4 days",days:4,setup:{water:true,hike:true,climate:"hot",dinners:2},hint:"Choose dinner clothes, toggle rugged hiking and the daypack, then change to cold weather. Check that dependent items appear and disappear."}
];
PACK_TEST_SCENARIOS.push(
  {id:"one-day",base:"professional",label:"One-day professional",days:1,setup:{tripType:"work",work:"laptop",workDays:1,formal:1,dinners:1,climate:"mild"},hint:"Check same-day sharing and a one-shirt, one-tie rotation."},
  {id:"long-trip",base:"laundry",label:"Long trip · 30 days",days:30,setup:{workout:true,climate:"cool",laundry:"cycle",firstWash:3,interval:5},hint:"Test long-trip clothing caps, different first-wash timing and frequent workouts."},
  {id:"uncertain",base:"activities",label:"Uncertain weather · 10 days",days:10,setup:{hike:true,climate:"unknown",dinners:2},hint:"Confirm weather later and test how activities, layers and dinner outfits change."}
);
function packingTestLibrary(){return lsGet("test-scenario-library",[]);}
function packingTestOptions(){return PACK_TEST_SCENARIOS.concat(packingTestLibrary());}
function packingTestScenario(){return lsGet("test-scenario-config",null) || packingTestOptions().find(function(x){return x.id===lsGet("test-scenario","professional");}) || PACK_TEST_SCENARIOS[0];}
function packingTestState(t,scenario){
  var state=scenario.state ? refineNormalizeState(clone(scenario.state)) : refineNewState(t,scenario.setup),s=scenario.setup;
  state.inputs.where=t.where;state.inputs.start=t.start;state.inputs.end=t.end;
  if(scenario.state){state.inputs.bag=s.bag || state.inputs.bag;["workout","hike","water"].forEach(function(k){state.inputs.activities[k]=!!s[k];});state.refinements.formalDays=s.formal || 0;state.refinements.dinners=s.dinners || 0;state.refinements.workDays=s.workDays;state.refinements.work=s.work || "none";state.refinements.climate=s.climate || "unknown";state.refinements.daypack=!!s.daypack;}
  state.refinements.laundry={available:s.laundry==="cycle",firstWash:s.firstWash || s.interval || 4,interval:s.interval || 4};
  delete state.undo;delete state.undoProfile;state.ruleResults={};state.ruleKeys={};state.baseline=null;return state;
}
function packingTestCapture(includeManual){
  var t=TRIPS["PACKING-TEST"];if(!t)return null;var state=refineSnapshot(refineLoad(t)),r=state.refinements,s=clone(packingTestScenario());
  delete state.ruleResults;delete state.ruleKeys;delete state.baseline;delete state.updatedAt;
  s.days=refineDays(state.inputs.start,state.inputs.end);s.label=t.name.replace(/^Test · /,"");s.state=state;
  if(!includeManual)state.overrides={removed:{},edited:{},added:{}};
  s.setup=Object.assign({},s.setup,{tripType:state.inputs.tripType,bag:state.inputs.bag,work:r.work,workDays:r.workDays,formal:r.formalDays,dinners:r.dinners,climate:r.climate,daypack:r.daypack,laundry:r.laundry.available ? "cycle":"none",firstWash:r.laundry.firstWash,interval:r.laundry.interval});
  ["workout","hike","water"].forEach(function(k){s.setup[k]=!!state.inputs.activities[k];});return s;
}
function packingTestValidate(){
  var t=TRIPS["PACKING-TEST"],rows=[];if(!t)return rows;
  var state=refineLoad(t),profile=generatorPrefs(),cached=state.legacy ? refineLegacyResult(state):refineEvaluate(clone(state),profile,[]),freshState=clone(state);freshState.ruleResults={};freshState.ruleKeys={};var fresh=state.legacy ? cached:refineEvaluate(freshState,profile,null);
  function row(name,expected,actual,status){rows.push({name:name,expected:String(expected),actual:String(actual),status:status || (expected===actual ? "PASS":"FAIL")});}
  row("Trip dates match saved assumptions",t.start+" / "+t.end,state.inputs.start+" / "+state.inputs.end);
  if(state.legacy){row("Legacy list","Pinned list","Preserved","REVIEW");return rows;}
  var auto=clone(state);auto.overrides={removed:{},edited:{},added:{}};auto.ruleResults={};auto.ruleKeys={};var recommended=refineEvaluate(auto,profile,null),ids={};recommended.items.concat(cached.items).forEach(function(x){ids[x.id]=true;});
  Object.keys(ids).forEach(function(id){var item=cached.items.find(function(x){return x.id===id;}),expected=fresh.items.find(function(x){return x.id===id;}),rec=recommended.items.find(function(x){return x.id===id;});
    if(state.overrides.edited[id] || state.overrides.added[id] || state.overrides.removed[id])row((item || rec || expected).label,rec ? rec.quantity:"not generated",item ? item.quantity:"removed","OVERRIDE");
    else row((item || expected || rec).label,expected ? expected.quantity:0,item ? item.quantity:0);
  });
  // Independent clothing formulas check the selected duration/laundry, not a preset fixture.
  var days=refineDays(state.inputs.start,state.inputs.end),r=state.refinements,l=r.laundry,first=Math.min(days,l.firstWash),gap=Math.max(first,Math.min(Math.max(0,days-first),l.interval)),coverage=l.available ? Math.min(days,gap+1):days,extra=r.packingMode==="extra" && !(l.available && coverage>gap) ? 1:0;
  [["tshirts",coverage-1+extra],["socks",2*coverage-1+2*extra],["underwear",2*coverage-1+2*extra]].forEach(function(x){var id="pack:"+x[0],actual=recommended.items.find(function(item){return item.id===id;});row("Formula: "+x[0]+" over "+days+" days",x[1],actual ? actual.quantity:0,profile.refinementProfile && profile.refinementProfile.excluded[id] ? "OVERRIDE":null);});
  var pending=refinePendingDecisions(state);row("Outfit confirmation",pending.length ? pending.join(", "):"Confirmed",pending.length ? "Needs confirmation":"Confirmed",pending.length ? "REVIEW":"PASS");
  fresh.warnings.filter(function(x){return !x.decision;}).forEach(function(x){row(x.text,"Check coverage","Needs review","REVIEW");});return rows;
}
function packingTestValidationSheet(){
  if(!PACK_TEST_MODE)return;var body=openSheet("Validate current test"),rows=packingTestValidate();
  body.appendChild(el("p","gen-note","Checks your saved test against a fresh rule run and independent clothing formulas. Manual edits are shown separately; warnings and unconfirmed assumptions need your review."));
  if(!rows.length){body.appendChild(el("p",null,"Load a scenario first."));return;}
  var failed=rows.filter(function(x){return x.status==="FAIL";}).length,review=rows.filter(function(x){return x.status==="REVIEW";}).length;
  body.appendChild(el("p","gen-step",failed+" failures · "+review+" to review · "+rows.filter(function(x){return x.status==="OVERRIDE";}).length+" manual overrides"));
  rows.forEach(function(x){var p=el("p",null,x.status+" · "+x.name+" — expected "+x.expected+"; actual "+x.actual);p.dataset.currentCheck=x.status;body.appendChild(p);});
}
function packingTestRecord(scenario){var start=isoToday(),date=pd(start);return {id:"PACKING-TEST",name:"Test · "+scenario.label,where:scenario.state ? scenario.state.inputs.where:"Sample destination",start:start,end:isoOf(new Date(date.getFullYear(),date.getMonth(),date.getDate()+scenario.days-1)),status:"Researching",bookings:{},days:[],createdAt:Date.now()};}
function packingTestStart(scenario,setup){
  var error=document.getElementById("pt-error");
  try{
    if(!PACK_TEST_MODE)throw new Error("Open test mode first.");
    var live=localStorage.getItem("ta:meta/packing"),prefs=live ? JSON.parse(live):PACK_PREFS;
    var keys=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k && k.indexOf(PACK_TEST_PREFIX+"ta:")===0)keys.push(k);}
    // Reset only this sandbox, including its exports and overrides.
    keys.forEach(function(k){localStorage.removeItem(k);});
    localStorage.setItem(PACK_TEST_PREFIX+"ta:meta/packing",JSON.stringify(prefs));lsSet("test-scenario",scenario.id);lsSet("test-scenario-config",scenario);lsSet("test-initial-setup",!!setup);
    var t=packingTestRecord(scenario);
    var state=packingTestState(t,scenario);var result=refineEvaluate(state,prefs,null);
    return db.doc("trips/"+t.id).set(t).then(function(){return refinePersist(t,state,result);}).then(function(){
      // Reload drops subscriptions/caches from the preceding scenario.
      location.replace("?test=1#"+t.id+(setup ? ".edit":""));location.reload();
    }).catch(function(){if(error)error.textContent="Could not save the test. Check browser storage and try again.";});
  }catch(e){if(error)error.textContent="Could not reset the test. Check browser storage and try again.";return Promise.resolve();}
}
function packingTestMenu(){
  var body=openSheet("Test flow");body.appendChild(el("p","muted","Configure reusable test scenarios. Preview quantities, save named variants, then start setup or jump to the generated list. Real trips and preferences stay separate."));
  if(!PACK_TEST_MODE){body.appendChild(generatorLink("Open test flow","?test=1",true));return;}
  var options=packingTestOptions(),active=options.find(function(x){return x.id===lsGet("test-menu-selection","");}) || packingTestScenario(),select=sel("pt-scenario",options.map(function(x){return [x.id,x.label];}),active.id),hint=el("p","gen-note"),error=el("p","gen-error"),preview=el("div","panel test-preview"),config=clone(active),fields={},form=el("div","test-fields"),name=inp("pt-name","text",active.label);
  body.classList.add("test-editor");body.parentNode.classList.add("test-sheet");error.id="pt-error";error.setAttribute("role","status");preview.setAttribute("aria-live","polite");body.appendChild(fieldEl("Sample or saved scenario",select));body.appendChild(fieldEl("Scenario name",name));if(TRIPS["PACKING-TEST"])body.appendChild(el("p","gen-note","Active test: "+TRIPS["PACKING-TEST"].name+". Setup settings below are separate from the refined test."));body.appendChild(hint);
  function number(key,label,max){var input=inp("pt-"+key,"number",0);input.min=key==="days" || key==="interval" || key==="firstWash" ? "1":"0";input.max=String(max);input.style.fontSize="16px";fields[key]=input;form.appendChild(fieldEl(label,input));input.addEventListener("input",drawPreview);return input;}
  number("days","Trip length (days)",60);number("workDays","Video-call workdays",60);number("formal","Full suit days",60);number("dinners","Nice dinners",60);
  var climate=sel("pt-climate",[["unknown","Uncertain weather"],["hot","Hot"],["mild","Mild"],["cool","Cool"],["cold","Cold"]],"cool");form.appendChild(fieldEl("Coldest outdoor conditions",climate));climate.addEventListener("change",drawPreview);
  var checks={};[["workout","Workouts most days"],["hike","Hiking"],["water","Swimming"],["daypack","Daypack"],["laundry","Laundry available"],["carryon","Carry-on only"]].forEach(function(x){var label=el("label","chipchk"),c=el("input");c.type="checkbox";c.id="pt-"+x[0];checks[x[0]]=c;label.appendChild(c);label.appendChild(el("span",null,x[1]));form.appendChild(label);c.addEventListener("change",drawPreview);});
  number("firstWash","First wash day",60);number("interval","Wash interval (days)",60);
  function bounded(key){return +fields[key].value;}
  function valid(){var days=+fields.days.value;Object.keys(fields).forEach(function(key){fields[key].setCustomValidity("");});var bad=Object.keys(fields).find(function(key){var input=fields[key];if((key==="firstWash" || key==="interval") && !checks.laundry.checked)return false;var max=key==="days" ? 60:days,value=+input.value;input.max=String(max);return !input.value || !Number.isInteger(value) || value<+input.min || value>max;});if(bad){var input=fields[bad];error.textContent="Enter a whole number from "+input.min+" to "+input.max+" for "+input.previousElementSibling.textContent+".";input.setAttribute("aria-invalid","true");return false;}Object.keys(fields).forEach(function(k){fields[k].removeAttribute("aria-invalid");});error.textContent="";return true;}
  function current(){var s=clone(config),days=bounded("days");s.label=name.value.trim() || "My scenario";s.days=days;s.setup=Object.assign({},s.setup,{formal:bounded("formal",0,days),dinners:bounded("dinners",0,days),workDays:bounded("workDays",0,days),climate:climate.value,laundry:checks.laundry.checked ? "cycle":"none",interval:bounded("interval",1,days),firstWash:bounded("firstWash",1,days),bag:checks.carryon.checked ? "carryon":"checked"});["workout","hike","water","daypack"].forEach(function(key){s.setup[key]=checks[key].checked;});if(s.setup.workDays>0 && !s.state && (!s.setup.work || s.setup.work==="none"))s.setup.work="laptop";return s;}
  function makeState(s,t){return packingTestState(t,s);}
  function drawPreview(){if(!valid()){preview.textContent="Enter valid settings to preview quantities.";return;}var s=current();["formal","dinners","workDays","firstWash","interval"].forEach(function(key){fields[key].max=String(s.days);});fields.firstWash.parentNode.hidden=fields.interval.parentNode.hidden=!checks.laundry.checked;preview.textContent="";preview.appendChild(el("h3",null,"Quantity preview"));preview.appendChild(el("p","gen-note",s.state ? "Saved outfit assumptions and optional manual edits are included.":"Provisional dinner sharing; confirm outfits in the flow."));
    try{var t=packingTestRecord(s),state=makeState(s,t);if(!s.state)state.refinements.dinnerTop="buttonup";if(!s.state)state.refinements.dinnerBottoms=s.setup.climate==="hot" || s.setup.climate==="mild" ? "shorts":"khakis";var result=refineEvaluate(state,generatorPrefs(),null);["tshirts","socks","lulu-shorts","button-up-long-sleeve-shirt","white-shirt","tie","khakis"].forEach(function(id){var item=result.items.find(function(x){return x.id==="pack:"+id;});if(item)preview.appendChild(el("p",null,refineLabel(item)));});}catch(e){preview.appendChild(el("p","gen-error","Enter valid settings to preview."));}}
  function fill(s){config=clone(s);name.value=s.label;fields.days.value=s.days;fields.workDays.value=s.setup.workDays==null ? (s.setup.work && s.setup.work!=="none" ? s.days:0):s.setup.workDays;fields.formal.value=s.setup.formal || 0;fields.dinners.value=s.setup.dinners || 0;fields.firstWash.value=s.setup.firstWash || s.setup.interval || 4;fields.interval.value=s.setup.interval || 4;climate.value=s.setup.climate || "unknown";["workout","hike","water","daypack"].forEach(function(key){checks[key].checked=!!s.setup[key];});checks.laundry.checked=s.setup.laundry==="cycle";checks.carryon.checked=s.setup.bag!=="checked";hint.textContent=s.hint;drawPreview();}
  select.addEventListener("change",function(){lsSet("test-menu-selection",select.value);fill(options.find(function(x){return x.id===select.value;}));});body.appendChild(preview);body.appendChild(form);
  var actions=el("div","gen-actions"),tools=el("div","gen-actions");
  function start(setup){if(!valid()){fields[Object.keys(fields).find(function(k){return fields[k].getAttribute("aria-invalid");})].focus();return;}var s=current();return packingTestStart(s,setup);}
  actions.appendChild(generatorButton("Reset & test setup",function(){start(true);},true));actions.appendChild(generatorButton("Reset & generate list",function(){start(false);}));
  function saveScenario(copy,source){if(!source && !valid())return;var s=source || current(),library=packingTestLibrary();s.base=s.base || s.id;if(copy || s.id.indexOf("custom-")!==0)s.id="custom-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,6);var label=s.label,n=1;while(PACK_TEST_SCENARIOS.concat(library).some(function(x){return x.label===s.label && x.id!==s.id;})){s.label=label+" (Copy"+(n===1 ? "":" "+n)+")";n++;}var index=library.findIndex(function(x){return x.id===s.id;});if(index<0)library.push(s);else library[index]=s;try{localStorage.setItem(PACK_TEST_PREFIX+"test-scenario-library",JSON.stringify(library));options=PACK_TEST_SCENARIOS.concat(library);var option=Array.from(select.options).find(function(x){return x.value===s.id;});if(!option){option=el("option");option.value=s.id;select.appendChild(option);}option.textContent=s.label;select.value=s.id;fill(s);lsSet("test-menu-selection",s.id);error.textContent="Scenario saved. Resetting the test keeps your named scenarios.";}catch(e){error.textContent="Could not save this scenario.";}}
  tools.appendChild(generatorButton("Save setup configuration",function(){saveScenario(false);}));tools.appendChild(generatorButton("Save as another scenario",function(){saveScenario(true);}));
  if(TRIPS["PACKING-TEST"]){var manual=inp("pt-includeManual","checkbox",null);manual.checked=true;body.appendChild(fieldEl("Include manual edits when saving current test",manual));body.appendChild(generatorButton("Save current test as variant",function(){var captured=packingTestCapture(manual.checked);captured.label=name.value.trim() || captured.label;saveScenario(true,captured);}));var resume=generatorLink("Resume current test","#PACKING-TEST");resume.addEventListener("click",closeSheet);tools.appendChild(resume);}tools.appendChild(generatorButton("Run fixed regression checks",function(){packingTestCheckSheet(PACK_TEST_SCENARIOS.slice(0,3));}));body.appendChild(tools);actions.classList.add("test-actions");body.appendChild(error);body.appendChild(actions);body.appendChild(generatorLink("Exit test mode","./"));fill(active);
}
function packingTestBanner(){
  var panel=el("section","panel"),actions=el("div","gen-actions");panel.appendChild(el("h2","k","Test mode"));panel.appendChild(el("p","muted","Changes are saved only in your test sandbox."));panel.appendChild(el("p","gen-note",packingTestScenario().hint));var picker=sel("pt-quickScenario",packingTestOptions().map(function(x){return [x.id,x.label];}),packingTestScenario().id);picker.addEventListener("change",function(){lsSet("test-menu-selection",picker.value);packingTestMenu();});panel.appendChild(fieldEl("Switch scenario",picker));actions.appendChild(generatorButton("Test menu / reset",packingTestMenu));actions.appendChild(generatorButton("Validate current test",packingTestValidationSheet));actions.appendChild(generatorLink("Exit test mode","./"));panel.appendChild(actions);return panel;
}
function packingTestHome(){
  var w=el("div","stack"),panel=el("section","panel");w.appendChild(packingTestBanner());panel.appendChild(generatorButton("Choose a test scenario",packingTestMenu,true));if(TRIPS["PACKING-TEST"])panel.appendChild(generatorLink("Resume current test","#PACKING-TEST"));w.appendChild(panel);return w;
}
// Standalone app: fixed regression cases run in memory without changing the saved sandbox.
function packingTestFixture(scenario){var found=PACK_TEST_SCENARIOS.find(function(x){return x.id===(scenario.base || scenario.id);}) || PACK_TEST_SCENARIOS[0];return found.base ? PACK_TEST_SCENARIOS.find(function(x){return x.id===found.base;}):found;}
function packingTestChecks(scenario){
  scenario=packingTestFixture(scenario);
  var t={id:"CHECK",name:"Scenario check",where:"Sample",start:"2026-10-01",end:"2026-10-"+String(scenario.days).padStart(2,"0")},state=refineNewState(t,scenario.setup),rows=[],result;
  function expect(name,expected,actual){rows.push({name:name,expected:String(expected),actual:String(actual),pass:expected===actual});}
  function run(){result=refineEvaluate(state,PACK_PREFS,[]);state.ruleResults=result.ruleResults;state.ruleKeys=result.ruleKeys;return result;}
  function quantity(id){var item=result.items.find(function(x){return x.id==="pack:"+id;});return item ? item.quantity:0;}
  function count(name,id,expected){expect(name,expected,quantity(id));}
  try{
    if(scenario.id==="professional"){
      state.refinements.workDays=5;state.refinements.dinnerTop="buttonup";state.refinements.dinnerBottoms="khakis";run();
      count("5 video days + 3 same-day dinners share 5 button-ups","button-up-long-sleeve-shirt",5);count("3 suit days need 3 white shirts","white-shirt",3);count("Multiple suit days rotate 2 ties","tie",2);count("Suit/dinner khakis share 2 pairs","khakis",2);count("Suit and dinner share one belt","belt",1);
      state.refinements.shareSuitShirts=true;state.refinements.suitOverlap=2;run();count("Compatible shirts with 2 shared suit days need 6 shirts","white-shirt",6);count("Compatible shirts replace the separate button-up pool","button-up-long-sleeve-shirt",0);
      state.refinements.shareSuitShirts=false;state.refinements.formalDays=1;run();count("One suit day reduces rotation to one tie","tie",1);count("One suit day needs one white shirt","white-shirt",1);
    }else if(scenario.id==="laundry"){
      run();count("14 days, wash every 4 days: 4 packed T-shirts","tshirts",4);count("Laundry plus spare day: 9 packed socks","socks",9);count("Workouts have 3 pairs of shorts for 5 clothing days","lulu-shorts",3);
      state.refinements.packingMode="extra";run();count("Pack extra does not stack another laundry buffer","socks",9);count("Pack extra keeps the shared T-shirt buffer","tshirts",4);
      state.refinements.laundry.firstWash=2;state.refinements.laundry.interval=2;run();count("Wash every 2 days recalculates socks to 5","socks",5);count("Wash every 2 days recalculates T-shirts to 2","tshirts",2);
    }else{
      state.refinements.dinnerTop="polo";state.refinements.dinnerBottoms="shorts";run();count("2 dinners need 2 polos","polo-shirts",2);count("Ordinary hiking does not add hiking footwear","hiking-footwear",0);count("Hiking does not automatically add a daypack","daypack",0);
      state.refinements.ruggedHike=true;state.refinements.daypack=true;run();count("Rugged hiking adds footwear","hiking-footwear",1);count("Selected daypack is included","daypack",1);
      state.inputs.activities.hike=false;state.refinements.daypack=false;run();count("Turning hiking off removes its footwear","hiking-footwear",0);count("Turning daypack off removes it","daypack",0);
      state.refinements.climate="cold";run();expect("Cold weather adds a puffer",true,result.items.some(function(x){return /puffer/i.test(x.label);}));
    }
    var original=result.items.find(function(x){return x.id==="pack:tshirts";});state.overrides.edited[original.id]=Object.assign({},original,{quantity:9});state.refinements.packingMode=state.refinements.packingMode==="extra" ? "standard":"extra";run();count("Manual T-shirt quantity survives recalculation","tshirts",9);
    expect("Manual quantity is visibly marked",true,result.items.find(function(x){return x.id===original.id;}).manual===true);
    var pending=refinePendingDecisions(state);if(state.refinements.formalDays || state.refinements.dinners || state.refinements.work!=="none")expect("Unconfirmed outfit decisions block export",true,pending.length>0);pending.forEach(function(step){state.decisionReviews[step]=refineDecisionKey(state,step);});expect("Confirmed outfit decisions permit export",0,refinePendingDecisions(state).length);
    var data={title:"Scenario check",detail:"",groups:result.groups.map(function(g){return {title:g.title,items:g.items.map(function(x){return {label:refineLabel(x),checked:false};})};})},xml=packExportEnex(data),total=data.groups.reduce(function(n,g){return n+g.items.length;},0);
    expect("Notes export has a checkbox for every item",total,(xml.match(/<en-todo /g) || []).length);expect("Notes export preserves every section heading",data.groups.length,(xml.match(/<h2>/g) || []).length);expect("Notes export does not duplicate the title",false,xml.indexOf("<h1>")>=0);
  }catch(e){rows.push({name:"Scenario checks completed",expected:"No error",actual:e.message,pass:false});}
  return rows;
}
function packingTestCheckSheet(scenarios){
  if(!PACK_TEST_MODE)return;
  var body=openSheet("Scenario checks"),summary=el("p","muted");body.appendChild(summary);body.appendChild(el("p","gen-note","These fixed sample cases check the engine and Notes format in memory. They do not change your saved test. Expected and actual values are shown below."));
  var all=[];scenarios.forEach(function(scenario){var base=packingTestFixture(scenario);body.appendChild(el("h3",null,"Fixed checks: "+base.label));var rows=packingTestChecks(scenario);all=all.concat(rows);rows.forEach(function(row){var p=el("p",null,(row.pass ? "PASS · ":"FAIL · ")+row.name+" — expected "+row.expected+"; actual "+row.actual);p.dataset.testCheck=row.pass ? "pass":"fail";body.appendChild(p);});});
  summary.textContent=all.filter(function(x){return x.pass;}).length+" / "+all.length+" checks passed";summary.setAttribute("role","status");
  var t=TRIPS["PACKING-TEST"];if(t){var pending=refinePendingDecisions(refineLoad(t));body.appendChild(el("h3",null,"Your saved test"));body.appendChild(el("p",null,pending.length ? "Before export, confirm: "+pending.join(" → "):"Outfit decisions confirmed; ready for export review."));}
}
