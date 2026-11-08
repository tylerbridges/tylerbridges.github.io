"use strict";
/* Itinerary Generator app: a day-by-day itinerary from the trip's dates, flights and lodging. */
var APP = {title:"Itinerary Generator", tab:"itinerary",
  tripView: function(t, focus){ return itinView(t, focus); },
  tripExtras: function(t){ return bookingsPanel(t); },
  // Same as the dashboard: confirmed flights and lodging flow into the itinerary whenever trips change.
  onTrips: function(){ clearTimeout(window.__bkT); window.__bkT = setTimeout(itinBookingSweep, 400); }};
// "Build from my trip": a day for every trip date (title from the trip's day notes, else Travel day / Open day),
// then bookingShell() adds the flights with their ground legs and the lodging lines.
function buildShell(t){
  var dates = tripDates(t), dayT = {}; (t.days || []).forEach(function(x){ if (x && x.d && x.t) dayT[x.d] = x.t; });
  var nav = '<nav class="nav" aria-label="Days">' + dates.map(function(dt){ var x = pd(dt); return '<a href="#day-' + dt + '" data-date="' + dt + '">' + WD[x.getDay()] + " " + x.getDate() + "</a>"; }).join("") + "</nav>";
  var secs = dates.map(function(dt){ return '<section class="day" data-date="' + dt + '" id="day-' + dt + '"><div class="day-head"><h2>' + escHtml(dayT[dt] || "Open day") + '</h2><span class="date">' + fmtLong(dt) + '</span></div>' + ETA_BLOCK + '<ul><li>No plans yet</li></ul></section>'; });
  var html = nav + "\n" + secs.join("\n") + "\n" + PASSED_BLOCK, res = bookingShell(t, html);
  return saveItin(t, res ? res.html : html, {day:"all", request:"Built itinerary from trip dates and bookings", at:Date.now(), synced:false});
}
