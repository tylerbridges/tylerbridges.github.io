import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const storeSrc = readFileSync(new URL("../shared/store.js", import.meta.url), "utf8");
const configSrc = readFileSync(new URL("../shared/supabase-config.js", import.meta.url), "utf8");
assert.match(configSrc, /https:\/\/bpimarlvrastqchhxdcl\.supabase\.co/);
assert.match(configSrc, /key:\s*"sb_publishable_/);
assert.doesNotMatch(configSrc, /key:\s*"sb_secret_|key:\s*"[^"]*service_role/);

function waitFor(fn, ms = 2000){
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function tick(){
      let value;
      try { value = fn(); } catch(e){ reject(e); return; }
      if (value){ resolve(value); return; }
      if (Date.now() - start > ms){ reject(new Error("timed out")); return; }
      setTimeout(tick, 10);
    })();
  });
}
function memoryStorage(seed){
  const memory = new Map(seed || []);
  return {
    getItem(k){ return memory.has(k) ? memory.get(k) : null; },
    setItem(k, v){ memory.set(k, String(v)); },
    removeItem(k){ memory.delete(k); },
    key(i){ return [...memory.keys()][i] || null; },
    get length(){ return memory.size; }
  };
}
function jwt(role){
  const body = Buffer.from(JSON.stringify({role})).toString("base64url");
  return "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." + body + ".sig";
}
function load(setup){
  const localStorage = setup.localStorage || memoryStorage();
  const calls = {create:0, handlers:[]};
  const rows = setup.rows || new Map();
  const upserts = [];
  function builder(){
    const b = {
      _op:"select", _a:0, _b:999,
      select(){ b._op = "select"; return b; },
      order(){ return b; },
      range(a, c){ b._a = a; b._b = c; return b; },
      eq(col, val){ b._eq = val; return b; },
      upsert(input){ b._op = "upsert"; b._rows = Array.isArray(input) ? input : [input]; return b; },
      delete(){ b._op = "delete"; return b; },
      then(ok, bad){
        const run = () => Promise.resolve(b.exec()).then(ok, bad);
        if (b._op === "select" && setup.delaySelect && !b._waited){
          b._waited = true;
          return new Promise(r => setTimeout(r, setup.delaySelect)).then(run);
        }
        return run();
      },
      exec(){
        if (b._op === "upsert"){
          b._rows.forEach(row => { rows.set(row.path, JSON.parse(JSON.stringify(row.data))); upserts.push(row); });
          return {data:null, error:null};
        }
        if (b._op === "delete"){ rows.delete(b._eq); return {data:null, error:null}; }
        const all = [...rows.entries()].map(([path, data]) => ({path, data})).sort((a, c) => a.path < c.path ? -1 : 1);
        return {data:all.slice(b._a, b._b + 1), error:null};
      }
    };
    return b;
  }
  const session = setup.session === undefined ? {user:{id:"11111111-1111-4111-8111-111111111111", email:"tylerbridges1@gmail.com"}} : setup.session;
  const client = {
    rows, upserts,
    auth:{
      getSession(){ return Promise.resolve({data:{session}, error:null}); },
      onAuthStateChange(cb){ calls.handlers.push(cb); if (session) cb("INITIAL_SESSION", session); return {data:{subscription:{unsubscribe(){}}}}; },
      signInWithPassword(){ return Promise.resolve({data:{session}, error:null}); },
      signInWithOtp(){ return Promise.resolve({data:{}, error:null}); },
      signUp(){ return Promise.resolve({data:{}, error:null}); },
      signOut(){ return Promise.resolve({error:null}); }
    },
    from(){ return builder(); },
    channel(){ return {on(type, filter, cb){ calls.remote = cb; calls.filter = filter; return this; }, subscribe(){ return this; }}; },
    removeChannel(){}
  };
  const c = vm.createContext({
    console, URL, URLSearchParams, atob:(s) => Buffer.from(s, "base64").toString("utf8"),
    setTimeout, clearTimeout, localStorage,
    location:{href:"http://localhost:8000/packing-list/", search:"", hash:"", origin:"http://localhost:8000", pathname:"/packing-list/"},
    history:{replaceState(){}},
    document:{getElementById(){ return null; }, createElement(){ return null; }, addEventListener(){}, visibilityState:"visible"},
    addEventListener(){},
    PACK_TEST_PREFIX:setup.prefix || "",
    TRAVEL_SUPABASE:setup.config,
    supabase:{createClient(){ calls.create++; return client; }}
  });
  c.window = c;
  vm.runInContext("var db = null;", c);
  vm.runInContext(storeSrc, c);
  return {c, calls, client, localStorage};
}

const publishable = {url:"https://bpimarlvrastqchhxdcl.supabase.co", key:"sb_publishable_DSlSqyq3cxFs_v46gl_4Bw_qNG0_Iiu", email:"tylerbridges1@gmail.com"};

// Local mode stays synchronous and lists only immediate children.
{
  const {c} = load({config:null, session:null});
  await c.db.doc("trip/A/pack_items/1").set({label:"Shirt"});
  await c.db.doc("trip/A/pack_items/1/nested").set({label:"nope"});
  await c.db.doc("trips/A").set({name:"A", bag:{size:"carry"}});
  await c.db.doc("trips/A").update({bag:{color:"blue"}, gone:{__delete__:true}});
  const trip = await c.db.doc("trips/A").get();
  assert.equal(trip.data().bag.size, "carry");
  assert.equal(trip.data().bag.color, "blue");
  assert.equal(trip.data().gone, undefined);
  const items = await c.db.collection("trip/A/pack_items").get();
  assert.equal(items.docs.map(d => d.id).join(","), "1");
  const exported = c.Store.exportAll();
  assert.equal(exported["trips/A"].name, "A");
  c.Store.importAll({"trips/B":{name:"B"}});
  assert.equal(c.Store.exportAll()["trips/B"].name, "B");
  let seen = null;
  c.db.doc("trips/B").onSnapshot(snap => { seen = snap.data().name; });
  await waitFor(() => seen === "B");
}

// Empty account imports this browser's ta: rows. Test-mode keys are not part of that.
{
  const localStorage = memoryStorage([["ta:trips/ONE", JSON.stringify({name:"Browser"})], ["packing-test:ta:trips/HIDDEN", JSON.stringify({name:"Sandbox"})]]);
  const {c, calls, client} = load({config:publishable, localStorage, rows:new Map()});
  await waitFor(() => client.rows.get("trips/ONE") && client.rows.get("trips/ONE").name === "Browser");
  assert.equal(calls.create, 1);
  assert.equal(client.upserts[0].user_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(client.rows.has("trips/HIDDEN"), false);
  assert.equal(JSON.parse(localStorage.getItem("ta:trips/ONE")).name, "Browser");
  const listed = await c.db.collection("trips").get();
  assert.equal(listed.docs.map(d => d.id).join(","), "ONE");
}

// Cloud wins when both sides differ. Canonically equal JSON does not ask for an import.
{
  const localStorage = memoryStorage([
    ["ta:trips/ONE", JSON.stringify({name:"Browser"})],
    ["ta:meta/packing", JSON.stringify({b:1, a:2})]
  ]);
  const rows = new Map([["trips/ONE", {name:"Cloud"}], ["meta/packing", {a:2, b:1}]]);
  const {c, client, calls} = load({config:publishable, localStorage, rows});
  await waitFor(() => JSON.parse(localStorage.getItem("ta:trips/ONE")).name === "Cloud");
  const stash = JSON.parse(localStorage.getItem("ta-cloud-stash"));
  assert.equal(Object.keys(stash.docs).join(","), "trips/ONE");
  assert.equal(stash.docs["trips/ONE"].name, "Browser");
  assert.equal(JSON.parse(localStorage.getItem("ta:meta/packing")).a, 2);
  c.Store.dismissBrowserCopy();
  assert.ok(localStorage.getItem("ta-cloud-stash-skip"));
  await c.Store.importBrowserCopy();
  assert.equal(client.rows.get("trips/ONE").name, "Browser");
  assert.equal(localStorage.getItem("ta-cloud-stash"), null);
  await c.db.doc("trip/A/pack_items/shirt").set({label:"Shirt"});
  await c.db.doc("trip/A/pack_items/shirt/nested").set({label:"Nested"});
  const kids = await c.db.collection("trip/A/pack_items").get();
  assert.equal(kids.docs.map(d => d.id).join(","), "shirt");
  assert.equal(client.rows.get("trip/A/pack_items/shirt").label, "Shirt");
  localStorage.removeItem("ta:trips/ONE");
  await waitFor(() => !client.rows.has("trips/ONE"));
  calls.remote({eventType:"UPDATE", new:{path:"trips/TWO", data:{name:"Phone"}}});
  await waitFor(() => JSON.parse(localStorage.getItem("ta:trips/TWO")).name === "Phone");
  calls.remote({eventType:"DELETE", old:{}});
  await waitFor(() => client.rows.size >= 0 && calls.remote);
}

// Secret keys never build a client. Test flow never reaches the network client either.
{
  const secret = load({config:{url:"https://bpimarlvrastqchhxdcl.supabase.co", key:"sb_secret_nope"}, session:null});
  assert.equal(secret.calls.create, 0);
  await secret.c.db.doc("trips/LOCAL").set({name:"Local"});
  assert.equal(JSON.parse(secret.localStorage.getItem("ta:trips/LOCAL")).name, "Local");
  const service = load({config:{url:"https://bpimarlvrastqchhxdcl.supabase.co", key:jwt("service_role")}, session:null});
  assert.equal(service.calls.create, 0);
  const sandbox = load({config:publishable, prefix:"packing-test:"});
  assert.equal(sandbox.calls.create, 0);
  await sandbox.c.db.doc("trips/T").set({name:"Test"});
  assert.equal(JSON.parse(sandbox.localStorage.getItem("packing-test:ta:trips/T")).name, "Test");
  assert.equal(sandbox.localStorage.getItem("ta:trips/T"), null);
}

// A write while the first account read is still in flight stays local and is the copy uploaded.
{
  const localStorage = memoryStorage([["ta:trips/ONE", JSON.stringify({name:"Browser"})]]);
  const rows = new Map([["trips/ONE", {name:"Account"}]]);
  const {c, client} = load({config:publishable, localStorage, rows, delaySelect:40});
  await c.db.doc("trips/ONE").set({name:"During"});
  await waitFor(() => client.rows.get("trips/ONE") && client.rows.get("trips/ONE").name === "During");
  assert.equal(JSON.parse(localStorage.getItem("ta:trips/ONE")).name, "During");
  assert.equal(localStorage.getItem("ta-cloud-stash"), null);
}

console.log("store-cloud ok");
