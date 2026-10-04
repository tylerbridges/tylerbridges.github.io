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
- **Packing generator**: one compact setup form collects destination, dates, trip type, baggage and optional major activities, including Workouts for most days. Expected weather and rain are optional setup choices; skipping them keeps weather unconfirmed. Hiking reveals a rugged/wet-trails toggle. Trip name is automatic; travel mode/international status are optional details. Dates are required (1–60 calendar days, including both travel days). Generate first, then use focused Laundry, Packing, Extras, Bag, Weather, Activities, Events, Work and Flight editors on the list to change assumptions and recalculate affected rule groups. No AI API call is needed. Weather defaults to unconfirmed and is never inferred as a forecast.
- **Draft autosave**: Setup (including calendar dates), semantic refinements, manual edits/additions, preference edits, trip-style names and post-trip feedback save unfinished work immediately in `meta/packingFormDrafts/<scope>`. Reopening the same editor restores the draft with a visible status and a Discard unfinished draft action. Drafts remain separate from confirmed assumptions, item overrides, preferences and learning evidence; Apply/Save confirms them and clears the draft only after a successful save. Draft context checks prevent restoring edits against changed confirmed values. Storage failures are visible and test-mode drafts are isolated. All data remains in this browser; Settings backup includes it.
- **Quick setup and trip styles**: Work, Formal event and Mixed reveal explicit video-call workday, suit-day and dinner counts plus equipment selection. Leisure can reveal the same fields with the occasion toggle. Confirmed counts do not get asked twice; applicable dinner/suit/sharing decisions still appear before export. Weekend, Work week and Longer trip are built-in reusable styles. Save trip style under Trip styles & learning to reuse baggage, mode, activities, equipment, laundry and selected extras. A new trip keeps destination/dates empty, weather unconfirmed, and asks for fresh occasion counts; manual overrides stay on the original trip.
- **Refinement state**: `trip/<ID>/pack_meta/refinement` stores version 2 inputs, refinements, explicit item overrides, cached rule-group outputs with dependency fingerprints and an unchanged first-generation baseline. Stable item IDs are separate from labels and quantities. Changes show a summary and support one-step Undo. Rules compare actual dependency values to prevent stale results; baggage and manual exceptions update final composition without rerunning unrelated rules. Unchanged submissions preserve Undo. Only changed list sections are repainted. Manual edits/removals/additions survive regeneration and reload. Existing lists are preserved as pinned legacy items; automatic refinement is opt-in for them.
- **Rules and defaults**: Standard provides fresh daily T-shirts and bottoms for two days per pair. Pack lighter is removed; existing lighter settings normalize to Standard while explicit edits stay pinned. Usual accessories stay included except Kindle, Hotspot, Belkin charging pad, Garmin + charger (paired) and extra phone case, selected explicitly via setup Trip extras or the Extras refinement. They default off; existing manual/legacy items remain pinned. Snacks, water bottle, Anker battery pack, WHOOP charger and other reviewed usual items remain automatic. Extra adds one T-shirt, two underwear, two pairs of socks and one pair of bottoms; it uses the existing laundry buffer instead of stacking a second spare set. Laundry covers the longest actual gap between washes plus one spare day; contacts always cover the full trip. Weather represents the coldest expected outdoor conditions; warmer-weather shorts can be added separately. Cool/cold weather keeps both hoodie and puffer even when you run hot; rain protection remains separate. Workouts assumes most days and uses regular clothing, with enough shorts for two days per pair even in cool weather. No extra workout outfit or extra workout shirt is added. Brooks cover ordinary hikes; rugged/wet trails require hiking footwear. Hiking shares hydration and weather protection. The collapsible daypack is opt-in via I need a daypack in setup or Activities; it is not added by defaults or hiking. Existing manual/legacy daypack items remain pinned. Carry-on only flags space conflicts; quantities and item placement remain unchanged. Work setup includes power dependencies. Long trips without laundry show a warning rather than silently capping quantities. Sleepwear remains none; shared items and medication dosing are not inferred.
- **Guided outfits**: Suit days, video-call workdays and nice dinners are separate needs. Video days use fresh long-sleeve tops without dedicated bottoms. Confirm polo/button-up dinner tops and suitable shorts/jeans/khakis; reuse bottoms and one belt across occasions. One reusable suit uses fresh solid-color dress shirts and dress socks per suit day, without undershirts. Confirm tie, optional alternating khakis and shirt compatibility. Suit shirts default separate from patterned work/dinner tops. Maximum same-day shirt overlap is an explicit assumption with editable shared-day counts. Laundry never reduces work/dinner/suit shirt counts. Applicable decisions appear in sequence and must be confirmed before export; changing their context reopens them. Optional general refinements remain skippable. Existing saved trips acquire the new assumptions and review requirements while retaining all explicit overrides and baseline data.
- **Manual exceptions and feedback**: Edit pins an item; Return to automatic resets that override. Remove offers This trip or Usually don’t pack this (for noncritical, nonrequired generated items). Profile exclusions live in `meta/packing.refinementProfile.excluded` and can be inspected/reset in Defaults & exclusions. Critical/required removals and pinned shortfalls leave visible warnings. Post-trip learning is deterministic and local: use Trip styles & learning → Learn from this trip to report only exceptions, optionally confirming the rest of the captured list was needed. Only explicitly reviewed items count. Five comparable reviewed opportunities with four unneeded reports (or three missing reports) yield inspectable suggestions. Applying a safe usual-item exclusion requires an explicit choice; critical/required items, clothing, manual items and Snacks are protected. History can be inspected, forgotten or reset under Packing learning; applied defaults are reset separately in Defaults & exclusions. Notes edits do not sync back, so actual feedback must be entered here. Profile choices, overrides and all data remain local to this browser.
- **Standard quantities**: socks/underwear 2 per day; T-shirts 1 per day; bottoms days ÷ 2 rounded up; the departure outfit counts toward socks/underwear/T-shirt totals. Cool/cold conditions swap half the packed shorts for joggers, while workouts retain sufficient shorts and running hot keeps cool-weather layers. Contacts cover the whole trip plus 2 days, rounded up to a multiple of 5. Nice dinners get one button-up per dinner; formal white shirts and dress socks follow suit-day count, with no undershirts. Before leaving checks are derived from the final reviewed items.
- **Packing export**: select Export to Notes and resolve applicable outfit decisions. One Review & export screen shows quantities, warnings and the export action. The last successful format is remembered; alternative formats and preview live under More export options (the legacy export also keeps its checked-item option there). Then download an Apple Notes `.enex` file (Mac Notes → File → Import to Notes), download Markdown, or copy formatted headings and checkbox symbols for pasting into Notes. Every section and item is included; Before leaving stays last. The ENEX import produced native Apple Notes checklist items in Tyler's device test. The note title appears once. Formatted copy uses checkbox symbols, which may need conversion using Notes' checklist button. Exports are separate copies and do not sync changes back.
- **Claude**: off by default. Settings takes your own Anthropic API key (stored only in the browser, never in the repo) and a model (default `claude-sonnet-5-5`). With it on, the prompts are the dashboard's own.
- **Without Claude**: the packing builder uses `rules.js` + preferences (quantities by trip length, maybe items for ticked tags, usual extras, Before leaving). The itinerary builds a day per trip date and places confirmed flights (with ground legs) and lodging.
- **Left out** (dashboard-only): home page, chat, tasks, costs, trip close-out/archive, Gmail/booking import, scheduled weather, PDF copies, Google Maps list sync.
- **Small edits inside the extracted modules** are marked with `Standalone app:` comments.

## Checks

```
node tools/check.mjs   # JS syntax + every file the HTML loads exists
node tests/generator.mjs
node tests/refinements.mjs
node tests/learning.mjs # local evidence, protections and namespace isolation
node tests/e2e.mjs     # optional, needs Playwright: both apps end to end
node tests/scenario-ui.mjs
node tests/setup-export-ui.mjs # optional: setup/styles/final review/export/feedback
node tests/autosave-ui.mjs # optional: reload/resume, confirm/discard, failures and isolation
```

Agent rules for this folder are in `AGENTS.md`.

## Run locally

```
python3 -m http.server 8000
# open http://localhost:8000/
```

Packing List → Test flow opens a reusable sandbox (`?test=1`). Choose Professional, Laundry + workouts, or Warm weather + activities; reset into setup or generated review, resume the saved test, and exercise normal refinements/manual overrides/Notes export. The separate `packing-test:` namespace isolates test trips, preferences, exclusions and export documents. Reset copies current real preferences and clears only sandbox data.

In Test flow, **Check this scenario** or **Run all scenario checks** shows fixed expected/actual results for outfit sharing, tie/khaki rotation, laundry buffers, activity dependencies, manual quantity preservation and native Notes formatting. Checks run entirely in memory; the saved test remains unchanged, and its pending export decisions are listed separately.

The Test flow menu also configures trip length (1–60 days), video workdays, suit days, nice dinners, weather, activities, baggage and laundry timing, with an immediate quantity preview. Save named variants or make another copy; presets and named variants remain available across resets. Fixed checks use the selected scenario’s original regression family and are separate from the configurable preview.

Test flow now separates **Validate current test** (the active saved inputs, fresh quantities, formula checks, manual overrides and warnings) from **Run fixed regression checks**. **Save setup configuration** stores editor settings; **Save current test as variant** captures refined assumptions with an explicit manual-edits option. Invalid counts block saving/loading, copy names stay distinct, and the editor keeps its preview and launch controls visible.

Refinement review shows relevant assumptions in a compact checklist, quantity impact alongside outfit choices, and a final outfit summary before opening Notes export. All assumptions remain accessible individually. If Playwright is available, run `node tests/scenario-ui.mjs` for the focused scenario-saving/validation/mobile regressions.

## First-use onboarding direction

The independent onboarding review recommends separating person setup from trip setup: **Starting point → My essentials and clothing → Review my defaults**, then the existing quick trip form. Existing users keep their profile and enter this flow voluntarily. A versioned `meta/packing.packingProfile` should hold the selected preset, baseline, typed clothing/rewear policy, departure outfit, personal consumables and dependency gear. Unfinished onboarding belongs in the draft store; completion explicitly validates and saves it.

The custom-person wizard is not exposed yet: current rule groups force Tyler-specific contacts, quantities, clothing brands and activity/work dependencies. Those contributions must first read the selected profile, with profile dependencies added to caches and policy fingerprints added to learning comparisons. Profiles without the new schema must preserve Tyler behavior exactly. Existing trips and pinned overrides must remain unchanged until explicit recalculation. Acceptance should cover an unchanged Tyler list, a person without contacts or branded gear, custom quantities/departure subtraction, profile-driven cache invalidation, cancel/resume, storage failures and learning isolation across policies.
