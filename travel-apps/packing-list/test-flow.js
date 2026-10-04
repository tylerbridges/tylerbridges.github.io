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
function packingTestScenario(){return PACK_TEST_SCENARIOS.find(function(x){return x.id===lsGet("test-scenario","professional");}) || PACK_TEST_SCENARIOS[0];}
function packingTestStart(scenario,setup){
  var error=document.getElementById("pt-error");
  try{
    if(!PACK_TEST_MODE)throw new Error("Open test mode first.");
    var live=localStorage.getItem("ta:meta/packing"),prefs=live ? JSON.parse(live):PACK_PREFS;
    var keys=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k && k.indexOf(PACK_TEST_PREFIX)===0)keys.push(k);}
    // Reset only this sandbox, including its exports and overrides.
    keys.forEach(function(k){localStorage.removeItem(k);});
    localStorage.setItem(PACK_TEST_PREFIX+"ta:meta/packing",JSON.stringify(prefs));lsSet("test-scenario",scenario.id);
    var start=isoToday(),date=pd(start),end=isoOf(new Date(date.getFullYear(),date.getMonth(),date.getDate()+scenario.days-1));
    var t={id:"PACKING-TEST",name:"Test · "+scenario.label,where:"Sample destination",start:start,end:end,status:"Researching",bookings:{},days:[],createdAt:Date.now()};
    var state=refineNewState(t,scenario.setup),result=refineEvaluate(state,prefs,null);
    return db.doc("trips/"+t.id).set(t).then(function(){return refinePersist(t,state,result);}).then(function(){
      // Reload drops subscriptions/caches from the preceding scenario.
      location.replace("?test=1#"+t.id+(setup ? ".edit":""));location.reload();
    }).catch(function(){if(error)error.textContent="Could not save the test. Check browser storage and try again.";});
  }catch(e){if(error)error.textContent="Could not reset the test. Check browser storage and try again.";return Promise.resolve();}
}
function packingTestMenu(){
  var body=openSheet("Test flow");body.appendChild(el("p","muted","Reusable sandbox using the same setup, rules, refinements and Notes export. Real trips and preferences stay separate. Reset copies your current preferences."));
  if(!PACK_TEST_MODE){body.appendChild(generatorLink("Open test flow","?test=1",true));return;}
  var select=sel("pt-scenario",PACK_TEST_SCENARIOS.map(function(x){return [x.id,x.label];}),packingTestScenario().id),hint=el("p","gen-note"),error=el("p","gen-error");error.id="pt-error";error.setAttribute("role","status");
  function selected(){return PACK_TEST_SCENARIOS.find(function(x){return x.id===select.value;});}function describe(){hint.textContent=selected().hint;}select.addEventListener("change",describe);describe();
  body.appendChild(fieldEl("Sample scenario",select));body.appendChild(hint);
  var actions=el("div","gen-actions");actions.appendChild(generatorButton("Reset & test setup",function(){packingTestStart(selected(),true);},true));actions.appendChild(generatorButton("Reset & generate list",function(){packingTestStart(selected(),false);}));
  if(TRIPS["PACKING-TEST"]){var resume=generatorLink("Resume current test","#PACKING-TEST");resume.addEventListener("click",closeSheet);actions.appendChild(resume);}body.appendChild(actions);body.appendChild(error);body.appendChild(generatorLink("Exit test mode","./"));
}
function packingTestBanner(){
  var panel=el("section","panel"),actions=el("div","gen-actions");panel.appendChild(el("h2","k","Test mode"));panel.appendChild(el("p","muted","Changes are saved only in your test sandbox."));panel.appendChild(el("p","gen-note",packingTestScenario().hint));actions.appendChild(generatorButton("Test menu / reset",packingTestMenu));actions.appendChild(generatorLink("Exit test mode","./"));panel.appendChild(actions);return panel;
}
function packingTestHome(){
  var w=el("div","stack"),panel=el("section","panel");w.appendChild(packingTestBanner());panel.appendChild(generatorButton("Choose a test scenario",packingTestMenu,true));if(TRIPS["PACKING-TEST"])panel.appendChild(generatorLink("Resume current test","#PACKING-TEST"));w.appendChild(panel);return w;
}
