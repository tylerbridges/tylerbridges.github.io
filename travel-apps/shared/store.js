"use strict";
/* ================= Local store =================
   Stand-in for the Claude artifact database the dashboard uses (window.claude.use("db")), with the same calls the
   extracted modules make: db.doc(path).get/set/update/delete/onSnapshot and db.collection(path).onSnapshot.
   Data lives in this browser's localStorage under "ta:<path>". Both apps share one origin on GitHub Pages, so a trip
   made in one app shows up in the other. Swap this file for a real backend later without touching the modules. */
var Store = (function(){
  var P = "ta:", docSubs = {}, colSubs = {};
  function key(path){ return P + path; }
  function read(path){ try { var v = localStorage.getItem(key(path)); return v ? JSON.parse(v) : null; } catch(e){ return null; } }
  function write(path, data){ try { localStorage.setItem(key(path), JSON.stringify(data)); return true; } catch(e){ return false; } }
  function parent(path){ var i = path.lastIndexOf("/"); return i < 0 ? "" : path.slice(0, i); }
  function snap(path, data){ var id = path.slice(path.lastIndexOf("/") + 1); return {id:id, exists: data != null, data: function(){ return data == null ? undefined : JSON.parse(JSON.stringify(data)); }}; }
  function list(coll){ var out = [], pre = key(coll) + "/";
    for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf(pre) === 0 && k.slice(pre.length).indexOf("/") < 0) out.push(snap(k.slice(P.length), read(k.slice(P.length)))); }
    return out; }
  function notify(path){ setTimeout(function(){
    (docSubs[path] || []).forEach(function(cb){ try { cb(snap(path, read(path))); } catch(e){ console.error(e); } });
    var c = parent(path); (colSubs[c] || []).forEach(function(cb){ try { cb({docs:list(c)}); } catch(e){ console.error(e); } }); }, 0); }
  function deepMerge(a, b){ Object.keys(b).forEach(function(k){ var v = b[k];
    if (v && typeof v === "object" && v.__delete__ === true){ delete a[k]; return; }
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) deepMerge(a[k], v); else a[k] = v; }); return a; }
  function fail(){ return Promise.reject(Object.assign(new Error("Storage is full or blocked"), {code:"storage"})); }
  function doc(path){ return {
    get: function(){ return Promise.resolve(snap(path, read(path))); },
    set: function(data){ if (!write(path, data)) return fail(); notify(path); return Promise.resolve(); },
    update: function(patch){ var cur = read(path); if (cur == null) return Promise.reject(Object.assign(new Error("No document"), {code:"not_found"}));
      if (!write(path, deepMerge(cur, patch))) return fail(); notify(path); return Promise.resolve(); },
    delete: function(){ try { localStorage.removeItem(key(path)); } catch(e){} notify(path); return Promise.resolve(); },
    onSnapshot: function(cb){ (docSubs[path] = docSubs[path] || []).push(cb); setTimeout(function(){ cb(snap(path, read(path))); }, 0);
      return function(){ docSubs[path] = (docSubs[path] || []).filter(function(x){ return x !== cb; }); }; }
  }; }
  function collection(path){ return {
    onSnapshot: function(cb){ (colSubs[path] = colSubs[path] || []).push(cb); setTimeout(function(){ cb({docs:list(path)}); }, 0);
      return function(){ colSubs[path] = (colSubs[path] || []).filter(function(x){ return x !== cb; }); }; },
    get: function(){ return Promise.resolve({docs:list(path)}); }
  }; }
  // Other tabs (the other app open at the same time) see changes too.
  window.addEventListener("storage", function(e){ if (e.key && e.key.indexOf(P) === 0) notify(e.key.slice(P.length)); });
  // Backup: everything this app stores, as one JSON file, and restore from it.
  function exportAll(){ var o = {}; for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf(P) === 0) o[k.slice(P.length)] = read(k.slice(P.length)); } return o; }
  function importAll(o){ Object.keys(o || {}).forEach(function(p){ write(p, o[p]); notify(p); }); }
  return {doc:doc, collection:collection, exportAll:exportAll, importAll:importAll};
})();
db = Store;
