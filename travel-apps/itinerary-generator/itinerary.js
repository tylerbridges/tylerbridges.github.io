"use strict";
/* ================= Change this day (AI) =================
   Claude rewrites one day's section of the stored itinerary HTML from a plain-language request.
   Tyler previews it; only Save writes trip/<ID>/itinerary/main. Edits are logged in `changes` for reconcile. */
function cleanSection(html, id, date){
  var tpl = document.createElement("template"); tpl.innerHTML = String(html || "").replace(/^[\s\S]*?(<section)/i, "$1").replace(/(<\/section>)[\s\S]*$/i, "$1");
  var sec = tpl.content.querySelector("section"); if (!sec) return null;
  sec.querySelectorAll("script,style,iframe,object,embed,form,input,img").forEach(function(n){ n.remove(); });
  sec.querySelectorAll("*").forEach(function(n){ [].slice.call(n.attributes).forEach(function(a){
    if (/^on/i.test(a.name)) n.removeAttribute(a.name);
    if (a.name === "href" && !/^(https:\/\/|#)/i.test(a.value)) n.removeAttribute("href"); }); });
  sec.id = id; sec.setAttribute("data-date", date); sec.classList.add("day");
  sec.querySelectorAll("a[href^='https']").forEach(function(a){ a.target = "_blank"; a.rel = "noopener"; });
  return sec;
}
function dayPrompt(t, q, origHTML){
  return "You edit one day of a travel itinerary stored as HTML. Apply the traveler's change and return the whole updated <section> element and nothing else (no code fences, no commentary).\n\n" +
      "Rules:\n- Keep the same structure and class names: section.day, .day-head with h2 and span.date, a.drive (the day's Google Maps route), .eta and .eta-hint blocks unchanged, ul of stops with span.t times, ul.details notes, .lodging.\n" +
      "- Recalculate later times so the day still flows, keeping realistic drive times and small buffers. Write times like 9:50–10:40a or 6:20p with no tilde.\n" +
      "- Update the a.drive link's waypoints and destination to match the stops in order (https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=...&waypoints=A%7CB). Place links use https://www.google.com/maps/search/?api=1&query=Place+Name+Area.\n" +
      "- Update the h2 title if the day's main stops change. Keep data-cut/data-drop attributes on stops that remain; drop them for removed stops.\n- Change nothing the traveler didn't ask for beyond what the change requires.\n\n" +
      ITIN_FORMAT + "- If the current day does not follow the DAY FORMAT, convert it while applying the change.\n\n" +
      "Trip: " + t.name + " (" + (t.where || "") + ")\nChange requested: " + q + "\n\nCurrent day HTML:\n" + origHTML;
}
function changeDay(t, secId){
  var raw = document.createElement("div"); raw.innerHTML = FRAGS[t.id] || "";
  var orig = raw.querySelector("section#" + secId); if (!orig) return;
  var date = orig.getAttribute("data-date"), title = (orig.querySelector("h2") || {}).textContent || "this day";
  var body = openSheet("Change " + fmtD(date));
  var ta = el("textarea"); ta.id = "cd-q"; ta.rows = 3; ta.placeholder = "e.g. Skip Tower Fall and leave 30 minutes later";
  var go = el("button","btn primary","Update the day"); go.type = "button";
  var out = el("div"); body.appendChild(ta); body.appendChild(go); body.appendChild(out);
  setTimeout(function(){ ta.focus(); }, 0);
  go.addEventListener("click", function(){
    var q = ta.value.trim(); if (!q){ ta.focus(); return; }
    go.disabled = true; var st = thinking(out, "Updating " + title + "…");
    var prompt = dayPrompt(t, q, orig.outerHTML);
    AI.sample(prompt, {cache:false, onText: function(){ st.textContent = "Rewriting the day…"; }}).then(function(r){
      go.disabled = false; out.textContent = "";
      var sec = cleanSection(r && r.text, secId, date);
      if (!sec || !sec.querySelector("ul")){ out.appendChild(el("p","errline","Claude's answer didn't come back as a usable day. Try rewording the change.")); return; }
      out.appendChild(el("h2","k","Preview"));
      var pv = el("div","itin"); pv.style.padding = "0 12px"; var cp = sec.cloneNode(true); stripTilde(cp); pv.appendChild(cp); out.appendChild(pv);
      var acts = el("div","actions"); acts.style.display = "flex"; acts.style.gap = "8px"; acts.style.marginTop = "10px";
      var sv = el("button","btn primary","Save this day"); sv.type = "button";
      var again = el("button","btn","Try again"); again.type = "button"; again.addEventListener("click", function(){ out.textContent = ""; ta.focus(); });
      acts.appendChild(sv); acts.appendChild(again); out.appendChild(acts);
      sv.addEventListener("click", function(){
        sv.disabled = true; sv.textContent = "Saving…";
        orig.parentNode.replaceChild(sec, orig);
        var html = raw.innerHTML, ref = db.doc("trip/" + t.id + "/itinerary/main");
        ref.get().then(function(sn){ var o = (sn.exists && sn.data()) || {}; var log = Array.isArray(o.changes) ? o.changes.slice(-49) : [];
          log.push({day:date, request:q.slice(0,300), at:Date.now(), synced:false});
          return ref.update({html:html, changes:log, updatedAt:Date.now()}); })
          .then(function(){ FRAGS[t.id] = html; FRAG_DB[t.id] = true; closeSheet(); render(true); })
          .catch(function(){ sv.disabled = false; sv.textContent = "Save this day"; showStatus("<strong>Not saved.</strong> Couldn't save the itinerary change; try again."); });
      });
    }).catch(function(e){ go.disabled = false; var msg = sampleError(e); out.textContent = ""; if (msg) out.appendChild(el("p","errline",msg)); });
  });
}

/* ================= Itinerary tab ================= */
function itinView(t, focus){
  if (!t.itinerary && FRAGS[t.id] == null) return itinEmpty(t);
  var wrap = el("div"), box = el("div","itin"); wrap.style.display = "contents";
  var html = FRAGS[t.id];
  if (html == null){
    box.appendChild(el("p","muted","Loading itinerary…"));
    // Stored itinerary first; the published file is only a read-only fallback (and is dropped once the database connects).
    var viaDb = !!db, gotDb = false;
    (db ? db.doc("trip/" + t.id + "/itinerary/main").get().then(function(sn){ var o = sn.exists && sn.data(); if (o && typeof o.html === "string"){ FRAG_DB[t.id] = true; FRAG_AT[t.id] = o.updatedAt || 0; gotDb = true; return o.html; } throw 0; }) : Promise.reject())
      .catch(function(){ return fetch("trips/" + t.id + ".itinerary.html", {cache:"no-store"}).then(function(r){ if (!r.ok) throw 0; return r.text(); }); })
      .then(function(tx){
        if (!gotDb && FRAG_DB[t.id]) return;                       // a stored copy already arrived; never replace it with the file
        if (!viaDb && db){ render(true); return; }                   // database connected meanwhile: load the stored copy instead
        FRAGS[t.id] = tx; render(true); })
      .catch(function(){ box.textContent = "Couldn't load this itinerary. Check your connection and reopen the tab."; });
    wrap.appendChild(box); return wrap;
  }
  box.innerHTML = html; stripTilde(box); stripEstNotes(box);
  // No "Tap any time…" instruction line on any day (help text removed, Tyler, Sep 26 2026).
  box.querySelectorAll(".eta-hint").forEach(function(n){ n.remove(); });
  box.querySelectorAll("a[href]").forEach(function(a){ var h = noOrigin(a.href); if (h !== a.href) a.href = h; });
  // Itinerary only: money and open-booking lines live on the Overview tab.
  box.querySelectorAll("ul.facts > li").forEach(function(li){ var k = (li.querySelector("b") || li).textContent; if (/cash|cost|budget|points|still open|open items?|to book/i.test(k)) li.remove(); });
  box.querySelectorAll("ul.facts").forEach(function(u){ if (!u.children.length) u.remove(); });
  wrap.appendChild(box);
  var pb = offlineButton(t, box), rt = box.querySelector("a.route");
  if (rt){ pb.style.margin = "0 0 10px"; rt.parentNode.insertBefore(pb, rt); } else wrap.appendChild(pb);
  if (db && FRAG_DB[t.id] && t.start) wrap.appendChild(addDayBox(t, false));
  enhanceItinerary(box, t, focus);
  return wrap;
}

/* Starting and extending an itinerary on the page.
   Empty state: ✨ Draft itinerary (Claude drafts every day; preview, then save) or Add a day.
   Both write trip/<ID>/itinerary/main (html, changes, updatedAt) and set trips/<ID>.itinerary = true. */
function fmtLong(iso){ var d = pd(iso); return d ? WD[d.getDay()] + ", " + MO[d.getMonth()] + " " + d.getDate() : ""; }
/* Itinerary day format (Tyler, Sep 25 2026): every day on every trip uses the same layout, so all days look alike.
   Shared by the itinerary drafter, day rewrites and linked updates. */
var ITIN_FORMAT = "DAY FORMAT (use exactly, for every day):\n" +
  "<section class=\"day\" data-date=\"YYYY-MM-DD\" id=\"...\"><div class=\"day-head\"><h2>short title</h2><span class=\"date\">Sat, Sep 26</span></div>\n" +
  "<a class=\"drive\" href=\"https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=...&waypoints=A%7CB\">Day's driving route ↗</a>  (no \"estimate\" notes anywhere; no origin parameter; waypoints follow the stops in order; for a flight-only day link the airport instead)\n" +
  "the .eta and .eta-hint blocks, then <ul> of stops in time order. EVERY stop starts with a time chip: <li><span class=\"t\">9:50–10:40a</span> <a href=\"https://www.google.com/maps/search/?api=1&query=Place+Name+City\">Place</a> a few words <ul class=\"details\"><li>one short fact</li></ul></li>\n" +
  "- Estimated times: <span class=\"t\">. Fixed times (flights, reservations, check-in/out, business hours): <span class=\"t fx\">. With no clock time, use a short word label with no digits (Morning, Lunch, Evening, Late).\n" +
  "- Flights are stops too: <li><span class=\"t fx\">2:35p</span> Southwest WN 4008 BZN → DEN <ul class=\"details\"><li>Arrives DEN 4:20p</li></ul></li>. Traveler names go before the flight when travelers differ.\n" +
  "- Caveats, arrival times, seats, distances and tips go in ul.details (at most three), never in parentheses on the stop line. Write times like 9:50a or 6:20–7:00p with no tilde.\n" +
  "- Lodging only on the check-in day: <div class=\"lodging\"><span class=\"k\">Lodging · N nights</span><a href=\"https://www.google.com/maps/search/?api=1&query=Hotel+Name+address\">Hotel</a></div>. When a stay is extended, update N on that check-in line; never add a lodging line on a continuing night. A day with nothing planned: <ul><li>Open day</li></ul>.\n" +
  "- Every flight gets its ground legs as estimate stops around it: before a departure from MSP, \"Leave home for MSP\" (3 hr 30 min before; ~1 hr 30 min drive from Rochester) and \"MSP · park and check in\" (2 hr before); before any other departure, \"Head to <code> airport\" (2 hr 30 min before); after landing, \"Land at <code> · get to the lodging\" or, flying home, \"Land at MSP · head home to Rochester\". Unknown times use the chip TBD. Keep these legs when a flight changes or is still TBD.\n" +
  "- The itinerary shows the plan only: never add change history or notes about what was canceled or replaced (that lives in bookings and the change log).\n";
var ETA_BLOCK = '<div class="eta" hidden><span class="eta-state"></span><button class="eta-reset" type="button">Reset</button></div>';
var PASSED_BLOCK = '<details class="passed" hidden><summary>Already passed <span class="note passed-count"></span></summary><div class="passed-days"></div></details>';
function tripDates(t){ var out = [], a = pd(t.start), b = pd(t.end || t.start); if (!a || !b) return out; for (var d = new Date(a); d <= b && out.length < 60; d.setDate(d.getDate() + 1)) out.push(d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0")); return out; }
function withEta(sec){
  if (!sec.querySelector(".eta")){ var tmp = document.createElement("div"); tmp.innerHTML = ETA_BLOCK; var after = sec.querySelector("a.drive") || sec.querySelector(".day-head");
    var nodes = [].slice.call(tmp.childNodes); nodes.forEach(function(n){ if (after && after.nextSibling) sec.insertBefore(n, after.nextSibling); else sec.appendChild(n); after = n; }); }
  return sec;
}
function saveItin(t, html, change){
  var ref = db.doc("trip/" + t.id + "/itinerary/main");
  return ref.get().then(function(sn){
    var o = (sn.exists && sn.data()) || {}, log = Array.isArray(o.changes) ? o.changes.slice(-49) : [], at = Date.now();
    log.push(change); var p = {html:html, changes:log, updatedAt:at};
    return (sn.exists ? ref.update(p) : ref.set(p)).then(function(){
      FRAGS[t.id] = html; FRAG_DB[t.id] = true; FRAG_AT[t.id] = at;
      if (!RAW[t.id] || !RAW[t.id].itinerary) return saveTrip(t.id, {itinerary:true}); render(true); });
  });
}
function itinEmpty(t){
  var box = el("section","panel itin-empty");
  box.appendChild(el("p",null,"No itinerary yet."));
  if (!t.start){ box.appendChild(el("p","muted","Add the trip dates first; the itinerary is built day by day.")); var e = el("a","btn","Edit trip"); e.href = "#" + t.id + ".edit"; e.style.textDecoration = "none"; box.appendChild(e); return box; }
  if (!db){ box.appendChild(el("p","muted","You can start an itinerary once the page is connected.")); return box; }
  var acts = el("div","actions");
  // Standalone app: "Build from my trip" makes every day from the dates, flights (with ground legs) and lodging, no Claude needed.
  var bs = el("button","btn" + (AI.sample ? "" : " primary"),"Build from my trip"); bs.type = "button"; bs.addEventListener("click", function(){ bs.disabled = true; buildShell(t).catch(function(){ bs.disabled = false; showStatus("<strong>Not saved.</strong> Couldn't build the itinerary; try again.", true); }); }); acts.appendChild(bs);
  if (AI.sample){ var dr = el("button","btn primary","✨ Draft itinerary"); dr.type = "button"; dr.addEventListener("click", function(){ draftItin(t); }); acts.appendChild(dr); }
  box.appendChild(acts);
  box.appendChild(addDayBox(t, true));
  return box;
}
function addDayBox(t, inline){
  var wrap = el("div","addday"), btn = el("button","btn","+ Add a day"); btn.type = "button"; wrap.appendChild(btn);
  btn.addEventListener("click", function(){
    var raw = document.createElement("div"); raw.innerHTML = FRAGS[t.id] || "";
    var have = {}; [].slice.call(raw.querySelectorAll("section.day[data-date]")).forEach(function(s){ have[s.getAttribute("data-date")] = true; });
    var free = tripDates(t).filter(function(x){ return !have[x]; })[0] || "";
    var f = el("form","addday"), two = el("div","two"), di = inp("ad-date-" + t.id, "date", free), ti = inp("ad-title-" + t.id, "text", "", "e.g. Arrive Phoenix");
    two.appendChild(fieldEl("Day", di)); two.appendChild(fieldEl("Title", ti)); f.appendChild(two);
    var acts = el("div","actions"); acts.style.display = "flex"; acts.style.gap = "8px";
    var sv = el("button","btn primary","Add day"); sv.type = "submit"; var cc = el("button","btn","Cancel"); cc.type = "button"; cc.addEventListener("click", function(){ wrap.replaceChild(btn, f); });
    acts.appendChild(sv); acts.appendChild(cc); f.appendChild(acts); var msg = el("p","muted"); f.appendChild(msg);
    f.addEventListener("submit", function(e){ e.preventDefault();
      var date = di.value, title = ti.value.trim() || "Day plan";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)){ msg.textContent = "Pick a date."; di.focus(); return; }
      if (have[date]){ msg.textContent = "That day is already in the itinerary."; return; }
      var d = document.createElement("div"); d.innerHTML = FRAGS[t.id] || "";
      var tmp = document.createElement("div"); tmp.innerHTML = '<section class="day" data-date="' + date + '" id="day-' + date + '"><div class="day-head"><h2>' + escHtml(title) + '</h2><span class="date">' + fmtLong(date) + '</span></div>' + ETA_BLOCK + '<ul><li>No plans yet</li></ul></section>';
      var sec = tmp.firstChild, nav = d.querySelector(".nav");
      if (!nav){ nav = document.createElement("nav"); nav.className = "nav"; nav.setAttribute("aria-label","Days"); d.insertBefore(nav, d.firstChild); }
      var chipA = document.createElement("a"), dd = pd(date); chipA.href = "#day-" + date; chipA.setAttribute("data-date", date); chipA.textContent = WD[dd.getDay()] + " " + dd.getDate(); nav.appendChild(chipA);
      var anchor = d.querySelector("section.ref") || d.querySelector("details.passed");
      if (anchor) anchor.parentNode.insertBefore(sec, anchor); else d.appendChild(sec);
      if (!d.querySelector("details.passed")) d.insertAdjacentHTML("beforeend", PASSED_BLOCK);
      sv.disabled = true; sv.textContent = "Saving…";
      saveItin(t, d.innerHTML, {day:date, request:"Added day: " + title, at:Date.now(), synced:false})
        .catch(function(){ sv.disabled = false; sv.textContent = "Add day"; showStatus("<strong>Not saved.</strong> Couldn't add that day; try again."); });
    });
    wrap.replaceChild(f, btn); setTimeout(function(){ ti.focus(); }, 0);
  });
  return wrap;
}
function draftItin(t){
  var body = openSheet("Draft itinerary");
  var ta = el("textarea"); ta.id = "di-q"; ta.rows = 3; ta.placeholder = "Anything to plan around? e.g. a wedding Saturday at 4p, one good hike, no early mornings";
  var go = el("button","btn primary","Draft it"); go.type = "button"; var out = el("div");
  body.appendChild(ta); body.appendChild(go); body.appendChild(out);
  go.addEventListener("click", function(){
    var q = ta.value.trim(), dates = tripDates(t);
    go.disabled = true; var st = thinking(out, "Drafting " + dates.length + " day" + (dates.length === 1 ? "" : "s") + "…");
    var prompt = "You draft a day-by-day travel itinerary as HTML for a trip tracker page.\n\nTrip: " + tripBrief(t) +
      (t.days && t.days.length ? "\nDay notes: " + JSON.stringify(t.days) : "") + (t.notes ? "\nTraveler notes: " + t.notes.slice(0, 1500) : "") +
      "\nDates to cover, in order: " + dates.join(", ") + (q ? "\nPlan around: " + q : "") +
      "\n\nReturn only one <section class=\"day\" data-date=\"YYYY-MM-DD\"> per date above, nothing else (no code fences, no commentary). Inside each section:\n" +
      "- <div class=\"day-head\"><h2>short day title</h2><span class=\"date\">Thu, Oct 8</span></div>\n" +
      "- On driving days: <a class=\"drive\" href=\"https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=...&waypoints=A%7CB\">Day's driving route ↗</a>. Never add an origin parameter. Waypoints follow the stops in order.\n" +
      ITIN_FORMAT + "- Use realistic drive times plus about 10 minutes of buffer per leg, and never mention the buffer.\n" +
      "- For each night's stay: <div class=\"lodging\"><span class=\"k\">Lodging · N nights</span><a href=\"https://www.google.com/maps/search/?api=1&query=Hotel+Name+full+street+address\">Hotel</a></div> on the check-in day. If lodging isn't booked, write \"not booked yet\".\n" +
      "- Use the bookings exactly as given. Never invent a booking, confirmation or price. List only places a traveler navigates to; no pass-through checkpoints. Keep each stop to one short line.\n" +
      "- A day with nothing planned gets a single <li>Open day</li>.";
    AI.sample(prompt, {cache:false, onText: function(){ st.textContent = "Writing the days…"; }}).then(function(r){
      go.disabled = false; out.textContent = "";
      var tpl = document.createElement("template"); tpl.innerHTML = String((r && r.text) || "").replace(/```[a-z]*\n?/gi, "");
      var ok = {}; dates.forEach(function(x){ ok[x] = true; });
      var secs = [].slice.call(tpl.content.querySelectorAll("section")).map(function(s){ var dt = s.getAttribute("data-date"); if (!ok[dt]) return null; ok[dt] = false; var c = cleanSection(s.outerHTML, "day-" + dt, dt); if (!c) return null; stripTilde(c); if (!c.querySelector("ul")) c.insertAdjacentHTML("beforeend","<ul><li>Open day</li></ul>"); return withEta(c); }).filter(Boolean)
        .sort(function(a,b){ return a.getAttribute("data-date") < b.getAttribute("data-date") ? -1 : 1; });
      if (!secs.length){ out.appendChild(el("p","errline","Claude's draft didn't come back as usable days. Try again.")); return; }
      out.appendChild(el("h2","k","Preview · " + secs.length + " of " + dates.length + " days"));
      var pv = el("div","itin"); pv.style.padding = "0 12px"; secs.forEach(function(s){ pv.appendChild(s.cloneNode(true)); }); out.appendChild(pv);
      var acts = el("div","actions"); acts.style.display = "flex"; acts.style.gap = "8px"; acts.style.marginTop = "10px";
      var sv = el("button","btn primary","Save itinerary"); sv.type = "button"; var again = el("button","btn","Try again"); again.type = "button";
      again.addEventListener("click", function(){ out.textContent = ""; ta.focus(); });
      acts.appendChild(sv); acts.appendChild(again); out.appendChild(acts);
      sv.addEventListener("click", function(){
        sv.disabled = true; sv.textContent = "Saving…";
        var nav = '<nav class="nav" aria-label="Days">' + secs.map(function(s){ var dt = s.getAttribute("data-date"), x = pd(dt); return '<a href="#' + s.id + '" data-date="' + dt + '">' + WD[x.getDay()] + " " + x.getDate() + "</a>"; }).join("") + "</nav>";
        var html = nav + "\n" + secs.map(function(s){ return s.outerHTML; }).join("\n") + "\n" + PASSED_BLOCK;
        saveItin(t, html, {day:"all", request:("Drafted itinerary" + (q ? ": " + q : "")).slice(0,300), at:Date.now(), synced:false})
          .then(function(){ closeSheet(); render(true); })
          .catch(function(){ sv.disabled = false; sv.textContent = "Save itinerary"; showStatus("<strong>Not saved.</strong> Couldn't save the itinerary; try again."); });
      });
    }).catch(function(e){ go.disabled = false; var msg = sampleError(e); out.textContent = ""; if (msg) out.appendChild(el("p","errline",msg)); });
  });
  setTimeout(function(){ ta.focus(); }, 0);
}

// A clean, static copy of the itinerary: no buttons, day chips or ETA bars; past days put back in date order; links kept.
// A point-in-time copy of the itinerary exactly as it shows now: same day order, earlier days tucked into a
// collapsed section at the end. Buttons, day chips and ETA bars are dropped; links are kept.
// forNotes: Notes can't keep a collapsed block from a paste, so earlier days become a labeled section instead.
// Times and durations show without a "~" (Tyler's rule: estimates are understood). Money amounts keep theirs.
var TILDE_TIME = /[~≈]\s?(?=\d{1,2}(?::\d{2})?\s?(?:[AaPp]\.?[Mm]\b|[AaPp]\b|hrs?\b|h\b|hours?\b|mins?\b|minutes?\b|–|-))/g;
// No "estimate" disclaimers in itineraries (Tyler, Sep 25 2026): notes like "(all times estimates)" are dropped on display.
function stripEstNotes(root){ root.querySelectorAll(".note").forEach(function(n){ if (/^\s*\(?\s*(all |drive )?(times?|drive times?)\s*(are\s*)?(estimates?|approximate)\s*\)?\s*$/i.test(n.textContent) || /^\s*\((est\.|all times)[^)]*\)\s*$/i.test(n.textContent)) n.remove(); }); }
function stripTilde(root){
  var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
  while ((n = w.nextNode())) if (/[~≈]/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(TILDE_TIME, "");
}
function cleanItinerary(t, live, forNotes){
  var d = document.createElement("div");
  if (live) d.innerHTML = live.innerHTML; else d.innerHTML = FRAGS[t.id] || "";
  d.querySelectorAll("nav, .nav, .eta, .eta-hint, .from-here, .wx, button, script, style, input").forEach(function(n){ n.remove(); });
  d.querySelectorAll("details").forEach(function(n){
    var sum = n.querySelector("summary"), label = sum ? sum.textContent.trim() : "Earlier days";
    if (!forNotes){ n.removeAttribute("open"); return; }
    var f = document.createDocumentFragment(), h = document.createElement("h2"); h.textContent = label; f.appendChild(h);
    [].slice.call(n.childNodes).forEach(function(c){ if (c.nodeName !== "SUMMARY") f.appendChild(c); });
    n.parentNode.replaceChild(f, n);
  });
  d.querySelectorAll("a[href]").forEach(function(a){ a.removeAttribute("target"); a.removeAttribute("rel"); });
  stripTilde(d); stripEstNotes(d);
  // Bold each stop's time and heading line (Notes and plain files drop page CSS); the notes under it stay regular.
  d.querySelectorAll("section.day > ul > li").forEach(function(li){
    var b = document.createElement("b"), first = li.firstChild;
    while (first && !(first.nodeType === 1 && first.matches("ul.details"))){ var nx = first.nextSibling; b.appendChild(first); first = nx; }
    li.insertBefore(b, li.firstChild);
  });
  var head = "<h1>" + escHtml(t.name + (forNotes ? " (Offline Copy)" : "")) + "</h1><p>" + escHtml([t.where, t.start && t.end ? fmt(t.start) + " – " + fmt(t.end) : ""].filter(Boolean).join(" · ")) + "<br>Copy as of " + escHtml(new Date().toLocaleString([], {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"})) + "</p>";
  return head + d.innerHTML;
}
function escHtml(x){ return String(x == null ? "" : x).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
function copyRich(html){
  // innerText only keeps line breaks for an element that is laid out, so attach it off-screen briefly.
  var plain = (function(){ var d = document.createElement("div"); d.style.position = "fixed"; d.style.left = "-9999px"; d.innerHTML = html; document.body.appendChild(d); var x = d.innerText || d.textContent || ""; d.remove(); return x; })();
  if (navigator.clipboard && window.ClipboardItem){
    return navigator.clipboard.write([new ClipboardItem({"text/html": new Blob([html], {type:"text/html"}), "text/plain": new Blob([plain], {type:"text/plain"})})]).catch(function(){ return legacyCopy(html); });
  }
  return legacyCopy(html);
}
function legacyCopy(html){
  return new Promise(function(res, rej){
    var d = document.createElement("div"); d.contentEditable = "true"; d.innerHTML = html; d.style.position = "fixed"; d.style.left = "-9999px"; document.body.appendChild(d);
    var r = document.createRange(); r.selectNodeContents(d); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    var ok = false; try { ok = document.execCommand("copy"); } catch(e){}
    sel.removeAllRanges(); d.remove(); ok ? res() : rej(new Error("copy"));
  });
}
function offlineButton(t, live){
  var d = el("div"), b = el("button","btn","Save offline copy"); b.type = "button"; d.appendChild(b);
  // No "PDF out of date" badge on the button (removed at Tyler's request, Sep 26 2026); the note inside the sheet stays.
  b.addEventListener("click", function(){
    var body = openSheet("Save offline copy"), msg = el("p","muted");
    var notes = el("button","btn primary","Copy for Apple Notes"); notes.type = "button"; notes.style.width = "100%";
    notes.addEventListener("click", function(){ copyRich(cleanItinerary(t, live, true)).then(function(){ msg.textContent = "Copied. Open Apple Notes, start a new note and paste. Headings, bold text and links carry over."; })
      .catch(function(){ msg.textContent = "Couldn't copy here. Use \"Save as web page\" instead, then open the file and share it to Notes."; }); });
    body.appendChild(notes);
    // Standalone app: no Claude downloads capability, so "Save as web page" downloads the file directly.
    var dlP = window.claude && window.claude.use ? window.claude.use("downloads") : Promise.resolve({save:function(o){ var a = document.createElement("a"); a.href = URL.createObjectURL(o.data); a.download = o.filename; document.body.appendChild(a); a.click(); a.remove(); return Promise.resolve({status:"saved"}); }});
    dlP.then(function(dl){ if (!dl) return;
      var web = el("button","btn","Save as web page"); web.type = "button"; web.style.width = "100%"; web.style.marginTop = "8px";
      web.addEventListener("click", function(){
        var doc = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + escHtml(t.name) + " Itinerary</title><style>details{margin-top:18px}summary{font-weight:600;cursor:pointer}body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:720px;margin:0 auto;padding:16px;color:#1b1f24}h1{font-size:24px}h2{font-size:19px;margin:22px 0 4px}a{color:#9a5b12}section.day{border-top:1px solid #ddd;padding-top:6px}ul{padding-left:20px}</style></head><body>" + cleanItinerary(t, live, false) + "</body></html>";
        dl.save({filename: t.name + " Itinerary.html", data: new Blob([doc], {type:"text/html"})}).then(function(r){ msg.textContent = r && r.status === "saved" ? "Saved. It opens in Safari or Files with working links, no connection needed." : ""; })
          .catch(function(e){ msg.textContent = e && e.code === "declined" ? "" : "Couldn't save here."; });
      });
      body.insertBefore(web, msg);
      if (t.pdf){ var pdf = el("button","btn","Save PDF"); pdf.type = "button"; pdf.style.width = "100%"; pdf.style.marginTop = "8px";
        if (FRAG_AT[t.id] && (!t.pdfAt || FRAG_AT[t.id] > t.pdfAt)) body.insertBefore(el("p","muted","The PDF is older than the latest itinerary change. Ask Claude to rebuild it if you need the newest version offline."), msg);
        pdf.addEventListener("click", function(){ getPdf(t).then(function(r){ if (!r.ok) throw 0; return r.blob(); })
          .then(function(bl){ return dl.save({filename: t.name + " Itinerary.pdf", data: bl}); })
          .then(function(r){ msg.textContent = r && r.status === "saved" ? "PDF saved." : ""; })
          .catch(function(e){ msg.textContent = e && e.code === "declined" ? "" : "Couldn't save the PDF here."; }); });
        body.insertBefore(pdf, msg); }
    }).catch(function(){});
    body.appendChild(msg);
  });
  return d;
}
// The PDF lives in the asset store (cheap to replace); the published file is the fallback.
function getPdf(t){ return fetch(t.pdf,{cache:"no-store"}).then(function(r){ if (r.ok) return r; throw 0; }).catch(function(){ return fetch("trips/" + t.id + ".pdf",{cache:"no-store"}); }); }
function pdfButton(t){
  var d = el("div"), b = el("button","btn","Save offline PDF"), msg = el("span","muted"); b.type = "button"; b.hidden = true; msg.style.marginLeft = "8px";
  d.appendChild(b); d.appendChild(msg);
  if (window.claude && window.claude.use) window.claude.use("downloads").then(function(dl){ if (!dl) return; b.hidden = false;
    b.addEventListener("click", function(){ msg.textContent = "";
      fetch(t.pdf,{cache:"no-store"}).then(function(r){ if (!r.ok) throw 0; return r.blob(); })
        .then(function(bl){ return dl.save({filename: t.name + " Itinerary.pdf", data: bl}); })
        .then(function(r){ msg.textContent = r && r.status === "saved" ? "Saved" : ""; })
        .catch(function(e){ msg.textContent = e && e.code === "declined" ? "" : "Couldn't save here"; });
    }); }).catch(function(){});
  return d;
}

function enhanceItinerary(root, t, focus){
  var iso = isoToday();
  var nav = root.querySelector(".nav"), det = root.querySelector("details.passed"), pbox = root.querySelector(".passed-days"), ref = root.querySelector("section.ref");
  var days = [].slice.call(root.querySelectorAll("section.day[data-date]")).sort(function(a,b){ return a.dataset.date < b.dataset.date ? -1 : 1; });
  var chips = {};
  if (nav) [].slice.call(nav.querySelectorAll("a[data-date]")).forEach(function(a){ chips[a.dataset.date] = a; });
  // "Done, move down": finished days drop into Already passed early. Saved to trip/<ID>/eta/_days.
  var dkey = "tif-done-" + t.id, done = lsGet(dkey, []), dref = null;
  days.forEach(function(s){
    if (s.dataset.date < iso) return;
    // "Mark day done" sits at the bottom of the day (Tyler, Sep 26 2026), after its stops and lodging.
    var bt = el("button","btn daydone"); bt.type = "button"; var foot = el("div","dayfoot"); foot.appendChild(bt);
    bt.addEventListener("click", function(){ var i = done.indexOf(s.id); if (i > -1) done.splice(i,1); else done.push(s.id); lsSet(dkey, done); if (dref) dref.set({ids:done, updatedAt:Date.now()}).catch(function(){}); layout();
      if (done.indexOf(s.id) > -1){ var nx = root.querySelector("section.day.up"); if (nx) nx.scrollIntoView({block:"start"}); } });
    s._doneBtn = bt; s.appendChild(foot);
  });
  // Edit stops by hand (Tyler, Sep 26 2026): every day gets an Edit button once the itinerary is stored.
  if (db && FRAG_DB[t.id]) days.forEach(function(s){ var h = s.querySelector(".day-head"); if (!h) return;
    // A readable pill in the day header, same style as the day's other buttons (Tyler, Sep 26 2026).
    var eb = el("button","btn dayedit","✎ Edit stops"); eb.type = "button";
    eb.addEventListener("click", function(){ if (!s.querySelector(".stopedit")) editDay(t, s, s.dataset.date); });
    h.appendChild(eb); });
  // The collapsed bottom section is labeled "Already passed" whatever the stored HTML says.
  if (det){ var sm = det.querySelector("summary"); if (sm && sm.firstChild && sm.firstChild.nodeType === 3) sm.firstChild.nodeValue = "Already passed "; }
  function layout(){
    var past = [], up = [];
    days.forEach(function(s){ var isPast = s.dataset.date < iso || done.indexOf(s.id) > -1; (isPast ? past : up).push(s); s.classList.toggle("up", !isPast);
      if (s._doneBtn) s._doneBtn.textContent = done.indexOf(s.id) > -1 ? "✓ Done · Undo" : "Mark day done"; });
    if (det && pbox){
      up.forEach(function(s){ if (ref) ref.parentNode.insertBefore(s, ref); else det.parentNode.insertBefore(s, det); });
      past.forEach(function(s){ pbox.appendChild(s); });
      det.hidden = !past.length;
      var pc = det.querySelector(".passed-count"); if (pc) pc.textContent = past.length ? "(" + past.length + " day" + (past.length > 1 ? "s" : "") + ")" : "";
    }
    if (nav){
      up.forEach(function(s){ var a = chips[s.dataset.date]; if (a){ a.classList.remove("past"); nav.appendChild(a); } });
      past.forEach(function(s){ var a = chips[s.dataset.date]; if (a){ a.classList.add("past"); nav.appendChild(a); } });
    }
  }
  layout();
  if (db){ dref = db.doc("trip/" + t.id + "/eta/_days");
    dref.onSnapshot(function(snap){ var o = snap.exists && snap.data(); if (o && Array.isArray(o.ids)){ done = o.ids.slice(); lsSet(dkey, done); layout(); } }, function(){}); }
  // In-page day links scroll instead of changing the page's route
  root.addEventListener("click", function(e){
    var a = e.target.closest("a"); if (!a) return;
    var h = a.getAttribute("href") || ""; if (h.charAt(0) !== "#") return;
    e.preventDefault(); var target = root.querySelector(h.replace(/([^\w#-])/g, "\\$1"));
    if (target){ if (det && det.contains(target)) det.open = true; target.scrollIntoView({block:"start"}); }
  });
  var sec = root.querySelector('section.day[data-date="' + iso + '"]');
  if (sec){
    sec.classList.add("is-today");
    if (chips[iso]) chips[iso].classList.add("is-today");
  }
  routeFromHere(root);
  driveOrigins(root);
  weatherDecorate(root, t);
  etaTaps(root, t);
  if (focus && wantFocus){
    wantFocus = false;
    setTimeout(function(){ var f = root.querySelector('section.day[data-date="' + focus + '"]'); if (f){ if (det && det.contains(f)) det.open = true; f.scrollIntoView({block:"start"}); } }, 0);
  }
}

function routeFromHere(root){
  function norm(x){ return decodeURIComponent((x||"").replace(/\+/g," ")).toLowerCase().replace(/[,]/g,"").replace(/\s+/g," ").trim(); }
  root.querySelectorAll("section.day").forEach(function(sec){
    var d = sec.querySelector("a.drive"); if (!d) return; var u; try { u = new URL(d.href); } catch(e){ return; }
    var w = u.searchParams.get("waypoints"); if (!w) return;
    var stops = w.split("|").concat([u.searchParams.get("destination")]), k = 0, ul = sec.querySelector(":scope > ul"); if (!ul) return;
    [].slice.call(ul.children).forEach(function(li, idx){
      var q = [].map.call(li.querySelectorAll('a[href*="maps/search"]'), function(a){ return norm(new URL(a.href).searchParams.get("query")); }).join(" | ");
      while (k < stops.length - 1 && q.indexOf(norm(stops[k]).split(" ").slice(0,2).join(" ")) > -1) k++;
      if (idx === 0 || !li.querySelector(":scope > .t") || k >= stops.length) return;
      var rest = stops.slice(k); if (rest.length === 1 && (li.textContent.toLowerCase() + q).indexOf(norm(rest[0]).split(" ")[0]) > -1) return;
      var a = el("a","from-here","Route from here ↗"); a.target = "_blank"; a.rel = "noopener";
      a.href = "https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=" + encodeURIComponent(rest[rest.length-1]) + (rest.length > 1 ? "&waypoints=" + encodeURIComponent(rest.slice(0,-1).join("|")) : "");
      a.title = "Remaining stops: " + rest.join(" → ");
      var sub = li.querySelector(":scope > ul"); li.insertBefore(a, sub || null); if (sub) a.insertAdjacentText("afterend"," ");
    });
  });
}

/* Live ETA taps: tapping a time on today's plan shifts every later estimate that day.
   Saved to trip/<ID>/eta/<day id>. */
function etaTaps(root, t){
  function parse(s){ var mt = s.match(/(\d{1,2})(?::(\d{2}))?([ap])?/); return mt ? {h:+mt[1], m:+(mt[2]||0), ap:mt[3]||""} : null; }
  function toMin(o, ap){ var h = o.h % 12; if ((o.ap || ap) === "p") h += 12; return h * 60 + o.m; }
  function f(x){ x = ((x % 1440) + 1440) % 1440; var h = Math.floor(x / 60), mm = x % 60; return (h % 12 || 12) + ":" + String(mm).padStart(2,"0") + (h >= 12 ? "p" : "a"); }
  function nowMin(){ var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  var iso = isoToday();
  root.querySelectorAll("section.day").forEach(function(sec){
    var bar = sec.querySelector(".eta"), hint = sec.querySelector(".eta-hint"); if (!bar) return;
    var toks = [];
    // Fixed times (flights, reservations: span.t.fx) look the same but never shift with live ETA.
    sec.querySelectorAll(".t:not(.fx),.t2").forEach(function(e){
      var txt = e.textContent.trim(), tilde = "", parts = txt.replace(/^~/,"").split("–"), bold = !!e.querySelector("b");
      var en = parts[1] ? parse(parts[1]) : null, s0 = parse(parts[0]); if (!s0) return; var ap = s0.ap || (en && en.ap) || "a";
      var h = tilde; parts.forEach(function(pt, j){ var o = parse(pt), mn = j === 0 ? toMin(o, ap) : toMin(o, o.ap);
        var sp = el("span","tk"); sp.dataset.m = mn; sp.dataset.o = pt; toks.push(sp); if (j) h += "–"; h += "\u0000" + (toks.length - 1) + "\u0000"; });
      e.textContent = ""; var fr = bold ? document.createElement("b") : e;
      h.split("\u0000").forEach(function(chunk, j){ if (j % 2) fr.appendChild(toks[+chunk]); else if (chunk) fr.appendChild(document.createTextNode(chunk)); });
      if (bold) e.appendChild(fr);
    });
    var key = "tif-eta-" + t.id + "-" + sec.id, st = lsGet(key, {tk:[], cuts:[]}), taps = st.tk || [], cuts = st.cuts || [], ref = null;
    var cutBtns = [].slice.call(sec.querySelectorAll(".cut"));
    function inList(sp){ return !!sp.closest(".cutlist"); }
    function cutPos(id){ var li = sec.querySelector('li[data-cut="' + id + '"]'), ft = li && li.querySelector(".tk"); return ft ? toks.indexOf(ft) : -1; }
    function paint(){
      taps.sort(function(x, y){ return x.k - y.k; });
      var act = cutBtns.filter(function(bt){ return cuts.indexOf(bt.dataset.cut) > -1; }).map(function(bt){ return {pos:cutPos(bt.dataset.cut), save:+bt.dataset.save}; });
      toks.forEach(function(sp, k){ var d = 0, anc = false, tk = -1; taps.forEach(function(tp){ if (tp.k <= k){ d = tp.d; anc = tp.k === k; tk = tp.k; } });
        if (!inList(sp)) act.forEach(function(c){ if (c.pos > -1 && k > c.pos && c.pos >= tk) d -= c.save; });
        sp.classList.toggle("anchor", anc && !!d);
        if (!d){ sp.textContent = sp.dataset.o; return; }
        sp.innerHTML = "<s>" + sp.dataset.o + "</s> <span class=\"new\">" + f(+sp.dataset.m + d) + "</span>"; });
      cutBtns.forEach(function(bt){ var on = cuts.indexOf(bt.dataset.cut) > -1; bt.setAttribute("aria-pressed", on); var li = sec.querySelector('li[data-cut="' + bt.dataset.cut + '"][data-drop]'); if (li) li.classList.toggle("is-cut", on); });
      var last = taps.length ? taps[taps.length-1].d : 0, saved = act.reduce(function(x, c){ return x + c.save; }, 0), parts = [];
      if (taps.length) parts.push(last ? (last > 0 ? last + " min behind" : (-last) + " min ahead") : "On time");
      if (saved) parts.push(act.length + (act.length > 1 ? " cuts" : " cut") + " save " + saved + " min");
      if (parts.length){ bar.hidden = false; bar.querySelector(".eta-state").textContent = parts.join(" · ") + " · times below updated"; } else bar.hidden = true;
    }
    function persist(){ lsSet(key, {tk:taps, cuts:cuts}); if (ref) ref.set({tk:taps, cuts:cuts, updatedAt:Date.now()}).catch(function(){}); }
    cutBtns.forEach(function(bt){ bt.addEventListener("click", function(){ var id = bt.dataset.cut, i = cuts.indexOf(id); if (i > -1) cuts.splice(i,1); else cuts.push(id); persist(); paint(); }); });
    var isToday = sec.dataset.date === iso; if (hint) hint.hidden = !isToday; if (isToday) sec.classList.add("eta-live");
    paint();
    if (isToday) toks.forEach(function(sp, k){ sp.setAttribute("role","button"); sp.tabIndex = 0;
      function tap(){ var d = nowMin() - (+sp.dataset.m); if (Math.abs(d) < 5) d = 0; taps = taps.filter(function(x){ return x.k < k; }); taps.push({k:k, d:d}); persist(); paint(); }
      sp.addEventListener("click", function(e){ e.preventDefault(); e.stopPropagation(); tap(); });
      sp.addEventListener("keydown", function(e){ if (e.key === "Enter" || e.key === " "){ e.preventDefault(); tap(); } }); });
    var rs = bar.querySelector(".eta-reset"); if (rs) rs.addEventListener("click", function(){ taps = []; cuts = []; persist(); paint(); });
    if (db){ ref = db.doc("trip/" + t.id + "/eta/" + sec.id);
      ref.onSnapshot(function(snap){ var o = snap.exists && snap.data(); if (o && Array.isArray(o.tk)){ taps = o.tk.slice(); cuts = Array.isArray(o.cuts) ? o.cuts.slice() : []; lsSet(key, {tk:taps, cuts:cuts}); paint(); } }, function(){}); }
  });
}

/* Edit a day's stops by hand (Tyler, Sep 26 2026): change a stop's time (and whether it's fixed), rename it, move it,
   delete it or add one, with no Claude call. Works on the stored itinerary HTML: details lines under a stop are kept,
   a renamed stop gets a fresh Maps link, the day's driving route follows the new stop order, and the day's ETA taps
   reset (their positions no longer match). Saved like + Add a day, with the edit logged in `changes`. */
// Split "9:30a Old Faithful" / "9:50–10:40a Canyon" / "Morning Hike" into a time and a name.
var STOP_TIME_RE = /^\s*((?:\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m?\.?)?\s*(?:[–—-]\s*\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m?\.?)?)?)|(?:Early|Morning|Midday|Noon|Afternoon|Evening|Night|Late|Later)\b)\s*[·:,-]?\s*/i;
function splitStop(v){ v = String(v || "").replace(/\s*\n\s*/g, " ").trim(); var m = STOP_TIME_RE.exec(v);
  if (m && /\d/.test(m[1]) && !/[ap]/i.test(m[1]) && !/:/.test(m[1]) && !/[–—-]/.test(m[1])) m = null; // a bare number isn't a time
  var tm = m ? m[1].replace(/\s+/g, "").replace(/\./g, "").replace(/([ap])m/gi, "$1").replace(/-/g, "–") : ""; if (/\d/.test(tm)) tm = tm.toLowerCase();
  return m ? {time: tm, name: v.slice(m[0].length).trim()} : {time:"", name:v}; }
function stopParts(li){
  var tEl = li.querySelector(":scope > .t"), c = li.cloneNode(true);
  c.querySelectorAll(":scope > .t, :scope > ul, :scope > .from-here").forEach(function(x){ x.remove(); });
  var name = c.textContent.replace(/\s+/g, " ").trim();
  return {time: tEl ? tEl.textContent.replace(/[~≈]/g, "").trim() : "", fx: !!(tEl && tEl.classList.contains("fx")), name: name, orig: name, li: li,
    details: li.querySelector(":scope > ul.details")}; }
function mapsQ(t, name){ var area = String(t.where || "").split(/[→,/]/)[0].trim();
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(name + (area ? " " + area : "")).replace(/%20/g, "+"); }
function editDay(t, rsec, date){
  if (!db || FRAGS[t.id] == null) return;
  var raw = document.createElement("div"); raw.innerHTML = FRAGS[t.id];
  var sec = raw.querySelector('section.day[data-date="' + date + '"]'); if (!sec) return;
  var ul = sec.querySelector(":scope > ul");
  var rows = ul ? [].slice.call(ul.children).filter(function(li){ return !/^(Open day|No plans yet)$/i.test(li.textContent.trim()); }).map(stopParts) : [];
  var hid = [].slice.call(rsec.children).filter(function(c){ return !c.classList.contains("day-head"); });
  // While editing, the day header shows only the title: Save day / Cancel are the only actions.
  [].forEach.call(rsec.querySelectorAll(".day-head > button"), function(b){ hid.push(b); });
  hid.forEach(function(c){ c.hidden = true; });
  var box = el("div","stopedit"); rsec.appendChild(box);
  function close(){ box.remove(); hid.forEach(function(c){ c.hidden = false; }); }
  function paint(){ box.textContent = "";
    rows.forEach(function(r, i){
      // One cell per stop (Tyler, Sep 26 2026): time and name together, e.g. "9:30a Old Faithful"; the leading time is read off on save.
      var row = el("div","strow"), ni = el("textarea","stn");
      ni.rows = 1; ni.value = (r.time ? r.time + " " : "") + r.name; ni.id = "se-n-" + i;
      ni.setAttribute("aria-label","Stop " + (i + 1)); ni.placeholder = "9:30a Stop";
      function grow(){ ni.style.height = "auto"; ni.style.height = ni.scrollHeight + "px"; }
      ni.addEventListener("input", function(){ var p = splitStop(ni.value); r.time = p.time || r.time; r.name = p.name; grow(); }); setTimeout(grow, 0);
      var fx = el("label","stfx"), cb = el("input"); cb.type = "checkbox"; cb.checked = r.fx; cb.addEventListener("change", function(){ r.fx = cb.checked; });
      fx.appendChild(cb); fx.appendChild(document.createTextNode("Fixed"));
      function mv(d){ var j = i + d; if (j < 0 || j >= rows.length) return; var x = rows[i]; rows[i] = rows[j]; rows[j] = x; paint(); }
      var up = el("button","iconbtn","↑"), dn = el("button","iconbtn","↓"), rm = el("button","iconbtn danger","✕");
      up.type = dn.type = rm.type = "button"; up.setAttribute("aria-label","Move stop up"); dn.setAttribute("aria-label","Move stop down"); rm.setAttribute("aria-label","Delete stop " + (r.name || i + 1));
      up.addEventListener("click", function(){ mv(-1); }); dn.addEventListener("click", function(){ mv(1); });
      rm.addEventListener("click", function(){ rows.splice(i, 1); paint(); });
      var top = el("div","stline"); top.appendChild(ni); row.appendChild(top);
      var ctl = el("div","stctl"); ctl.appendChild(fx); ctl.appendChild(up); ctl.appendChild(dn); ctl.appendChild(rm);
      if (r.details) row.insertBefore(el("span","stsub", [].map.call(r.details.children, function(x){ return x.textContent.replace(/\s+/g, " ").trim(); }).filter(Boolean).join(" · ").slice(0, 120)), top.nextSibling);
      row.appendChild(ctl); box.appendChild(row); });
    if (!rows.length) box.appendChild(el("p","muted","No stops. Add one below, or save to leave the day open."));
    var add = el("div","strow stadd"), an = el("input","stn"), ab = el("button","btn","+ Add stop");
    an.type = "text"; an.id = "se-add-n"; an.placeholder = "New stop, e.g. 7:30p Dinner"; ab.type = "button"; an.setAttribute("aria-label","New stop");
    ab.addEventListener("click", function(){ var p = splitStop(an.value); if (!p.name){ an.focus(); return; }
      rows.push({time: p.time || "Later", fx:false, name:p.name, orig:"", li:null, details:null}); paint(); var n = document.getElementById("se-add-n"); if (n) n.focus(); });
    an.addEventListener("keydown", function(e){ if (e.key === "Enter"){ e.preventDefault(); ab.click(); } });
    var al = el("div","stline"); al.appendChild(an); add.appendChild(al); add.appendChild(ab); box.appendChild(add);
    var msg = el("p","muted"), acts = el("div","actions"), sv = el("button","btn primary","Save day"), cc = el("button","btn","Cancel");
    sv.type = cc.type = "button"; acts.style.display = "flex"; acts.style.gap = "8px"; acts.appendChild(sv); acts.appendChild(cc); box.appendChild(acts); box.appendChild(msg);
    cc.addEventListener("click", close);
    sv.addEventListener("click", function(){
      var bad = rows.filter(function(r){ return !String(r.time).trim() || !String(r.name).trim(); })[0];
      if (bad){ msg.textContent = "Every stop needs a name after its time, like \"9:30a Old Faithful\"."; return; }
      var nu = document.createElement("ul");
      rows.forEach(function(r){
        var li = r.li ? r.li.cloneNode(true) : document.createElement("li"), tEl = li.querySelector(":scope > .t");
        if (!tEl){ tEl = document.createElement("span"); li.insertBefore(tEl, li.firstChild); }
        tEl.className = r.fx ? "t fx" : "t"; tEl.textContent = String(r.time).replace(/[~≈]/g, "").trim();
        if (!r.li || r.name.trim() !== r.orig){
          [].slice.call(li.childNodes).forEach(function(n){ if (n !== tEl && !(n.nodeType === 1 && n.matches("ul.details"))) n.remove(); });
          var a = document.createElement("a"); a.href = mapsQ(t, r.name.trim()); a.textContent = r.name.trim();
          var det = li.querySelector(":scope > ul.details"); li.insertBefore(document.createTextNode(" "), det); li.insertBefore(a, det); if (det) li.insertBefore(document.createTextNode(" "), det); }
        nu.appendChild(li); });
      if (!rows.length) nu.innerHTML = "<li>Open day</li>";
      if (ul) ul.replaceWith(nu); else { var lg = sec.querySelector(":scope > .lodging"); sec.insertBefore(nu, lg || null); }
      var drive = sec.querySelector("a.drive"), qs = [].map.call(nu.querySelectorAll(':scope > li > a[href*="maps/search"]'), function(a){ try { return new URL(a.href).searchParams.get("query"); } catch(e){ return ""; } }).filter(Boolean);
      if (drive && qs.length){ try { var u = new URL(drive.href); u.searchParams.delete("origin"); u.searchParams.set("destination", qs[qs.length - 1]);
        if (qs.length > 1) u.searchParams.set("waypoints", qs.slice(0, -1).join("|")); else u.searchParams.delete("waypoints"); drive.href = u.toString(); } catch(e){} }
      sv.disabled = true; sv.textContent = "Saving…";
      saveItin(t, raw.innerHTML, {day:date, request:"Edited stops by hand", at:Date.now(), synced:false}).then(function(){
        try { localStorage.removeItem("tif-eta-" + t.id + "-" + sec.id); } catch(e){}
        db.doc("trip/" + t.id + "/eta/" + sec.id).set({tk:[], cuts:[], updatedAt:Date.now()}).catch(function(){});
        showStatus("<strong>Saved.</strong> " + escHtml(fmtD(date)) + " updated.", true); var sh = statusEl.innerHTML; setTimeout(function(){ if (statusEl.innerHTML === sh) statusEl.hidden = true; }, 4000);
      }).catch(function(){ sv.disabled = false; sv.textContent = "Save day"; msg.textContent = "Not saved. Check your connection and try again."; }); }); }
  paint(); }

/* Day's driving route starts where the day starts (Tyler, Sep 26 2026), on every trip: the previous night's lodging;
   before any lodging, the arrival airport on a day with a flight (the last "ABC … → XYZ" leg), otherwise home
   (meta/main.home, default Rochester, MN). Added at display time only; stored itineraries keep no origin, and the
   per-stop "Route from here" links still start from the phone's location. */
var HOME_BASE = "Rochester, MN";
function driveOrigins(root){
  var days = [].slice.call(root.querySelectorAll("section.day[data-date]")).sort(function(a,b){ return a.dataset.date < b.dataset.date ? -1 : 1; });
  var stay = "", home = (IDX && typeof IDX.home === "string" && IDX.home.trim()) || HOME_BASE;
  days.forEach(function(s){
    var d = s.querySelector("a.drive");
    if (d){ try { var u = new URL(d.href);
      if (/\/maps\/dir\//.test(u.href) && !u.searchParams.get("origin")){
        var o = stay;
        if (!o){ var txt = s.textContent.replace(/\s+/g, " "), re = /\b([A-Z]{3})\b[^→;]{0,14}→\s*([A-Z]{3})\b/g, m, arr = "", dep = "";
          while ((m = re.exec(txt))){ if (!dep) dep = m[1]; arr = m[2]; }
          // Driving to the departure airport (e.g. home → MSP) starts at home, not at the flight's arrival airport.
          var dest = (u.searchParams.get("destination") || "").toUpperCase(), toDep = dep && (dest.indexOf(dep) > -1 || (dep === HOME_AIRPORT && /MINNEAPOLIS/.test(dest)));
          if (/:drive$/.test(d.getAttribute("data-bk") || "")) toDep = true;  // route added for a flight leaving from home
          o = arr && !toDep ? arr + " Airport" : home; }
        u.searchParams.set("origin", o); d.href = u.toString(); } } catch(e){} }
    var lg = s.querySelector(".lodging a[href*='maps/search']");
    if (lg){ try { stay = new URL(lg.href).searchParams.get("query") || stay; } catch(e){} }
  }); }

/* Bookings shape the itinerary (Tyler, Sep 28 2026): on every active or upcoming dated trip, each confirmed flight
   (state confirmed / reported / done, with a date) is added to its day as a fixed stop, and each confirmed lodging as
   the day's lodging line with its nights. Every trip date gets a day section, so the rest is a shell to fill in
   ("No plans yet"). Added items carry data-bk="<booking id>"; a booking already in the day (same flight number, or a
   lodging line / the hotel's name) is never added twice. Runs on load and when trips change; logged in `changes`. */
var BK_OK = {confirmed:1, reported:1, done:1};
var HOME_AIRPORT = "MSP", LEGS_V = "2";
function hm(x){ x = ((x % 1440) + 1440) % 1440; var h = Math.floor(x / 60), mm = x % 60; return (h % 12 || 12) + ":" + String(mm).padStart(2,"0") + (h >= 12 ? "p" : "a"); }
// The legs around a flight: getting to the departure airport (Rochester → MSP is ~1 hr 30 min; be at the airport
// 2 hr before) and, after landing, getting to the lodging or home. Unknown times show as "TBD".
function apName(code){ return code === HOME_AIRPORT ? "Minneapolis-Saint Paul International Airport" : code + " Airport"; }
function mapsSearch(q){ return "https://www.google.com/maps/search/?api=1&amp;query=" + encodeURIComponent(q).replace(/%20/g, "+"); }
function mapsDir(dest, origin){ return "https://www.google.com/maps/dir/?api=1&amp;travelmode=driving" + (origin ? "&amp;origin=" + encodeURIComponent(origin).replace(/%20/g, "+") : "") + "&amp;destination=" + encodeURIComponent(dest).replace(/%20/g, "+"); }
function aLink(href, text){ return '<a href="' + href + '" target="_blank" rel="noopener">' + escHtml(text) + '</a>'; }
// The legs around a flight, in the Wyoming format (Tyler, Sep 28 2026): every place is a Google Maps link. Getting to the
// departure airport (Rochester → MSP is ~1 hr 30 min; be at the airport 2 hr before) and, after landing, getting to
// the lodging or home. Unknown times show as "TBD". drive = the day's driving route when the flight leaves from home.
function flightLegs(b, t, dep){
  // Airports come only from route legs like "MSP 3:05p → MDW" (never other capitals such as "PDF").
  var txt = (b.label || "") + " " + (b.detail || ""), legs = [], re = /\b([A-Z]{3})\b(?:\s+\d{1,2}(?::\d{2})?\s*[ap])?\s*→\s*([A-Z]{3})\b/g, mm; while ((mm = re.exec(txt))) legs.push([mm[1], mm[2]]);
  var from = legs.length ? legs[0][0] : "", to = legs.length ? legs[legs.length - 1][1] : "", times = String(b.detail || "").match(/\b\d{1,2}(?::\d{2})?\s*[ap]\b/gi) || [], arr = times.length > 1 ? bkMin(times[times.length - 1]) : null;
  var homeward = to === HOME_AIRPORT || /\breturn\b|\bhome\b/i.test(txt), homeName = (IDX && typeof IDX.home === "string" && IDX.home.trim()) || HOME_BASE, homeShort = String(homeName).split(",")[0];
  function li(chip, html, det){ return '<span class="t">' + escHtml(chip) + '</span> ' + html + (det ? '<ul class="details"><li>' + escHtml(det) + '</li></ul>' : ""); }
  var pre = [], post = [], drive = "";
  if (from === HOME_AIRPORT){
    pre.push(li(dep != null ? hm(dep - 210) : "TBD", "Leave home for " + aLink(mapsDir(apName(HOME_AIRPORT)), HOME_AIRPORT), "~1 hr 30 min drive from " + homeShort));
    pre.push(li(dep != null ? hm(dep - 120) : "TBD", aLink(mapsSearch(apName(HOME_AIRPORT)), HOME_AIRPORT) + " · park and check in", "Be at the airport 2 hr before departure"));
    drive = '<a class="drive" href="' + mapsDir(apName(HOME_AIRPORT)) + '" target="_blank" rel="noopener">Day\'s driving route ↗</a>';
  } else if (from) pre.push(li(dep != null ? hm(dep - 150) : "TBD", "Head to " + aLink(mapsSearch(apName(from)), from) + " airport", "Aim to arrive 2 hr before departure"));
  if (homeward) post.push(li(arr != null ? hm(arr + 15) : "TBD", "Land" + (to ? " at " + aLink(mapsSearch(apName(to)), to) : "") + " · head home to " + aLink(mapsDir(homeName), homeShort), to === HOME_AIRPORT ? "~1 hr 30 min drive" : "Connection and drive home TBD"));
  else if (to) post.push(li(arr != null ? hm(arr + 15) : "TBD", "Land at " + aLink(mapsSearch(apName(to)), to) + " · get to the lodging", "Ground transport TBD"));
  return {pre:pre, post:post, drive:drive};
}

function bkMin(s){ var m = /(\d{1,2})(?::(\d{2}))?\s*([ap])/i.exec(s || ""); if (!m) return null; var h = +m[1] % 12; if (m[3].toLowerCase() === "p") h += 12; return h * 60 + (+m[2] || 0); }
function bkTime(s){ var m = /\b(\d{1,2}(?::\d{2})?)\s*([ap])\.?m?\b/i.exec(s || ""); return m ? m[1] + m[2].toLowerCase() : ""; }
function flightNos(s){ var out = [], re = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b/g, m; while ((m = re.exec(s || ""))) out.push(m[1] + m[2]); return out; }
function bookingShell(t, html){
  var r0 = RAW[t.id] || {}, bks = r0.bookings || {}, dates = tripDates(t); if (!dates.length) return null;
  var ok = Object.keys(bks).map(function(k){ return Object.assign({id:k}, bks[k]); }).filter(function(b){ return !b.removed && BK_OK[b.state] && b.day && (b.type === "flight" || b.type === "lodging") && dates.indexOf(b.day) > -1; });
  if (!ok.length && !/data-bk=/.test(html || "")) return null;
  var d = document.createElement("div"); d.innerHTML = html || ""; var added = [];
  function norm(x){ return String(x || "").replace(/\s+/g,"").toUpperCase(); }
  function secFor(date, title){ var s = d.querySelector('section.day[data-date="' + date + '"]'); if (s) return s;
    var tmp = document.createElement("div"); tmp.innerHTML = '<section class="day" data-date="' + date + '" id="day-' + date + '"><div class="day-head"><h2>' + escHtml(title) + '</h2><span class="date">' + fmtLong(date) + '</span></div>' + ETA_BLOCK + '<ul><li>No plans yet</li></ul></section>';
    s = tmp.firstChild; var later = [].slice.call(d.querySelectorAll("section.day[data-date]")).filter(function(x){ return x.getAttribute("data-date") > date && !x.closest("details.passed"); })[0];
    var anchor = later || d.querySelector("section.ref") || d.querySelector("details.passed");
    if (anchor) anchor.parentNode.insertBefore(s, anchor); else d.appendChild(s);
    var nav = d.querySelector(".nav"); if (!nav){ nav = document.createElement("nav"); nav.className = "nav"; nav.setAttribute("aria-label","Days"); d.insertBefore(nav, d.firstChild); }
    if (!nav.querySelector('a[data-date="' + date + '"]')){ var a = document.createElement("a"), dd = pd(date); a.href = "#day-" + date; a.setAttribute("data-date", date); a.textContent = WD[dd.getDay()] + " " + dd.getDate();
      var nx = [].slice.call(nav.querySelectorAll("a[data-date]")).filter(function(x){ return x.getAttribute("data-date") > date; })[0]; if (nx) nav.insertBefore(a, nx); else nav.appendChild(a); }
    added.push("day " + date); return s; }
  // Keep the itinerary in step with bookings (Tyler, Sep 28 2026): items added for a booking that is now removed,
  // no longer complete, or changed (label, detail or date: data-bkv) are taken out with their ground legs; a changed
  // booking is then added again fresh.
  function bkv(b){ var x = (b.label || "") + "|" + (b.detail || "") + "|" + (b.day || ""), h = 0; for (var i = 0; i < x.length; i++) h = (h * 31 + x.charCodeAt(i)) | 0; return String(h >>> 0); }
  var okIds = {}; ok.forEach(function(b){ okIds[b.id] = b; });
  [].slice.call(d.querySelectorAll("[data-bk]")).forEach(function(n){ if (!d.contains(n)) return; var id = n.getAttribute("data-bk").split(":")[0], b = okIds[id];
    var stale = !b || (n.getAttribute("data-bk") === id && n.hasAttribute("data-bkv") && n.getAttribute("data-bkv") !== bkv(b));
    if (!stale) return; [].slice.call(d.querySelectorAll('[data-bk="' + id + '"],[data-bk^="' + id + ':"]')).forEach(function(x){ var u = x.parentNode; x.remove(); if (u && u.tagName === "UL" && !u.children.length) u.innerHTML = "<li>No plans yet</li>"; });
    added.push("removed " + (b ? "old details for " + (b.label || "a booking") : ((bks[id] || {}).label || "a removed booking"))); });
  var flightDays = {}; ok.forEach(function(b){ if (b.type === "flight") flightDays[b.day] = 1; });
  var dayT = {}; (t.days || []).forEach(function(x){ if (x && x.d && x.t) dayT[x.d] = x.t; });
  dates.forEach(function(date){ secFor(date, dayT[date] || (flightDays[date] ? "Travel day" : "Open day")); });
  // The itinerary follows the trip record's dates (Tyler, Oct 3 2026): a day outside start–end is dropped with its nav
  // link when it holds nothing of his own (only "No plans yet" or booking-generated lines). A day with his own stops is kept.
  [].slice.call(d.querySelectorAll("section.day[data-date]")).forEach(function(sec){ var dt = sec.getAttribute("data-date"); if (dates.indexOf(dt) > -1 || sec.closest("details.passed")) return;
    var own = [].slice.call(sec.querySelectorAll("ul > li")).filter(function(li){ return li.parentNode.closest("li") === null && !li.hasAttribute("data-bk") && !/^No plans yet$/i.test(li.textContent.trim()); });
    if (own.length || sec.querySelector(".lodging:not([data-bk])")) return;
    sec.remove(); var a = d.querySelector('.nav a[data-date="' + dt + '"]'); if (a) a.remove(); added.push("removed day " + dt + " (outside trip dates)"); });
  // Place (or refresh) a flight's ground legs and, leaving from home, the day's driving route. LEGS_V marks the current
  // format; older legs are replaced so every trip matches it.
  function placeLegs(b, li, dep){
    [].slice.call(d.querySelectorAll('[data-bk^="' + b.id + ':"]')).forEach(function(x){ x.remove(); });
    var cz = flightLegs(b, t, dep), ul = li.parentNode, sec = li.closest("section.day");
    cz.pre.forEach(function(h){ var x = document.createElement("li"); x.setAttribute("data-bk", b.id + ":pre"); x.setAttribute("data-bkl", LEGS_V); x.innerHTML = h; ul.insertBefore(x, li); });
    var ref = li.nextSibling; cz.post.forEach(function(h){ var x = document.createElement("li"); x.setAttribute("data-bk", b.id + ":post"); x.setAttribute("data-bkl", LEGS_V); x.innerHTML = h; ul.insertBefore(x, ref); });
    if (cz.drive && sec && !sec.querySelector(":scope > a.drive")){ var w = document.createElement("div"); w.innerHTML = cz.drive; var a = w.firstChild; a.setAttribute("data-bk", b.id + ":drive"); a.setAttribute("data-bkl", LEGS_V);
      var hd = sec.querySelector(":scope > .day-head"); if (hd) hd.after(a); else sec.insertBefore(a, sec.firstChild); } }
  ok.sort(function(a, b){ return (a.day + (bkMin(a.detail) || 0)).localeCompare(b.day + (bkMin(b.detail) || 0)); }).forEach(function(b){
    var have = d.querySelector('[data-bk="' + b.id + '"]');
    if (have){ // flights added before ground legs existed get them once (Tyler, Sep 28 2026)
      var comps = [].slice.call(d.querySelectorAll('[data-bk^="' + b.id + ':"]'));
      if (b.type === "flight" && have.tagName === "LI" && (!comps.length || comps.some(function(x){ return x.getAttribute("data-bkl") !== LEGS_V; }))){ var t1 = have.querySelector(":scope > .t");
        placeLegs(b, have, t1 ? bkMin(t1.textContent) : null); added.push("ground legs for " + (b.label || "flight")); }
      return; }
    var sec = secFor(b.day, dayT[b.day] || (b.type === "flight" ? "Travel day" : "Open day")), txt = norm(sec.textContent);
    if (b.type === "flight"){
      var nos = flightNos((b.label || "") + " " + (b.detail || "")); if (nos.length && nos.some(function(n){ return txt.indexOf(n) > -1; })) return;
      if (!nos.length && !bkTime(b.detail) && !bkTime(b.label) && !/\b[A-Z]{3}\s*→\s*[A-Z]{3}\b/.test((b.label || "") + " " + (b.detail || ""))) return;  // nothing to place (no flight number, time or route)
      var ul = [].slice.call(sec.children).filter(function(c){ return c.tagName === "UL"; })[0]; if (!ul){ ul = document.createElement("ul"); sec.appendChild(ul); }
      // A real flight replaces TBD placeholders on its day (placeholder flight lines and their TBD legs).
      [].slice.call(ul.children).forEach(function(x){ if (x.hasAttribute("data-bk")) return; var c = x.querySelector(":scope > .t"); if (c && /^(flight\s+)?tbd$/i.test(c.textContent.trim())){ x.remove(); added.push("removed placeholder"); } });
      var only = ul.children.length === 1 && /^No plans yet$/i.test(ul.children[0].textContent.trim()); if (only || !ul.children.length) ul.innerHTML = "";
      var tm = bkTime(b.detail) || bkTime(b.label), mn = bkMin(tm), li = document.createElement("li"); li.setAttribute("data-bk", b.id); li.setAttribute("data-bkv", bkv(b));
      li.innerHTML = '<span class="t fx">' + escHtml(tm || "Flight") + '</span> ' + escHtml(b.label || "Flight") + (b.detail ? '<ul class="details"><li>' + escHtml(b.detail) + (b.conf && String(b.detail).indexOf(b.conf) < 0 ? " · confirmation " + escHtml(b.conf) : "") + '</li></ul>' : "");
      var before = mn == null ? null : [].slice.call(ul.children).filter(function(x){ var t0 = x.querySelector(":scope > .t"); var v = t0 ? bkMin(t0.textContent) : null; return v != null && v > mn; })[0];
      if (before) ul.insertBefore(li, before); else ul.appendChild(li);
      // Flight-day shell (Tyler, Sep 28 2026): the ground legs around the flight, as estimates to adjust.
      placeLegs(b, li, mn);
      added.push(b.label || "flight");
    } else {
      var name = String(b.label || "Lodging").split(" · ")[0].trim();
      if (sec.querySelector(".lodging") || txt.indexOf(norm(name)) > -1) return;
      // Standalone app: a lodging booking can carry its full street address (b.address), used for the Maps link and the next day's route start.
      var nm = /(\d+)\s+nights?/i.exec((b.label || "") + " " + (b.detail || "")), q = encodeURIComponent(name + (b.address ? " " + b.address : t.where ? " " + String(t.where).split("→")[0].trim() : "")).replace(/%20/g, "+");
      var lod = document.createElement("div"); lod.className = "lodging"; lod.setAttribute("data-bk", b.id); lod.setAttribute("data-bkv", bkv(b));
      lod.innerHTML = '<span class="k">Lodging' + (nm ? " · " + nm[1] + " night" + (nm[1] === "1" ? "" : "s") : "") + '</span><a href="https://www.google.com/maps/search/?api=1&amp;query=' + q + '" target="_blank" rel="noopener">' + escHtml(name) + '</a>' + (b.conf ? " · confirmation " + escHtml(b.conf) : "");
      sec.appendChild(lod); added.push(name);
    }
  });
  // Any day that now has a booked flight drops its TBD placeholder lines (a flight "TBD" and TBD legs without a booking).
  [].slice.call(d.querySelectorAll("section.day")).forEach(function(sec){ if (!sec.querySelector('li[data-bk]:not([data-bk*=":"])')) return;
    [].slice.call(sec.querySelectorAll(":scope > ul > li:not([data-bk])")).forEach(function(x){ var c = x.querySelector(":scope > .t"); if (c && /^(flight\s+)?tbd$/i.test(c.textContent.trim())){ x.remove(); added.push("removed placeholder"); } }); });
  if (!d.querySelector("details.passed")) d.insertAdjacentHTML("beforeend", PASSED_BLOCK);
  return added.length ? {html:d.innerHTML, added:added} : null;
}
var BK_BUSY = {};
function itinBookingSweep(){
  if (!db || !READY || document.querySelector(".stopedit")) return;
  ORDER.forEach(function(id){ var t = TRIPS[id], r0 = RAW[id]; if (!t || !r0 || r0.archived || !t.start || closing(t) || BK_BUSY[id]) return;
    BK_BUSY[id] = true;
    db.doc("trip/" + id + "/itinerary/main").get().then(function(sn){ var o = sn.exists && sn.data(); var res = bookingShell(t, o && typeof o.html === "string" ? o.html : "");
      if (!res) return;
      var names = res.added.filter(function(x){ return x.indexOf("day ") !== 0 && x.indexOf("removed") !== 0; }), gone = res.added.filter(function(x){ return x.indexOf("removed") === 0; });
      return saveItin(t, res.html, {day:"all", request:"Synced itinerary with bookings" + (names.length ? ": added " + names.join(", ") : "") + (gone.length ? (names.length ? "; " : ": ") + gone.join(", ") : "") + (!names.length && !gone.length ? " (day shells)" : ""), at:Date.now(), synced:false});
    }).catch(function(){}).then(function(){ BK_BUSY[id] = false; });
  });
}


/* Weather on each itinerary day (Tyler, September 29, 2026). Display only: the forecast lives in trip/<Trip ID>/weather/main,
   written by a scheduled check from weather.gov for trips within 7 days; nothing is stored in the itinerary HTML.
   Shape: {at: ms, source, place, days: {"YYYY-MM-DD": {hi, lo, pop, sky, wind}}, alerts: [{day?, event, headline}]}. */
var WX = {};
function wxLoad(t){
  var c = WX[t.id]; if (c && Date.now() - c.ts < 600000) return Promise.resolve(c.doc);
  if (!db) return Promise.resolve(null);
  return db.doc("trip/" + t.id + "/weather/main").get().then(function(sn){ var o = sn.exists ? sn.data() : null; WX[t.id] = {ts:Date.now(), doc:o}; return o; }).catch(function(){ return null; });
}
function weatherDecorate(root, t){
  wxLoad(t).then(function(o){
    if (!o || !o.days || !root.isConnected) return;
    var stale = o.at && Date.now() - o.at > 36 * 3600000;
    root.querySelectorAll("section.day[data-date]").forEach(function(sec){
      var d = sec.getAttribute("data-date"), w = o.days[d], al = (o.alerts || []).filter(function(a){ return a && (!a.day || a.day === d); });
      if (!w && !al.length) return;
      [].slice.call(sec.querySelectorAll(":scope > .wx")).forEach(function(x){ x.remove(); });
      var box = el("div","wx");
      if (w){ var bits = [];
        if (w.sky) bits.push(w.sky);
        if (w.hi != null || w.lo != null) bits.push((w.hi != null ? Math.round(w.hi) + "°" : "") + (w.lo != null ? (w.hi != null ? " / " : "low ") + Math.round(w.lo) + "°" : ""));
        if (w.pop != null && w.pop >= 20) bits.push(Math.round(w.pop) + "% rain");
        if (w.wind) bits.push("wind " + w.wind);
        if (bits.length){ var ln = el("div","wxl", bits.join(" · ") + (stale && o.at ? " · as of " + fmt(new Date(o.at).toISOString().slice(0,10)) : "")); ln.title = "Forecast from " + (o.source || "weather.gov"); box.appendChild(ln); } }
      al.forEach(function(a){ var ar = el("div","wxa"); ar.appendChild(el("b",null,"⚠ " + (a.event || "Weather alert")));
        if (a.headline) ar.appendChild(document.createTextNode(" — " + String(a.headline).slice(0,160))); box.appendChild(ar); });
      var head = sec.querySelector(":scope > .day-head"); if (head && head.nextSibling) sec.insertBefore(box, head.nextSibling); else sec.appendChild(box);
    });
  });
}
