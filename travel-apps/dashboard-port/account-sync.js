"use strict";
/* ================= Packing app account sync (Nov 2026) =================
   Keeps the Dashboard's packing data in step with Tyler's standalone Packing List account (Supabase project
   bpimarlvrastqchhxdcl, table public.ta_docs, one row per document path). An artifact can't reach supabase.co
   directly, so it goes through the claude.ai Supabase connector (execute_sql) and only ever calls three fixed
   functions (supabase/migrations/002_ta_sync_functions.sql): ta_sync_state, ta_sync_read and ta_sync_write.

   Synced paths (same on both sides): trip/<ID>/pack_sections|pack_items|pack_meta/*, meta/packing,
   meta/packingLearning, meta/packingStyles, templates/*, and the packing fields of trips/<ID>.
   - Ledger meta/acctSync in the Dashboard db: per path, the hash of the last synced content and the account's
     updated_at at that moment. A side "changed" when it no longer matches the ledger.
   - Only changed on one side: copied to the other (deletes too). Changed on both, or first sync with different
     content: the account copy wins (it's what the packing app shows).
   - Trip headers: the Dashboard owns name, place, dates and status (pushed to the account); the account's
     packing fields (packing, packingDeleted, generatorSetup) come back. Trips that exist only in the account
     (and aren't deleted there) are created in the Dashboard.
   - Runs once Supabase is allowed for this page: on open, every minute while visible, a few seconds after a
     packing edit, and from the Sync now button. Never while a sheet or a text field is open. */
var AccountSync = (function(){
  var PROJECT = "bpimarlvrastqchhxdcl", UID = "3ecc982e-add2-4561-a6a3-68a7c060f21d", SERVER = "Supabase", TOOL = "execute_sql";
  var GLOBAL = ["meta/packing", "meta/packingLearning", "meta/packingStyles"], TRIP_FIELDS = ["packing", "packingDeleted", "generatorSetup"];
  var HEADER_FIELDS = ["name", "where", "start", "end", "status"];
  var S = {mcp:null, base:null, state:"starting", at:0, code:"", busy:false, again:false, timer:null, soon:null, ledger:null, stats:null, allowed:false};
  window.__acctSync = S;   // for checks

  /* ---------- helpers ---------- */
  function stable(x){ if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]"; if (x && typeof x === "object") return "{" + Object.keys(x).sort().map(function(k){ return JSON.stringify(k) + ":" + stable(x[k]); }).join(",") + "}"; return JSON.stringify(x === undefined ? null : x); }
  function hash(x){ if (x == null) return null; var s = stable(x), h = 5381, i; for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return s.length + ":" + (h >>> 0).toString(36); }
  function cp(x){ return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function lit(obj){ var s = JSON.stringify(obj), tag; do { tag = "$j" + Math.random().toString(36).slice(2, 9).replace(/[^a-z0-9]/g, "") + "$"; } while (s.indexOf(tag) >= 0); return tag + s + tag + "::jsonb"; }
  function tripOf(p){ var m0 = /^trips?\/([^/]+)/.exec(p); return m0 ? m0[1] : null; }
  function syncable(p){ return GLOBAL.indexOf(p) >= 0 || /^trip\/[^/]+\/(pack_sections|pack_items|pack_meta)\/[^/]+$/.test(p) || /^templates\/[^/]+$/.test(p); }
  function busyUi(){ var a = document.activeElement; return !!document.querySelector(".sheet-bg") || !!(a && /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName)); }

  /* ---------- connector ---------- */
  function err(code, message){ var e = new Error(message || code); e.code = code; return e; }
  function sql(q){
    return S.mcp.callTool(SERVER, TOOL, {project_id:PROJECT, query:q}, {cache:false}).then(function(res){
      var p = res && res.payload !== undefined ? res.payload : res, txt = typeof p === "string" ? p : (p && typeof p.result === "string" ? p.result : "");
      var m0 = /<untrusted-data-[0-9a-f-]+>\s*(\[[\s\S]*\])\s*<\/untrusted-data-/.exec(txt);
      if (!m0) throw err("parse", "Unexpected reply from Supabase");
      var rows = JSON.parse(m0[1]); if (!rows[0] || !("r" in rows[0])) throw err("parse", "Unexpected reply from Supabase");
      return rows[0].r;
    });
  }
  function remoteState(){ return sql("select public.ta_sync_state('" + UID + "'::uuid) as r"); }
  function remoteRead(paths){
    if (!paths.length) return Promise.resolve({});
    var out = {}, chunks = [], i; for (i = 0; i < paths.length; i += 60) chunks.push(paths.slice(i, i + 60));
    return chunks.reduce(function(pr, c){ return pr.then(function(){ return sql("select public.ta_sync_read('" + UID + "'::uuid, " + lit(c) + ") as r").then(function(r){ Object.assign(out, r || {}); }); }); }, Promise.resolve()).then(function(){ return out; });
  }
  function remoteWrite(docs, removed){
    var keys = Object.keys(docs), batches = [], cur = {}, size = 0, out = {};
    keys.forEach(function(k){ var n = JSON.stringify(docs[k]).length + k.length; if (size && size + n > 350000){ batches.push(cur); cur = {}; size = 0; } cur[k] = docs[k]; size += n; });
    if (size || !batches.length) batches.push(cur);
    return batches.reduce(function(pr, b, i){ return pr.then(function(){
      return sql("select public.ta_sync_write('" + UID + "'::uuid, " + lit(b) + ", " + lit(i === batches.length - 1 ? removed : []) + ") as r").then(function(r){ Object.assign(out, r || {}); }); }); }, Promise.resolve()).then(function(){ return out; });
  }

  /* ---------- Dashboard side ---------- */
  function localTrips(){ return (typeof RAW === "object" && RAW) || {}; }
  function readLocal(tripIds){
    var b = S.base, out = {}, jobs = [];
    GLOBAL.forEach(function(p){ jobs.push(b.doc(p).get().then(function(sn){ if (sn && sn.exists) out[p] = sn.data(); })); });
    jobs.push(b.collection("templates").get().then(function(sn){ ((sn && sn.docs) || []).forEach(function(d){ out["templates/" + d.id] = d.data(); }); }));
    tripIds.forEach(function(id){ ["pack_sections", "pack_items", "pack_meta"].forEach(function(c){
      jobs.push(b.collection("trip/" + id + "/" + c).get().then(function(sn){ ((sn && sn.docs) || []).forEach(function(d){ out["trip/" + id + "/" + c + "/" + d.id] = d.data(); }); })); }); });
    return Promise.all(jobs).then(function(){ return out; });
  }
  function hasPack(id, local){ var pre = "trip/" + id + "/pack_"; return Object.keys(local).some(function(p){ return p.indexOf(pre) === 0; }); }
  function header(t, acct){ var o = Object.assign({days:[], bookings:{}}, cp(acct) || {}); o.id = t.id;
    HEADER_FIELDS.forEach(function(k){ if (t[k] !== undefined) o[k] = t[k]; });
    TRIP_FIELDS.forEach(function(k){ if (t[k] !== undefined) o[k] = cp(t[k]); }); return o; }

  /* ---------- one sync cycle ---------- */
  function cycle(manual){
    if (!S.mcp || !S.base) return Promise.resolve();
    if (S.busy){ S.again = true; return Promise.resolve(); }
    if (!manual && busyUi()){ later(5000); return Promise.resolve(); }
    S.busy = true; S.state = "syncing"; paintStatus();
    var stats = {pulled:0, pushed:0, removedHere:0, removedThere:0, trips:0};
    var ledger, rstate, local, tripsInScope, acctTrips = {};
    return S.base.doc("meta/acctSync").get().then(function(sn){
      ledger = (sn && sn.exists && sn.data()) || {}; if (!ledger.paths) ledger = {v:1, paths:{}, trips:{}}; if (!ledger.trips) ledger.trips = {};
      return remoteState();
    }).then(function(st){
      rstate = st || {};
      var acctTripIds = Object.keys(rstate).filter(function(p){ return /^trips\/[^/]+$/.test(p); }).map(tripOf);
      return remoteRead(acctTripIds.map(function(id){ return "trips/" + id; })).then(function(r){ acctTrips = {}; Object.keys(r).forEach(function(p){ acctTrips[tripOf(p)] = r[p]; }); });
    }).then(function(){
      // Trips in scope: every Dashboard trip, plus account trips not deleted there.
      var raw = localTrips(); tripsInScope = Object.keys(raw);
      Object.keys(acctTrips).forEach(function(id){ var a = acctTrips[id].data || {}; if (!raw[id] && !a.packingDeleted && !a.replacedBy) tripsInScope.push(id); });
      return readLocal(tripsInScope);
    }).then(function(loc){
      local = loc; var raw = localTrips(), scope = {}; tripsInScope.forEach(function(id){ scope[id] = true; });
      function inScope(p){ var id = /^trip\//.test(p) ? tripOf(p) : null; return syncable(p) && (!id || scope[id]); }
      var paths = {}; Object.keys(local).concat(Object.keys(rstate), Object.keys(ledger.paths)).forEach(function(p){ if (inScope(p)) paths[p] = true; });
      var toRead = [], plan = [];
      Object.keys(paths).forEach(function(p){
        var L = local[p] !== undefined ? hash(local[p]) : null, R = rstate[p] || null, E = ledger.paths[p];
        if (!E){
          if (L && R) toRead.push(p), plan.push([p, "compare"]);
          else if (L) plan.push([p, "push"]);
          else if (R) toRead.push(p), plan.push([p, "pull"]);
          return;
        }
        var lc = L !== E.h, rc = R !== E.at;
        if (rc){ if (R) toRead.push(p), plan.push([p, "pull"]); else if (lc && L) plan.push([p, "push"]); else if (L) plan.push([p, "deleteHere"]); else plan.push([p, "forget"]); }
        else if (lc){ if (L) plan.push([p, "push"]); else plan.push([p, "deleteThere"]); }
      });
      return remoteRead(toRead).then(function(remote){
        var push = {}, removed = [], here = [];
        plan.forEach(function(x){ var p = x[0], act = x[1], r = remote[p];
          if (act === "compare"){ if (r && hash(r.data) === hash(local[p])){ ledger.paths[p] = {h:hash(local[p]), at:r.at}; return; } act = "pull"; }
          if (act === "pull"){ if (!r) return; here.push(S.base.doc(p).set(r.data).then(function(){ ledger.paths[p] = {h:hash(r.data), at:r.at}; stats.pulled++; })); }
          else if (act === "push") push[p] = local[p];
          else if (act === "deleteHere") here.push(S.base.doc(p).delete().then(function(){ delete ledger.paths[p]; stats.removedHere++; }));
          else if (act === "deleteThere"){ removed.push(p); }
          else if (act === "forget") delete ledger.paths[p];
        });
        // Trip headers.
        tripsInScope.forEach(function(id){
          var t = raw[id], a = acctTrips[id] && acctTrips[id].data, at = acctTrips[id] && acctTrips[id].at, E = ledger.trips[id];
          if (!t && a){ // account-only trip → new Dashboard trip
            var nt = {id:id, name:a.name || a.where || "Trip", where:a.where || "", start:a.start || "", end:a.end || a.start || "", who:"", status:a.status || "Researching", inactive:false,
              createdAt:a.createdAt || Date.now(), updatedAt:Date.now(), open:(typeof STARTER !== "undefined" ? STARTER.slice() : []), bookings:{}, archived:false, itinerary:false,
              packing:true, packingDeleted:false, records:[], days:[], costs:[], watch:[]};
            if (a.generatorSetup) nt.generatorSetup = cp(a.generatorSetup);
            here.push(S.base.doc("trips/" + id).set(nt).then(function(){ ledger.trips[id] = {at:at}; stats.trips++; }));
            var nh = header(nt, a); if (stable(nh) !== stable(a)) push["trips/" + id] = nh; return; }
          if (!t) return;
          var acctChanged = a && (!E || E.at !== at);
          if (acctChanged){ // the account's packing fields come back
            var patch = {}; TRIP_FIELDS.forEach(function(k){ if (a[k] !== undefined && stable(a[k]) !== stable(t[k])) patch[k] = cp(a[k]); });
            if (Object.keys(patch).length){ here.push(S.base.doc("trips/" + id).update(patch).then(function(){ stats.trips++; })); Object.assign(t, patch); } }
          var listed = t.packing === true || hasPack(id, local) || !!a;
          if (!listed) return;
          var h = header(t, a);
          if (!a || stable(h) !== stable(a)) push["trips/" + id] = h;
          ledger.trips[id] = {at:at || null, pending:!!push["trips/" + id]};
        });
        return Promise.all(here).then(function(){
          var n = Object.keys(push).length; S.lastPush = Object.keys(push).concat(removed.map(function(p){ return "-" + p; }));
          if (!n && !removed.length) return;
          return remoteWrite(push, removed).then(function(ats){
            Object.keys(push).forEach(function(p){ if (/^trips\//.test(p)){ ledger.trips[tripOf(p)] = {at:ats[p] || null}; } else { ledger.paths[p] = {h:hash(push[p]), at:ats[p] || null}; stats.pushed++; } });
            removed.forEach(function(p){ delete ledger.paths[p]; stats.removedThere++; });
          });
        });
      });
    }).then(function(){
      return S.base.doc("meta/acctSync").set(ledger);
    }).then(function(){
      S.state = "ok"; S.code = ""; S.at = Date.now(); S.stats = stats;
      if ((stats.pulled || stats.removedHere || stats.trips) && typeof render === "function" && !busyUi()){ if (window.PackGen) PackGen.loadedTrip = null; render(true); }
    }, function(e){
      S.state = "error"; S.code = (e && e.code) || "error"; S.message = (e && e.message) || ""; if (S.code === "not_in_manifest" || S.code === "approval_required") S.allowed = false;
    }).then(function(){ S.busy = false; paintStatus(); if (S.again){ S.again = false; later(1500); } });
  }
  function later(ms){ clearTimeout(S.soon); S.soon = setTimeout(function(){ if (!document.hidden && S.allowed) cycle(false); }, ms); }

  /* ---------- status line on the Packing tab ---------- */
  function ago(t){ var s = Math.round((Date.now() - t) / 1000); return s < 45 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : Math.round(s / 3600) + " hr ago"; }
  function paintStatus(){
    var root = document.getElementById("packgen"); if (!root) return;
    var box = root.querySelector(":scope > .acct-sync"); if (!box){ box = document.createElement("div"); box.className = "acct-sync gen-note"; box.setAttribute("role", "status"); root.insertBefore(box, root.firstChild); }
    var text = "", button = null, b;
    if (!S.mcp) text = S.state === "starting" ? "" : "Packing app sync isn't available in this view.";
    else if (!S.allowed){ text = "Sync this Dashboard with your Packing List app."; button = ["Turn on sync", function(){ S.allowed = true; cycle(true); }]; }
    else if (S.state === "syncing") text = "Syncing with your packing app…";
    else if (S.state === "ok") text = "Synced with your packing app · " + ago(S.at);
    else if (S.state === "error"){
      var c = S.code;
      text = c === "server_not_connected" ? "Add Supabase in claude.ai Settings → Connectors to sync with your packing app."
        : c === "needs_reauth" ? "Reconnect Supabase in claude.ai Settings → Connectors to keep syncing."
        : c === "not_in_manifest" || c === "approval_required" ? "Packing app sync needs your OK for Supabase."
        : c === "selection_required" ? "Choose which Supabase connection to use, then try again."
        : c === "server_unavailable" ? "Supabase didn't answer. Will try again shortly."
        : "Couldn't sync with your packing app" + (S.message ? " (" + S.message.slice(0, 80) + ")" : "") + ".";
      button = [c === "not_in_manifest" || c === "approval_required" ? "Allow and sync" : "Sync now", function(){ S.allowed = true; cycle(true); }];
    }
    if (S.state === "ok") button = ["Sync now", function(){ cycle(true); }];
    var key = text + "|" + (button ? button[0] : ""); if (box.dataset.k === key) return; box.dataset.k = key;
    box.textContent = ""; box.hidden = !text; if (!text) return;
    box.appendChild(document.createTextNode(text + " "));
    if (button){ b = document.createElement("button"); b.type = "button"; b.className = "linkbtn"; b.textContent = button[0]; b.addEventListener("click", button[1]); box.appendChild(b); }
  }

  /* ---------- start ---------- */
  function wrapForEdits(api){
    // A packing edit anywhere on the page schedules a quick sync. Sync's own writes go through S.base and don't.
    var o = Object.create(api);
    o.doc = function(p){ var ref = api.doc.apply(api, arguments), path = String(p), w = Object.create(ref);
      ["set", "update", "delete"].forEach(function(k){ w[k] = function(){ var r = ref[k].apply(ref, arguments); if (syncable(path) || /^trips\//.test(path)) r.then(function(){ if (S.allowed) later(3000); }, function(){}); return r; }; });
      return w; };
    return o;
  }
  function start(){
    if (!(window.claude && typeof window.claude.use === "function")){ S.state = "off"; return; }
    (function waitDb(n){
      if (typeof db === "undefined" || !db || typeof READY === "undefined" || !READY){ if (n < 600) setTimeout(function(){ waitDb(n + 1); }, 100); return; }
      S.base = db; db = wrapForEdits(db);
      window.claude.use("mcp").then(function(mcp){
        S.mcp = mcp || null; S.state = mcp ? "ready" : "off";
        if (!mcp){ paintStatus(); return; }
        var perms = window.claude.use("permissions").catch(function(){ return null; });
        return perms.then(function(pm){ return pm && pm.state ? Promise.resolve(pm.state("mcp:" + SERVER)).catch(function(){ return "unavailable"; }) : "prompt"; }).then(function(st){
          S.allowed = st === "granted";
          paintStatus();
          if (S.allowed) cycle(false);
        });
      }).catch(function(){ S.state = "off"; paintStatus(); });
      setInterval(function(){ if (!document.hidden && S.allowed) cycle(false); }, 60000);
      setInterval(paintStatus, 1000);
      document.addEventListener("visibilitychange", function(){ if (!document.hidden && S.allowed) later(800); });
    })(0);
  }
  start();
  return {sync:function(){ S.allowed = true; return cycle(true); }, _state:S};
})();
