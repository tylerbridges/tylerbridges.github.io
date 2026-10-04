"use strict";
/* ================= Rules-only builder =================
   Used when Claude isn't turned on. Builds the core of the list from Tyler's saved packing preferences
   (preferences.js, copied from the dashboard's meta/packing). The builder then adds the "maybe" items for the
   tags he ticked, the usual extras (on a new list) and the Before leaving checks, exactly as it does for a
   Claude draft. Quantities ("Socks ×14") are filled in by qtyLabel/packQtyFill in packing.js. */
function ruleDraft(t, tags, luggage, nights, existing){
  var has = function(tag){ return tags.indexOf(tag) > -1; }, seen = {};
  (existing || []).forEach(function(x){ seen[normItem(x)] = true; });
  var groups = [
    {title:"Wear to travel", items:["Shirt", "Pants", "Underwear", "Socks"]},
    {title:"Clothing", items:["T-shirts", "Underwear", "Socks"].concat(["Lulu shorts"])},
    {title:"Toiletries", items:["Liquids quart bag (travel-size)"]}
  ];
  // Work module (travel-dashboard skill): everything needed to work from the hotel.
  if (has("work")) groups.push({title:"Work", items:["Work computer charger", "Logitech mouse dongle", "USB-C hub / adapters / cables"]});
  if (has("formal")) groups.push({title:"Formal wear", items:["Dress pants ×1", "Belt"]});
  // Skip what's already on the list; the same item may sit in two sections (Wear to travel ×1 + Clothing = total).
  return groups.map(function(g){ var here = {}; return {title:g.title, items:g.items.filter(function(i){ var k = normItem(i); if (seen[k] || here[k]) return false; here[k] = true; return true; })}; })
    .filter(function(g){ return g.items.length; });
}
