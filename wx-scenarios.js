// wx-scenarios.js — built-in test weather (blizzard, ice storm, heat wave, severe storms, arctic cold).
// Each scenario is an hour-by-hour recipe anchored to the current time. It is turned into
// api.weather.gov-shaped responses (points, gridpoint layers, 12-hour periods, observations,
// alerts, discussion) and run through wx-normalize.js, so every tab renders it exactly as it
// would a real forecast. Sample data only — never a real forecast.
(function (root) {
  "use strict";
  var H = 3600000;
  var C = function (f) { return f == null ? null : (f - 32) * 5 / 9; };
  var KMH = function (m) { return m == null ? null : m * 1.609344; };
  var MM = function (i) { return i * 25.4; };
  var clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };
  // smooth day/night swing: low near 6 am, high near 4 pm local
  function diurnal(lh, lo, hi) { return lo + (hi - lo) * (0.5 - 0.5 * Math.cos((lh - 4) / 24 * 2 * Math.PI)); }
  function ramp(h, a, b, v0, v1) { return h <= a ? v0 : h >= b ? v1 : v0 + (v1 - v0) * (h - a) / (b - a); }
  function wchill(t, v) { return t <= 50 && v > 3 ? Math.round(35.74 + 0.6215 * t - 35.75 * Math.pow(v, 0.16) + 0.4275 * t * Math.pow(v, 0.16)) : null; }
  function rh(t, td) { var a = C(t), b = C(td); return Math.round(clamp(100 * Math.exp(17.625 * b / (243.04 + b)) / Math.exp(17.625 * a / (243.04 + a)), 5, 100)); }
  function heat(t, r) {
    if (t < 80) return null;
    return Math.round(-42.379 + 2.04901523 * t + 10.14333127 * r - 0.22475541 * t * r - 0.00683783 * t * t - 0.05481717 * r * r +
      0.00122874 * t * t * r + 0.00085282 * t * r * r - 0.00000199 * t * t * r * r);
  }
  var wx = function (w, cov, int) { return { weather: w, coverage: cov, intensity: int || null, visibility: { unitCode: "wmoUnit:km", value: null }, attributes: [] }; };

  // Each recipe: hour offset h (0 = now) and local hour lh -> { t, td, ws, wg, wd, sky, pop, thp, wx[], q, sn, ice } (°F, mph, %, in/hour)
  var S = {
    blizzard: {
      name: "Blizzard", desc: "Heavy snow, 40–50 mph gusts, then bitter cold",
      alerts: [["Blizzard Warning", "Severe", 6, 36, "Blizzard conditions. Total snow accumulations of 14 to 20 inches. Winds gusting as high as 50 mph.", "Travel should be restricted to emergencies only."],
        ["Cold Weather Advisory", "Moderate", 36, 60, "Very cold wind chills as low as 30 below zero.", "Use caution while traveling outside. Wear appropriate clothing."]],
      afd: "Heavy snow develops this evening and becomes intense overnight into Monday with snowfall rates of 1 to 2 inches per hour. Northwest winds gusting 45 to 50 mph will produce whiteout conditions. Snow tapers Monday night. Bitter cold follows Tuesday with wind chills 25 to 30 below zero.",
      f: function (h, lh) {
        var storm = h >= 6 && h < 30, heavy = h >= 10 && h < 24;
        var t = h < 30 ? ramp(h, 0, 30, 30, 12) : diurnal(lh, -6, 6) + ramp(h, 72, 140, 0, 18);
        var ws = h < 8 ? 10 : h < 40 ? ramp(h, 8, 16, 12, 30) : ramp(h, 40, 60, 25, 10), wg = ws > 15 ? ws + 18 : null;
        var sn = storm ? (heavy ? 1.2 : 0.4) : 0;
        return { t: t, td: t - 3, ws: ws, wg: wg, wd: h < 10 ? 90 : 320, sky: storm || h < 6 ? 100 : 30, pop: storm ? (heavy ? 100 : 80) : h < 6 ? 30 : 5, thp: 0,
          wx: storm ? [wx("snow", heavy ? "definite" : "likely", heavy ? "heavy" : null)].concat(ws >= 25 ? [wx("blowing_snow", "areas")] : []) : [],
          q: sn / 12, sn: sn, ice: 0 };
      }
    },
    ice: {
      name: "Ice storm", desc: "Freezing rain, sleet, then snow",
      alerts: [["Ice Storm Warning", "Severe", 4, 22, "Significant icing. Total ice accumulations of one quarter to one half inch.", "Travel is strongly discouraged. Prepare for power outages."],
        ["Winter Weather Advisory", "Moderate", 22, 32, "Mixed precipitation changing to snow. Additional snow accumulations of 1 to 3 inches.", "Slow down and use caution while traveling."]],
      afd: "Freezing rain spreads in early this evening and continues overnight with ice accumulations near a half inch. Sleet mixes in late Monday morning before a change to snow Monday afternoon. Patchy fog early this evening. Colder and dry for midweek.",
      f: function (h, lh) {
        var zr = h >= 4 && h < 20, pl = h >= 18 && h < 23, sn = h >= 22 && h < 30;
        var t = h < 30 ? ramp(h, 0, 30, 31, 25) : diurnal(lh, 12, 26);
        return { t: t, td: t - 1, ws: 12, wg: 22, wd: 45, sky: h < 34 ? 100 : 40, pop: zr || pl || sn ? 90 : h < 4 ? 40 : 10, thp: 0,
          wx: [].concat(zr ? [wx("freezing_rain", "definite")] : [], pl ? [wx("sleet", "chance")] : [], sn ? [wx("snow", "likely")] : [], h >= 1 && h < 5 ? [wx("fog", "patchy")] : []),
          q: zr ? 0.05 : pl ? 0.04 : sn ? 0.03 : 0, sn: sn ? 0.3 : pl ? 0.1 : 0, ice: zr ? 0.03 : 0 };
      }
    },
    heat: {
      name: "Heat wave", desc: "Highs near 100°, heat index to 110°",
      alerts: [["Extreme Heat Warning", "Severe", 0, 84, "Dangerously hot conditions with heat index values up to 112.", "Drink plenty of fluids, stay in an air-conditioned room, and check up on relatives and neighbors."]],
      afd: "Dangerous heat continues through Wednesday with highs 98 to 102 and dewpoints in the mid 70s, pushing heat index values to 110 to 112. Little relief overnight with lows near 80. A cold front brings scattered thunderstorms Thursday evening and a cooler weekend.",
      f: function (h, lh) {
        var front = h >= 96;
        var t = front ? diurnal(lh, 66, 84) : diurnal(lh, 79, 101), td = front ? 60 : 75;
        var ts = h >= 82 && h < 94 && (lh >= 15 || lh < 2);
        return { t: t, td: td, ws: 8, wg: null, wd: front ? 330 : 200, sky: ts ? 70 : 10, pop: ts ? 50 : 5, thp: ts ? 40 : 0,
          wx: ts ? [wx("thunderstorms", "scattered")] : [], q: ts ? 0.05 : 0, sn: 0, ice: 0 };
      }
    },
    severe: {
      name: "Severe storms", desc: "Afternoon thunderstorms, damaging wind, flooding rain",
      alerts: [["Severe Thunderstorm Watch", "Severe", 1, 10, "Scattered severe thunderstorms with damaging winds up to 70 mph and hail up to golf ball size.", "Be ready to move to a place of shelter if a warning is issued."],
        ["Flood Watch", "Moderate", 2, 20, "Excessive rainfall of 2 to 4 inches may cause flash flooding.", "Monitor later forecasts and be alert for possible flood warnings."]],
      afd: "Storms develop this afternoon along a warm front and quickly become severe, with damaging winds and large hail the main threats. Training storms this evening could produce 2 to 3 inches of rain. Another round of storms is possible Tuesday afternoon before cooler, drier air arrives Wednesday.",
      f: function (h, lh) {
        var r1 = h >= 2 && h < 9, r2 = h >= 48 && h < 55;
        var t = h < 60 ? diurnal(lh, 70, 88) : diurnal(lh, 58, 76), td = h < 60 ? 72 : 55;
        var ws = r1 || r2 ? 20 : 10, wg = r1 ? 60 : r2 ? 45 : 18;
        return { t: r1 || r2 ? t - 8 : t, td: td, ws: ws, wg: wg, wd: 210, sky: r1 || r2 ? 95 : 40, pop: r1 ? 90 : r2 ? 60 : 15, thp: r1 ? 80 : r2 ? 50 : 5,
          wx: r1 ? [wx("thunderstorms", "likely", "heavy"), wx("rain_showers", "definite")] : r2 ? [wx("thunderstorms", "scattered")] : [],
          q: r1 ? 0.35 : r2 ? 0.12 : 0, sn: 0, ice: 0 };
      }
    },
    cold: {
      name: "Arctic cold", desc: "Wind chills to 40 below",
      alerts: [["Extreme Cold Warning", "Severe", 0, 60, "Dangerously cold wind chills as low as 40 below zero.", "Avoid going outside during the coldest parts of the night. Frostbite can occur in as little as 10 minutes."]],
      afd: "Arctic air remains entrenched through Wednesday. Lows of 20 to 28 below and northwest winds of 10 to 15 mph produce wind chills of 35 to 45 below zero each night. Temperatures moderate late week with a chance of light snow Friday.",
      f: function (h, lh) {
        var t = h < 90 ? diurnal(lh, -26, -8) : diurnal(lh, -4, 14), fl = h >= 110 && h < 122;
        var ws = h < 90 ? 14 : 8;
        return { t: t, td: t - 6, ws: ws, wg: ws + 10, wd: 315, sky: fl ? 90 : 5, pop: fl ? 40 : 0, thp: 0,
          wx: fl ? [wx("snow", "chance")] : [], q: fl ? 0.01 : 0, sn: fl ? 0.15 : 0, ice: 0 };
      }
    }
  };

  var COMP = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split(" ");
  var WORD = { snow: "Snow", blowing_snow: "Blowing Snow", freezing_rain: "Freezing Rain", sleet: "Sleet", thunderstorms: "Thunderstorms", rain_showers: "Showers", fog: "Patchy Fog" };
  var COVW = { chance: "Chance ", scattered: "Scattered ", slight_chance: "Slight Chance ", patchy: "", likely: "", definite: "", areas: "" };
  function code(r, day) {
    var ws = r.wx.map(function (w) { return w.weather; });
    if (ws.indexOf("thunderstorms") >= 0) return "tsra";
    if (ws.indexOf("freezing_rain") >= 0) return "fzra";
    if (ws.indexOf("sleet") >= 0) return "sleet";
    if (ws.indexOf("snow") >= 0) return r.ws >= 30 ? "blizzard" : "snow";
    if (ws.indexOf("rain_showers") >= 0) return "rain_showers";
    if (ws.indexOf("fog") >= 0) return "fog";
    if (r.t >= 95) return "hot"; if (r.t <= 0) return "cold";
    return r.sky >= 88 ? "ovc" : r.sky >= 60 ? "bkn" : r.sky >= 30 ? "sct" : r.sky >= 10 ? "few" : "skc";
  }
  function words(r, day) {
    if (r.wx.length) return r.wx.filter(function (w) { return w.weather !== "fog" || r.wx.length === 1; }).map(function (w) {
      return (w.intensity === "heavy" ? "Heavy " : COVW[w.coverage] || "") + WORD[w.weather];
    }).join(" and ");
    if (r.t >= 95) return day ? "Sunny and Hot" : "Clear and Very Warm";
    return r.sky >= 88 ? "Cloudy" : r.sky >= 60 ? "Mostly Cloudy" : r.sky >= 30 ? "Partly " + (day ? "Sunny" : "Cloudy") : day ? "Sunny" : "Clear";
  }

  function load(id, loc, prev) {
    var sc = S[id]; if (!sc) return Promise.reject(new Error("unknown scenario " + id));
    var pl = (prev && prev.loc) || {}, tz = pl.tz || "America/Chicago";
    var now = Date.now(), h0 = Math.floor(now / H) * H;
    var fH = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }), fD = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" });
    var hourOf = function (ms) { return +fH.format(ms); };
    var dayName = function (ms) { return fD.format(ms); };
    var iso = function (ms) { return new Date(ms).toISOString().replace(".000Z", "+00:00"); };
    // hour-by-hour recipe, 30 h back (observations) to 7 days ahead
    var R = {};
    for (var t = h0 - 30 * H; t < h0 + 170 * H; t += H) {
      var r = sc.f((t - h0) / H, hourOf(t)), jit = Math.sin(t / H) * 0.6;
      r.t = Math.round(r.t + jit); r.td = Math.round(Math.min(r.td, r.t)); r.ws = Math.round(r.ws); r.wg = r.wg == null ? null : Math.round(r.wg);
      r.rh = rh(r.t, r.td); r.wc = wchill(r.t, r.ws); r.hi = heat(r.t, r.rh);
      R[t] = r;
    }
    var hours = Object.keys(R).map(Number).filter(function (x) { return x >= h0 - 6 * H; });
    var layer = function (fn, unit) { return { uom: unit, values: hours.map(function (x) { return { validTime: iso(x) + "/PT1H", value: fn(R[x]) }; }) }; };
    // precip amounts come in 6-hour blocks on 00/06/12/18Z, like the real grids
    var six = function (k) {
      var v = [], b0 = Math.floor((h0 - 6 * H) / (6 * H)) * 6 * H;
      for (var b = b0; b < h0 + 168 * H; b += 6 * H) { var sum = 0; for (var k2 = 0; k2 < 6; k2++) sum += R[b + k2 * H] ? R[b + k2 * H][k] : 0; v.push({ validTime: iso(b) + "/PT6H", value: MM(sum) }); }
      return { uom: "wmoUnit:mm", values: v };
    };
    var grid = { properties: {
      updateTime: iso(now - 40 * 60000), elevation: { value: 256 },
      temperature: layer(function (r) { return C(r.t); }), dewpoint: layer(function (r) { return C(r.td); }),
      apparentTemperature: layer(function (r) { return C(r.wc != null ? r.wc : r.hi != null ? r.hi : r.t); }),
      windChill: layer(function (r) { return C(r.wc); }), heatIndex: layer(function (r) { return C(r.hi); }),
      relativeHumidity: layer(function (r) { return r.rh; }), skyCover: layer(function (r) { return r.sky; }),
      probabilityOfPrecipitation: layer(function (r) { return r.pop; }), windSpeed: layer(function (r) { return KMH(r.ws); }),
      windDirection: layer(function (r) { return r.wd; }), windGust: layer(function (r) { return KMH(r.wg); }),
      probabilityOfThunder: layer(function (r) { return r.thp; }), weather: layer(function (r) { return r.wx; }),
      quantitativePrecipitation: six("q"), snowfallAmount: six("sn"), iceAccumulation: six("ice")
    } };
    // 12-hour periods: first runs to the next 6 am/6 pm, like the NWS 7-day forecast
    var periods = [], a = h0, lh = hourOf(h0), first = true;
    var e = h0 + (((lh >= 6 && lh < 18) ? 18 : 30) - lh) % 24 * H; if (e <= a) e += 12 * H;
    for (var n = 1; n <= 14; n++) {
      var day = hourOf(a) >= 6 && hourOf(a) < 18, rs = [];
      for (var x = a; x < e; x += H) if (R[x]) rs.push(R[x]);
      var temps = rs.map(function (q) { return q.t; }), pop = Math.max.apply(null, rs.map(function (q) { return q.pop; }));
      var mid = rs[Math.floor(rs.length / 2)] || rs[0], wet = rs.filter(function (q) { return q.wx.length; })[0], rep = wet || mid;
      var tmp = day ? Math.max.apply(null, temps) : Math.min.apply(null, temps);
      var wsA = Math.min.apply(null, rs.map(function (q) { return q.ws; })), wsB = Math.max.apply(null, rs.map(function (q) { return q.ws; }));
      var sn = rs.reduce(function (s2, q) { return s2 + q.sn; }, 0), ic = rs.reduce(function (s2, q) { return s2 + q.ice; }, 0);
      var name = first ? (day ? (lh >= 12 ? "This Afternoon" : "Today") : "Tonight") : dayName(a) + (day ? "" : " Night");
      var short = words(rep, day), wind = (wsA === wsB ? wsA : wsA + " to " + wsB) + " mph";
      var gusts = Math.max.apply(null, rs.map(function (q) { return q.wg || 0; }));
      var detail = short + ". " + (day ? "High near " : "Low around ") + tmp + ". " + COMP[Math.round(mid.wd / 22.5) % 16] + " wind " + wind +
        (gusts > wsB + 5 ? ", with gusts as high as " + gusts + " mph" : "") + "." + (pop >= 20 ? " Chance of precipitation is " + pop + "%." : "") +
        (sn >= 0.5 ? " New snow accumulation of " + Math.max(1, Math.floor(sn * 0.8)) + " to " + Math.ceil(sn * 1.2) + " inches possible." : "") +
        (ic >= 0.1 ? " New ice accumulation of " + (ic * 0.8).toFixed(1) + " to " + (ic * 1.2).toFixed(1) + " of an inch possible." : "");
      // split icon only when the weather itself changes during the period (e.g. cloudy -> snow)
      var c2 = code(rep, day), c1 = wet && !rs[0].wx.length ? code(rs[0], day) : c2, pp = pop >= 20 ? "," + pop : "";
      periods.push({ number: n, name: name, startTime: iso(a), endTime: iso(e), isDaytime: day, temperature: tmp, temperatureTrend: null,
        probabilityOfPrecipitation: { value: pop }, windSpeed: wind, windDirection: COMP[Math.round(mid.wd / 22.5) % 16],
        icon: "https://api.weather.gov/icons/land/" + (day ? "day" : "night") + "/" + (c1 !== c2 ? c1 + "/" : "") + c2 + pp + "?size=medium",
        shortForecast: short, detailedForecast: detail });
      a = e; e = a + 12 * H; first = false;
    }
    // hourly observations for the last 24 hours
    var feats = [];
    for (var o = h0 - 25 * H; o <= h0; o += H) {
      var q2 = R[o]; if (!q2) continue; var ts = o - 7 * 60000; if (ts > now) continue;
      feats.push({ properties: { timestamp: iso(ts), rawMessage: "METAR TEST", textDescription: words(q2, hourOf(o) >= 7 && hourOf(o) < 19),
        icon: "https://api.weather.gov/icons/land/day/" + code(q2, true) + "?size=medium",
        temperature: { value: C(q2.t) }, dewpoint: { value: C(q2.td) }, relativeHumidity: { value: q2.rh },
        windSpeed: { value: KMH(q2.ws) }, windDirection: { value: q2.wd }, windGust: { value: KMH(q2.wg) },
        windChill: { value: C(q2.wc) }, heatIndex: { value: C(q2.hi) }, barometricPressure: { value: 101200 - (q2.wx.length ? 1500 : 0) },
        visibility: { value: q2.wx.length ? (q2.ws >= 25 ? 400 : 2400) : 16093 }, precipitationLastHour: { value: MM(q2.q) } } });
    }
    var alerts = { features: sc.alerts.map(function (al, i) {
      return { properties: { id: "test-" + id + "-" + i, event: al[0], headline: al[0] + " (test scenario)", severity: al[1], urgency: "Expected", certainty: "Likely",
        onset: iso(h0 + al[2] * H), ends: iso(h0 + al[3] * H), senderName: "Test scenario", description: "* WHAT... " + al[4] + "\n\n* WHERE... " + (loc.label || "This area") + ".",
        instruction: al[5], areaDesc: loc.label || "" } };
    }) };
    var raw = {
      now: now, via: "test", label: loc.label || pl.label || "Test location", lat: +(+loc.lat).toFixed(4), lon: +(+loc.lon).toFixed(4),
      points: { properties: { cwa: pl.office || "MPX", gridX: 1, gridY: 1, timeZone: tz, forecastZone: "/" + (pl.zone || "MNZ060"), county: "/" + (pl.county || "MNC053"),
        relativeLocation: { properties: {} } } },
      forecast: { properties: { updateTime: iso(now - 50 * 60000), periods: periods } },
      grid: grid, station: { id: "TEST", name: "Test station" }, obs: { features: feats }, alerts: alerts,
      afd: { id: "test-afd", issuanceTime: iso(now - 2 * H), productText: ".KEY MESSAGES...\n\n" + sc.afd + "\n\n&&\n" },
      hwo: null, uv: null, uvh: null, mapclick: null
    };
    return Promise.resolve(root.WXNormalize.normalize(raw));
  }

  root.WXScenario = { list: Object.keys(S).map(function (k) { return { id: k, name: S[k].name, desc: S[k].desc }; }), load: load, has: function (id) { return !!S[id]; } };
})(window);
