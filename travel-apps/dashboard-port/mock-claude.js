// Mock window.claude for the Travel Dashboard harness. Injected with page.addInitScript before any page script.
// Implements the async document DB the dashboard uses: db.doc(path).get/set/update/delete/onSnapshot and
// db.collection(path).get/onSnapshot. In memory, persisted to sessionStorage so a reload keeps the data.
// Seed: window.__MOCK_SEED (set by a preceding init script) = {path: data}. Options: window.__MOCK_OPTS = {noClaude, noDb}.
(function(){
  var OPTS = window.__MOCK_OPTS || {};
  if (OPTS.noClaude) return;
  var KEY = "__mockdb", store = {};
  try { var saved = sessionStorage.getItem(KEY); store = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(window.__MOCK_SEED || {})); } catch(e){ store = {}; }
  function persist(){ try { sessionStorage.setItem(KEY, JSON.stringify(store)); } catch(e){} }
  persist();
  var docSubs = {}, colSubs = {}, log = [], downloads = [];
  function cp(x){ return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function parent(p){ var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function snap(p){ var d = store[p]; return {id:p.slice(p.lastIndexOf("/") + 1), exists:d != null, data:function(){ return d == null ? undefined : cp(d); }}; }
  function list(c){ return Object.keys(store).filter(function(p){ return parent(p) === c; }).sort().map(snap); }
  function notify(p){ setTimeout(function(){
    (docSubs[p] || []).forEach(function(cb){ try { cb(snap(p)); } catch(e){ console.error(e); } });
    var c = parent(p); (colSubs[c] || []).forEach(function(cb){ try { cb({docs:list(c)}); } catch(e){ console.error(e); } }); }, 0); }
  function merge(a, b){ Object.keys(b).forEach(function(k){ var v = b[k]; if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) merge(a[k], v); else a[k] = cp(v); }); return a; }
  function failing(op, p){ var f = window.__mockFail; return f && f.test(op + " " + p); }
  function later(fn){ return new Promise(function(res, rej){ setTimeout(function(){ try { res(fn()); } catch(e){ rej(e); } }, 1); }); }
  function err(m){ var e = new Error(m); e.code = "mock"; return e; }
  function doc(p){ return {
    get:function(){ if (failing("get", p)) return Promise.reject(err("get failed")); return later(function(){ return snap(p); }); },
    set:function(d){ log.push(["set", p]); if (failing("set", p)) return Promise.reject(err("set failed")); return later(function(){ store[p] = cp(d); persist(); notify(p); }); },
    update:function(patch){ log.push(["update", p]); if (failing("update", p)) return Promise.reject(err("update failed")); return later(function(){ if (store[p] == null) throw err("not found"); merge(store[p], patch); persist(); notify(p); }); },
    delete:function(){ log.push(["delete", p]); if (failing("delete", p)) return Promise.reject(err("delete failed")); return later(function(){ delete store[p]; persist(); notify(p); }); },
    onSnapshot:function(cb){ (docSubs[p] = docSubs[p] || []).push(cb); setTimeout(function(){ cb(snap(p)); }, 0); return function(){ docSubs[p] = (docSubs[p] || []).filter(function(x){ return x !== cb; }); }; }
  }; }
  function collection(p){ return {
    get:function(){ return later(function(){ return {docs:list(p)}; }); },
    onSnapshot:function(cb){ (colSubs[p] = colSubs[p] || []).push(cb); setTimeout(function(){ cb({docs:list(p)}); }, 0); return function(){ colSubs[p] = (colSubs[p] || []).filter(function(x){ return x !== cb; }); }; }
  }; }
  var api = {doc:doc, collection:collection};
  window.__mock = {downloads:downloads, store:function(){ return cp(store); }, get:function(p){ return cp(store[p]); }, log:log, put:function(p, d){ store[p] = cp(d); persist(); notify(p); }, reset:function(){ sessionStorage.removeItem(KEY); }};
  // downloads capability (as the live artifact declares): save({filename, data: Blob}) → {status:"saved"}; window.__mockDl = "declined" | "fail".
  // (downloads array declared above)
  var dlApi = {save:function(o){ var mode = window.__mockDl;
    if (mode === "declined") return Promise.reject(Object.assign(new Error("declined"), {code:"declined"}));
    if (mode === "fail") return Promise.reject(Object.assign(new Error("failed"), {code:"internal"}));
    return o.data.text().then(function(text){ downloads.push({filename:o.filename, type:o.data.type, text:text}); return {status:"saved"}; }); }};
  // Fake Supabase connector for account-sync.js: execute_sql running the three ta_sync_* functions over an
  // in-memory ta_docs table (window.__MOCK_SUPA = {path: data} seeds it; sessionStorage keeps it across reloads).
  var SKEY = "__mocksupa", supa = null, tick = 0, supaCalls = [];
  function supaLoad(){ if (supa) return supa; try { var s = sessionStorage.getItem(SKEY); supa = s ? JSON.parse(s) : null; } catch(e){}
    if (!supa){ supa = {}; Object.keys(window.__MOCK_SUPA || {}).forEach(function(p){ supa[p] = {data:cp(window.__MOCK_SUPA[p]), at:stamp()}; }); supaSave(); } return supa; }
  function supaSave(){ try { sessionStorage.setItem(SKEY, JSON.stringify(supa)); } catch(e){} }
  function stamp(){ tick++; return new Date(Date.UTC(2026, 10, 3, 6, 0, 0) + tick).toISOString().replace("Z", "+00:00"); }
  function reply(r){ return {payload:{result:"Below is the result. <untrusted-data-0000aaaa-1111-2222-3333-444455556666>\n" + JSON.stringify([{r:r}]) + "\n</untrusted-data-0000aaaa-1111-2222-3333-444455556666> end"}}; }
  var mcpApi = {callTool:function(server, tool, input){
    if (OPTS.supaError) return Promise.reject({code:OPTS.supaError, message:OPTS.supaError});
    if (server !== "Supabase" || tool !== "execute_sql") return Promise.reject({code:"not_in_manifest", message:"no"});
    var q = input.query, lits = [], m0, re = /\$j[a-z0-9]*\$([\s\S]*?)\$j[a-z0-9]*\$::jsonb/g, t = supaLoad(), out = {};
    while ((m0 = re.exec(q))) lits.push(JSON.parse(m0[1]));
    supaCalls.push(q.slice(0, 40));
    if (/ta_sync_state\(/.test(q)) Object.keys(t).forEach(function(p){ out[p] = t[p].at; });
    else if (/ta_sync_read\(/.test(q)) lits[0].forEach(function(p){ if (t[p]) out[p] = {data:cp(t[p].data), at:t[p].at}; });
    else if (/ta_sync_write\(/.test(q)){ Object.keys(lits[0]).forEach(function(p){ t[p] = {data:cp(lits[0][p]), at:stamp()}; out[p] = t[p].at; }); lits[1].forEach(function(p){ delete t[p]; }); supaSave(); }
    else return Promise.reject({code:"tool_error", message:"unexpected sql"});
    return Promise.resolve(reply(out));
  }};
  window.__mockSupa = {rows:function(){ return supaLoad(); }, calls:supaCalls,
    edit:function(p, data){ var t = supaLoad(); if (data == null) delete t[p]; else t[p] = {data:cp(data), at:stamp()}; supaSave(); }};
  window.claude = {use:function(name){
    if (name === "mcp") return Promise.resolve(window.__MOCK_SUPA ? mcpApi : null);
    if (name === "permissions") return Promise.resolve({state:function(){ return Promise.resolve(OPTS.supaPerm || "granted"); }});
    if (name === "downloads") return Promise.resolve(OPTS.noDownloads ? null : dlApi);
    if (name === "db") return OPTS.noDb ? Promise.resolve(null) : Promise.resolve(api);
    return Promise.resolve(null);
  }};
})();
