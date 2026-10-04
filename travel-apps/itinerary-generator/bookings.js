"use strict";
/* ================= Flights and lodging =================
   The trip details the itinerary is generated from. Saved on the trip as bookings, in the dashboard's shape
   (trips/<ID>.bookings.<id> = {type, label, detail, day, conf, state, address?, order}), so bookingShell() in
   itinerary.js places them exactly as the dashboard does: flights as fixed stops with ground legs, lodging as the
   lodging line on the check-in day. Only booked items (state "confirmed") go into the itinerary. */
function bkId(){ return "bk-" + Date.now().toString(36) + Math.random().toString(36).slice(2,5); }
function ap(x){ return String(x || "").trim().toUpperCase().slice(0,3); }
function tm(x){ // "15:05" (time input) → "3:05p"
  var m0 = /^(\d{1,2}):(\d{2})$/.exec(x || ""); if (!m0) return ""; var h = +m0[1], mm = m0[2];
  return (h % 12 || 12) + (mm === "00" ? "" : ":" + mm) + (h >= 12 ? "p" : "a"); }
function bookingsPanel(t){
  var p = collapsible("Flights & lodging · " + t.segments.length, "bk|" + t.id); p.classList.add("bkp"); if (!t.segments.length) p.open = true;
  if (!t.segments.length) p.appendChild(el("p","muted","Add your flights and where you're staying. The itinerary is built around them."));
  t.segments.slice().sort(function(a, b){ return (a.day || "").localeCompare(b.day || ""); }).forEach(function(b){
    var row = el("div","bkrow"), tx = el("span"); tx.appendChild(el("b",null,(b.type === "flight" ? "✈ " : "🛏 ") + (b.label || "")));
    tx.appendChild(el("span","muted", [b.day ? fmtD(b.day) : "", b.detail, b.conf ? "conf " + b.conf : "", b.state === "confirmed" ? "" : "not booked yet"].filter(Boolean).join(" · "))); row.appendChild(tx);
    var rm = el("button","iconbtn danger","✕"); rm.type = "button"; rm.setAttribute("aria-label","Remove " + (b.label || "booking"));
    rm.addEventListener("click", function(){ var q = {bookings:{}}; q.bookings[b.id] = {removed:true}; saveTrip(t.id, q, false, true).then(syncItin(t.id));
      undoToast("Booking removed", function(){ var u = {bookings:{}}; u.bookings[b.id] = {removed:false}; saveTrip(t.id, u, false, true).then(syncItin(t.id)); }); });
    row.appendChild(rm); p.appendChild(row); });
  var acts = el("div","actions"); acts.style.display = "flex"; acts.style.gap = "8px"; acts.style.marginTop = "10px"; acts.style.flexWrap = "wrap";
  var af = el("button","btn","+ Flight"); af.type = "button"; af.addEventListener("click", function(){ flightSheet(t); });
  var al = el("button","btn","+ Lodging"); al.type = "button"; al.addEventListener("click", function(){ lodgingSheet(t); });
  acts.appendChild(af); acts.appendChild(al); p.appendChild(acts);
  return p;
}
function syncItin(id){ return function(){ setTimeout(function(){ itinBookingSweep(); render(); }, 50); }; }
function bookedBox(id){ var l = el("label","chipchk"), c = el("input"); c.type = "checkbox"; c.id = id; c.checked = true; l.appendChild(c); l.appendChild(el("span",null,"Booked (show it in the itinerary)")); return {wrap:l, box:c}; }
function flightSheet(t){
  var body = openSheet("Add a flight"), f = el("form","form");
  var day = inp("fl-day","date", t.start), no = inp("fl-no","text", "", "e.g. UA 1234"), from = inp("fl-from","text", "MSP", "MSP"), to = inp("fl-to","text", "", "PHX"),
      dep = inp("fl-dep","time", ""), arr = inp("fl-arr","time", ""), conf = inp("fl-conf","text", "", "optional");
  f.appendChild(fieldEl("Date", day)); f.appendChild(fieldEl("Airline and flight number", no));
  var r1 = el("div","two"); r1.appendChild(fieldEl("From (airport code)", from)); r1.appendChild(fieldEl("To", to)); f.appendChild(r1);
  var r2 = el("div","two"); r2.appendChild(fieldEl("Departs", dep)); r2.appendChild(fieldEl("Arrives", arr)); f.appendChild(r2);
  f.appendChild(fieldEl("Confirmation", conf)); var bk = bookedBox("fl-booked"); f.appendChild(bk.wrap);
  var msg = el("p","muted"), go = el("button","btn primary","Add flight"); go.type = "submit"; f.appendChild(go); f.appendChild(msg); body.appendChild(f);
  f.addEventListener("submit", function(e){ e.preventDefault();
    var a = ap(from.value), b = ap(to.value);
    if (!day.value){ msg.textContent = "Pick the flight date."; return; }
    if (!/^[A-Z]{3}$/.test(a) || !/^[A-Z]{3}$/.test(b)){ msg.textContent = "Use 3-letter airport codes, like MSP and PHX."; return; }
    var d1 = tm(dep.value), d2 = tm(arr.value), num = no.value.trim().toUpperCase();
    var rec = {type:"flight", label:(num ? num + " " : "") + a + " → " + b, detail:a + (d1 ? " " + d1 : "") + " → " + b + (d2 ? " " + d2 : ""), day:day.value,
      conf:conf.value.trim(), state: bk.box.checked ? "confirmed" : "open", order:Date.now(), updatedAt:Date.now()};
    var q = {bookings:{}}; q.bookings[bkId()] = rec; closeSheet(); saveTrip(t.id, q, false, true).then(syncItin(t.id)); });
}
function lodgingSheet(t){
  var body = openSheet("Add lodging"), f = el("form","form");
  var name = inp("lg-name","text", "", "e.g. Comfort Inn Duluth West"), addr = inp("lg-addr","text", "", "Full street address"),
      din = inp("lg-in","date", t.start), dout = inp("lg-out","date", t.end), conf = inp("lg-conf","text", "", "optional");
  f.appendChild(fieldEl("Where you're staying", name)); f.appendChild(fieldEl("Address", addr));
  var r = el("div","two"); r.appendChild(fieldEl("Check in", din)); r.appendChild(fieldEl("Check out", dout)); f.appendChild(r);
  f.appendChild(fieldEl("Confirmation", conf)); var bk = bookedBox("lg-booked"); f.appendChild(bk.wrap);
  var msg = el("p","muted"), go = el("button","btn primary","Add lodging"); go.type = "submit"; f.appendChild(go); f.appendChild(msg); body.appendChild(f);
  f.addEventListener("submit", function(e){ e.preventDefault();
    var n = name.value.trim(); if (!n){ msg.textContent = "Add the hotel or place name."; name.focus(); return; }
    if (!din.value || !dout.value || dout.value <= din.value){ msg.textContent = "Check out must be after check in."; return; }
    var nights = Math.round((pd(dout.value) - pd(din.value)) / 864e5);
    var rec = {type:"lodging", label:n + " · " + nights + " night" + (nights === 1 ? "" : "s"), detail:[addr.value.trim(), "check in " + fmt(din.value) + ", out " + fmt(dout.value)].filter(Boolean).join(" · "),
      address:addr.value.trim(), day:din.value, checkout:dout.value, conf:conf.value.trim(), state: bk.box.checked ? "confirmed" : "open", order:Date.now(), updatedAt:Date.now()};
    var q = {bookings:{}}; q.bookings[bkId()] = rec; closeSheet(); saveTrip(t.id, q, false, true).then(syncItin(t.id)); });
}
