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
- **Packing generator**: one compact setup form collects destination, dates, trip type, baggage and optional major activities, including Workouts for most days. Expected weather and rain are optional setup choices; skipping them keeps weather unconfirmed. Hiking reveals a rugged/wet-trails toggle. Trip name is automatic; travel mode/international status are optional details. Dates are required (1–60 calendar days, including both travel days). Generate first, then use focused Laundry, Packing, Bag, Weather, Activities, Events, Work and Flight editors on the list to change assumptions and recalculate affected rule groups. No AI API call is needed. Weather defaults to unconfirmed and is never inferred as a forecast.
- **Refinement state**: `trip/<ID>/pack_meta/refinement` stores version 2 inputs, refinements, explicit item overrides, cached rule-group outputs with dependency fingerprints and an unchanged first-generation baseline. Stable item IDs are separate from labels and quantities. Changes show a summary and support one-step Undo. Rules compare actual dependency values to prevent stale results; baggage and manual exceptions update final composition without rerunning unrelated rules. Unchanged submissions preserve Undo. Only changed list sections are repainted. Manual edits/removals/additions survive regeneration and reload. Existing lists are preserved as pinned legacy items; automatic refinement is opt-in for them.
- **Rules and defaults**: Standard provides fresh daily T-shirts and bottoms for two days per pair. Pack lighter is removed; existing lighter settings normalize to Standard while explicit edits stay pinned. Usual accessories stay included. Extra adds one T-shirt, two underwear, two pairs of socks and one pair of bottoms. Laundry covers the longest actual gap between washes plus one spare day; contacts always cover the full trip. Cool/cold weather keeps both hoodie and puffer even when you run hot; rain protection remains separate. Workouts assumes most days and uses regular clothing, with enough shorts for two days per pair even in cool weather. No extra workout outfit or extra workout shirt is added. Brooks cover ordinary hikes; rugged/wet trails require hiking footwear. Hiking shares hydration and weather protection. The collapsible daypack is opt-in via I need a daypack in setup or Activities; it is not added by defaults or hiking. Existing manual/legacy daypack items remain pinned. Carry-on only flags space conflicts; quantities and item placement remain unchanged. Work setup includes power dependencies. Long trips without laundry show a warning rather than silently capping quantities. Sleepwear remains none; shared items and medication dosing are not inferred.
- **Manual exceptions and feedback**: Edit pins an item; Return to automatic resets that override. Remove offers This trip or Usually don’t pack this (for noncritical, nonrequired generated items). Profile exclusions live in `meta/packing.refinementProfile.excluded` and can be inspected/reset in Defaults & exclusions. Critical/required removals and pinned shortfalls leave visible warnings. No hidden statistical learning is active; repeated-trip suggestions are a later enhancement. Profile choices, overrides and all data remain local to this browser.
- **Standard quantities**: socks/underwear 2 per day; T-shirts 1 per day; bottoms days ÷ 2 rounded up; the departure outfit counts toward socks/underwear/T-shirt totals. Cool/cold conditions swap half the packed shorts for joggers, while workouts retain sufficient shorts and running hot keeps cool-weather layers. Contacts cover the whole trip plus 2 days, rounded up to a multiple of 5. Nice dinners get one button-up per dinner; formal shirts/socks/undershirts follow formal-day count. Before leaving checks are derived from the final reviewed items.
- **Packing export**: select Export to Notes, then download an Apple Notes `.enex` file (Mac Notes → File → Import to Notes), download Markdown, or copy formatted headings and checkbox symbols for pasting into Notes. Every section and item is included; Before leaving stays last. The ENEX import produced native Apple Notes checklist items in Tyler's device test. The note title appears once. Formatted copy uses checkbox symbols, which may need conversion using Notes' checklist button. Exports are separate copies and do not sync changes back.
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
