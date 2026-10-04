# Travel Apps

Two standalone apps split out of the Travel Dashboard (Claude artifact `W1KaDoXHcN8z1oEunPP7Nv`, version `1791053083-744f`, Oct 4 2026). The dashboard itself is unchanged and stays the source of record for trips; these are separate apps in development.

| App | Folder | Built from |
|---|---|---|
| Packing List | `packing-list/` | dashboard `js/packing.js` + `meta/packing` preferences |
| Itinerary Generator | `itinerary-generator/` | dashboard `js/itinerary.js` |

Static HTML/JS, no build step. Works on GitHub Pages: `/packing-list/` and `/itinerary-generator/`, with a landing page at `/`.

## Layout

```
index.html                 landing page linking both apps
shared/
  core.js     helpers lifted from dashboard core.js + trip.js (dates, sheets, forms, undo, trip records)
  store.js    localStorage stand-in for the artifact database (same doc/collection API)
  ai.js       optional Claude adapter (AI.sample / AI.sample.json), settings + backup/restore
  shell.js    trip list, trip form, routing
  styles.css  dashboard stylesheet, unchanged
  app.css     small additions for the standalone apps
packing-list/
  packing.js      extracted packing module (sections, items, quantities, usual extras, maybe items,
                  Before leaving rules, templates/reuse, builder, packing-learning)
  preferences.js  Tyler's packing preferences (dashboard meta/packing v14)
  rules.js        rules-only list builder used when Claude is off
  app.js
itinerary-generator/
  itinerary.js    extracted itinerary module (draft, change a day, add a day, edit stops, bookings → days,
                  flight ground legs, drive-route origins, Route from here, live ETA taps, offline copy)
  bookings.js     flights and lodging entry, saved in the dashboard's booking shape
  app.js          "Build from my trip" (day shells for every date + bookings)
```

## How it differs from the dashboard

- **Storage**: `store.js` keeps data in the browser (`localStorage`, keys `ta:<path>`) using the same paths the dashboard uses (`trips/<ID>`, `trip/<ID>/pack_items`, `trip/<ID>/itinerary/main`, `meta/packing`, `templates`). Both apps share one origin, so a trip created in one shows in the other. Settings has backup download/restore. Swap `store.js` for a synced backend later without touching the modules.
- **Packing generator**: start with Generate a packing list. Three short steps collect dates, travel mode, luggage, weather, activities, event counts, work gear, and a laundry plan. Dates are required (1–60 travel days, including departure and return). My preferences keeps the original defaults and lets you exclude usual extras or add your own. Saved preferences and trip setups remain in this browser. Rules generate the list without an AI key; arbitrary prose/learned rules are not interpreted by this deterministic generator. Review edits are stored as a separate draft and survive reloads; saving for export replaces this trip's saved packing draft. Existing trip lists remain available for review/export.
- **Quantities**: socks/underwear 2 per day; T-shirts 1 per day; bottoms days ÷ 2 rounded up; the departure outfit counts toward socks/underwear/T-shirt totals. Cool, cold or rainy trips swap half the packed shorts for joggers. A planned laundry cycle sizes clothing to the wash interval plus one spare day, capped at trip length; contacts always cover the whole trip plus 2 days, rounded up to a multiple of 5. Nice dinners get one button-up per dinner; formal shirts/socks/undershirts follow formal-day count. Before leaving checks are recalculated from the reviewed items at export.
- **Packing export**: select Save draft & export to Notes, then download an Apple Notes `.enex` file (Mac Notes → File → Import to Notes), download Markdown, or copy formatted headings and checkbox symbols for pasting into Notes. Every section and item is included; Before leaving stays last. The ENEX import produced native Apple Notes checklist items in Tyler's device test. The note title appears once. Formatted copy uses checkbox symbols, which may need conversion using Notes' checklist button. Exports are separate copies and do not sync changes back.
- **Claude**: off by default. Settings takes your own Anthropic API key (stored only in the browser, never in the repo) and a model (default `claude-sonnet-5-5`). With it on, the prompts are the dashboard's own.
- **Without Claude**: the packing builder uses `rules.js` + preferences (quantities by trip length, maybe items for ticked tags, usual extras, Before leaving). The itinerary builds a day per trip date and places confirmed flights (with ground legs) and lodging.
- **Left out** (dashboard-only): home page, chat, tasks, costs, trip close-out/archive, Gmail/booking import, scheduled weather, PDF copies, Google Maps list sync.
- **Small edits inside the extracted modules** are marked with `Standalone app:` comments.

## Checks

```
node tools/check.mjs   # JS syntax + every file the HTML loads exists
node tests/e2e.mjs     # optional, needs Playwright: both apps end to end
```

Agent rules for this folder are in `AGENTS.md`.

## Run locally

```
python3 -m http.server 8000
# open http://localhost:8000/
```
