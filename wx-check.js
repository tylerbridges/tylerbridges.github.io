// wx-check.js — the live data check behind check.html.
// For a spread of places it (1) runs the site's own WXLive.load pipeline and checks the result for gaps and odd values,
// (2) loads the site itself in a hidden frame and opens every tab, watching for script errors and empty tabs, and
// (3) once, sweeps every Maps product for dead images. ?mock=1 swaps in the built-in test scenarios so the checker can be
// exercised without the network. Nothing here touches the site's saved places (frames run with ?nostore=1).
(function () {
  "use strict";
  var H = 3600000, MOCK = /[?&]mock=1/.test(location.search);
  var $ = function (id) { return document.getElementById(id); };
  var LOCS = [
    ["Minneapolis, MN", 44.9778, -93.265], ["Rochester, MN", 44.0121, -92.4802], ["International Falls, MN", 48.6012, -93.411],
    ["Miami, FL", 25.7617, -80.1918], ["Phoenix, AZ", 33.4484, -112.074], ["Denver, CO", 39.7392, -104.9903],
    ["Seattle, WA", 47.6062, -122.3321], ["Buffalo, NY", 42.8864, -78.8784], ["Marfa, TX (rural)", 30.3094, -104.0206],
    ["Anchorage, AK", 61.2181, -149.9003], ["Honolulu, HI", 21.3069, -157.8583], ["San Juan, PR", 18.4655, -66.1057],
    ["Hagåtña, Guam", 13.4757, 144.7489]
  ];
  var KNOWN_ICON = /^(skc|few|sct|bkn|ovc|wind(_\w*)?|snow|rain_snow|rain_sleet|snow_sleet|fzra|rain_fzra|snow_fzra|sleet|rain|rain_showers(_hi)?|tsra(_sct|_hi)?|tornado|hurricane|tropical_storm|dust|smoke|haze|hot|cold|blizzard|fog)$/;
  var PRECIP_WORD = /rain|snow|sleet|ice|hail|drizzle|shower|storm|precip|freez|flurr/i;

  // ---- log every request the data layer makes (status + time), and keep the gridpoint response for the weather-type audit
  var REQ = null, realFetch = window.fetch.bind(window);
  function kind(u) {
    u = u.split("?")[0];
    if (/api\.weather\.gov\/points\//.test(u)) return "points";
    if (/gridpoints\/[^/]+\/[^/]+\/forecast$/.test(u)) return "forecast";
    if (/gridpoints\/[^/]+\/[^/]+\/stations$/.test(u)) return "stations";
    if (/gridpoints\/[^/]+\/[^/]+$/.test(u)) return "grid";
    if (/\/observations$/.test(u)) return "obs";
    if (/\/alerts\/active/.test(u)) return "alerts";
    if (/products\/types\/AFD/.test(u) || /forecast\.weather\.gov\/product/.test(u)) return "afd";
    if (/products\/types\/HWO/.test(u)) return "hwo";
    if (/MapClick/.test(u)) return "mapclick";
    if (/epa\.gov/.test(u)) return "uv";
    if (/arcgis/.test(u)) return "geocode";
    if (/api\.weather\.gov\/products\//.test(u)) return "product";
    return "other";
  }
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input.url, rec = { url: url, kind: kind(url), status: 0, ms: 0 }, t0 = performance.now();
    if (REQ) REQ.push(rec);
    return realFetch(input, init).then(function (r) {
      rec.status = r.status; rec.ms = Math.round(performance.now() - t0);
      if (REQ && rec.kind === "grid" && r.ok) r.clone().json().then(function (j) { rec.grid = j; }, function () {});
      return r;
    }, function (e) { rec.status = "network"; rec.ms = Math.round(performance.now() - t0); throw e; });
  };

  // ---- report
  var out = [], counts = { pass: 0, warn: 0, fail: 0 };
  function line(s) { out.push(s); $("out").textContent = out.join("\n"); }
  function prog(s) { $("prog").textContent = s; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function poll(cond, ms) {
    return new Promise(function (ok) {
      var t = Date.now();
      (function tick() { var v; try { v = cond(); } catch (e) { v = false; } if (v || Date.now() - t > ms) ok(!!v); else setTimeout(tick, 250); })();
    });
  }
  function secs(ms) { return (ms / 1000).toFixed(1) + "s"; }

  // ---- 1. data layer
  function analyze(doc, reqs, res) {
    var now = Date.now(), g = doc.grid, p = doc.periods || [], f = res.fails, w = res.warns, i;
    if (!doc.loc || !doc.loc.office) f.push("no forecast office");
    try { new Intl.DateTimeFormat("en-US", { timeZone: doc.loc.tz }); } catch (e) { f.push("bad time zone: " + (doc.loc && doc.loc.tz)); }
    if (!g || g.n < 48) f.push("hourly grid too short: " + (g && g.n));
    else {
      var bad = Object.keys(g.s).filter(function (k) { return g.s[k].length !== g.n; });
      if (bad.length) f.push("series length mismatch: " + bad.join(", "));
      var ts = g.s.t.filter(function (v) { return v != null; });
      if (ts.length < g.n * 0.9) w.push("temperature missing for " + (g.n - ts.length) + " of " + g.n + " hours");
      if (ts.length && (Math.min.apply(null, ts) < -80 || Math.max.apply(null, ts) > 140)) f.push("implausible temperatures " + Math.min.apply(null, ts) + ".." + Math.max.apply(null, ts));
      if (g.s.pop.some(function (v) { return v != null && (v < 0 || v > 100); })) f.push("chance of precipitation outside 0-100");
      if (g.s.ws.some(function (v) { return v != null && v > 200; })) f.push("wind speed over 200 mph");
      if (g.start > now + H) w.push("grid starts in the future");
      if (g.start + g.n * H < now + 24 * H) f.push("hourly grid ends within 24 h of now");
      ["qpf", "snow", "ice"].forEach(function (k) { (g[k] || []).forEach(function (b) { if (!(b[2] >= 0) || b[2] > 60) f.push("odd " + k + " amount " + b[2]); }); });
      res.info.push("grid " + g.n + " h");
    }
    if (p.length < 8) f.push("only " + p.length + " forecast periods");
    else {
      for (i = 0; i < p.length; i++) {
        var x = p[i];
        if (!isFinite(x.s) || !isFinite(x.e) || !isFinite(x.temp)) { f.push("period " + i + " (" + x.name + ") has a bad time or temperature"); break; }
        if (i && x.s < p[i - 1].s) { f.push("periods out of order at " + x.name); break; }
      }
      if (!(p[0].s <= now + 3 * H && p[0].e > now)) w.push("first period (" + p[0].name + ") doesn't cover now");
      res.info.push(p.length + " periods, " + (p[0].src === "mapclick" ? "weather.gov wording" : "API wording"));
      if (p[0].src !== "mapclick" && !MOCK) w.push("MapClick wording not used (source down or format changed)");
    }
    var c = doc.cur;
    if (!c) w.push("no current observation");
    else {
      if (c.t == null) w.push("current temperature missing");
      if (now - c.ms > 3 * H) w.push("latest observation is " + Math.round((now - c.ms) / H) + " h old");
      if (!c.desc) w.push("current conditions text is empty");
    }
    if (!(doc.obs || []).length) w.push("no observation history"); else res.info.push((doc.obs || []).length + " obs");
    (doc.alerts || []).forEach(function (a) { if (!a.event) f.push("an alert has no name"); });
    res.info.push((doc.alerts || []).length + " alerts");
    if (!doc.afd) w.push("no forecast discussion");
    if (!doc.hwo) res.info.push("no outlook for this zone");
    if (!doc.uv) res.info.push("no UV");
    // weather types / coverage words in the raw hourly grid that the site doesn't map
    var gr = reqs.filter(function (r) { return r.kind === "grid" && r.grid; })[0];
    if (gr && window.WXNormalize && WXNormalize.TYPE) {
      var types = {}, covs = {}, unmapped = {}, unk = {};
      ((gr.grid.properties.weather || {}).values || []).forEach(function (v) {
        (v.value || []).forEach(function (o) {
          if (!o || !o.weather) return; types[o.weather] = 1;
          if (!WXNormalize.TYPE[o.weather]) unmapped[o.weather] = 1;
          if (o.coverage && !WXNormalize.COV[o.coverage]) unk[o.coverage] = 1;
        });
      });
      var um = Object.keys(unmapped), uc = Object.keys(unk);
      if (um.length) (um.some(function (t) { return PRECIP_WORD.test(t); }) ? w : res.info).push("unmapped weather types: " + um.join(", "));
      if (uc.length) w.push("unmapped coverage words: " + uc.join(", "));
      if (Object.keys(types).length) res.info.push("types: " + Object.keys(types).join("/"));
    }
    var codes = {};
    p.forEach(function (x) { (x.icon || []).forEach(function (k) { codes[k.c] = 1; }); });
    ((doc.cur && doc.cur.icon) || []).forEach(function (k) { codes[k.c] = 1; });
    (doc.obs || []).forEach(function (o) { (o.icon || []).forEach(function (k) { codes[k.c] = 1; }); });
    var unknownIcons = Object.keys(codes).filter(function (k) { return k && !KNOWN_ICON.test(k); });
    if (unknownIcons.length) w.push("unrecognised icon codes: " + unknownIcons.join(", "));
  }
  function sources(reqs) {
    var order = ["points", "forecast", "grid", "stations", "obs", "alerts", "afd", "hwo", "mapclick", "uv"], o = [], bad = [];
    order.forEach(function (k) {
      var rs = reqs.filter(function (r) { return r.kind === k; }); if (!rs.length) return;
      var failed = rs.filter(function (r) { return r.status !== 200; });
      o.push(k + (failed.length ? "✗" + failed[0].status : "✓"));
      if (failed.length) bad.push([k, failed[0].status]);
    });
    return { text: o.join(" "), bad: bad };
  }
  function runData(name, lat, lon) {
    var res = { fails: [], warns: [], info: [], ms: 0 }, t0 = performance.now();
    REQ = [];
    return Promise.race([WXLive.load({ lat: lat, lon: lon, label: name }), sleep(60000).then(function () { throw new Error("timed out after 60 s"); })])
      .then(function (doc) { res.ms = performance.now() - t0; analyze(doc, REQ, res); }, function (e) { res.ms = performance.now() - t0; res.fails.push("load failed: " + e.message); })
      .then(function () {
        var s = sources(REQ); res.sources = s.text;
        s.bad.forEach(function (b) {
          if (/^(points|forecast|grid)$/.test(b[0])) res.fails.push(b[0] + " request returned " + b[1]);
          else if (b[0] === "stations" || b[0] === "obs") res.warns.push(b[0] + " request returned " + b[1]);
          else res.info.push(b[0] + " unavailable (" + b[1] + ")");
        });
        var slow = REQ.filter(function (r) { return r.ms > 8000; }); if (slow.length) res.warns.push("slow: " + slow.map(function (r) { return r.kind + " " + secs(r.ms); }).join(", "));
        REQ = null; return res;
      });
  }

  // ---- 2. the site itself, in a hidden frame
  function mapTry(d, cat, val, area, last) {
    var chip = d.querySelector('#mcats [data-mcat="' + cat + '"]'); if (chip) chip.click();
    var sel = d.getElementById("msel"); sel.value = val; sel.dispatchEvent(new Event("change"));
    if (area) { var b = d.querySelector('#marea [data-marea="' + area + '"]'); if (b) b.click(); }
    var rg = d.getElementById("mrange");
    if (last && !d.getElementById("mctl").hidden) { rg.value = rg.max; rg.dispatchEvent(new Event("input")); }
    var im = d.getElementById("mimg");
    return poll(function () { return !im.classList.contains("ld") && (im.naturalWidth > 0 || !d.getElementById("mmsg").hidden); }, 10000).then(function (settled) {
      return settled ? (im.naturalWidth > 0 && d.getElementById("mmsg").hidden ? "ok" : "MISSING") : "timeout";
    });
  }
  function runFrame(name, lat, lon, sweep) {
    return new Promise(function (resolve) {
      var res = { fails: [], warns: [], tabs: [] }, f = document.createElement("iframe"), d, w;
      f.style.cssText = "position:fixed;left:-9999px;top:0;width:390px;height:844px;border:0";
      f.src = "index.html?nostore=1&lat=" + lat + "&lon=" + lon + "&label=" + encodeURIComponent(name) + (MOCK ? "&test=blizzard" : "");
      document.body.appendChild(f);
      function finish() { (w && w.__errs || []).forEach(function (e) { res.fails.push("script error: " + e); }); f.remove(); resolve(res); }
      function wide(t) { try { if (d.documentElement.scrollWidth > w.innerWidth + 1) res.warns.push("page wider than the screen on " + t); } catch (e) {} }
      function openTab(t, cond, label, ms) {
        d.querySelector('#nav [data-tab="' + t + '"]').click();
        return poll(cond, ms || 5000).then(function (ok) { res.tabs.push(t + (ok ? "✓" : "✗")); if (!ok) res.fails.push(label + " is empty"); wide(t); return ok; });
      }
      f.onload = function () {
        w = f.contentWindow; d = f.contentDocument;
        poll(function () { var t = d.getElementById("nowcard").textContent; return t.trim() && !/Loading from weather\.gov/.test(t); }, 30000).then(function (ok) {
          if (!ok) { res.fails.push("Now tab never rendered (" + (d.getElementById("toast").textContent || "no message") + ")"); return null; }
          if (/Observation not available/.test(d.getElementById("nowcard").textContent)) res.warns.push("Now shows “observation not available”");
          res.tabs.push("now✓"); wide("now");
          return openTab("daily", function () { return d.querySelectorAll("#strip2 .ccard").length >= 6; }, "Daily tab")
            .then(function () { return openTab("hourly", function () { return d.querySelectorAll("#gin .pan").length >= 4; }, "Hourly tab"); })
            .then(function () { return openTab("maps", function () { return d.getElementById("mimg").naturalWidth > 0 || !d.getElementById("mmsg").hidden; }, "Maps tab", 10000); })
            .then(function () {
              var im = d.getElementById("mimg");
              if (!(im.naturalWidth > 0)) res.warns.push("first map image didn't load");
              // this place's local NWS sector: does the snowfall map exist for its office?
              return mapTry(d, "precip", "ndfd-SnowAmt", "local", false).then(function (r) { res.sector = r; if (r !== "ok") res.warns.push("local snowfall map: " + r); });
            })
            // Radar tab: frames load, and whether the tile server allows pixel access (needed for the smooth colours)
            .then(function () {
              if (MOCK) return null;
              return openTab("radar", function () { var r = w.WXRadar && w.WXRadar._state(); return r && (r.ready >= 1 || r.corsOK === false && r.ready > 0.9); }, "Radar tab", 20000).then(function (ok) {
                var r = w.WXRadar && w.WXRadar._state(); if (!r) return;
                res.radar = "radar " + (r.src === "s3" ? "MRMS from NOAA Open Data (rain/snow)" : r.src === "mrms" ? "MRMS via NCEP (rain/snow)" : r.src === "iemq" ? "MRMS via IEM (QC'd, no type)" : r.src === "iem" ? "IEM NEXRAD (unfiltered, no type)" : "?") + " " + Math.round(r.ready * 100) + "% loaded, colours " + (r.corsOK ? "recoloured" : r.corsOK === false ? "NWS only (no pixel access)" : "unknown") + (r.valid ? ", latest " + Math.round((Date.now() - r.valid) / 60000) + " min old" : ", frame times unavailable");
                var vm = w.WXVMap; res.radar += ", base map " + (vm && vm.ok() ? "vector (OpenFreeMap)" : vm && vm.failed() ? "raster fallback (Esri)" : "still loading");
                if (vm && vm.failed()) res.warns.push("vector base map unavailable: using Esri raster tiles");
                if (r.src === "iemq") res.warns.push("radar fell back to MRMS via IEM: rain/snow colouring unavailable"); if (r.src === "iem") res.warns.push("radar fell back to the unfiltered IEM NEXRAD mosaic: birds/insects may show as light rain");
                if (r.corsOK === false) res.warns.push("radar tiles don't allow pixel access: smooth colours unavailable");
                if (!r.valid) res.warns.push("radar frame times unavailable");
              });
            })
            .then(function () { return openTab("obs", function () { return d.querySelectorAll("#obscard tr").length >= 3 || /No recent observations/.test(d.getElementById("obscard").textContent); }, "Observations tab"); })
            .then(function () { if (/No recent observations/.test(d.getElementById("obscard").textContent)) res.warns.push("no recent observations"); })
            .then(function () { return sweep ? sweepMaps(d, res) : null; });
        }).then(finish, function (e) { res.fails.push("check crashed: " + e.message); finish(); });
      };
    });
  }
  // every Maps product, first and last frame, local and national where offered
  function sweepMaps(d, res) {
    d.querySelector('#nav [data-tab="maps"]').click();
    var cats = [].map.call(d.querySelectorAll("#mcats [data-mcat]"), function (b) { return b.dataset.mcat; }), jobs = [], results = [];
    cats.forEach(function (c) {
      d.querySelector('#mcats [data-mcat="' + c + '"]').click();
      [].forEach.call(d.querySelectorAll("#msel option"), function (o) { jobs.push([c, o.value, o.textContent]); });
    });
    var chain = Promise.resolve();
    jobs.forEach(function (j) {
      chain = chain.then(function () {
        d.querySelector('#mcats [data-mcat="' + j[0] + '"]').click();
        var sel = d.getElementById("msel"); sel.value = j[1]; sel.dispatchEvent(new Event("change"));
        var areas = d.getElementById("marea").hidden ? [null] : ["local", "conus"], r = [];
        return areas.reduce(function (pr, a) {
          return pr.then(function () { return mapTry(d, j[0], j[1], a, false).then(function (x) { return mapTry(d, j[0], j[1], a, true).then(function (y) { r.push((a === "conus" ? "US " : a === "local" ? "local " : "") + (x === "ok" && y === "ok" ? "ok" : "first " + x + ", last " + y)); }); }); });
        }, Promise.resolve()).then(function () { results.push([j[2], r]); });
      });
    });
    return chain.then(function () { res.maps = results; });
  }

  // ---- 3. search and location naming
  function runSearch() {
    var res = { lines: [], fails: 0 };
    var chain = Promise.resolve();
    [["Duluth MN", true], ["90210", true], ["Anchorage AK", true], ["Honolulu HI", true], ["Rochester, Minnesota", true], ["zzzzqqxx", false]].forEach(function (q) {
      chain = chain.then(function () {
        return WXLive.geocode(q[0]).then(function (hit) {
          if (!hit) { var okn = !q[1]; res.lines.push((okn ? "✓" : "✗") + " search “" + q[0] + "” → " + (okn ? "no match (expected)" : "no match")); if (!okn) res.fails++; return; }
          return WXLive.covers(hit.lat, hit.lon).then(function (cv) {
            var ok = q[1] && cv; res.lines.push((ok ? "✓" : "✗") + " search “" + q[0] + "” → " + hit.label + " (" + hit.lat + ", " + hit.lon + ") " + (cv ? "covered" : "NOT covered")); if (!ok) res.fails++;
          });
        }).catch(function (e) { res.lines.push("✗ search “" + q[0] + "” failed: " + e.message); res.fails++; });
      });
    });
    chain = chain.then(function () { return WXLive.covers(43.6532, -79.3832).then(function (cv) { res.lines.push((cv ? "✗" : "✓") + " Toronto is " + (cv ? "wrongly reported as covered" : "correctly not covered")); if (cv) res.fails++; }); });
    chain = chain.then(function () { return WXLive.place(44.9778, -93.265).then(function (n) { res.lines.push((n ? "✓" : "✗") + " current-location naming for Minneapolis → " + n); if (!n) res.fails++; }); });
    chain = chain.then(function () { return WXLive.place(43.6532, -79.3832).then(function (n) { res.lines.push((n === false ? "✓" : "✗") + " current-location naming outside the US → " + n); if (n !== false) res.fails++; }); });
    return chain.then(function () { return res; });
  }

  // ---- run
  var running = false;
  function run(full) {
    if (running) return; running = true; out = []; counts = { pass: 0, warn: 0, fail: 0 };
    $("run").disabled = $("quick").disabled = true; $("copy").disabled = true; $("sum").textContent = "";
    var started = Date.now(), chain = Promise.resolve();
    if (MOCK) WXLive.load = function (loc) { return WXScenario.load("blizzard", loc, null); };
    line("LIVE CHECK " + new Date().toString().slice(0, 24) + (MOCK ? " · MOCK (test scenario, no network)" : "") + (full ? "" : " · data only"));
    line(navigator.userAgent); line("");
    LOCS.forEach(function (L, idx) {
      chain = chain.then(function () {
        prog("Place " + (idx + 1) + " of " + LOCS.length + ": " + L[0] + " (data)…");
        return runData(L[0], L[1], L[2]).then(function (dr) {
          if (!full) return [dr, null];
          prog("Place " + (idx + 1) + " of " + LOCS.length + ": " + L[0] + " (site)…");
          return runFrame(L[0], L[1], L[2], idx === 0).then(function (fr) { return [dr, fr]; });
        }).then(function (both) {
          var dr = both[0], fr = both[1], fails = dr.fails.concat(fr ? fr.fails : []), warns = dr.warns.concat(fr ? fr.warns : []);
          var tag = fails.length ? "FAIL" : warns.length ? "WARN" : "PASS"; counts[tag.toLowerCase()]++;
          line("[" + tag + "] " + L[0] + " · load " + secs(dr.ms) + (dr.sources ? " · " + dr.sources : "") + (fr ? " · tabs " + fr.tabs.join(" ") + (fr.radar ? " · " + fr.radar : "") : ""));
          if (dr.info.length) line("      " + dr.info.join(" · "));
          fails.forEach(function (s) { line("      ✗ " + s); }); warns.forEach(function (s) { line("      ! " + s); });
          if (fr && fr.maps) { line("      MAP PRODUCTS (first/last frame):"); fr.maps.forEach(function (m) { line("        " + m[0] + ": " + m[1].join(" | ")); }); }
        });
      });
    });
    if (!MOCK) chain = chain.then(function () {
      prog("Search and location naming…");
      return runSearch().then(function (s) { line(""); line("SEARCH / LOCATION"); s.lines.forEach(line); counts[s.fails ? "fail" : "pass"]++; });
    });
    chain.then(function () {
      var sum = counts.pass + " passed · " + counts.warn + " warnings · " + counts.fail + " failed  (" + secs(Date.now() - started) + ")";
      line(""); line("SUMMARY: " + sum);
      $("sum").textContent = sum; $("sum").className = counts.fail ? "bad" : counts.warn ? "warn" : "ok";
      prog("Done."); running = false; $("run").disabled = $("quick").disabled = false; $("copy").disabled = false;
    }, function (e) { line("CHECK CRASHED: " + e.message); prog("Crashed."); running = false; $("run").disabled = $("quick").disabled = false; $("copy").disabled = false; });
  }
  $("run").addEventListener("click", function () { run(true); });
  $("quick").addEventListener("click", function () { run(false); });
  $("copy").addEventListener("click", function () {
    var t = out.join("\n");
    function fallback() { var a = document.createElement("textarea"); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand("copy"); } catch (e) {} a.remove(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(fallback); else fallback();
    $("copy").textContent = "Copied ✓"; setTimeout(function () { $("copy").textContent = "Copy report"; }, 2000);
  });
})();
