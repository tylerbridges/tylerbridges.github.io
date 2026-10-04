"use strict";
// Standalone app: explicit post-trip feedback, deterministic suggestions, no API or hidden default changes.
var PACK_LEARNING_PATH = "meta/packingLearning";
function packingLearningLoad(){
  var saved=lsGet("ta:"+PACK_LEARNING_PATH,null);
  return saved && saved.version===1 && saved.trips ? saved : {version:1,trips:{}};
}
// Preparation choices are automatic evidence of edits, never evidence of actual use in Notes.
function packingLearningObserve(t,state,result){
  var ledger=packingLearningLoad();if(state.legacy || ledger.observeEdits===false || (ledger.ignoredEditTrips || {})[t.id])return Promise.resolve();
  var automatic=clone(state);automatic.overrides={removed:{},edited:{},added:{}};
  var baseline=refineEvaluate(automatic,generatorPrefs(),[]),items={},added={};
  baseline.items.forEach(function(item){var edited=state.overrides.edited[item.id],change=state.overrides.removed[item.id] ? "removed":edited && (edited.label!==item.label || edited.quantity!==item.quantity || edited.section!==item.section) ? JSON.stringify([edited.label,edited.quantity,edited.section]):"kept";
    items[item.id]={id:item.id,label:item.label,context:packingLearningContext(state,item),safe:packingLearningSafe(item),change:change};
  });
  result.items.filter(function(item){return state.overrides.added[item.id] && !item.legacy;}).forEach(function(item){var id=refineId(item.label);added[id]={label:item.label,quantity:item.quantity,section:item.section};});
  ledger.editTrips=ledger.editTrips || {};ledger.editTrips[t.id]={name:t.name || t.where,end:state.inputs.end,items:items,added:added,context:packingLearningContext(state,{rule:"added item"}),assumptions:{inputs:clone(state.inputs),refinements:clone(state.refinements)},at:Date.now()};
  return db.doc(PACK_LEARNING_PATH).set(ledger);
}
function packingLearningEditRecommendations(ledger,profile){
  var buckets={},all={},excluded=profile.refinementProfile && profile.refinementProfile.excluded || {};
  Object.keys(ledger.editTrips || {}).forEach(function(tripId){var trip=ledger.editTrips[tripId];Object.keys(trip.items).forEach(function(id){var item=trip.items[id],key=JSON.stringify([id,item.context]),row={tripId:tripId,name:trip.name,end:trip.end,at:trip.at,item:item};(buckets[key] || (buckets[key]=[])).push(row);(all[id] || (all[id]=[])).push(row);});});
  var suggestions=[];
  Object.keys(buckets).forEach(function(key){var evidence=buckets[key].sort(function(a,b){return String(b.end).localeCompare(String(a.end)) || b.at-a.at || a.tripId.localeCompare(b.tripId);}).slice(0,5);if(evidence.length<5)return;var patterns={};evidence.forEach(function(row){if(row.item.change!=="kept")(patterns[row.item.change] || (patterns[row.item.change]=[])).push(row);});
    Object.keys(patterns).forEach(function(change){if(patterns[change].length<4)return;var item=evidence[0].item;if(change==="removed" && !evidence.every(function(row){return row.item.safe;}))return;
      var contrary=all[item.id].some(function(row){return row.item.context!==item.context && (row.item.change!=="removed" || !row.item.safe);}) || Object.values(ledger.trips).some(function(trip){return trip.reviewedAt && ["used","missing"].indexOf((trip.feedback || {})[item.id])>=0;}),kind=change==="removed" && !contrary ? "exclude":"review";
      if(kind==="exclude" && excluded[item.id])return;suggestions.push({key:"edit:"+key,id:item.id,label:item.label,kind:kind,change:change,count:patterns[change].length,total:evidence.length,evidence:evidence});
    });
  });
  var additions={};Object.keys(ledger.editTrips || {}).forEach(function(tripId){var trip=ledger.editTrips[tripId];Object.keys(trip.added || {}).forEach(function(id){var key=JSON.stringify([id,trip.context]),item=trip.added[id];(additions[key] || (additions[key]=[])).push({tripId:tripId,name:trip.name,item:item,context:trip.context});});});
  Object.keys(additions).forEach(function(key){var rows=additions[key],context=rows[0].context,opportunities=Object.values(ledger.editTrips).filter(function(trip){return trip.context===context;}).sort(function(a,b){return String(b.end).localeCompare(String(a.end)) || b.at-a.at;}).slice(0,5),recent=rows.filter(function(row){return opportunities.some(function(trip){return ledger.editTrips[row.tripId]===trip;});});if(opportunities.length===5 && recent.length>=3)suggestions.push({key:"add:"+key,label:recent[0].item.label,kind:"addition",count:recent.length,total:5,evidence:recent});});
  return suggestions;
}
function packingLearningApplyEdit(key){
  var ledger=packingLearningLoad(),profile=generatorPrefs(),suggestion=packingLearningEditRecommendations(ledger,profile).find(function(x){return x.key===key && x.kind==="exclude";});
  if(!suggestion)return Promise.reject(new Error("This edit pattern no longer supports a default change."));
  var sample=ledger.editTrips[suggestion.evidence[0].tripId],state=refineNewState({where:"",start:sample.assumptions.inputs.start,end:sample.assumptions.inputs.end});state.inputs=clone(sample.assumptions.inputs);state.refinements=clone(sample.assumptions.refinements);
  var item=refineEvaluate(state,profile,[]).items.find(function(x){return x.id===suggestion.id;});if(!item || !packingLearningSafe(item))return Promise.reject(new Error("Current rules protect this item or it is no longer automatic."));
  return db.doc("meta/packing").set(refineExclude(profile,item));
}
function packingLearningContext(state,item){
  var i=state.inputs,r=state.refinements;
  // Compare opportunities under like trip assumptions; dates and destination are not identity.
  var days=refineDays(i.start,i.end),activities=Object.keys(i.activities || {}).filter(function(key){return i.activities[key];}).sort();
  return JSON.stringify([item.rule || "manual",i.tripType,i.bag,i.mode,i.intl,days<=4 ? "short":days<=10 ? "week":"long",r.climate,r.rain,activities,r.work,r.formalDays>0,r.dinners>0,r.laundry.available,r.longFlight]);
}
function packingLearningSafe(item){
  // Clothing quantities and selected/required equipment need assumption changes, never blanket exclusions.
  return item.rule==="defaults" && !item.manual && !item.legacy && !item.critical && !item.required &&
    item.category!=="clothing" && item.section!=="Wear to travel" && item.id!=="pack:snacks";
}
function packingLearningSnapshot(t,state,result){
  var items={};(result.items || []).forEach(function(item){
    if(item.section==="Before leaving")return;
    items[item.id]={id:item.id,label:item.label,quantity:item.quantity,context:packingLearningContext(state,item),safe:packingLearningSafe(item),manual:!!item.manual,critical:!!item.critical,required:!!item.required};
  });
  return {name:t.name || t.where || t.id,end:t.end || state.inputs.end,items:items,feedback:{},context:packingLearningContext(state,{rule:"reported missing item"}),
    assumptions:{inputs:clone(state.inputs),refinements:clone(state.refinements)},capturedAt:Date.now()};
}
function packingLearningCapture(t,state,result){
  if(state.legacy)return Promise.resolve();
  var ledger=packingLearningLoad(),existing=ledger.trips[t.id];
  // A completed review keeps its actual opportunity snapshot, even if the trip is generated again later.
  if(existing && existing.reviewedAt)return Promise.resolve();
  ledger.trips[t.id]=packingLearningSnapshot(t,state,result);
  return db.doc(PACK_LEARNING_PATH).set(ledger);
}
function packingLearningReport(snapshot,exceptions,restUsed){
  var report=clone(snapshot),feedback={};
  Object.keys(report.items).forEach(function(id){if(restUsed && !report.items[id].reportedMissing)feedback[id]="used";});
  (exceptions || []).forEach(function(entry){
    if(["used","unneeded","missing"].indexOf(entry.status)<0)throw new Error("Choose a feedback result.");
    var id=entry.id,label=String(entry.label || "").trim();
    if(!id){
      if(!label || label.length>120)throw new Error("Enter a missing item name, up to 120 characters.");
      id="missing:"+refineId(label);
      report.items[id]={id:id,label:label,quantity:1,context:report.context || "reported missing item",safe:false,manual:true,reportedMissing:true,critical:false,required:false};
    }
    if(!report.items[id])throw new Error("Choose an item from this trip.");
    feedback[id]=entry.status;
  });
  if(!Object.keys(feedback).length)throw new Error("Add an exception or confirm the remaining items were used.");
  report.feedback=feedback;report.confirmedRemainingUsed=!!restUsed;report.reviewedAt=Date.now();return report;
}
function packingLearningSaveReport(t,state,result,exceptions,restUsed){
  if(state.legacy)return Promise.reject(new Error("Start automatic refinement before recording trip learning."));
  if((t.end || state.inputs.end)>=isoToday() && !window.PACK_TEST_MODE)return Promise.reject(new Error("Save actual feedback after the trip ends."));
  try{var ledger=packingLearningLoad(),snapshot=ledger.trips[t.id] || packingLearningSnapshot(t,state,result);
    ledger.trips[t.id]=packingLearningReport(snapshot,exceptions,restUsed);
    return db.doc(PACK_LEARNING_PATH).set(ledger);
  }catch(error){return Promise.reject(error);}
}
function packingLearningRecommendations(ledger,profile){
  var buckets={},byItem={},excluded=profile && profile.refinementProfile && profile.refinementProfile.excluded || {};
  Object.keys(ledger.trips).forEach(function(tripId){var trip=ledger.trips[tripId];if(!trip.reviewedAt)return;
    Object.keys(trip.feedback || {}).forEach(function(id){var item=trip.items[id],status=trip.feedback[id];
      if(!item || ["used","unneeded","missing"].indexOf(status)<0)return;
      var key=JSON.stringify([id,item.context]);if(!buckets[key])buckets[key]=[];
      var row={tripId:tripId,name:trip.name,end:trip.end,item:item,status:status};buckets[key].push(row);
      if(!byItem[id])byItem[id]=[];byItem[id].push(row);
    });
  });
  var suggestions=[];
  Object.keys(buckets).forEach(function(key){
    var evidence=buckets[key].sort(function(a,b){return String(b.end).localeCompare(String(a.end)) || a.tripId.localeCompare(b.tripId);}).slice(0,5);
    var unneeded=evidence.filter(function(x){return x.status==="unneeded";}).length,missing=evidence.filter(function(x){return x.status==="missing";}).length;
    if(evidence.length<5 || (unneeded<4 && missing<3))return;
    var item=evidence[0].item,safe=evidence.every(function(x){return x.item.safe && !x.item.manual && !x.item.required && !x.item.critical;});
    // A shared exclusion is unsuitable when other reviewed contexts show the item was useful or protected.
    var contrary=byItem[item.id].filter(function(row){return row.item.context!==item.context && (row.status!=="unneeded" || !row.item.safe);});
    if(contrary.length)safe=false;
    var kind=missing>=3 ? "missing":safe ? "exclude":"review";
    if(kind==="exclude" && excluded[item.id])return;
    suggestions.push({key:key,id:item.id,label:item.label,context:item.context,kind:kind,count:kind==="missing" ? missing:unneeded,total:evidence.length,evidence:evidence,contrary:contrary});
  });
  return suggestions;
}
function packingLearningApply(key){
  var ledger=packingLearningLoad(),profile=generatorPrefs(),suggestion=packingLearningRecommendations(ledger,profile).find(function(x){return x.key===key && x.kind==="exclude";});
  if(!suggestion)return Promise.reject(new Error("This suggestion is no longer eligible."));
  var sample=ledger.trips[suggestion.evidence[0].tripId],state={version:2,inputs:clone(sample.assumptions.inputs),refinements:clone(sample.assumptions.refinements),overrides:{removed:{},edited:{},added:{}},reviewed:{},decisionReviews:{},ruleResults:{}};
  var item=refineEvaluate(state,profile,[]).items.find(function(x){return x.id===suggestion.id;});
  if(!item || !packingLearningSafe(item))return Promise.reject(new Error("The current rules protect this item or it is no longer automatic. Review its assumptions instead."));
  return db.doc("meta/packing").set(refineExclude(profile,item));
}
function packingLearningReset(){return db.doc(PACK_LEARNING_PATH).set({version:1,trips:{},editTrips:{},observeEdits:false});}
function packingLearningForgetTrip(id){var ledger=packingLearningLoad();delete ledger.trips[id];if(ledger.editTrips)delete ledger.editTrips[id];ledger.ignoredEditTrips=ledger.ignoredEditTrips || {};ledger.ignoredEditTrips[id]=true;return db.doc(PACK_LEARNING_PATH).set(ledger);}
function packingLearningContextLabel(snapshot){var i=snapshot.assumptions.inputs,r=snapshot.assumptions.refinements,a=Object.keys(i.activities || {}).filter(function(k){return i.activities[k];});return r.climate+" weather · "+(i.bag==="carryon" ? "carry-on":"checked bag")+" · "+refineDays(i.start,i.end)+" days"+(a.length ? " · "+a.join(", "):"");}
function packingLearningFeedbackSheet(t,state,result){
  var body=openSheet("Learn from this trip");
  if(state.legacy){body.appendChild(el("p","gen-note","This imported list has no structured rule assumptions. Start automatic refinement before recording trip learning; your pinned items stay saved."));return;}
  var ledger=packingLearningLoad(),snapshot=ledger.trips[t.id] || packingLearningSnapshot(t,state,result),exceptions=[];
  body.appendChild(el("p","gen-note","After traveling, report only exceptions. Unreviewed items do not count as evidence. Saving this review never changes your packing defaults."));
  if(window.PACK_TEST_MODE)body.appendChild(el("p","gen-step","Test feedback stays in the sandbox."));
  if((t.end || state.inputs.end)>=isoToday() && !window.PACK_TEST_MODE){body.appendChild(el("p",null,"Actual feedback can be saved after this trip ends."));return;}
  Object.keys(snapshot.feedback || {}).forEach(function(id){if(snapshot.feedback[id]!=="used" || !snapshot.confirmedRemainingUsed)exceptions.push({id:id,status:snapshot.feedback[id]});});
  var f=el("form","form gen-form"),choices=[["","Choose an item"]].concat(Object.keys(snapshot.items).map(function(id){return [id,snapshot.items[id].label];}));choices.push(["__missing__","Something missing from the list"]);
  var select=sel("pl-item",choices,""),status=sel("pl-result",[["unneeded","Did not need / would leave behind"],["missing","Needed more / was missing"],["used","Used / needed"]],"unneeded"),label=inp("pl-missing","text",""),rows=el("div"),error=el("p","gen-error"),used=inp("pl-restUsed","checkbox",null);
  label.maxLength=120;select.style.fontSize=status.style.fontSize=label.style.fontSize="16px";
  f.appendChild(fieldEl("Item",select));f.appendChild(fieldEl("What happened?",status));var missingField=fieldEl("Missing item name",label);missingField.hidden=true;f.appendChild(missingField);
  select.addEventListener("change",function(){missingField.hidden=select.value!=="__missing__";if(!missingField.hidden)status.value="missing";});
  function draw(){rows.textContent="";exceptions.forEach(function(entry,index){var row=el("div","gen-actions"),item=snapshot.items[entry.id];row.appendChild(el("span",null,(item ? item.label:entry.label)+" · "+entry.status));row.appendChild(generatorButton("Remove feedback",function(){exceptions.splice(index,1);draw();}));rows.appendChild(row);});}
  f.appendChild(generatorButton("Add feedback",function(){var id=select.value;if(!id){error.textContent="Choose an item.";return;}var entry={id:id==="__missing__" ? null:id,label:label.value.trim(),status:id==="__missing__" ? "missing":status.value};
    if(!entry.id && (!entry.label || entry.label.length>120)){error.textContent="Enter the missing item name.";return;}
    exceptions=exceptions.filter(function(x){return entry.id ? x.id!==entry.id:x.label!==entry.label;});exceptions.push(entry);select.value="";label.value="";missingField.hidden=true;error.textContent="";draw();}));
  used.checked=!!snapshot.confirmedRemainingUsed;
  f.appendChild(rows);f.appendChild(fieldEl("I used or needed all remaining listed items",used,"Confirm only if you reviewed the rest of the list. Otherwise only your exceptions are saved."));
  var detail=el("details","panel");detail.appendChild(el("summary",null,"Review captured list · "+Object.keys(snapshot.items).length+" items"));Object.keys(snapshot.items).forEach(function(id){var item=snapshot.items[id];detail.appendChild(el("p",null,item.label+(item.quantity>1 ? " ×"+item.quantity:"")+((item.critical || item.required) ? " · protected by rules":"")));});f.appendChild(detail);
  var save=el("button","btn primary",snapshot.reviewedAt ? "Update trip feedback":"Save trip feedback");save.type="submit";f.appendChild(error);f.appendChild(save);body.appendChild(f);draw();
  f.addEventListener("submit",function(event){event.preventDefault();if(select.value){error.textContent="Add your selected feedback before saving.";return;}save.disabled=true;packingLearningSaveReport(t,state,result,exceptions,used.checked).then(function(){feedbackDraft.clear();packingLearningSheet();}).catch(function(e){save.disabled=false;error.textContent=e.message || "Could not save feedback.";});});
  var feedbackDraft=packingDraftAttach(f,"feedback:"+t.id,JSON.stringify([snapshot.reviewedAt || null,snapshot.items,snapshot.assumptions]),{saveClicks:true,capture:function(){return {exceptions:exceptions};},beforeRestore:function(data){if(data.custom)exceptions=clone(data.custom.exceptions);},onRestore:function(){missingField.hidden=select.value!=="__missing__";draw();}});
}
function packingLearningChoiceText(item){if(!item.change)return "added";if(item.change==="kept" || item.change==="removed")return item.change;try{var choice=JSON.parse(item.change);return "changed to "+choice[0]+(choice[1]>1 ? " ×"+choice[1]:"")+" · "+choice[2];}catch(e){return "adjusted manually";}}
function packingLearningEditPanel(body,ledger,profile){
  var error=el("p","gen-error");error.setAttribute("role","status");body.appendChild(error);
  body.appendChild(el("h3",null,"Automatic learning from edits"));body.appendChild(el("p","gen-note","Your saved edits are tracked locally, once per trip. Kept items are comparison opportunities, not proof of use. Patterns suggest changes; defaults only change when you approve. Notes edits are not visible here."));
  var suggestions=packingLearningEditRecommendations(ledger,profile);if(!suggestions.length)body.appendChild(el("p","muted","No recurring edit pattern yet. Suggestions need five comparable trips: the same change on four, or the same addition on three."));
  suggestions.forEach(function(s){var box=el("section","panel");box.appendChild(el("strong",null,s.label));box.appendChild(el("p",null,s.count+" of the last "+s.total+" comparable trip setups: "+(s.kind==="addition" ? "added manually":s.change==="removed" ? "removed before export":"same manual adjustment")));var evidence=el("details");evidence.appendChild(el("summary",null,"Inspect saved choices"));s.evidence.forEach(function(row){evidence.appendChild(el("p",null,row.name+" · "+packingLearningChoiceText(row.item)));});box.appendChild(evidence);
    if(s.kind==="exclude")box.appendChild(generatorButton("Review default change",function(){var confirm=openSheet("Change usual packing default?");confirm.appendChild(el("p",null,"Usually don’t pack "+s.label+"? This changes future automatic lists. Required items remain protected; reset this in Defaults & exclusions."));var error=el("p","gen-error"),apply=generatorButton("Apply default exclusion",function(){apply.disabled=true;packingLearningApplyEdit(s.key).then(function(){packingLearningSheet();render();}).catch(function(e){apply.disabled=false;error.textContent=e.message;});},true);confirm.appendChild(apply);confirm.appendChild(error);confirm.appendChild(generatorButton("Keep current default",packingLearningSheet));}));
    else box.appendChild(el("p","gen-note",s.kind==="addition" ? "Consider adding this to My usual items. It is not added automatically.":"Review the underlying quantity, bag or trip assumption. Learning will not silently override it."));body.appendChild(box);
  });
  var history=el("details","panel");history.appendChild(el("summary",null,"Saved edit history · "+Object.keys(ledger.editTrips || {}).length+" trips"));Object.keys(ledger.editTrips || {}).forEach(function(id){var trip=ledger.editTrips[id],row=el("div");row.appendChild(el("strong",null,trip.name));Object.values(trip.items).filter(function(item){return item.change!=="kept";}).forEach(function(item){row.appendChild(el("p",null,item.label+" · "+packingLearningChoiceText(item)));});Object.values(trip.added || {}).forEach(function(item){row.appendChild(el("p",null,item.label+" · added"));});row.appendChild(generatorButton("Forget this trip’s edit history",function(){packingLearningForgetTrip(id).then(packingLearningSheet).catch(function(){error.textContent="Could not forget edit history.";});}));history.appendChild(row);});body.appendChild(history);
  body.appendChild(generatorButton(ledger.observeEdits===false ? "Resume automatic learning":"Pause automatic learning",function(){ledger.observeEdits=ledger.observeEdits===false;db.doc(PACK_LEARNING_PATH).set(ledger).then(packingLearningSheet).catch(function(){error.textContent="Could not save the learning setting.";});}));
}
function packingLearningSheet(){
  var body=openSheet("Packing learning"),ledger=packingLearningLoad(),profile=generatorPrefs(),suggestions=packingLearningRecommendations(ledger,profile),status=el("p","gen-error");status.setAttribute("role","status");body.appendChild(status);
  body.appendChild(el("p","gen-note","Stored only in this browser. No ChatGPT, model or API calls. The last five explicitly reviewed comparable trips drive suggestions; updating one trip still counts once. Defaults change only when you apply a suggestion."));
  packingLearningEditPanel(body,ledger,profile);
  if(window.PACK_TEST_MODE)body.appendChild(el("p","gen-step","Sandbox evidence; real trip learning is separate."));
  body.appendChild(el("h3",null,"Post-trip feedback suggestions"));
  if(!suggestions.length)body.appendChild(el("p","muted","No recurring pattern yet. Suggestions need five reviewed opportunities: at least four unneeded reports, or three missing reports. Unreviewed trips never count as use."));
  suggestions.forEach(function(suggestion){var box=el("div","panel");box.appendChild(el("strong",null,suggestion.label));box.appendChild(el("p",null,suggestion.count+" of the last "+suggestion.total+" reviewed opportunities: "+(suggestion.kind==="missing" ? "needed more / missing":"not needed")));
    var evidence=el("details");evidence.appendChild(el("summary",null,"Inspect evidence"));suggestion.evidence.concat(suggestion.contrary || []).forEach(function(row){evidence.appendChild(el("p",null,row.name+" · "+row.end+" · "+row.status));evidence.appendChild(el("p","gen-note",packingLearningContextLabel(ledger.trips[row.tripId])));});box.appendChild(evidence);
    if(suggestion.kind==="exclude"){
      box.appendChild(el("p","gen-note","These trips have comparable climate, activities, baggage and duration. Usually don’t pack this changes the shared default, including automatic regeneration of existing trips. Required and critical rules still keep it. Manual edits stay unchanged."));
      box.appendChild(generatorButton("Review default change",function(){var confirm=openSheet("Change usual packing default?");confirm.appendChild(el("p",null,"Usually don’t pack "+suggestion.label+"? This shared default applies whenever lists are generated or regenerated. Required rules still protect it. Reset it in Defaults & exclusions."));var failure=el("p","gen-error");confirm.appendChild(failure);var apply=generatorButton("Apply default exclusion",function(){apply.disabled=true;packingLearningApply(suggestion.key).then(function(){packingLearningSheet();if(typeof render==="function")render();}).catch(function(e){apply.disabled=false;failure.textContent=e.message || "Could not save the default.";});},true);confirm.appendChild(apply);confirm.appendChild(generatorButton("Keep current default",packingLearningSheet));}));
    }else box.appendChild(el("p","gen-note",suggestion.kind==="missing" ? "Review the quantity or add this as an edge case on your next trip. Learning will not add it automatically.":suggestion.contrary.length ? "Other trip conditions show this item was useful or protected. Consider a situational rule instead of a shared exclusion; inspect the evidence.":"Review the relevant weather, activity or quantity assumption. Critical, required, clothing and manual items cannot be excluded by learning."));
    body.appendChild(box);
  });
  var trips=Object.keys(ledger.trips).filter(function(id){return ledger.trips[id].reviewedAt;});
  var history=el("details","panel");history.appendChild(el("summary",null,"Reviewed trips · "+trips.length));trips.forEach(function(id){var trip=ledger.trips[id],row=el("div","panel");row.appendChild(el("strong",null,trip.name+" · "+trip.end));Object.keys(trip.feedback).forEach(function(itemId){var item=trip.items[itemId];if(item)row.appendChild(el("p",null,item.label+" · "+trip.feedback[itemId]));});row.appendChild(generatorButton("Forget this trip’s feedback",function(){packingLearningForgetTrip(id).then(packingLearningSheet).catch(function(){status.textContent="Could not forget feedback.";});}));history.appendChild(row);});body.appendChild(history);
  body.appendChild(generatorButton("Reset learning history",function(){var confirm=openSheet("Reset packing learning?");confirm.appendChild(el("p",null,"Delete captured lists, automatic edit patterns and feedback history? Automatic observation will pause until you resume it. Existing trips, manual edits and applied profile defaults stay saved."));var failure=el("p","gen-error");confirm.appendChild(failure);var reset=generatorButton("Reset learning history",function(){reset.disabled=true;packingLearningReset().then(packingLearningSheet).catch(function(){reset.disabled=false;failure.textContent="Could not reset learning.";});},true);confirm.appendChild(reset);confirm.appendChild(generatorButton("Keep history",packingLearningSheet));}));
}
