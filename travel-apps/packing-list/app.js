"use strict";
/* Packing List app: one trip's packing checklist, built from Tyler's preferences. */
var APP = {title:"Packing List", tab:"packing", homeView:generatorHome, tripForm:refineSetup, tripPage:refinePage, tripView:refineReview};
// First run in this browser: store the preferences where packing.js looks for them (meta/packing).
(function seed(){ var cur = lsGet("ta:meta/packing", null);
  if (!cur) lsSet("ta:meta/packing", Object.assign({}, PACK_PREFS, {rules:PREF_RULES.slice(), lessons:[], learned:{}, seededAt:isoToday()})); })();
