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
  store.js    document API (localStorage, or Supabase ta_docs when signed in)
  supabase-config.js   project URL + publishable key (never the secret key)
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

- **Storage**: `store.js` keeps the same paths the dashboard uses (`trips/<ID>`, `trip/<ID>/pack_items`, `trip/<ID>/itinerary/main`, `meta/packing`, `templates`). Signed out, and in Test flow (`?test=1`), they stay in this browser (`localStorage` keys `ta:<path>`). Signed in, the same paths are rows in Supabase `public.ta_docs` and this browser keeps a mirror. Both apps share one origin. Settings still downloads and restores a backup. See [Supabase sync](#supabase-sync).
- **Packing generator**: one compact setup form collects destination, dates, trip type, baggage and optional major activities, including Workouts for most days. Expected weather and rain are optional setup choices; skipping them keeps weather unconfirmed. Hiking reveals a rugged/wet-trails toggle. Trip name is automatic; travel mode/international status are optional details. Dates are required (1–60 calendar days, including both travel days). Generate first, resolve only applicable outfit decisions, then export. A single Adjust trip entry opens focused Laundry, Packing, Extras, Bag, Weather, Activities, Events, Work and Flight editors when something changes; repeated assumption checklists are removed from the generated list. No AI API call is needed. Weather defaults to unconfirmed and is never inferred as a forecast.
- **App updates**: a local asset-version check bypasses cached HTML when the app launches or resumes, and once per minute while visible. Idle views load the newest version automatically; open forms show Load update so editing is not interrupted. Autosaved drafts resume after updating; a failed autosave blocks that reload.
- **Draft autosave**: Setup (including calendar dates), semantic refinements, manual edits/additions, preference edits, trip-style names and post-trip feedback save unfinished work immediately in `meta/packingFormDrafts/<scope>`. Reopening the same editor restores the draft with a visible status and a Discard unfinished draft action. Drafts remain separate from confirmed assumptions, item overrides, preferences and learning evidence; Apply/Save confirms them and clears the draft only after a successful save. Draft context checks prevent restoring edits against changed confirmed values. Storage failures are visible and test-mode drafts are isolated. All data remains in this browser; Settings backup includes it.
- **Quick setup and trip styles**: Work, Formal event and Mixed reveal explicit video-call workday, suit-day and dinner counts plus equipment selection. Leisure can reveal the same fields with the occasion toggle. Full suit days starts at zero and survives draft restoration; entered counts stay intact when changing trip type. Confirmed counts do not get asked twice; applicable dinner/suit/sharing decisions still appear before export. Weekend, Work week and Longer trip are built-in reusable styles. Save trip style under Trip styles & learning to reuse baggage, mode, activities, equipment, laundry and selected extras. A new trip keeps destination/dates empty, weather unconfirmed, and asks for fresh occasion counts; manual overrides stay on the original trip.
- **Refinement state**: `trip/<ID>/pack_meta/refinement` stores version 2 inputs, refinements, explicit item overrides, cached rule-group outputs with dependency fingerprints and an unchanged first-generation baseline. Stable item IDs are separate from labels and quantities. Changes show a summary and support one-step Undo. Rules compare actual dependency values to prevent stale results; baggage and manual exceptions update final composition without rerunning unrelated rules. Unchanged submissions preserve Undo. Only changed list sections are repainted. Manual edits/removals/additions survive regeneration and reload. Existing lists are preserved as pinned legacy items; automatic refinement is opt-in for them.
- **Rules and defaults**: Standard provides fresh daily T-shirts and bottoms for two days per pair. Pack lighter is removed; existing lighter settings normalize to Standard while explicit edits stay pinned. Usual accessories stay included except Kindle, Hotspot, Belkin charging pad, Garmin + charger (paired) and extra phone case, selected explicitly via setup Trip extras or the Extras refinement. They default off; existing manual/legacy items remain pinned. Snacks, water bottle, Anker battery pack, WHOOP charger and other reviewed usual items remain automatic. Extra adds one T-shirt, two underwear, two pairs of socks and one pair of bottoms; it uses the existing laundry buffer instead of stacking a second spare set. Laundry covers the longest actual gap between washes plus one spare day; contacts always cover the full trip. Weather represents the coldest expected outdoor conditions; warmer-weather shorts can be added separately. Cool/cold weather keeps both hoodie and puffer even when you run hot; rain protection remains separate. Workouts assumes most days and uses regular clothing, with enough shorts for two days per pair even in cool weather. No extra workout outfit or extra workout shirt is added. Brooks cover ordinary hikes; rugged/wet trails require hiking footwear. Hiking shares hydration and weather protection. The collapsible daypack is opt-in via I need a daypack in setup or Activities; it is not added by defaults or hiking. Existing manual/legacy daypack items remain pinned. Carry-on only flags space conflicts; quantities and item placement remain unchanged. Work setup includes power dependencies. Long trips without laundry show a warning rather than silently capping quantities. Sleepwear remains none; shared items and medication dosing are not inferred.
- **Guided outfits**: Suit days, video-call workdays and nice dinners are separate needs. Video days use fresh long-sleeve tops without dedicated bottoms. Choose polo, short-sleeve nice shirt, long-sleeve nice shirt, long-sleeve button-up, or Other with a custom name for dinners. Only the button-up choice shares work shirts; other tops get one fresh top per dinner. Choose shorts/jeans/khakis or named Other bottoms; reuse one pair and select whether custom bottoms need a belt. One belt is shared across occasions. One reusable suit uses fresh solid-color dress shirts and dress socks per suit day, without undershirts. Confirm tie, optional alternating khakis and shirt compatibility. Suit shirts default separate from patterned work/dinner tops. Maximum same-day shirt overlap is an explicit assumption with editable shared-day counts. Laundry never reduces work/dinner/suit shirt counts. Applicable decisions appear in sequence and must be confirmed before export; changing their context reopens them. Adjust trip only revisits the choice you select; confirmed questions are not repeated. Existing saved trips acquire the new assumptions and review requirements while retaining all explicit overrides and baseline data.
- **Manual exceptions and feedback**: Edit pins an item, including its Section / toiletries bag; Return to automatic resets that override. Remove offers This trip or Usually don’t pack this (for noncritical, nonrequired generated items). Profile exclusions live in `meta/packing.refinementProfile.excluded` and can be inspected/reset in Defaults & exclusions. Critical/required removals and pinned shortfalls leave visible warnings. Automatic preparation learning records the final saved additions, removals and edits once per trip, including Undo and Return to automatic. Four matching edits/removals among five comparable eligible trip setups, or three matching manual additions among five, produce visible suggestions on the list. Inspect history and evidence in Packing learning. Only safe usual-item exclusions can be applied with approval; quantities, clothing and other edits are suggestions for rule review. Kept items are opportunities, never proof of use. Other contexts can prevent a blanket exclusion. Pause/resume and forget controls are local; resetting history pauses observation and keeps applied defaults. Notes edits are not visible to the app. Optional post-trip learning is deterministic and local: use Trip styles & learning → Learn from this trip to report only exceptions, optionally confirming the rest of the captured list was needed. Only explicitly reviewed items count. Five comparable reviewed opportunities with four unneeded reports (or three missing reports) yield inspectable suggestions. Applying a safe usual-item exclusion requires an explicit choice; critical/required items, clothing, manual items and Snacks are protected. History can be inspected, forgotten or reset under Packing learning; applied defaults are reset separately in Defaults & exclusions. Notes edits do not sync back, so actual feedback must be entered here. Profile choices, overrides and all data remain local to this browser.
- **Standard quantities**: socks/underwear 2 per day; T-shirts 1 per day; bottoms days ÷ 2 rounded up; the departure outfit counts toward socks/underwear/T-shirt totals. Cool/cold conditions swap half the packed shorts for joggers, while workouts retain sufficient shorts and running hot keeps cool-weather layers. Contacts cover the whole trip plus 2 days, rounded up to a multiple of 5. Nice dinners get one chosen fresh top per dinner; formal white shirts and dress socks follow suit-day count, with no undershirts. Before leaving checks are derived from the final reviewed items.
- **Toiletries bags**: products previously in Toiletries appear in Dry toiletries and Liquid toiletries in the list, usual-items menu and exports. Toothpaste, shampoo, body wash, hair product, face wash, shaving cream, aftershave, Prep H and wrinkle release go in liquids; deodorant and lip balm default to solid/dry. Use item editing to change a product’s bag for this trip. Personal-bag items retain their existing section. Liquids are already in travel containers, so no automatic liquids-bag item or separate departure reminder is added. Before leaving includes one general Toiletries packed? check when either section has items. Existing manual items and quantities stay preserved.
- **In-app packing (Nov 2026)**: the generated list has **Pack** (live checklist: progress bar, per-section counts, tap a line to pack it, packed lines drop to the bottom dimmed, Uncheck all with Undo) and **Adjust** (trip plan, warnings, export; each row has X to remove and −/+ for quantity; tap the name to edit). Checks are saved in `trip/<ID>/pack_meta/progress` by stable item id, so they survive recalculation and sync to the Travel Dashboard. Add one-offs from the multi-line box (one per line, `x2` for quantities; sections are guessed) or the Add field at the end of any section; each added item offers **Always bring** for future lists.
- **Packing export**: select Export to Notes and resolve applicable outfit decisions. One Review & export screen shows quantities, warnings and the export action. iPhone/iPad defaults to Copy for Apple Notes, independently of desktop export preferences. ENEX is labeled as a Mac import and does not import directly into iPhone Notes. The last successful format is remembered per device type; alternative formats and preview live under More export options (the legacy export also keeps its checked-item option there). Then download an Apple Notes `.enex` file (Mac Notes → File → Import to Notes), download Markdown, or copy formatted headings and checkbox symbols for pasting into Notes. Every section and item is included; Before leaving stays last. The ENEX import produced native Apple Notes checklist items in Tyler's device test. The note title appears once. Formatted copy uses checkbox symbols, which may need conversion using Notes' checklist button. Exports are separate copies and do not sync changes back.
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
node tests/dinner-export-ui.mjs # optional: custom outfits, bag overrides, Mac export and iPhone copy
node tests/learning-ui.mjs # optional: automatic observation, undo, suggestions and reset
node tests/app-update-ui.mjs # optional: update detection, draft-safe reload and saved suit defaults
node tests/autosave-ui.mjs # optional: reload/resume, confirm/discard, failures and isolation
node tests/pack-ui.mjs     # optional: Pack/Adjust, live progress, quick add, Always bring, row controls
```

Agent rules for this folder are in `AGENTS.md`.

## Supabase sync

Project `bpimarlvrastqchhxdcl` ([dashboard](https://supabase.com/dashboard/project/bpimarlvrastqchhxdcl)). The website already has the project URL and publishable key in `shared/supabase-config.js`. Replace those two fields if the project is rotated. Do not put the service role or an `sb_secret_` key there; row level security is what keeps each account to its own rows.

`supabase-js` 2.118 accepts the publishable key (`sb_publishable_…`) in the browser. A legacy anon JWT is not required.

### One-time setup

1. In the SQL editor, run `supabase/migrations/001_ta_docs.sql`. It is safe if `public.ta_docs` already exists. It adds the owner-only policies, forces `user_id` to the signed-in user, turns on realtime, and sets replica identity to full so deletes sync.
2. Authentication → URL configuration:
   - Site URL: `https://tylerbridges.github.io/travel-apps/packing-list/`
   - Redirect URLs (exact, no wildcards needed):
     - `https://tylerbridges.github.io/travel-apps/auth.html`
     - `http://localhost:8000/auth.html`
     - `http://127.0.0.1:8000/auth.html`
     - `http://localhost:8000/travel-apps/auth.html` (only if you serve the repo root)
3. Leave the default email templates alone unless you edited them. The link has to be `{{ .ConfirmationURL }}` so the `redirect_to` to `auth.html` is kept. Sign-in uses PKCE (`?code=` on `auth.html`), not a hash, so it does not overwrite a trip URL such as `#KAUAI-2026-11-03`.
4. Authentication → Users → Add user: `tylerbridges1@gmail.com`, a password, and Auto Confirm. Then Authentication → Providers → Email → turn off **Enable sign ups** so a second account cannot be created from the app. Policies are per signed-in user; disabling sign-ups is what keeps the project to that one account.
5. The built-in mailer only delivers to addresses on the Supabase organization team, about two messages an hour, until a custom SMTP provider is set (Authentication → Emails → SMTP; a free SMTP account is enough, and it is not a paid Supabase add-on). Password sign-in does not need a message after the user exists. Magic link and the confirm-account message do.

Open Packing List or Itinerary, choose **Sign in to sync**, and sign in with that email. The footer then reads `synced · tylerbridges1@gmail.com`.

### What the app does after sign-in

- If the account has no rows and this browser still has `ta:` lists, they upload on their own.
- If both sides have lists and they differ, the page asks before copying the browser over the account. **Keep account copy** leaves the browser snapshot on this device until Account → Import or Discard.
- Writes go to the account. This browser keeps a mirror so existing screens that read `localStorage` keep working. A failed write stays queued and is retried on the next sign-in. Unfinished form drafts under `ta:meta/packingFormDrafts/` sync with the rest; the draft line in the form still says "on this device".
- The app also listens for realtime changes and re-reads the account every 12 seconds while the tab is open.
- `?test=1` never talks to Supabase and never imports sandbox lists.
- Settings → Download backup / Restore still uses `Store.exportAll` / `importAll`. Restore waits until the account write finishes.

## Run locally

```
python3 -m http.server 8000
# open http://localhost:8000/
```

Packing List → Test flow opens a reusable sandbox (`?test=1`). Choose Professional, Laundry + workouts, or Warm weather + activities; reset into setup or generated review, resume the saved test, and exercise normal refinements/manual overrides/Notes export. The separate `packing-test:` namespace isolates test trips, preferences, exclusions and export documents. Reset copies current real preferences and clears only sandbox data.

In Test flow, **Check this scenario** or **Run all scenario checks** shows fixed expected/actual results for outfit sharing, tie/khaki rotation, laundry buffers, activity dependencies, manual quantity preservation and native Notes formatting. Checks run entirely in memory; the saved test remains unchanged, and its pending export decisions are listed separately.

The Test flow menu also configures trip length (1–60 days), video workdays, suit days, nice dinners, weather, activities, baggage and laundry timing, with an immediate quantity preview. Save named variants or make another copy; presets and named variants remain available across resets. Fixed checks use the selected scenario’s original regression family and are separate from the configurable preview.

Test flow now separates **Validate current test** (the active saved inputs, fresh quantities, formula checks, manual overrides and warnings) from **Run fixed regression checks**. **Save setup configuration** stores editor settings; **Save current test as variant** captures refined assumptions with an explicit manual-edits option. Invalid counts block saving/loading, copy names stay distinct, and the editor keeps its preview and launch controls visible.

The list shows only outstanding outfit decisions, one Adjust trip entry, quantity impact alongside outfit choices, and a final outfit summary before Notes export. All assumptions remain accessible through one Adjust trip entry. If Playwright is available, run `node tests/scenario-ui.mjs` for the focused scenario-saving/validation/mobile regressions.

## First-use onboarding direction

The independent onboarding review recommends separating person setup from trip setup: **Starting point → My essentials and clothing → Review my defaults**, then the existing quick trip form. Existing users keep their profile and enter this flow voluntarily. A versioned `meta/packing.packingProfile` should hold the selected preset, baseline, typed clothing/rewear policy, departure outfit, personal consumables and dependency gear. Unfinished onboarding belongs in the draft store; completion explicitly validates and saves it.

The custom-person wizard is not exposed yet: current rule groups force Tyler-specific contacts, quantities, clothing brands and activity/work dependencies. Those contributions must first read the selected profile, with profile dependencies added to caches and policy fingerprints added to learning comparisons. Profiles without the new schema must preserve Tyler behavior exactly. Existing trips and pinned overrides must remain unchanged until explicit recalculation. Acceptance should cover an unchanged Tyler list, a person without contacts or branded gear, custom quantities/departure subtraction, profile-driven cache invalidation, cancel/resume, storage failures and learning isolation across policies.
