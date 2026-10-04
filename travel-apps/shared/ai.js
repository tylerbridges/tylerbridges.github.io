"use strict";
/* ================= Claude adapter =================
   The dashboard asks Claude through the artifact runtime (window.claude.use("sample")). Outside claude.ai that
   isn't there, so this file provides the same two calls the modules use:
     AI.sample(prompt, opts)      -> Promise<{text}>
     AI.sample.json(prompt, opts) -> Promise<parsed JSON>
   Off by default. Turning it on (Settings) uses your own Anthropic API key, kept only in this browser's
   localStorage; it is never written to the repo. Without it, both apps still work: the packing list builds from
   your saved preferences and the itinerary builds day shells from your trip dates, flights and lodging. */
var AI = {sample:null};
var AI_CFG_KEY = "ta-ai";
function aiCfg(){ return lsGet(AI_CFG_KEY, {key:"", model:"claude-sonnet-5-5"}); }
function aiErr(code, msg){ return Object.assign(new Error(msg || code), {code:code}); }
function aiCall(prompt, opts){
  var c = aiCfg(); if (!c.key) return Promise.reject(aiErr("sampling_disabled"));
  return fetch("https://api.anthropic.com/v1/messages", {method:"POST",
    headers:{"content-type":"application/json", "x-api-key":c.key, "anthropic-version":"2023-06-01", "anthropic-dangerous-direct-browser-access":"true"},
    body: JSON.stringify({model:c.model || "claude-sonnet-5-5", max_tokens:(opts && opts.maxTokens) || 8000, messages:[{role:"user", content:prompt}]})
  }).then(function(r){
    if (r.status === 429 || r.status === 529) throw aiErr("rate_limited");
    if (r.status === 401 || r.status === 403) throw aiErr("not_granted");
    if (r.status === 413) throw aiErr("prompt_too_large");
    if (!r.ok) throw aiErr("upstream_error");
    return r.json();
  }).then(function(j){
    var text = ((j && j.content) || []).filter(function(b){ return b.type === "text"; }).map(function(b){ return b.text; }).join("");
    if (!text) throw aiErr("empty_completion");
    if (opts && opts.onText) try { opts.onText(text); } catch(e){}
    return {text:text};
  });
}
function aiJson(prompt, opts){
  return aiCall(prompt, opts).then(function(r){
    var s = r.text.replace(/```[a-z]*\n?/gi, "").trim(), i = s.search(/[\[{]/), j = Math.max(s.lastIndexOf("]"), s.lastIndexOf("}"));
    try { return JSON.parse(s.slice(i, j + 1)); } catch(e){ throw aiErr("invalid_json"); }
  });
}
function aiRefresh(){ if (aiCfg().key){ AI.sample = aiCall; AI.sample.json = aiJson; } else AI.sample = null; }
aiRefresh();
function sampleError(e){
  var c = e && e.code;
  if (c === "cancelled") return "";
  if (c === "rate_limited") return "Claude is busy right now. Try again in a minute.";
  if (c === "prompt_too_large") return "That's too long. Trim it and try again.";
  if (c === "refused" || c === "empty_completion" || c === "invalid_json") return "Claude couldn't make sense of that. Try again.";
  if (c === "not_granted") return "Your API key was refused. Check it in Settings.";
  if (c === "sampling_disabled") return "Claude isn't turned on. Add an API key in Settings.";
  return "Something went wrong asking Claude. Try again.";
}
function aiSettingsSheet(onDone){
  var body = openSheet("Settings"), c = aiCfg();
  body.appendChild(el("p","muted","Optional. With an Anthropic API key, Claude drafts lists and itineraries. The key stays in this browser only."));
  var k = inp("ai-key","password", c.key, "sk-ant-…"); k.autocomplete = "off"; body.appendChild(fieldEl("Anthropic API key", k));
  var md = inp("ai-model","text", c.model || "claude-sonnet-5-5"); body.appendChild(fieldEl("Model", md));
  var home = inp("home-base","text", IDX.home, "Rochester, MN"); body.appendChild(fieldEl("Home (start of driving routes)", home));
  var row = el("div","actions"); row.style.display = "flex"; row.style.gap = "8px"; row.style.flexWrap = "wrap";
  var sv = el("button","btn primary","Save"); sv.type = "button";
  var clr = el("button","btn","Remove key"); clr.type = "button";
  sv.addEventListener("click", function(){ lsSet(AI_CFG_KEY, {key:k.value.trim(), model:md.value.trim() || "claude-sonnet-5-5"}); IDX.home = home.value.trim() || "Rochester, MN"; lsSet("ta-home", IDX.home); aiRefresh(); closeSheet(); if (onDone) onDone(); });
  clr.addEventListener("click", function(){ lsSet(AI_CFG_KEY, {key:"", model:md.value.trim()}); aiRefresh(); closeSheet(); if (onDone) onDone(); });
  row.appendChild(sv); row.appendChild(clr); body.appendChild(row);
  // Backup / restore of everything both apps store in this browser.
  body.appendChild(el("h2","k","Backup"));
  var bx = el("div","actions"); bx.style.display = "flex"; bx.style.gap = "8px"; bx.style.flexWrap = "wrap";
  var ex = el("button","btn","Download backup"); ex.type = "button";
  ex.addEventListener("click", function(){ var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(Store.exportAll(), null, 1)], {type:"application/json"})); a.download = "travel-apps-backup.json"; a.click(); });
  var im = el("input"); im.type = "file"; im.accept = "application/json"; im.id = "ai-import"; im.style.maxWidth = "100%";
  im.addEventListener("change", function(){ var f = im.files && im.files[0]; if (!f) return; f.text().then(function(s){ Store.importAll(JSON.parse(s)); closeSheet(); location.reload(); }).catch(function(){ showStatus("<strong>Couldn't</strong> read that backup file.", true); }); });
  bx.appendChild(ex); bx.appendChild(fieldEl("Restore from backup", im)); body.appendChild(bx);
}
IDX.home = lsGet("ta-home", IDX.home);
