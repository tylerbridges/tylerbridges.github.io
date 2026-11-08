"use strict";
/* ================= Shared core =================
   Helpers lifted from the Travel Dashboard (js/core.js and js/trip.js) so the extracted
   packing and itinerary modules run on their own. Same names and behavior as the dashboard;
   anything tied to the dashboard's home page, chat, costs or tasks is left out. */
var IDX = {home: "Rochester, MN"}, TRIPS = {}, ORDER = [], FRAGS = {}, FRAG_DB = {}, FRAG_AT = {};
var STATE = {}, PACK = {}, db = null, wantFocus = true, OPEN = {}, READY = false;
var RAW = {}, ARCHIVED = [], LIVE = false;
var view = document.getElementById("view"), statusEl = document.getElementById("status");
var MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var STATE_LABEL = {confirmed:"Complete", reported:"Complete", done:"Complete", open:"Open", risk:"Open"};

function showStatus(html, force){ if (!statusEl) return; statusEl.innerHTML = html; statusEl.hidden = !html || (!force && !/Not saved|Couldn't|Nothing new|Saved\./.test(html)); }
function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function today(){ var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function isoOf(d){ return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
function isoToday(){ return isoOf(today()); }
function pd(s){ if (!s) return null; var p = s.split("-"); if (p.length !== 3) return null; return new Date(+p[0], +p[1]-1, +p[2]); }
function fmt(s){ var d = pd(s); return d ? MO[d.getMonth()] + " " + d.getDate() : "—"; }
function fmtD(s){ var d = pd(s); return d ? WD[d.getDay()] + " " + MO[d.getMonth()] + " " + d.getDate() : ""; }
function diff(s){ var d = pd(s); return d ? Math.round((d - today()) / 86400000) : null; }
function tripDates(t){ var out = [], a = pd(t.start), b = pd(t.end || t.start); if (!a || !b) return out; for (var d = new Date(a); d <= b && out.length < 60; d.setDate(d.getDate() + 1)) out.push(isoOf(d)); return out; }
function escHtml(x){ return String(x == null ? "" : x).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
// Guard: Maps direction links never carry an origin, so they start from the phone's location.
function noOrigin(url){ try { var u = new URL(url); if (/google\.[^/]+\/maps\/dir/.test(u.href) && u.searchParams.has("origin")){ u.searchParams.delete("origin"); return u.toString(); } } catch(e){} return url; }
function lsGet(k, dflt){ try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : dflt; } catch(e){ return dflt; } }
function lsSet(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
function clone(o){ return JSON.parse(JSON.stringify(o || {})); }
function slug(x){ return (x || "TRIP").toUpperCase().replace(/[^A-Z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,24) || "TRIP"; }
function newTripId(name, where, start){ var base = slug((where || name).split(",")[0]) + "-" + (start || "TBD"), id = base, n = 2; while (RAW[id]) id = base + "-" + n++; return id; }

/* ================= Trip records =================
   Same shape as the dashboard's trips/<ID> documents: {name, where, start, end, who, status, bookings:{id:{...}}, days:[]}. */
function normTrip(d){
  var t = {open:[], segments:[], days:[], who:"", where:"", status:"Researching"};
  Object.keys(d).forEach(function(k){ t[k] = d[k]; });
  if (d.bookings && typeof d.bookings === "object"){
    t.segments = Object.keys(d.bookings).map(function(k){ var b = clone(d.bookings[k]); b.id = k; return b; })
      .filter(function(b){ return !b.removed; }).sort(function(a,b){ return (a.order || 0) - (b.order || 0); });
  }
  return t;
}
function rebuild(){ TRIPS = {}; ORDER = []; ARCHIVED = [];
  Object.keys(RAW).forEach(function(id){ var t = normTrip(RAW[id]); t.id = id; TRIPS[id] = t; (t.archived ? ARCHIVED : ORDER).push(id); });
  ORDER.sort(function(a, b){ return (TRIPS[a].start || "9999") < (TRIPS[b].start || "9999") ? -1 : 1; }); }
function m(t){ var o = STATE[t.id] || {}, r = {}; Object.keys(t).forEach(function(k){ r[k] = t[k]; }); r.notes = o.notes || ""; r.checks = o.checks || {}; r.extra = []; return r; }
var SAVES = null;
function saveNote(pr, what){ if (SAVES) SAVES.push(pr.then(function(ok){ return {ok:ok !== false, what:what}; }, function(){ return {ok:false, what:what}; })); return pr; }
function saveTrip(id, patch, isNew, quiet){
  var cur = clone(RAW[id]);
  (function merge(a, b){ Object.keys(b).forEach(function(k){ if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) merge(a[k], b[k]); else a[k] = b[k]; }); })(cur, patch);
  RAW[id] = cur; rebuild(); if (!quiet) render(true);
  return saveNote(db.doc("trips/" + id).set(cur).then(function(){ return true; }), "trip");
}
function deleteTrip(id){ delete RAW[id]; rebuild(); return db.doc("trips/" + id).delete(); }
function phase(t){
  if (!t.start) return {k:"undated", label:"Dates TBD"};
  var a = diff(t.start), b = diff(t.end || t.start);
  if (a <= 0 && b >= 0) return {k:"now", label:"Day " + (1 - a) + " of " + (b - a + 1)};
  if (a > 0) return {k:"upcoming", label: a === 1 ? "Tomorrow" : "In " + a + " days", d:a};
  return {k:"past", label:"Returned " + fmt(t.end || t.start)};
}
function closing(t){ return phase(t).k === "past"; }
function tasks(t){ return (t.open || []).concat(t.extra || []); }
function tripLen(t){ var n = tripDates(t).length; return n ? " (" + n + " day" + (n === 1 ? "" : "s") + ")" : ""; }

/* ================= Delete + Undo (dashboard rule: one tap, Undo bar for 5 s) ================= */
var UNDO = null;
function undoToast(msg, undo, after){
  if (UNDO){ var prev = UNDO; UNDO = null; clearTimeout(prev.timer); prev.box.remove(); if (prev.after) try { prev.after(); } catch(e){} }
  var box = el("div","undotoast"), b = el("button",null,"Undo"); b.type = "button"; box.setAttribute("role","status");
  box.appendChild(el("span",null,msg)); box.appendChild(b); document.body.appendChild(box);
  var me = {box:box, after:after, timer:setTimeout(function(){ if (UNDO === me){ UNDO = null; box.remove(); if (after) try { after(); } catch(e){} } }, 5000)};
  b.addEventListener("click", function(){ if (UNDO !== me) return; UNDO = null; clearTimeout(me.timer); box.remove(); try { undo(); } catch(e){} });
  UNDO = me;
}

/* ================= Forms and sheets (from trip.js) ================= */
function collapsible(title, key){ var d = el("details","panel"); if (OPEN[key]) d.open = true; d.appendChild(el("summary",null,title)); d.addEventListener("toggle", function(){ OPEN[key] = d.open; }); return d; }
function fieldEl(labelText, input, hint){ var f = el("div","field"), l = el("label",null,labelText); l.htmlFor = input.id; f.appendChild(l); f.appendChild(input); if (hint) f.appendChild(el("span","muted", hint)); return f; }
function inp(id, type, value, ph){ var i = el("input"); i.type = type || "text"; i.id = id; if (value != null) i.value = value; if (ph) i.placeholder = ph; return i; }
function sel(id, options, value){ var s = el("select"); s.id = id; options.forEach(function(o){ var op = el("option",null,o[1]); op.value = o[0]; if (o[0] === value) op.selected = true; s.appendChild(op); }); return s; }
var sheetBg = null;
function closeSheet(){ if (sheetBg){ sheetBg.remove(); sheetBg = null; document.body.style.overflow = ""; } }
function openSheet(title){
  closeSheet();
  sheetBg = el("div","sheet-bg"); var sh = el("div","sheet"); sh.setAttribute("role","dialog"); sh.setAttribute("aria-modal","true"); sh.setAttribute("aria-label", title);
  var hd = el("div","sheet-head"); hd.appendChild(el("h2",null,title));
  var x = el("button","linkbtn","Close"); x.type = "button"; x.addEventListener("click", closeSheet); hd.appendChild(x);
  var body = el("div","sheet-body"); sh.appendChild(hd); sh.appendChild(body); sheetBg.appendChild(sh);
  sheetBg.addEventListener("click", function(e){ if (e.target === sheetBg) closeSheet(); });
  document.body.appendChild(sheetBg); document.body.style.overflow = "hidden";
  return body;
}
document.addEventListener("keydown", function(e){ if (e.key === "Escape" && sheetBg) closeSheet(); });
window.addEventListener("hashchange", closeSheet);
function thinking(box, text){ box.textContent = ""; var p = el("p","thinking", text || "Thinking…"); box.appendChild(p); return p; }
function tripBrief(t){
  return JSON.stringify({trip:t.name, destination:t.where, dates: t.start ? t.start + " to " + t.end : "not set", travelers:t.who, status:t.status,
    bookings: (t.segments || []).map(function(s){ return {what:s.label, detail:s.detail, date:s.day || "", status:STATE_LABEL[s.state] || s.state}; })});
}
