"use strict";
/* ================= Packing generator: Dashboard adapter =================
   The other files in js/packgen/ are verbatim copies of the standalone Packing List app (travel-apps/packing-list,
   commit 90c4df4) so standalone changes can be re-ported by copying them again. Everything Dashboard-specific lives here:
   - a synchronous in-memory mirror of the documents the standalone reads with lsGet("ta:" + path) / Store.exportAll(),
     filled from the async db before the Packing tab (or a preferences / learning / style sheet) renders;
   - a db facade (PackGen.wrapDb, applied in boot.js) whose writes update both the real db and the mirror;
   - storage paths that touched raw localStorage (list save rollback, Delete list, Undo) redone through the db + mirror;
   - routing glue: the standalone's #ID / #ID.edit / #rules / "" navigations map to #ID.packing[.edit|.rules];
   - stubs for the standalone-only pieces left out (test flow, app update, home list, shell).
   Load order: after js/packing.js and the js/packgen/ files, before js/boot.js. */

/* ---------- Standalone helpers the generator needs (copied from travel-apps/packing-list/packing.js) ----------
   The Dashboard's packing.js keeps its own versions of everything else. Before leaving follows the standalone's current
   rules (no liquids-bag check); in the Dashboard only the retired checklist builder used the old version. */
var LEAVING_RULES = [
  [/^(glasses)\b/i, "Glasses packed?"], [/sunglasses/i, "Sunglasses packed?"], [/water bottle/i, "Water bottle empty?"],
  [/charger|usb-c|\bhub\b|\bcord\b|\bcable/i, "Chargers packed?"], [/^work computer(?:\s*[×x]\s*\d+)?$/i, "Work computer packed?"], [/^personal laptop(?:\s*[×x]\s*\d+)?$/i, "Personal laptop packed?"],
  [/^monitors?(?:\s*[×x]\s*\d+)?$/i, "Both work monitors packed?"], [/^monitor cables?/i, "Monitor cables / power packed?"]
];
function toiletryBagSection(label){
  return /^(toothpaste|shampoo|conditioner|body wash|hair product|face wash|shaving cream|aftershave|prep h|wrinkle release|eye drops|sunscreen)$/.test(normItem(label)) || /\b(gel|cream|lotion|spray|liquid)\b/.test(normItem(label)) ? "Liquid toiletries":"Dry toiletries";
}
function splitToiletryGroups(groups){
  var out=[],index=Object.create(null);
  groups.forEach(function(group){if(!(group.items || []).length && group.title!=="Toiletries" && !index[group.title]){index[group.title]=Object.assign({},group,{items:[]});out.push(index[group.title]);}(group.items || []).forEach(function(item){var title=group.title==="Toiletries" ? toiletryBagSection(typeof item==="string" ? item:item.label):group.title;
    if(!index[title]){index[title]=Object.assign({},group,{title:title,items:[]});out.push(index[title]);}index[title].items.push(item);
  });});return out;
}
function leavingFor(groups, checked){
  var labels = []; groups.forEach(function(g){ if (g.depart || /^before leaving$/i.test(g.title || "")) return; (g.items || []).forEach(function(x){ labels.push({t:g.title || "", x:String(x)}); }); });
  var out = ["Grab wallet", "ID in wallet?"];
  if (labels.some(function(l){ return /toiletr/i.test(l.t); })) out.push("Toiletries packed?");
  LEAVING_RULES.forEach(function(r){ if (labels.some(function(l){ return r[0].test(l.x); }) && out.indexOf(r[1]) < 0) out.push(r[1]); });
  out.push("Grab personal bag", checked ? "Grab checked bag" : "Grab carry-on");
  return out;
}

/* ---------- Left out: test flow (test-flow.js) and app update (app-update.js) ---------- */
var PACK_TEST_MODE = false;
function packingTestMenu(){}
function packingTestHome(){ return el("div"); }
function packingTestBanner(){ return el("div"); }

/* ---------- Mirror + db facade ---------- */
var PackGen = (function(){
  var PG = {mirror:{}, localAt:{}, loadedTrip:null, loading:null, armed:null, tid:null, mode:"list", root:null,
    dbState: (window.claude && typeof window.claude.use === "function") ? "pending" : "none"};
  var GLOBAL_DOCS = ["meta/packing", "meta/packingLearning", "meta/packingStyles"], TRIP_DOCS = ["original", "draft", "refinement", "export"];
  function cp(x){ return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function mirrored(p){ return GLOBAL_DOCS.indexOf(p) >= 0 || /^trip\/[^/]+\/pack_meta\/[^/]+$/.test(p); }
  function packPath(p){ var m0 = /^trip\/([^/]+)\/(pack_sections|pack_items)\/([^/]+)$/.exec(p); return m0 ? {id:m0[1], key:m0[2] === "pack_items" ? "items" : "sections", doc:m0[3]} : null; }
  function put(p, data){ if (data == null) delete PG.mirror[p]; else PG.mirror[p] = cp(data); PG.localAt[p] = Date.now(); }
  function deepMerge(a, b){ Object.keys(b).forEach(function(k){ var v = b[k]; if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) deepMerge(a[k], v); else a[k] = cp(v); }); return a; }
  // Synchronous read for the standalone's lsGet("ta:" + path). Pack sections/items come from the Dashboard's live PACK cache.
  function read(p, dflt){
    var pp = packPath(p); if (pp){ var pk = PACK[pp.id], v = pk && pk[pp.key] && pk[pp.key][pp.doc]; return v == null ? dflt : cp(v); }
    var d = PG.mirror[p]; return d == null ? dflt : cp(d);
  }
  // Plain delegating wrappers (no Proxy: a frozen API object would break Proxy invariants).
  function delegate(target, over){
    var o = {}, seen = {};
    for (var obj = target; obj && obj !== Object.prototype; obj = Object.getPrototypeOf(obj)){
      Object.getOwnPropertyNames(obj).forEach(function(k){ if (seen[k] || k === "constructor" || over[k]) return; seen[k] = 1;
        Object.defineProperty(o, k, {enumerable:true, get:function(){ var v = target[k]; return typeof v === "function" ? v.bind(target) : v; }}); });
    }
    Object.keys(over).forEach(function(k){ o[k] = over[k]; });
    return o;
  }
  function wrapDoc(p, ref){
    if (!mirrored(p) || !ref) return ref;
    return delegate(ref, {
      get:function(){ return ref.get.apply(ref, arguments); },
      set:function(data){ return ref.set.apply(ref, arguments).then(function(r){ put(p, data); return r; }); },
      update:function(patch){ return ref.update.apply(ref, arguments).then(function(r){ if (PG.mirror[p] != null) deepMerge(PG.mirror[p], patch); PG.localAt[p] = Date.now(); return r; }); },
      delete:function(){ return ref.delete.apply(ref, arguments).then(function(r){ put(p, null); return r; }); },
      onSnapshot:function(){ return ref.onSnapshot.apply(ref, arguments); }
    });
  }
  PG.wrapDb = function(api){
    if (!api) return api;
    PG.mirror = {}; PG.localAt = {}; PG.loadedTrip = null; PG.loading = null; PG.dbState = "ready";
    return delegate(api, {doc:function(p){ return wrapDoc(String(p), api.doc.apply(api, arguments)); },
      collection:function(){ return api.collection.apply(api, arguments); }});
  };
  PG.read = read;
  PG.onTab = function(){ var r = route(); return !!(r.t && r.tab === "packing"); };

  /* Loading: global profile docs, then this trip's pack_meta docs and its live sections/items. A doc written here in the
     last 15 s keeps its local value, so a slow or eventually-consistent read can't roll back a confirmed save. */
  function fetchDocs(paths){
    return Promise.all(paths.map(function(p){ return db.doc(p).get().then(function(sn){
      if (Date.now() - (PG.localAt[p] || 0) < 15000) return;
      var d = sn && sn.exists ? sn.data() : null; if (d == null) delete PG.mirror[p]; else PG.mirror[p] = cp(d); }); }));
  }
  function waitPack(id){ var pk = packData(id), t0 = Date.now();
    return new Promise(function(res, rej){ (function poll(){ if (pk.ready) return res(); if (Date.now() - t0 > 12000) return rej(new Error("Packing list didn't load")); setTimeout(poll, 50); })(); }); }
  PG.load = function(id){
    if (PG.loading && PG.loading.id === id) return PG.loading.p;
    // Start from a past trip (packingPastTrips) reads other trips' refinement docs: load those of trips that have a list.
    var others = Object.keys(RAW).filter(function(x){ return x !== id && RAW[x] && RAW[x].packing === true && !RAW[x].packingDeleted; }).map(function(x){ return "trip/" + x + "/pack_meta/refinement"; });
    var p = fetchDocs(GLOBAL_DOCS.concat(TRIP_DOCS.map(function(n){ return "trip/" + id + "/pack_meta/" + n; }), others)).then(function(){ return waitPack(id); })
      .then(function(){ if (PG.loading && PG.loading.p === p) PG.loading = null; PG.loadedTrip = id; }, function(e){ if (PG.loading && PG.loading.p === p) PG.loading = null; throw e; });
    PG.loading = {id:id, p:p}; return p;
  };
  PG.refreshGlobals = function(){ return db ? fetchDocs(GLOBAL_DOCS).catch(function(){}) : Promise.resolve(); };
  PG.exportAll = function(){ var o = {};
    Object.keys(PG.mirror).forEach(function(p){ o[p] = cp(PG.mirror[p]); });
    Object.keys(PACK).forEach(function(id){ var pk = PACK[id];
      Object.keys(pk.sections || {}).forEach(function(k){ o["trip/" + id + "/pack_sections/" + k] = cp(pk.sections[k]); });
      Object.keys(pk.items || {}).forEach(function(k){ o["trip/" + id + "/pack_items/" + k] = cp(pk.items[k]); }); });
    return o; };

  /* ---------- Routing ----------
     #ID.packing (list or setup) · #ID.packing.edit (Trip details) · #ID.packing.rules (Rules and quantities).
     The standalone sets location.hash = ID after a save and "" after Delete list; arm() marks those as the generator's own,
     and fixHash() (called first thing in route()) rewrites them before the Dashboard reads the hash. */
  PG.arm = function(id, kind){ PG.armed = {id:id, kind:kind || "save", at:Date.now()}; };
  function tripOf(hash){ var h = String(hash || "").replace(/^#/, ""), mm = /^(.+?)\.packing(\.(edit|rules))?$/.exec(h); return mm ? mm[1] : null; }
  PG.fixHash = function(){
    var a = PG.armed, h = (location.hash || "").replace(/^#/, "");
    if (a && Date.now() - a.at < 3000){ var to = h === a.id || h === "" ? a.id + ".packing" : h === a.id + ".edit" ? a.id + ".packing.edit" : null;
      if (to){ PG.armed = null; try { history.replaceState(null, "", "#" + to); } catch(e){ location.hash = to; } } }
    else if (a) PG.armed = null;
    if (PG.loadedTrip && tripOf(location.hash) !== PG.loadedTrip) PG.loadedTrip = null;   // left this trip's Packing tab: reload next time
  };
  PG.mapHash = function(hash){
    var id = PG.tid, h = String(hash == null ? "" : hash).replace(/^#/, ""); if (!id) return hash;
    if (h === "" || h === id) return "#" + id + (PG.mode === "setup" ? "" : ".packing");
    if (h === id + ".edit") return "#" + id + ".packing.edit";
    if (h === "rules") return "#" + id + ".packing.rules";
    if (h === "new") return "#" + id + ".packing";
    return hash;
  };

  /* ---------- The Packing tab ---------- */
  function flights(t){ return (t.segments || []).some(function(b){ return b.type === "flight" || (!b.type && /flight|outbound|return/i.test(b.label || "")); }); }
  function hasList(t){
    if (t.packingDeleted) return false;
    var pk = PACK[t.id] || {sections:{}, items:{}};
    return PG.mirror["trip/" + t.id + "/pack_meta/refinement"] != null || PG.mirror["trip/" + t.id + "/pack_meta/draft"] != null || Object.keys(pk.items).length > 0 || Object.keys(pk.sections).length > 0;
  }
  // No list yet: the standalone's quick setup for an existing trip (prefilled destination and dates; Flying when it has flights).
  function setupTrip(t){ var g = Object.assign({}, t.generatorSetup || {}); if (flights(t)) g.mode = "fly"; return Object.assign({}, t, {packingDeleted:true, generatorSetup:g}); }
  function note(root, text, retry){ root.textContent = ""; var p = el("section","panel"); p.appendChild(el("h2","k","Packing list")); var x = el("p","muted",text); x.setAttribute("role","status"); p.appendChild(x);
    if (retry){ var b = el("button","btn","Try again"); b.type = "button"; b.addEventListener("click", retry); p.appendChild(b); } root.appendChild(p); }
  function paint(root, t0, focus){
    var t = TRIPS[t0.id] ? m(TRIPS[t0.id]) : t0, list = hasList(t), node;
    PG.tid = t.id;
    try {
      if (focus === "rules"){ PG.mode = list ? "list" : "setup"; node = generatorRulesPage();
        var back = node.querySelector("a.back"); if (back){ back.href = "#" + t.id + ".packing"; back.textContent = "← Packing list"; } }
      else if (!list){ PG.mode = "setup"; node = refineSetup(setupTrip(t)); PG_stylePicker(node, t.id); }
      else if (focus === "edit"){ PG.mode = "list"; node = refineSetup(t); }
      else { PG.mode = "list"; node = refineReview(t); }
    } catch(e){ note(root, "The packing list couldn't be shown. Reload the page and try again."); setTimeout(function(){ throw e; }, 0); return; }
    root.textContent = ""; root.appendChild(node);
  }
  PG.view = function(t, focus){
    var root = el("div","packgen"); root.id = "packgen"; PG.root = root; PG.tid = t.id; PG_downloads();
    if (!db){
      if (PG.dbState === "pending"){ note(root, "Loading your packing list…"); setTimeout(function(){ if (!db && PG.dbState === "pending" && PG.root === root){ PG.dbState = "none"; if (PG.onTab()) render(true); } }, 10000); }
      else note(root, "Packing lists can't be generated or saved in this view (preview or read-only). Open the dashboard in Claude to make or change this trip's list.");
      return root;
    }
    if (PG.loadedTrip === t.id && !PG.loading){ paint(root, t, focus); return root; }
    note(root, "Loading your packing list…");
    PG.load(t.id).then(function(){ if (PG.root === root) paint(root, t, focus); },
      function(){ if (PG.root === root) note(root, "Couldn't load this trip's packing data. Check your connection, then try again.", function(){ if (PG.root === root) render(true); }); });
    return root;
  };
  return PG;
})();

/* Standalone Store calls (generator.js): the same facade over the db, with exportAll/importAll over the mirror. */
var Store = {doc:function(p){ return db.doc(p); }, collection:function(p){ return db.collection(p); },
  exportAll:function(){ return PackGen.exportAll(); },
  importAll:function(o){ return Promise.all(Object.keys(o || {}).map(function(p){ return db.doc(p).set(o[p]); })); }};

/* ---------- Shared globals with Dashboard-transparent wrappers ---------- */
// lsGet/lsSet: only "ta:" keys (the standalone's store namespace) go to the mirror; every Dashboard key is unchanged.
var PG_lsGet = lsGet, PG_lsSet = lsSet;
lsGet = function(k, dflt){ if (typeof k === "string" && k.indexOf("ta:") === 0) return PackGen.read(k.slice(3), dflt); return PG_lsGet(k, dflt); };
lsSet = function(k, v){ if (typeof k === "string" && k.indexOf("ta:") === 0){ if (db) db.doc(k.slice(3)).set(v).catch(function(){ showStatus("<strong>Not saved.</strong> That packing change didn't store."); }); return; } return PG_lsSet(k, v); };
// render(): the Dashboard always calls render(true); the standalone calls render() (or .then(render)) to redraw the
// current page, which here means re-rendering the current route in full.
var PG_render = render;
render = function(force){ return PG_render(typeof force === "boolean" ? force : true); };
// Generator sheets carry the .packgen scope so its styles apply to them (and only to them).
var PG_openSheet = openSheet;
// With the old checklist retired, every sheet opened while the Packing tab shows is a generator sheet.
openSheet = function(){ var body = PG_openSheet.apply(null, arguments); if (sheetBg && PackGen.onTab()) sheetBg.classList.add("packgen"); return body; };

/* ---------- Generator functions redone for the Dashboard ---------- */
// Links map to the Packing tab's routes.
var PG_generatorLink = generatorLink;
generatorLink = function(label, hash, primary){ return PG_generatorLink(label, PackGen.mapHash(hash), primary); };
// Sheets that read the profile docs refresh them first.
["generatorPreferences", "packingLearningSheet", "packingTripStyleSheet", "packingLearningFeedbackSheet"].forEach(function(name){
  var orig = window[name];
  window[name] = function(){ var args = arguments; PackGen.refreshGlobals().then(function(){ orig.apply(null, args); }); };
});
// A list save: mark the trip as having a list (trips/<ID>.packing), and treat the follow-up hash change as staying on the tab.
var PG_refineSaveTrip = refineSaveTrip;
refineSaveTrip = function(record, patch, state, result){
  if (patch && typeof patch === "object") patch.packing = true;
  // First generation from the no-list setup (setupTrip marks it packingDeleted): like a new standalone trip, no Undo back to an empty plan.
  if (record && record.packingDeleted && state){ delete state.undo; delete state.undoProfile;
    // Trip style chosen in the no-list setup: the same result as the standalone's new-trip path (style refinements under the
    // form's values, the style's trip type, Work/Events confirmations keyed to it), then re-evaluated.
    var ps = PackGen.setupStyle; PackGen.setupStyle = null;
    // ps.past: Start from a past trip (its style part, then its carried edits).
    if (ps && ps.id === record.id && ps.style && !state.legacy){ var formKeys = ["extraItems","daypack","climate","rain","ruggedHike","brooksToo","work","workDays","formalDays","dinners"];
      Object.keys(ps.style.refinements || {}).forEach(function(k){ if (formKeys.indexOf(k) < 0) state.refinements[k] = clone(ps.style.refinements[k]); });
      state.inputs.tripType = ps.style.inputs.tripType || "leisure";
      ["Work","Events"].forEach(function(f){ if (state.decisionReviews && state.decisionReviews[f]) state.decisionReviews[f] = refineDecisionKey(state, f); });
      if (ps.past) refineCarryOverrides(ps.past.state, state, generatorPrefs());
      result = refineEvaluate(state, generatorPrefs(), null); } }
  return PG_refineSaveTrip(record, patch, state, result).then(function(r){ PackGen.arm(record.id); return r; });
};
function PG_sameAsDocs(pk, groups){
  var secs = Object.keys(pk.sections).map(function(id){ var s = pk.sections[id]; return {id:id, title:s.title, order:s.order || 0, depart:!!s.depart}; }).sort(secSort);
  if (secs.length !== groups.length) return false;
  return secs.every(function(s, i){ var g = groups[i], labels = Object.keys(pk.items).map(function(k){ return pk.items[k]; }).filter(function(x){ return x.section === s.id; }).sort(function(a, b){ return (a.order || 0) - (b.order || 0); }).map(function(x){ return x.label; });
    return g.title === s.title && !!g.depart === s.depart && JSON.stringify(labels) === JSON.stringify(g.items); });
}
function PG_keepBaseline(id){ var o = PackGen.mirror["trip/" + id + "/pack_meta/original"]; return !!(o && !(o.context && o.context.source === "generator")); }
// Standalone rule (skip when pack_meta/original already matches), plus: a list whose baseline was built by the Dashboard's
// old checklist keeps that baseline (close-out compares against it), so "already matches" is checked against the saved docs.
function generatorSaveDraft(t,groups,setup){
  var pk0 = packData(t.id), luggage = setup ? setup.bag : "carryon", total = groups.reduce(function(n,g){ return n + g.items.length; },0);
  return db.doc("trip/" + t.id + "/pack_meta/original").get().then(function(snap){ var o = snap && snap.exists !== false && snap.data ? snap.data() : null;
    if (o && pk0.ready && JSON.stringify(o.groups) === JSON.stringify(groups) && o.context && o.context.luggage === luggage && Object.keys(pk0.sections).length === groups.length && Object.keys(pk0.items).length === total) return;
    if (PG_keepBaseline(t.id) && pk0.ready && PG_sameAsDocs(pk0, groups)) return;
    return generatorWriteDraft(t,groups,setup);
  });
}
// Same document shapes and ids as the standalone; rollback goes through the db instead of raw localStorage. Packed state,
// hints and section notes carry over by label/title, so re-saving a legacy list loses nothing the old checklist had.
function generatorWriteDraft(t,groups,setup){
  var id = t.id, pk = packData(id), sections = {}, items = {}, prefix = "gen-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,8), base = "trip/" + id + "/";
  var oldS = clone(pk.sections), oldI = clone(pk.items), byLabel = {}, notes = {};
  Object.keys(oldI).forEach(function(k){ var key = normItem(oldI[k].label); if (key && !byLabel[key]) byLabel[key] = oldI[k]; });
  Object.keys(oldS).forEach(function(k){ var s = oldS[k]; if (s.note) notes[String(s.title || "").toLowerCase()] = s.note; });
  groups.forEach(function(g,index){ var sid = prefix + "-s" + index; sections[sid] = {title:g.title,depart:!!g.depart,order:g.depart ? 9999 : (index + 1) * 10,note:notes[String(g.title || "").toLowerCase()] || ""};
    g.items.forEach(function(label,i){ var old = byLabel[normItem(label)], it = {label:label,section:sid,order:(i + 1) * 10,checked:!!(old && old.checked),at:Date.now()}; if (old && old.hint) it.hint = old.hint; items[prefix + "-i" + index + "-" + i] = it; }); });
  var written = [], removed = [];
  function track(list, p, pr){ return pr.then(function(){ list.push(p); }); }
  var writes = []; Object.keys(sections).forEach(function(k){ writes.push(track(written, base + "pack_sections/" + k, db.doc(base + "pack_sections/" + k).set(sections[k]))); });
  Object.keys(items).forEach(function(k){ writes.push(track(written, base + "pack_items/" + k, db.doc(base + "pack_items/" + k).set(items[k]))); });
  return Promise.all(writes).then(function(){
    var deletes = []; Object.keys(oldS).forEach(function(k){ deletes.push(track(removed, base + "pack_sections/" + k, db.doc(base + "pack_sections/" + k).delete())); });
    Object.keys(oldI).forEach(function(k){ deletes.push(track(removed, base + "pack_items/" + k, db.doc(base + "pack_items/" + k).delete())); });
    return Promise.all(deletes);
  }).then(function(){ pk.sections = sections; pk.items = items; pk.ready = true;
    if (PG_keepBaseline(id)) return;
    return db.doc(base + "pack_meta/original").set({at:Date.now(),context:packContext(t,{source:"generator",luggage:setup ? setup.bag : "carryon"}),groups:groups});
  }).catch(function(err){
    // Roll back only this trip's packing documents: drop the new ones, put back any old one already deleted.
    var undo = written.map(function(p){ return db.doc(p).delete().catch(function(){}); }).concat(removed.map(function(p){ var pp = p.split("/"), d = pp[2] === "pack_items" ? oldI[pp[3]] : oldS[pp[3]]; return db.doc(p).set(d).catch(function(){}); }));
    pk.sections = oldS; pk.items = oldI;
    return Promise.all(undo).then(function(){ throw err; });
  });
}
// Scoped unfinished-form drafts for a trip (device localStorage, as in the standalone).
function generatorPackingKeys(id){
  var draft="ta:meta/packingFormDrafts/",keys=[];
  for(var i=0;i<localStorage.length;i++){var key=localStorage.key(i);if(!key || key.indexOf(draft)!==0)continue;var scope=decodeURIComponent(key.slice(draft.length));
    if(["setup:","trip-details:","feedback:","add:"].some(function(part){return scope===part+id;}) || ["refine:","edit:"].some(function(part){return scope.indexOf(part+id+":")===0;}))keys.push(key);}
  return keys;
}
function generatorRestoreRaw(values){Object.keys(values).forEach(function(key){try{if(values[key]===null)localStorage.removeItem(key);else localStorage.setItem(key,values[key]);}catch(e){}});}
// Delete list: this trip's pack_sections, pack_items and pack_meta documents plus its scoped drafts; the trip header,
// bookings, itinerary, profile and learning history stay. Header gets packingDeleted:true, packing:false. Failed deletes roll back.
function generatorDeleteList(t){
  var id = t.id, pk = packData(id), base = "trip/" + id + "/", docs = {}, drafts = {};
  if (!RAW[id]) return Promise.reject(new Error("Trip missing"));
  Object.keys(pk.sections).forEach(function(k){ docs[base + "pack_sections/" + k] = clone(pk.sections[k]); });
  Object.keys(pk.items).forEach(function(k){ docs[base + "pack_items/" + k] = clone(pk.items[k]); });
  Object.keys(PackGen.mirror).forEach(function(p){ if (p.indexOf(base + "pack_meta/") === 0) docs[p] = clone(PackGen.mirror[p]); });
  generatorPackingKeys(id).forEach(function(k){ drafts[k] = localStorage.getItem(k); });
  var prev = {flag:RAW[id].packingDeleted, packing:RAW[id].packing}, gone = [];
  return Promise.all(Object.keys(docs).map(function(p){ return db.doc(p).delete().then(function(){ gone.push(p); }); }))
    .then(function(){ return saveTrip(id, {packingDeleted:true, packing:false}, false, true); })
    .then(function(ok){ if (ok === false) throw new Error("Trip header not saved");
      Object.keys(drafts).forEach(function(k){ try { localStorage.removeItem(k); } catch(e){} });
      if (PACK[id]){ PACK[id].sections = {}; PACK[id].items = {}; }
      GEN_DELETED_LIST = {id:id, docs:docs, drafts:drafts, flag:prev.flag, packing:prev.packing};
      generatorDeletionToast(); PackGen.arm(id, "delete"); return true; })
    .catch(function(e){ return Promise.all(gone.map(function(p){ return db.doc(p).set(docs[p]).catch(function(){}); })).then(function(){ throw e; }); });
}
function generatorRestoreList(){
  var saved = GEN_DELETED_LIST; if (!saved) return Promise.resolve();
  var put = [];
  return Promise.all(Object.keys(saved.docs).map(function(p){ return db.doc(p).set(saved.docs[p]).then(function(){ put.push(p); }); }))
    .then(function(){ return saveTrip(saved.id, {packingDeleted:saved.flag === true, packing:saved.packing === false ? false : true}, false, true); })
    .then(function(ok){ if (ok === false) throw new Error("Trip header not saved");
      generatorRestoreRaw(saved.drafts || {});
      var pk = packData(saved.id); Object.keys(saved.docs).forEach(function(p){ var pp = p.split("/"); if (pp[2] === "pack_sections") pk.sections[pp[3]] = clone(saved.docs[p]); else if (pp[2] === "pack_items") pk.items[pp[3]] = clone(saved.docs[p]); });
      if (GEN_DELETED_LIST === saved) GEN_DELETED_LIST = null; })
    .catch(function(e){ return Promise.all(put.map(function(p){ return db.doc(p).delete().catch(function(){}); })).then(function(){ throw e; }); });
}

/* ---------- Trip style / past-trip pickers for a trip with no list yet ----------
   The standalone builds "Trip style (optional)" and "Start from a past trip (optional)" only for brand-new trips; every Dashboard
   trip already exists, so the adapter adds the same two selects (mutually exclusive) to the no-list setup and mirrors the
   standalone's reuse() on the form's fields. The style/past choice is applied at save in the refineSaveTrip wrapper above.
   The Trip details editor (a list exists) has neither, as in the standalone. */
function PG_stylePicker(form, id){
  var styleNote = form.querySelector("#rs-style-note") || form.querySelector("h2.k + p.gen-note"); if (!styleNote || form.querySelector("#rs-style")) return;
  var styleSelect = sel("rs-style", [["","Usual defaults"]].concat(packingTripStyles().map(function(x){ return [x.id, x.name]; })), "");
  form.insertBefore(fieldEl("Trip style (optional)", styleSelect), styleNote);
  var pastTrips = packingPastTrips(id), pastSelect = null;
  if (pastTrips.length){ pastSelect = sel("rs-past", [["","None"]].concat(pastTrips.map(function(x){ return [x.id, x.label]; })), ""); form.insertBefore(fieldEl("Start from a past trip (optional)", pastSelect), styleNote); }
  function $(x){ return form.querySelector("#" + x); }
  function fire(x){ var e = $(x); if (e) e.dispatchEvent(new Event("change", {bubbles:true})); }
  function reuse(activeStyle, text){
    var style = activeStyle || {inputs:{tripType:"leisure",bag:"carryon",mode:"fly",activities:{}},refinements:{work:"none",extraItems:{}}};
    styleNote.hidden = !activeStyle; styleNote.textContent = activeStyle ? text : "";
    $("rs-type").value = style.inputs.tripType; $("rs-bag").value = style.inputs.bag; $("rs-mode").value = style.inputs.mode; $("rs-work").value = style.refinements.work || "none";
    ["hike","workout","water","fish"].forEach(function(k){ $("rs-" + k).checked = !!style.inputs.activities[k]; });
    REFINE_EXTRAS.forEach(function(c){ var x = $("rs-extra-" + c.key); if (x) x.checked = !!(style.refinements.extraItems && style.refinements.extraItems[c.key]); });
    $("rs-daypack").checked = !!style.refinements.daypack; $("rs-rugged").checked = !!style.refinements.ruggedHike; $("rs-brooks").checked = !!style.refinements.brooksToo; $("rs-intl").checked = !!style.inputs.intl;
    $("rs-climate").value = "unknown"; $("rs-rain").checked = false; $("rs-occasions").checked = !!style.inputs.occasions || $("rs-work").value !== "none";
    ["workDays","formalDays","dinners"].forEach(function(k){ $("rs-" + k).value = 0; });
    fire("rs-occasions"); fire("rs-hike");   // the setup's own count/hiking visibility handlers
  }
  function chosenStyle(){ return packingTripStyles().find(function(x){ return x.id === styleSelect.value; }) || null; }
  function chosenPast(){ return pastSelect ? pastTrips.find(function(x){ return x.id === pastSelect.value; }) || null : null; }
  styleSelect.addEventListener("change", function(){ var st = chosenStyle(); if (pastSelect) pastSelect.value = "";
    PackGen.setupStyle = st ? {id:id, style:clone(st)} : null;
    reuse(st, st ? "Reusing " + st.name + ": " + packingStyleSummary(st) + ". Confirm dates, occasion counts and weather for this trip." : ""); });
  if (pastSelect) pastSelect.addEventListener("change", function(){ var past = chosenPast(), st = past ? packingPastTripStyle(past) : null; styleSelect.value = "";
    PackGen.setupStyle = past ? {id:id, style:clone(st), past:past} : null;
    reuse(st, past ? packingPastTripNote(past) : ""); });
  // A restored unfinished draft keeps its style / past-trip choice (fields themselves were already restored by autosave.js).
  try { var d = JSON.parse(localStorage.getItem(packingDraftPath("setup:" + id)) || "null"), fs = d && d.data && d.data.fields;
    if (fs && /Restored your unfinished draft/.test(form.textContent)){
      var pv = fs["rs-past"] && fs["rs-past"].value, sv = fs["rs-style"] && fs["rs-style"].value;
      if (pv && pastSelect){ pastSelect.value = pv; var past = chosenPast(); if (past){ PackGen.setupStyle = {id:id, style:packingPastTripStyle(past), past:past}; styleNote.hidden = false; styleNote.textContent = packingPastTripNote(past); } }
      else if (sv){ styleSelect.value = sv; var st = chosenStyle(); if (st){ PackGen.setupStyle = {id:id, style:clone(st)}; styleNote.hidden = false; styleNote.textContent = "Reusing " + st.name + ": " + packingStyleSummary(st) + ". Confirm dates, occasion counts and weather for this trip."; } } } } catch(e){}
}

/* ---------- Exports through the artifact's downloads capability ----------
   The live artifact runs sandboxed and declares "downloads" (as the itinerary's offline copy uses). The standalone's
   packExportDownload is synchronous and export.js has already written "File downloaded…" when it returns, so the result
   (saved / declined / failed) updates that status line afterwards. A declined or failed save also puts back the previous
   pack_meta/export record, so the export-changed banner doesn't treat an unsaved file as exported. Anchor download is
   used only when the capability is absent. */
var PG_dl = null, PG_dlKnown;   // PG_dlKnown: undefined until the capability lookup settles, then the API or null
function PG_downloads(){ if (!PG_dl) PG_dl = (window.claude && typeof window.claude.use === "function") ? window.claude.use("downloads").then(function(x){ return (PG_dlKnown = x || null); }, function(){ return (PG_dlKnown = null); }) : Promise.resolve(PG_dlKnown = null); return PG_dl; }
var PG_packExportDownload = packExportDownload;
packExportDownload = function(t, content, extension, type){
  var btn = (typeof LAST_BTN !== "undefined" && LAST_BTN) || document.activeElement, box = btn && btn.closest ? btn.closest(".inline-export, .sheet-body") : null;
  var status = box ? Array.prototype.find.call(box.querySelectorAll('p.muted[role="status"]'), function(p){ return p.closest(".inline-export, .sheet-body") === box; }) : null;
  var recPath = "trip/" + t.id + "/pack_meta/export", prevRec = PackGen.mirror[recPath] == null ? null : clone(PackGen.mirror[recPath]), started = Date.now();
  var filename = String(t.name || t.where || "Trip").replace(/[\/\\:*?"<>|]+/g, " ").trim() + " Packing List." + extension;
  function say(x){ if (status) status.textContent = x; }
  if (PG_dlKnown === null || !(window.claude && typeof window.claude.use === "function")) return PG_packExportDownload(t, content, extension, type);   // no capability: anchor download, still inside the tap
  // Wait for export.js's record write (if any), restore the previous record, redraw the list page (its banner state lives in
  // the page), and once the redrawn export controls are ready show the result message there.
  function unrecord(msg){
    var tries = 0; (function poll(){ if ((PackGen.localAt[recPath] || 0) >= started || tries++ > 40){ if ((PackGen.localAt[recPath] || 0) < started) return;
        (prevRec ? db.doc(recPath).set(prevRec) : db.doc(recPath).delete()).then(function(){ if (!PackGen.onTab()) return; render(true); if (!msg) return;
          var n = 0; (function ready(){ var b = document.getElementById("pe-enex"), st = b && b.closest(".inline-export") && b.closest(".inline-export").querySelector('p.muted[role="status"]');
            if (b && !b.disabled && st){ st.textContent = msg; return; } if (n++ < 100) setTimeout(ready, 50); })(); }).catch(function(){}); return; } setTimeout(poll, 50); })(); }
  PG_downloads().then(function(dl){
    if (!dl){ PG_packExportDownload(t, content, extension, type); return; }
    say("Saving " + filename + "…");
    return dl.save({filename:filename, data:new Blob([content], {type:type})}).then(function(r){
      if (r && r.status === "saved") say(extension === "enex" ? "Saved " + filename + ". On a Mac, use Notes → File → Import to Notes." : "Saved " + filename + ".");
      else { say(""); unrecord(""); }
    }, function(e){ var msg = e && e.code === "declined" ? "" : "Couldn't save the file here. Try again, or use Copy under More export options."; say(msg); unrecord(msg); });
  });
};
