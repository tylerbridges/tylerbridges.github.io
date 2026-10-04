"use strict";
// Standalone app: unfinished form drafts are separate from confirmed trip assumptions and profiles.
function packingDraftPath(key){return (window.PACK_TEST_PREFIX || "")+"ta:meta/packingFormDrafts/"+encodeURIComponent(key);}
function packingDraftRead(key,context){try{var saved=JSON.parse(localStorage.getItem(packingDraftPath(key)) || "null");return saved && saved.version===1 && saved.context===context ? saved.data:null;}catch(e){return null;}}
function packingDraftWrite(key,context,data){try{localStorage.setItem(packingDraftPath(key),JSON.stringify({version:1,context:context,data:data,at:Date.now()}));return true;}catch(e){return false;}}
function packingDraftForget(key){try{localStorage.removeItem(packingDraftPath(key));return true;}catch(e){return false;}}
function packingFieldHints(form){
  form.querySelectorAll("input,textarea,select").forEach(function(input){
    if(input.tagName==="SELECT"){Array.from(input.options).forEach(function(option){if(option.value==="" && /^Choose /.test(option.textContent))option.textContent=option.textContent.replace(/^Choose /,"Select ");});return;}
    if(["hidden","checkbox","radio","button","submit","date","file"].indexOf(input.type)>=0)return;
    var label=input.labels && input.labels[0],name=label ? label.textContent.replace(/\*/g,"").trim().toLowerCase():"item name";
    if(input.type==="number")input.placeholder=input.min==="0" ? "Enter days (0 for none)":/quantity/.test(name) ? "Enter quantity":"Enter days";
    else if(!input.placeholder)input.placeholder="Enter "+name;
    else if(/^Add item/.test(input.placeholder))input.placeholder="Enter item name";
    else if(/^New section header/.test(input.placeholder))input.placeholder="Enter section name";
    else if(/^One (extra|additional) item/.test(input.placeholder))input.placeholder="Enter additional items (one per line)";
    else if(!/^Enter /i.test(input.placeholder))input.placeholder="Enter "+input.placeholder.charAt(0).toLowerCase()+input.placeholder.slice(1);
  });
}
function packingDraftAttach(form,key,context,options){
  packingFieldHints(form);options=options || {};var restoring=false,active=true;
  function controls(){return Array.prototype.slice.call(form.querySelectorAll("input,select,textarea")).filter(function(x){return x.type!=="submit" && x.type!=="button" && x.type!=="file" && !x.readOnly;}).concat(options.extras || []);}
  function snapshot(){var fields={};controls().forEach(function(x,index){fields[x.id || "@"+index]={value:x.value,checked:!!x.checked};});return {fields:fields,custom:options.capture ? clone(options.capture()):null};}
  var initial=snapshot(),contextBase=String(context || ""),contextFields=clone(initial.fields);(options.contextOmit || []).forEach(function(id){delete contextFields[id];});var fingerprint="|"+JSON.stringify(contextFields);context=contextBase+fingerprint;
  var status=el("p","gen-note"),discard=generatorButton("Discard unfinished draft",function(){packingDraftForget(key);restore(initial);status.textContent="Draft discarded. Confirmed settings are unchanged.";discard.hidden=true;});status.setAttribute("role","status");discard.hidden=true;
  function restore(data){restoring=true;if(options.beforeRestore)options.beforeRestore(data);controls().forEach(function(x,index){var value=data.fields[x.id || "@"+index];if(value){x.value=value.value;x.checked=value.checked;}});if(options.restoreEvents!==false)controls().forEach(function(x){x.dispatchEvent(new Event("change",{bubbles:true}));});if(options.onRestore)options.onRestore(data);restoring=false;}
  var saved=packingDraftRead(key,context);if(!saved && options.contextLegacyOmit){var legacyFields=clone(initial.fields);options.contextLegacyOmit.forEach(function(id){delete legacyFields[id];});[contextBase].concat(options.legacyContexts || []).some(function(oldContext){saved=packingDraftRead(key,String(oldContext)+"|"+JSON.stringify(legacyFields));return !!saved;});}if(!saved)(options.legacyContexts || []).some(function(oldContext){saved=packingDraftRead(key,String(oldContext)+fingerprint);return !!saved;});if(saved){restore(saved);status.textContent="Restored your unfinished draft. Confirm or discard it.";discard.hidden=false;}else status.textContent="Unfinished changes autosave on this device. Confirm them to apply.";
  function save(){if(!active || restoring)return;var okay=packingDraftWrite(key,context,snapshot());var message=okay ? "Draft saved on this device. Changes are not applied yet.":"Draft could not be saved. Browser storage may be full or blocked; keep this screen open.";if(status.textContent!==message)status.textContent=message;discard.hidden=!okay;}
  form.addEventListener("input",save);form.addEventListener("change",save);form.addEventListener("packingchange",save);if(options.saveClicks)form.addEventListener("click",function(event){if(!discard.contains(event.target))save();});
  form.appendChild(status);form.appendChild(discard);
  return {clear:function(){active=false;packingDraftForget(key);},save:save};
}
