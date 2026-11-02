"use strict";
/* ================= Document store =================
   Same calls the modules already make: db.doc(path).get/set/update/delete/onSnapshot
   and db.collection(path).onSnapshot / .get. Paths stay trips/<ID>, trip/<ID>/pack_items/<id>,
   meta/packing, templates/<id>, and the rest.
   Without a configured project, or in packing Test flow (?test=1), everything stays in
   localStorage under "<prefix>ta:<path>" exactly as before.
   With the publishable key and a signed-in session, those paths are rows in public.ta_docs.
   This browser keeps a mirror so exportAll(), delete-list, and draft keys still read
   localStorage. The account is the source of truth after sign-in. */
var Store = (function(){
  var P = (window.PACK_TEST_PREFIX || "") + "ta:", docSubs = {}, colSubs = {};
  var rawSet = localStorage.setItem.bind(localStorage);
  var rawRemove = localStorage.removeItem.bind(localStorage);
  var STASH = "ta-cloud-stash", SKIP = "ta-cloud-stash-skip", OUTBOX = "ta-cloud-outbox";
  var cloudClient = null, cloudOn = false, hydrating = false, hooked = false, warnedSecret = false;
  var account = null, epoch = 0, gate = null, releaseGate = null, gateTimer = null;
  var pending = {}, outboxGen = {}, channel = null, pollTimer = null, refreshing = false, mirroring = false;

  function key(path){ return P + path; }
  function read(path){ try { var v = localStorage.getItem(key(path)); return v ? JSON.parse(v) : null; } catch(e){ return null; } }
  function put(path, data){
    try {
      var payload = JSON.stringify(data);
      // Once the hook is installed, Store writes go straight to the original method.
      if (cloudOn || hooked) rawSet(key(path), payload);
      else localStorage.setItem(key(path), payload);
      return true;
    } catch(e){ return false; }
  }
  function erase(path){ try { if (cloudOn || hooked) rawRemove(key(path)); else localStorage.removeItem(key(path)); } catch(e){} }
  function parent(path){ var i = path.lastIndexOf("/"); return i < 0 ? "" : path.slice(0, i); }
  function snap(path, data){ var id = path.slice(path.lastIndexOf("/") + 1); return {id:id, exists: data != null, data: function(){ return data == null ? undefined : JSON.parse(JSON.stringify(data)); }}; }
  function list(coll){ var out = [], pre = key(coll) + "/";
    for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf(pre) === 0 && k.slice(pre.length).indexOf("/") < 0) out.push(snap(k.slice(P.length), read(k.slice(P.length)))); }
    return out; }
  function notify(path){ if (hydrating) return; setTimeout(function(){
    (docSubs[path] || []).forEach(function(cb){ try { cb(snap(path, read(path))); } catch(e){ console.error(e); } });
    var c = parent(path); (colSubs[c] || []).forEach(function(cb){ try { cb({docs:list(c)}); } catch(e){ console.error(e); } }); }, 0); }
  function deepMerge(a, b){ Object.keys(b).forEach(function(k){ var v = b[k];
    if (v && typeof v === "object" && v.__delete__ === true){ delete a[k]; return; }
    if (v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) deepMerge(a[k], v); else a[k] = v; }); return a; }
  function fail(){ return Promise.reject(Object.assign(new Error("Storage is full or blocked"), {code:"storage"})); }
  function storageError(err){
    var msg = err && (err.message || err.error_description || err.msg) || "Not saved";
    return Object.assign(new Error(msg), {code:"storage"});
  }
  function whenHeld(run){ if (releaseGate) return gate.then(run); return Promise.resolve(run()); }
  function holdLocal(path, data, isDelete){
    if (hydrating && account && !cloudOn) rememberOutbox(path, isDelete, data);
  }
  function applySet(path, data){
    if (!put(path, data)) return fail();
    notify(path);
    if (cloudOn) return schedulePush(path, data, false);
    holdLocal(path, data, false);
    return Promise.resolve();
  }
  function doc(path){ return {
    get: function(){ return whenHeld(function(){ return snap(path, read(path)); }); },
    set: function(data){ return whenHeld(function(){ return applySet(path, data); }); },
    update: function(patch){ return whenHeld(function(){
      var cur = read(path); if (cur == null) return Promise.reject(Object.assign(new Error("No document"), {code:"not_found"}));
      return applySet(path, deepMerge(cur, patch));
    }); },
    delete: function(){ return whenHeld(function(){ erase(path); notify(path); if (cloudOn) return schedulePush(path, null, true); holdLocal(path, null, true); return Promise.resolve(); }); },
    onSnapshot: function(cb){ (docSubs[path] = docSubs[path] || []).push(cb);
      var fire = function(){ try { cb(snap(path, read(path))); } catch(e){ console.error(e); } };
      if (releaseGate) gate.then(fire); else setTimeout(fire, 0);
      return function(){ docSubs[path] = (docSubs[path] || []).filter(function(x){ return x !== cb; }); }; }
  }; }
  function collection(path){ return {
    onSnapshot: function(cb){ (colSubs[path] = colSubs[path] || []).push(cb);
      var fire = function(){ try { cb({docs:list(path)}); } catch(e){ console.error(e); } };
      if (releaseGate) gate.then(fire); else setTimeout(fire, 0);
      return function(){ colSubs[path] = (colSubs[path] || []).filter(function(x){ return x !== cb; }); }; },
    get: function(){ return whenHeld(function(){ return {docs:list(path)}; }); }
  }; }
  window.addEventListener("storage", function(e){ if (e.key && e.key.indexOf(P) === 0) notify(e.key.slice(P.length)); });
  function exportAll(){ var o = {}; for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf(P) === 0) o[k.slice(P.length)] = read(k.slice(P.length)); } return o; }
  function importAll(o){
    return whenHeld(function(){
      var jobs = [];
      Object.keys(o || {}).forEach(function(p){ if (!put(p, o[p])) return; notify(p); if (cloudOn) jobs.push(schedulePush(p, o[p], false)); });
      return jobs.length ? Promise.all(jobs) : Promise.resolve();
    });
  }

  function testMode(){ return !!window.PACK_TEST_PREFIX; }
  function b64urlDecode(s){
    try {
      if (typeof atob !== "function") return "";
      var pad = String(s).replace(/-/g, "+").replace(/_/g, "/");
      while (pad.length % 4) pad += "=";
      return atob(pad);
    } catch(e){ return ""; }
  }
  function jwtRole(token){
    try { var part = String(token).split(".")[1]; return (JSON.parse(b64urlDecode(part)) || {}).role || ""; }
    catch(e){ return ""; }
  }
  function cfg(){ return window.TRAVEL_SUPABASE || {}; }
  function projectUrl(){ return String(cfg().url || "").trim().replace(/\/$/, ""); }
  function projectKey(){ return String(cfg().key || cfg().anonKey || "").trim(); }
  function configured(){
    var url = projectUrl(), key = projectKey();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) return false;
    if (!key || key.indexOf("sb_secret_") === 0 || jwtRole(key) === "service_role"){
      if (key && (key.indexOf("sb_secret_") === 0 || jwtRole(key) === "service_role") && !warnedSecret){
        warnedSecret = true;
        try { console.warn("Supabase secret key ignored. Paste the publishable key."); } catch(e){}
      }
      return false;
    }
    if (key.indexOf("sb_publishable_") === 0) return true;
    return jwtRole(key) === "anon";
  }
  function accountEmail(){ return String(cfg().email || "").trim(); }
  function canon(v){
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(function(k){ return JSON.stringify(k) + ":" + canon(v[k]); }).join(",") + "}";
    return JSON.stringify(v);
  }
  function readJson(storageKey){ try { return JSON.parse(localStorage.getItem(storageKey) || "null"); } catch(e){ return null; } }
  function readOutbox(){ var box = readJson(OUTBOX); return box && typeof box === "object" && !Array.isArray(box) ? box : {}; }
  function saveOutbox(box){ try { if (box && Object.keys(box).length) rawSet(OUTBOX, JSON.stringify(box)); else rawRemove(OUTBOX); } catch(e){} }
  function rememberOutbox(path, isDelete, data){
    outboxGen[path] = (outboxGen[path] || 0) + 1;
    var gen = outboxGen[path], box = readOutbox();
    box[path] = isDelete ? {op:"del", gen:gen} : {op:"set", gen:gen, data:data};
    saveOutbox(box);
    return gen;
  }
  function forgetOutbox(path, gen){
    var box = readOutbox();
    if (!box[path] || (gen && box[path].gen !== gen)) return;
    delete box[path];
    saveOutbox(box);
  }
  function readStash(){ var stash = readJson(STASH); return stash && stash.docs ? stash : null; }
  function liveDocs(){
    var o = {}, i, k;
    for (i = 0; i < localStorage.length; i++){
      k = localStorage.key(i);
      if (!k || k.indexOf("ta:") !== 0) continue;
      try { o[k.slice(3)] = JSON.parse(localStorage.getItem(k)); } catch(e){}
    }
    return o;
  }
  function notifyAll(){
    var paths = {}, i, k;
    for (i = 0; i < localStorage.length; i++){ k = localStorage.key(i); if (k && k.indexOf(P) === 0) paths[k.slice(P.length)] = 1; }
    Object.keys(docSubs).forEach(function(p){ paths[p] = 1; });
    Object.keys(paths).forEach(function(p){ (docSubs[p] || []).forEach(function(cb){ try { cb(snap(p, read(p))); } catch(e){ console.error(e); } }); });
    Object.keys(colSubs).forEach(function(c){ (colSubs[c] || []).forEach(function(cb){ try { cb({docs:list(c)}); } catch(e){ console.error(e); } }); });
  }
  function schedulePush(path, data, isDelete){
    var gen = rememberOutbox(path, isDelete, data);
    return new Promise(function(resolve, reject){
      var slot = pending[path] || (pending[path] = {resolvers:[]});
      slot.data = data; slot.del = !!isDelete; slot.gen = gen;
      slot.resolvers.push({resolve:resolve, reject:reject});
      clearTimeout(slot.timer);
      slot.timer = setTimeout(function(){ flushPath(path); }, isDelete ? 0 : 300);
    });
  }
  function flushPath(path){
    var slot = pending[path];
    if (!slot) return;
    clearTimeout(slot.timer);
    delete pending[path];
    var resolvers = slot.resolvers, gen = slot.gen;
    if (!cloudOn || !cloudClient || !account){ resolvers.forEach(function(r){ r.resolve(); }); return; }
    var req = slot.del
      ? cloudClient.from("ta_docs").delete().eq("path", path)
      : cloudClient.from("ta_docs").upsert({user_id:account.id, path:path, data:slot.data == null ? {} : slot.data}, {onConflict:"user_id,path"});
    Promise.resolve(req).then(function(res){
      if (res && res.error) throw res.error;
      forgetOutbox(path, gen);
      resolvers.forEach(function(r){ r.resolve(); });
    }).catch(function(err){ resolvers.forEach(function(r){ r.reject(storageError(err)); }); });
  }
  function upsertChunks(rows){
    var size = 100, i = 0;
    function next(){
      if (i >= rows.length) return Promise.resolve();
      var part = rows.slice(i, i + size);
      i += size;
      return cloudClient.from("ta_docs").upsert(part, {onConflict:"user_id,path"}).then(function(res){
        if (res && res.error) throw res.error;
        return next();
      });
    }
    return next();
  }
  function fetchAll(){
    var size = 1000, acc = [];
    function page(offset){
      return cloudClient.from("ta_docs").select("path,data").order("path", {ascending:true}).range(offset, offset + size - 1).then(function(res){
        if (res.error) throw res.error;
        var rows = res.data || [];
        acc = acc.concat(rows);
        if (rows.length < size) return acc;
        return page(offset + size);
      });
    }
    return page(0);
  }
  function mirrorCloud(cloudMap, outbox){
    var keep = {}, remove = [], i, k;
    Object.keys(cloudMap).forEach(function(p){ keep[p] = 1; });
    Object.keys(outbox).forEach(function(p){ keep[p] = 1; });
    mirroring = true;
    try {
      for (i = 0; i < localStorage.length; i++){
        k = localStorage.key(i);
        if (k && k.indexOf("ta:") === 0 && !keep[k.slice(3)]) remove.push(k);
      }
      remove.forEach(function(storageKey){ rawRemove(storageKey); });
      Object.keys(cloudMap).forEach(function(p){
        if (outbox[p]) return;
        rawSet("ta:" + p, JSON.stringify(cloudMap[p]));
      });
      Object.keys(outbox).forEach(function(p){
        if (outbox[p].op === "del") rawRemove("ta:" + p);
        else rawSet("ta:" + p, JSON.stringify(outbox[p].data));
      });
      // A write during the mirror is newer than the snapshot just applied.
      var latest = readOutbox();
      Object.keys(latest).forEach(function(p){
        if (latest[p].op === "del") rawRemove("ta:" + p);
        else rawSet("ta:" + p, JSON.stringify(latest[p].data));
      });
    } finally { mirroring = false; }
  }
  function pushNow(path){
    var current = readOutbox()[path];
    if (!current) return Promise.resolve();
    var gen = current.gen, isDelete = current.op === "del", data = current.data;
    var req = isDelete
      ? cloudClient.from("ta_docs").delete().eq("path", path)
      : cloudClient.from("ta_docs").upsert({user_id:account.id, path:path, data:data == null ? {} : data}, {onConflict:"user_id,path"});
    return Promise.resolve(req).then(function(res){
      if (res && res.error) throw res.error;
      var now = readOutbox()[path];
      if (!now || now.gen === gen){ forgetOutbox(path, gen); return; }
      return pushNow(path);
    });
  }
  function replayOutbox(pass){
    var paths = Object.keys(readOutbox());
    if (!paths.length || !cloudClient || !account) return Promise.resolve();
    return Promise.all(paths.map(function(p){ return pushNow(p); })).then(function(){
      if ((pass || 0) < 3 && Object.keys(readOutbox()).length) return replayOutbox((pass || 0) + 1);
    });
  }
  function hydrate(my){
    return fetchAll().then(function(rows){
      if (my !== epoch) return "stale";
      var cloudMap = {}, outbox = readOutbox(), local = liveDocs(), diff = {};
      rows.forEach(function(row){ if (row && row.path) cloudMap[row.path] = row.data; });
      Object.keys(local).forEach(function(p){
        if (outbox[p]) return;
        if (!Object.prototype.hasOwnProperty.call(cloudMap, p) || canon(cloudMap[p]) !== canon(local[p])) diff[p] = local[p];
      });
      var locals = Object.keys(local).filter(function(p){ return !outbox[p]; });
      if (!rows.length && locals.length && !Object.keys(outbox).length){
        var seeded = locals.filter(function(p){ return local[p] != null; }).map(function(p){ return {user_id:account.id, path:p, data:local[p]}; });
        return upsertChunks(seeded).then(function(){
          if (my !== epoch) return "stale";
          try { rawSet("ta-cloud-imported", String(Date.now())); } catch(e){}
          return replayOutbox();
        });
      }
      if (Object.keys(diff).length){
        try { rawSet(STASH, JSON.stringify({at:Date.now(), docs:diff})); }
        catch(e){ throw new Error("Couldn't keep this browser's lists aside for import."); }
      }
      if (my !== epoch) return "stale";
      mirrorCloud(cloudMap, readOutbox());
      return replayOutbox();
    });
  }
  function afterExternalSet(storageKey, value){
    if (mirroring || typeof storageKey !== "string" || storageKey.indexOf("ta:") !== 0) return;
    var path = storageKey.slice(3), data;
    try { data = JSON.parse(value); } catch(e){ return; }
    if (hydrating && account && !cloudOn){ holdLocal(path, data === null ? null : data, data === null); return; }
    if (!cloudOn) return;
    if (data === null) schedulePush(path, null, true); else schedulePush(path, data, false);
    notify(path);
  }
  function afterExternalRemove(storageKey){
    if (mirroring || typeof storageKey !== "string" || storageKey.indexOf("ta:") !== 0) return;
    var path = storageKey.slice(3);
    if (hydrating && account && !cloudOn){ holdLocal(path, null, true); return; }
    if (!cloudOn) return;
    schedulePush(path, null, true);
    notify(path);
  }
  function installHook(){
    if (hooked) return;
    try {
      if (typeof Storage !== "undefined" && Storage.prototype && Storage.prototype.setItem){
        var origS = Storage.prototype.setItem, origR = Storage.prototype.removeItem;
        rawSet = function(k, v){ return origS.call(localStorage, k, v); };
        rawRemove = function(k){ return origR.call(localStorage, k); };
        Storage.prototype.setItem = function(k, v){ origS.call(this, k, v); if (this === localStorage) afterExternalSet(k, v); };
        Storage.prototype.removeItem = function(k){ origR.call(this, k); if (this === localStorage) afterExternalRemove(k); };
        hooked = true;
        return;
      }
    } catch(e){}
    try {
      var instS = localStorage.setItem, instR = localStorage.removeItem;
      rawSet = function(k, v){ return instS.call(localStorage, k, v); };
      rawRemove = function(k){ return instR.call(localStorage, k); };
      localStorage.setItem = function(k, v){ rawSet(k, v); afterExternalSet(k, v); };
      localStorage.removeItem = function(k){ rawRemove(k); afterExternalRemove(k); };
      hooked = true;
    } catch(e){}
  }
  function onRemote(payload){
    if (!payload || !cloudOn) return;
    var type = payload.eventType || payload.event || "";
    if (type === "DELETE"){
      var oldPath = payload.old && payload.old.path;
      if (!oldPath || readOutbox()[oldPath] || pending[oldPath]){ if (!oldPath) refreshFromCloud(); return; }
      mirroring = true;
      try { rawRemove("ta:" + oldPath); } finally { mirroring = false; }
      notify(oldPath);
      return;
    }
    var row = payload.new;
    if (!row || !row.path || readOutbox()[row.path] || pending[row.path]) return;
    if (canon(read(row.path)) === canon(row.data)) return;
    mirroring = true;
    try { rawSet("ta:" + row.path, JSON.stringify(row.data)); } finally { mirroring = false; }
    notify(row.path);
  }
  function refreshFromCloud(){
    if (!cloudOn || refreshing || !cloudClient) return;
    refreshing = true;
    fetchAll().then(function(rows){
      if (!cloudOn) return;
      var cloudMap = {}, outbox = readOutbox(), local = liveDocs();
      rows.forEach(function(row){ if (row && row.path) cloudMap[row.path] = row.data; });
      Object.keys(cloudMap).forEach(function(p){
        if (outbox[p] || pending[p]) return;
        if (canon(local[p]) === canon(cloudMap[p])) return;
        mirroring = true;
        try { rawSet("ta:" + p, JSON.stringify(cloudMap[p])); } finally { mirroring = false; }
        notify(p);
      });
      Object.keys(local).forEach(function(p){
        if (outbox[p] || pending[p] || Object.prototype.hasOwnProperty.call(cloudMap, p)) return;
        mirroring = true;
        try { rawRemove("ta:" + p); } finally { mirroring = false; }
        notify(p);
      });
    }).catch(function(){}).then(function(){ refreshing = false; });
  }
  function startPoll(){
    stopPoll();
    var tick = function(){
      if (!cloudOn) return;
      if (!document || document.visibilityState !== "hidden") refreshFromCloud();
      pollTimer = setTimeout(tick, 12000);
      if (pollTimer && pollTimer.unref) pollTimer.unref();
    };
    pollTimer = setTimeout(tick, 12000);
    if (pollTimer && pollTimer.unref) pollTimer.unref();
  }
  function stopPoll(){ if (pollTimer){ clearTimeout(pollTimer); pollTimer = null; } }
  function subscribe(){
    if (!cloudClient || channel || !cloudClient.channel) return;
    try {
      channel = cloudClient.channel("ta-docs", {config:{private:true}});
      if (channel.on) channel.on("postgres_changes", {event:"*", schema:"public", table:"ta_docs", filter:account ? "user_id=eq." + account.id : undefined}, onRemote);
      if (channel.subscribe) channel.subscribe();
    } catch(e){ channel = null; }
  }
  function unsubscribe(){
    if (channel && cloudClient && cloudClient.removeChannel){ try { cloudClient.removeChannel(channel); } catch(e){} }
    channel = null;
  }
  function holdGate(){
    if (gate) return;
    gate = new Promise(function(resolve){ releaseGate = resolve; });
    gateTimer = setTimeout(function(){ openGate(); }, 8000);
    if (gateTimer && gateTimer.unref) gateTimer.unref();
  }
  function openGate(){
    if (!releaseGate) return false;
    var fn = releaseGate;
    releaseGate = null;
    if (gateTimer){ clearTimeout(gateTimer); gateTimer = null; }
    fn();
    return true;
  }
  function cachedSessionLikely(){
    try {
      for (var i = 0; i < localStorage.length; i++){
        var k = localStorage.key(i);
        if (!k || k.indexOf("auth-token") < 0) continue;
        var v = localStorage.getItem(k) || "";
        if (v.indexOf("access_token") > 0) return true;
      }
    } catch(e){}
    return false;
  }
  function banner(){
    if (!document || !document.getElementById || !document.createElement) return null;
    var existing = document.getElementById("ta-cloud");
    if (existing) return existing;
    var view = document.getElementById("view");
    if (!view || !view.parentNode) return null;
    var box = document.createElement("div");
    if (!box) return null;
    box.id = "ta-cloud";
    box.className = "status";
    box.hidden = true;
    box.setAttribute("role", "status");
    view.parentNode.insertBefore(box, view);
    return box;
  }
  function hideBanner(){ var box = banner(); if (!box) return; box.hidden = true; box.textContent = ""; }
  function showSyncError(text){
    var box = banner();
    if (!box || !document.createElement) return;
    box.hidden = false;
    box.textContent = "";
    box.appendChild(document.createTextNode(text + " "));
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = "Try again";
    btn.addEventListener("click", retrySync);
    box.appendChild(btn);
  }
  function paintMigration(){
    if (!cloudOn){ hideBanner(); return; }
    var box = banner();
    if (!box || !document.createElement) return;
    var stash = readStash();
    if (!stash || !Object.keys(stash.docs).length){ hideBanner(); return; }
    var hash = canon(stash.docs), skip = "";
    try { skip = localStorage.getItem(SKIP) || ""; } catch(e){}
    if (skip === hash){ hideBanner(); return; }
    box.hidden = false;
    box.textContent = "";
    box.appendChild(document.createTextNode("This browser has packing lists that aren't in your account yet. Import keeps the browser copy where they differ."));
    var row = document.createElement("div");
    row.className = "ta-row";
    var imp = document.createElement("button");
    imp.type = "button"; imp.className = "btn primary"; imp.textContent = "Import into account";
    imp.addEventListener("click", function(){ imp.disabled = true; importBrowserCopy().then(function(){ location.reload(); }).catch(function(){ imp.disabled = false; showSyncError("Couldn't import this browser's lists."); }); });
    var keep = document.createElement("button");
    keep.type = "button"; keep.className = "btn"; keep.textContent = "Keep account copy";
    keep.addEventListener("click", dismissBrowserCopy);
    row.appendChild(imp); row.appendChild(keep); box.appendChild(row);
  }
  function paintAccount(){
    if (testMode() || !configured() || !document || !document.getElementById || !document.createElement) return;
    var where = document.getElementById("ta-where");
    var foot = document.getElementById("foot");
    if (where) where.textContent = account ? ("synced · " + (account.email || "your account")) : "saved in this browser";
    if (!foot) return;
    var btn = document.getElementById("ta-account-btn");
    if (!btn){
      foot.appendChild(document.createTextNode(" · "));
      btn = document.createElement("button");
      btn.id = "ta-account-btn";
      btn.type = "button";
      btn.className = "linkbtn";
      btn.addEventListener("click", openAccount);
      foot.appendChild(btn);
    }
    btn.textContent = account ? "Account" : "Sign in to sync";
  }
  function authRedirect(){
    try { return new URL("../auth.html", location.href).href; }
    catch(e){ return location.origin + "/auth.html"; }
  }
  function authText(err){
    var msg = err && (err.message || err.msg) || "Something went wrong.";
    var code = err && err.code || "";
    if (/invalid login/i.test(msg)) return "Email or password didn't match.";
    if (/not confirmed/i.test(msg)) return "Confirm that email first, then sign in.";
    if (/signups not allowed|signup_disabled/i.test(msg + code)) return "New accounts are turned off. Sign in instead.";
    if (/already registered|already been registered/i.test(msg)) return "That email already has an account. Sign in instead.";
    if (/rate limit|only request this after/i.test(msg) || code === "over_email_send_rate_limit") return "The email limit was reached. Wait a bit, or sign in with a password.";
    if (/not authorized/i.test(msg)) return "The built-in mail only delivers to addresses on the Supabase project team.";
    return msg;
  }
  function openAccount(){
    if (typeof openSheet !== "function" || typeof el !== "function") return;
    var body = openSheet(account ? "Account" : "Sign in");
    var note = el("p", "muted");
    if (account){
      note.textContent = "Signed in as " + (account.email || "your account") + ". Lists on this account are the copy other browsers open.";
      body.appendChild(note);
      var stash = readStash();
      if (stash && Object.keys(stash.docs).length){
        body.appendChild(el("p", null, "A copy from this browser is still waiting. Import overwrites the same lists in the account."));
        var stashRow = el("div", "actions");
        stashRow.style.display = "flex"; stashRow.style.gap = "8px"; stashRow.style.flexWrap = "wrap";
        var bring = el("button", "btn primary", "Import browser copy"); bring.type = "button";
        var drop = el("button", "btn", "Discard browser copy"); drop.type = "button";
        bring.addEventListener("click", function(){ bring.disabled = true; importBrowserCopy().then(function(){ location.reload(); }).catch(function(){ bring.disabled = false; note.textContent = "Couldn't import this browser's lists."; }); });
        drop.addEventListener("click", function(){ discardBrowserCopy(); closeSheet(); });
        stashRow.appendChild(bring); stashRow.appendChild(drop); body.appendChild(stashRow);
      }
      var out = el("button", "btn", "Sign out"); out.type = "button";
      out.addEventListener("click", function(){ signOut(); closeSheet(); });
      body.appendChild(out);
      return;
    }
    note.textContent = "Sign in to sync trips and packing lists across browsers. Until then they stay in this browser.";
    body.appendChild(note);
    var email = inp("ta-email", "email", accountEmail(), "you@example.com");
    email.autocomplete = "username";
    email.inputMode = "email";
    var password = inp("ta-password", "password", "", "Password");
    password.autocomplete = "current-password";
    body.appendChild(fieldEl("Email", email));
    body.appendChild(fieldEl("Password", password, "At least 6 characters for a new account."));
    var msg = el("p", "muted", "");
    var row = el("div", "actions");
    row.style.display = "flex"; row.style.gap = "8px"; row.style.flexWrap = "wrap";
    var signIn = el("button", "btn primary", "Sign in"); signIn.type = "button";
    var link = el("button", "btn", "Email me a sign-in link"); link.type = "button";
    var create = el("button", "btn", "Create account"); create.type = "button";
    function busy(on){ signIn.disabled = link.disabled = create.disabled = on; }
    function address(){ return email.value.trim(); }
    signIn.addEventListener("click", function(){
      if (!cloudClient){ msg.textContent = "The sync library didn't load."; return; }
      busy(true);
      cloudClient.auth.signInWithPassword({email:address(), password:password.value}).then(function(res){
        if (res.error) throw res.error;
        closeSheet();
      }).catch(function(err){ busy(false); msg.textContent = authText(err); });
    });
    link.addEventListener("click", function(){
      if (!cloudClient){ msg.textContent = "The sync library didn't load."; return; }
      if (!address()){ msg.textContent = "Enter the email on the Supabase project."; email.focus(); return; }
      busy(true);
      try { sessionStorage.setItem("ta-auth-return", location.href); } catch(e){}
      cloudClient.auth.signInWithOtp({email:address(), options:{emailRedirectTo:authRedirect(), shouldCreateUser:false}}).then(function(res){
        if (res.error) throw res.error;
        busy(false);
        msg.textContent = "Check that inbox for a sign-in link. Open it in this browser. The free mail service only delivers to the project team, a couple of times an hour.";
      }).catch(function(err){ busy(false); msg.textContent = authText(err); });
    });
    create.addEventListener("click", function(){
      if (!cloudClient){ msg.textContent = "The sync library didn't load."; return; }
      if (password.value.length < 6){ msg.textContent = "Use a password of at least 6 characters."; password.focus(); return; }
      busy(true);
      try { sessionStorage.setItem("ta-auth-return", location.href); } catch(e){}
      cloudClient.auth.signUp({email:address(), password:password.value, options:{emailRedirectTo:authRedirect()}}).then(function(res){
        if (res.error) throw res.error;
        if (res.data && res.data.session){ closeSheet(); return; }
        busy(false);
        msg.textContent = "Check that inbox to confirm the account, then sign in. If no message arrives, add the user from the Supabase dashboard instead.";
      }).catch(function(err){ busy(false); msg.textContent = authText(err); });
    });
    row.appendChild(signIn); row.appendChild(link); row.appendChild(create);
    body.appendChild(row); body.appendChild(msg);
    setTimeout(function(){ email.focus(); }, 0);
  }
  function finishCloud(my){
    if (my !== epoch) return;
    hydrating = false;
    cloudOn = true;
    installHook();
    subscribe();
    startPoll();
    paintAccount();
    var openedNow = openGate();
    paintMigration();
    if (!openedNow) notifyAll();
  }
  function failCloud(my, text){
    if (my !== epoch) return;
    hydrating = false;
    cloudOn = false;
    paintAccount();
    showSyncError(text);
    openGate();
  }
  function applySession(session){
    var id = session && session.user && session.user.id || "";
    if (!id){
      epoch++;
      hydrating = false;
      cloudOn = false;
      account = null;
      stopPoll();
      unsubscribe();
      hideBanner();
      paintAccount();
      openGate();
      return;
    }
    if (account && account.id === id && (cloudOn || hydrating)){ paintAccount(); return; }
    hydrating = true;
    var my = ++epoch;
    account = {id:id, email:session.user.email || accountEmail()};
    installHook();
    paintAccount();
    hydrate(my).then(function(state){
      if (state === "stale" || my !== epoch) return;
      finishCloud(my);
    }).catch(function(){
      failCloud(my, "Signed in, but lists couldn't sync. They're still saved in this browser. Run the Supabase SQL setup if this keeps happening.");
    });
  }
  function retrySync(){
    if (!account || !cloudClient || hydrating) return;
    hydrating = true;
    var my = ++epoch;
    hideBanner();
    hydrate(my).then(function(state){
      if (state === "stale" || my !== epoch) return;
      finishCloud(my);
    }).catch(function(){
      failCloud(my, "Still couldn't sync. Lists stay in this browser.");
    });
  }
  function signOut(){
    var done = function(){ applySession(null); };
    if (!cloudClient || !cloudClient.auth){ done(); return; }
    cloudClient.auth.signOut().then(done, done);
  }
  function importBrowserCopy(){
    var stash = readStash();
    if (!stash || !cloudClient || !account) return Promise.resolve();
    var rows = [];
    mirroring = true;
    try {
      Object.keys(stash.docs).forEach(function(p){
        if (stash.docs[p] == null) return;
        rows.push({user_id:account.id, path:p, data:stash.docs[p]});
        rawSet("ta:" + p, JSON.stringify(stash.docs[p]));
      });
    } finally { mirroring = false; }
    return upsertChunks(rows).then(function(){
      rawRemove(STASH); rawRemove(SKIP);
      hideBanner();
      notifyAll();
    });
  }
  function dismissBrowserCopy(){
    var stash = readStash();
    try { if (stash) rawSet(SKIP, canon(stash.docs)); } catch(e){}
    hideBanner();
  }
  function discardBrowserCopy(){
    try { rawRemove(STASH); rawRemove(SKIP); } catch(e){}
    hideBanner();
  }
  function stripAuthQuery(){
    try {
      if (typeof URL !== "function" || !location || !location.href) return;
      var u = new URL(location.href), changed = false;
      ["code", "error", "error_code", "error_description"].forEach(function(name){
        if (u.searchParams.has(name)){ u.searchParams.delete(name); changed = true; }
      });
      if (changed && history.replaceState) history.replaceState(null, "", u.pathname + u.search + u.hash);
      var hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
      if (hash.get("error_description") || hash.get("access_token") || hash.get("error")){
        showSyncError((hash.get("error_description") || "Sign-in didn't finish.").replace(/\+/g, " "));
        if (history.replaceState) history.replaceState(null, "", u.pathname + u.search);
      }
    } catch(e){}
  }
  function bootCloud(){
    if (testMode() || !configured()) return;
    paintAccount();
    if (cachedSessionLikely()) holdGate();
    if (!window.supabase || !window.supabase.createClient){
      showSyncError("The sync library didn't load. Lists stay in this browser.");
      openGate();
      return;
    }
    try {
      cloudClient = window.supabase.createClient(projectUrl(), projectKey(), {
        auth: {flowType:"pkce", detectSessionInUrl:true, persistSession:true, autoRefreshToken:true}
      });
    } catch(e){
      showSyncError("Couldn't start sync. Lists stay in this browser.");
      openGate();
      return;
    }
    if (document && document.addEventListener) document.addEventListener("visibilitychange", function(){
      if (document.visibilityState === "visible") refreshFromCloud();
    });
    window.addEventListener("pagehide", function(){ Object.keys(pending).forEach(flushPath); });
    cloudClient.auth.getSession().then(function(res){
      stripAuthQuery();
      applySession(res && res.data && res.data.session);
    }).catch(function(){
      showSyncError("Couldn't reach the account service. Lists stay in this browser.");
      openGate();
    });
    // Ignore a null INITIAL_SESSION. It can arrive before getSession reads storage and would
    // wipe a sign-in that is already in progress. Sign-out is an explicit event.
    cloudClient.auth.onAuthStateChange(function(event, session){
      if (event === "SIGNED_OUT") applySession(null);
      else if (session) applySession(session);
    });
  }
  bootCloud();

  return {doc:doc, collection:collection, exportAll:exportAll, importAll:importAll, importBrowserCopy:importBrowserCopy, dismissBrowserCopy:dismissBrowserCopy};
})();
db = Store;
