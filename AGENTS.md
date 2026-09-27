# Repository workflow

Tyler's personal GitHub Pages weather site: a single-page, live weather.gov dashboard.
Optimize for a simple loop: request, implement, review, publish, verify.

## Publishing

- Work directly on `main` unless Tyler asks for a branch or pull request.
- Start with `git status`; when clean, `git pull --ff-only origin main`. Never discard pre-existing changes.
- Commit task-scoped files with a descriptive message and push with `git push origin main` without waiting for approval. Never force-push.
- After pushing, confirm `origin/main` has the commit and the GitHub Pages build finished, then load the live site and confirm it serves the change.
- End every reply that involves a change with:

  ```
  ---
  - **Done:** what changed (and the commit/deploy status)
  - **Couldn't do:** anything skipped, unverified, or blocked (or "Nothing")
  - **Your action items:** what Tyler needs to check or decide (or "None")
  ```

## How the site works

- `index.html` holds the markup and all CSS; `app.js` renders everything (Now, Daily, Hourly graphs, Maps with storm totals, Observations, location picker, pull-to-refresh).
- Maps shows public-domain NWS/NOAA images by URL (no API): graphical.weather.gov NDFD sector PNGs (`images/{office|conus}/{Element}{N}_{sector}.png` for SnowAmt, IceAccum, QPF, MaxT, MinT, T, ApparentT, local = the location's forecast office), WPC winter/QPF GIFs, and CPC outlooks. Add products in `MCATS` in `app.js`.
- `wx-live.js` fetches live data in the browser on every open/refresh: api.weather.gov (points, forecast, gridpoint data, alerts, observations, AFD/HWO products), forecast.weather.gov MapClick JSON (for the site's exact period wording and precip-trend percentages), EPA Envirofacts UV (daily + hourly), and the ArcGIS World Geocoder for location search. All allow cross-origin requests.
- `wx-normalize.js` turns those responses into the one data document `app.js` renders. Change data shape there, not in `app.js`.
- Location: `?q=City ST` or `?lat=..&lon=..` in the URL, else the last location used on the device (localStorage), else Minneapolis, MN. The location sheet offers "Use my current location" (one-time browser geolocation, named via weather.gov points) and starred favorites (`wx-favs` in localStorage).
- Test scenarios: `wx-scenarios.js` builds sample weather (blizzard, ice storm, heat wave, severe storms, arctic cold) as api.weather.gov-shaped responses and runs them through `wx-normalize.js`. Open with `?test=blizzard` (etc.) or Location → Test scenarios; a banner shows while active and nothing is cached. Maps stay live. Use them to check winter/severe layouts in any season.
- `sw.js` only retires the old Sky Report service worker; don't add caching back without a cache-busting plan.

## Checks before publishing

- No runtime JavaScript errors; layouts work at 360–430px wide in light and dark mode.
- Load Minneapolis, run a location search, and open each tab against live data.
- Keep it dependency-free and static-host compatible.
