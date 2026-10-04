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
- **Packing export**: open a trip's packing list and select Export. Download an Apple Notes `.enex` file (Mac Notes → File → Import to Notes), download Markdown, or copy formatted headings and checkbox symbols for pasting into Notes. Every section and item is included, regardless of filters or collapsed sections; Before leaving stays last. Exports start unchecked unless you select Keep packed items checked. ENEX contains Evernote checkbox elements; native checklist conversion and exact formatting in Apple Notes require device testing. Formatted copy uses checkbox symbols, which may need conversion using Notes' checklist button. Exports are separate copies and do not sync changes back.
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
