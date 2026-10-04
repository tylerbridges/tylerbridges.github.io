"use strict";
/* ================= App shell =================
   Trip list, trip form and routing shared by both apps. Each app sets window.APP before this file loads:
     APP.title        page heading
     APP.tripView(t, focus)  the element shown on a trip's page (packing list or itinerary)
     APP.tripExtras(t)       optional extra panel under the trip header (e.g. bookings)
   Routes: #  (trips) · #new · #<ID> · #<ID>.edit · #<ID>.YYYY-MM-DD (itinerary day) */
function route(){
  var h = (location.hash || "").replace("#",""), i = h.indexOf("."), id = i < 0 ? h : h.slice(0, i), rest = i < 0 ? "" : h.slice(i + 1);
  var t = TRIPS[id] || null;
  if (!t) return {t:null, page:h};
  if (rest === "edit") return {t:t, tab:"edit"};
  if (/^\d{4}-\d{2}-\d{2}$/.test(rest)) return {t:t, tab:"itinerary", focus:rest};
  return {t:t, tab: APP.tab || "main"};
}
function render(){
  if (!READY) return;
  var r = route(), y = window.scrollY;
  view.textContent = "";
  document.getElementById("h1").textContent = r.t ? r.t.name : APP.title;
  view.appendChild(r.t ? (r.tab === "edit" ? tripForm(r.t) : tripPage(m(r.t), r.focus)) : r.page === "new" ? tripForm(null) : homeView());
  window.scrollTo(0, y);
}
window.addEventListener("hashchange", function(){ wantFocus = true; render(); window.scrollTo(0,0); });

function homeView(){
  var w = el("div","stack"), top = el("div","controls bar");
  var nb = el("a","btn primary","+ New trip"); nb.href = "#new"; nb.style.textDecoration = "none"; top.appendChild(nb);
  top.appendChild(el("span","spacer"));
  var st = el("button","linkbtn","Settings"); st.type = "button"; st.addEventListener("click", function(){ aiSettingsSheet(render); }); top.appendChild(st);
  w.appendChild(top);
  if (!ORDER.length){ var e = el("section","panel"); e.appendChild(el("p",null,"No trips yet.")); e.appendChild(el("p","muted","Add a trip with its destination and dates to start.")); w.appendChild(e); }
  ORDER.forEach(function(id){ var t = TRIPS[id], a = el("a","panel tripcard"); a.href = "#" + id; a.style.display = "block"; a.style.textDecoration = "none"; a.style.color = "inherit";
    a.appendChild(el("h2",null,t.name)); a.appendChild(el("p","muted", [t.where, t.start ? fmt(t.start) + " – " + fmt(t.end || t.start) + tripLen(t) : "Dates TBD", phase(t).label].filter(Boolean).join(" · "))); w.appendChild(a); });
  if (!AI.sample) w.appendChild(el("p","muted","Claude drafting is off. Turn it on in Settings with your own API key, or use the built-in rules."));
  return w;
}
function tripPage(t, focus){
  var w = el("div","stack"), back = el("a","back","← All trips"); back.href = "#"; w.appendChild(back);
  var hd = el("section","panel"), meta = el("p","muted", [t.where, t.start ? fmt(t.start) + " – " + fmt(t.end || t.start) + tripLen(t) : "Dates TBD", t.who].filter(Boolean).join(" · "));
  hd.appendChild(meta); var ed = el("a","linkbtn","Edit trip"); ed.href = "#" + t.id + ".edit"; hd.appendChild(ed); w.appendChild(hd);
  if (APP.tripExtras){ var x = APP.tripExtras(t); if (x) w.appendChild(x); }
  w.appendChild(APP.tripView(t, focus));
  return w;
}
function tripForm(t){
  var f = el("form","form panel"), isNew = !t; t = t || {name:"", where:"", start:"", end:"", who:"", kind:""};
  f.appendChild(el("h2","k", isNew ? "New trip" : "Edit trip"));
  var n = inp("tf-name","text", t.name, "e.g. Duluth & North Shore"), wh = inp("tf-where","text", t.where, "City, State"), a = inp("tf-start","date", t.start), b = inp("tf-end","date", t.end), who = inp("tf-who","text", t.who, "e.g. Tyler & Taryn");
  f.appendChild(fieldEl("Trip name", n)); f.appendChild(fieldEl("Destination", wh));
  var two = el("div","two"); two.appendChild(fieldEl("Start", a)); two.appendChild(fieldEl("End", b)); f.appendChild(two);
  f.appendChild(fieldEl("Travelers", who));
  var msg = el("p","muted"), acts = el("div","actions"); acts.style.display = "flex"; acts.style.gap = "8px"; acts.style.flexWrap = "wrap";
  var sv = el("button","btn primary", isNew ? "Create trip" : "Save"); sv.type = "submit"; acts.appendChild(sv);
  var cc = el("a","btn","Cancel"); cc.href = isNew ? "#" : "#" + t.id; cc.style.textDecoration = "none"; acts.appendChild(cc);
  if (!isNew){ var del = el("button","btn danger","Delete trip"); del.type = "button"; var armed = false;
    del.addEventListener("click", function(){ if (!armed){ armed = true; del.textContent = "Tap again to delete"; return; } deleteTrip(t.id).then(function(){ location.hash = ""; }); }); acts.appendChild(del); }
  f.appendChild(acts); f.appendChild(msg);
  f.addEventListener("submit", function(e){ e.preventDefault();
    var name = n.value.trim(), start = a.value, end = b.value || a.value;
    if (!name){ msg.textContent = "Give the trip a name."; n.focus(); return; }
    if (start && end < start){ msg.textContent = "End date is before the start."; return; }
    var patch = {name:name, where:wh.value.trim(), start:start, end:end, who:who.value.trim()};
    if (isNew){ var id = newTripId(name, patch.where, start); patch.status = "Researching"; patch.bookings = {}; patch.days = []; patch.createdAt = Date.now();
      saveTrip(id, patch, true, true).then(function(){ location.hash = id; }); }
    else saveTrip(t.id, patch, false, true).then(function(){ location.hash = t.id; });
  });
  setTimeout(function(){ if (isNew) n.focus(); }, 0);
  return f;
}

/* Boot: trips load from the local store and stay live. */
(function boot(){
  function calm(){ var a = document.activeElement; return !(a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT" || a.tagName === "SELECT")) && !document.querySelector(".stopedit") && !sheetBg; }
  db.collection("trips").onSnapshot(function(sn){ var first = !READY; RAW = {}; (sn.docs || []).forEach(function(d){ RAW[d.id] = d.data(); }); rebuild(); READY = true;
    if (first || (calm() && route().tab !== APP.tab)) render(); if (APP.onTrips) APP.onTrips(); });
})();
