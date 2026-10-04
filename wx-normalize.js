/* wx-normalize.js — turns raw api.weather.gov responses into the compact
   document the Rochester Weather dashboard renders (db doc wx/latest).
   Runs unchanged in Node (scheduled refresh) and in the browser (live path). */
(function (root) {
  "use strict";
  var COV = { slight_chance: 1, isolated: 1, patchy: 1, chance: 2, scattered: 2, areas: 2,
    likely: 3, numerous: 3, widespread: 3, occasional: 3, periods: 3, intermittent: 3, brief: 2,
    definite: 4, frequent: 4 };
  var COVLBL = { slight_chance: "SChc", isolated: "Iso", patchy: "Patchy", chance: "Chc", scattered: "Sct",
    areas: "Areas", likely: "Lkly", numerous: "Num", widespread: "Wide", occasional: "Ocnl",
    periods: "Pds", intermittent: "Inter", brief: "Brf", definite: "Def", frequent: "Frq" };
  var TYPE = { rain: "rain", rain_showers: "rain", drizzle: "rain", thunderstorms: "thunder",
    snow: "snow", snow_showers: "snow", blowing_snow: "snow", freezing_rain: "fzra",
    freezing_drizzle: "fzra", freezing_spray: "fzra", sleet: "sleet", ice_crystals: "snow", hail: "hail",
    fog: "fog", freezing_fog: "fog", ice_fog: "fog" };
  // not mapped (not precipitation): frost, haze, smoke, dust, sand, spray, volcanic ash, water spouts
  var WXKEYS = ["rain", "thunder", "snow", "fzra", "sleet", "hail", "fog"];
  var H = 3600000;

  function durH(d) {
    var m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?)?/.exec(d || "");
    return ((+(m && m[1]) || 0) * 24 + (+(m && m[2]) || 0)) || 1;
  }
  function blocks(layer) {
    return ((layer && layer.values) || []).map(function (v) {
      var p = v.validTime.split("/");
      return { s: Date.parse(p[0]), h: durH(p[1]), v: v.value };
    });
  }
  var r1 = function (x, n) { var k = Math.pow(10, n || 0); return Math.round(x * k) / k; };
  var F = function (c) { return c == null ? null : Math.round(c * 9 / 5 + 32); };
  var MPH = function (k) { return k == null ? null : Math.round(k / 1.609344); };
  var IN = function (mm) { return mm ? mm / 25.4 : 0; };
  var val = function (o) { return o && o.value != null ? o.value : null; };
  var COMPASS = "N NNE NE ENE E ESE SE SSE S SSW SW WSW W WNW NW NNW".split(" ");
  var compass = function (d) { return d == null ? null : COMPASS[Math.round(d / 22.5) % 16]; };

  function iconCodes(url) {
    // .../icons/land/day/rain_showers,40/tsra,60?size=medium -> [{c:'rain_showers',p:40},{c:'tsra',p:60}]
    if (!url) return [];
    var path = url.split("?")[0].split("/icons/land/")[1] || "";
    return path.split("/").slice(1).map(function (s) {
      var a = s.split(","); return { c: a[0], p: a[1] ? +a[1] : null };
    });
  }

  // weather.gov's names for its observation icon codes (api.weather.gov/icons), for stations that send no text
  var ICON_NAME = { skc: "Clear", few: "A Few Clouds", sct: "Partly Cloudy", bkn: "Mostly Cloudy", ovc: "Overcast",
    wind_skc: "Clear and Windy", wind_few: "A Few Clouds and Windy", wind_sct: "Partly Cloudy and Windy", wind_bkn: "Mostly Cloudy and Windy", wind_ovc: "Overcast and Windy",
    snow: "Snow", rain_snow: "Rain and Snow", rain_sleet: "Rain and Sleet", snow_sleet: "Snow and Sleet", fzra: "Freezing Rain", rain_fzra: "Rain and Freezing Rain",
    snow_fzra: "Freezing Rain and Snow", sleet: "Sleet", rain: "Rain", rain_showers: "Rain Showers", rain_showers_hi: "Rain Showers", tsra: "Thunderstorm",
    tsra_sct: "Thunderstorm", tsra_hi: "Thunderstorm", tornado: "Tornado", hurricane: "Hurricane", tropical_storm: "Tropical Storm", dust: "Dust", smoke: "Smoke",
    haze: "Haze", hot: "Hot", cold: "Cold", blizzard: "Blizzard", fog: "Fog/Mist" };
  function iconName(ic) { var c = ic && ic[0] && ic[0].c; return c && ICON_NAME[c] || ""; }

  function normalize(raw) {
    var pt = raw.points.properties;
    var gd = raw.grid.properties;
    var fc = raw.forecast.properties;
    var now = raw.now || Date.now();

    // ---- hourly series from grid data (what the weather.gov graph plots) ----
    var L = {};
    ["temperature", "dewpoint", "apparentTemperature", "windChill", "heatIndex", "relativeHumidity",
      "skyCover", "probabilityOfPrecipitation", "windSpeed", "windDirection", "windGust",
      "probabilityOfThunder", "weather", "quantitativePrecipitation", "snowfallAmount", "iceAccumulation"]
      .forEach(function (k) { L[k] = blocks(gd[k]); });
    function at(k, t) {
      var b = L[k];
      for (var i = 0; i < b.length; i++) if (t >= b[i].s && t < b[i].s + b[i].h * H) return b[i].v;
      return null;
    }
    // start 6 hours back (when the grid still has them) so "now" sits inside the graph, not at its left edge
    var gridStart = L.temperature.length ? L.temperature[0].s : now;
    var start = Math.max(Math.floor(now / H) * H - 6 * H, Math.ceil(gridStart / H) * H);
    var tb = L.temperature;
    var end = tb.length ? tb[tb.length - 1].s + tb[tb.length - 1].h * H : start;
    var s = { t: [], td: [], wc: [], hi: [], rh: [], sky: [], pop: [], ws: [], wd: [], wg: [], thp: [] };
    WXKEYS.forEach(function (k) { s[k] = []; });
    for (var t = start; t < end; t += H) {
      var tf = F(at("temperature", t));
      var wc = F(at("windChill", t)), hi = F(at("heatIndex", t));
      s.t.push(tf);
      s.td.push(F(at("dewpoint", t)));
      s.wc.push(wc != null && tf != null && tf <= 50 && wc < tf ? wc : null);
      s.hi.push(hi != null && tf != null && tf >= 80 && hi > tf ? hi : null);
      s.rh.push(at("relativeHumidity", t));
      s.sky.push(at("skyCover", t));
      s.pop.push(at("probabilityOfPrecipitation", t));
      s.ws.push(MPH(at("windSpeed", t)));
      var wd = at("windDirection", t); s.wd.push(wd == null ? null : Math.round(wd));
      s.wg.push(MPH(at("windGust", t)));
      s.thp.push(at("probabilityOfThunder", t));
      var w = {}, wl = {};
      (at("weather", t) || []).forEach(function (x) {
        var ty = TYPE[x.weather], lv = COV[x.coverage];
        if (ty && lv && (!w[ty] || lv > w[ty])) { w[ty] = lv; wl[ty] = COVLBL[x.coverage]; }
      });
      WXKEYS.forEach(function (k) { s[k].push(w[k] ? [w[k], wl[k]] : 0); });
    }
    var nH = s.t.length;
    function amt(k) {
      return L[k].filter(function (b) { return b.s + b.h * H > start && b.s < end; })
        .map(function (b) { return [b.s, b.h, r1(IN(b.v), 2)]; });
    }
    var grid = { start: start, n: nH, s: s, qpf: amt("quantitativePrecipitation"),
      snow: amt("snowfallAmount"), ice: amt("iceAccumulation"), updated: Date.parse(gd.updateTime) };

    // ---- 7-day periods (forecast page) with liquid/snow/ice per period ----
    function total(k, a, b) {
      var tot = 0;
      L[k].forEach(function (x) {
        if (!x.v) return;
        var ov = (Math.min(x.s + x.h * H, b) - Math.max(x.s, a)) / H;
        if (ov > 0) tot += IN(x.v) * ov / x.h;
      });
      return tot;
    }
    var periods = fc.periods.map(function (p) {
      var a = Date.parse(p.startTime), b = Date.parse(p.endTime);
      return { name: p.name, s: a, e: b, day: p.isDaytime, temp: p.temperature,
        trend: p.temperatureTrend || null, pop: val(p.probabilityOfPrecipitation) || 0,
        wind: (p.windDirection + " " + p.windSpeed).trim(), short: p.shortForecast,
        detail: p.detailedForecast, icon: iconCodes(p.icon),
        qpf: r1(total("quantitativePrecipitation", a, b), 2), snow: r1(total("snowfallAmount", a, b), 2),
        ice: r1(total("iceAccumulation", a, b), 2) };
    });

    // ---- weather.gov page wording: MapClick's period text/names/temps replace the API's (they come from a different generator) ----
    var mc = raw.mapclick;
    if (mc && mc.time && mc.data && mc.data.text && mc.data.text.length) {
      var st = mc.time.startValidTime || [];
      var mp = mc.data.text.map(function (txt, i) {
        var a = Date.parse(st[i]), b = st[i + 1] ? Date.parse(st[i + 1]) : a + 12 * H;
        var mid = a + 3600e3, api = periods.filter(function (q) { return mid >= q.s && mid < q.e; })[0] || periods[Math.min(i, periods.length - 1)] || {};
        var day = (mc.time.tempLabel || [])[i] === "High";
        // weather.gov's split icons carry a start/end chance (DualImage.php?...&ip=20&jp=70) shown as "20% → 70%"
        var il = (mc.data.iconLink || [])[i] || "", ip = /[?&]ip=(\d+)/.exec(il), jp = /[?&]jp=(\d+)/.exec(il);
        var popTrend = ip && jp && ip[1] !== jp[1] ? [+ip[1], +jp[1]] : null;
        return { name: mc.time.startPeriodName[i], s: a, e: b, day: day, temp: +mc.data.temperature[i], popTrend: popTrend,
          trend: null, pop: mc.data.pop && mc.data.pop[i] != null ? +mc.data.pop[i] : 0, wind: api.wind || "",
          short: mc.data.weather[i], detail: String(txt).trim(), icon: api.icon,
          qpf: r1(total("quantitativePrecipitation", a, b), 2), snow: r1(total("snowfallAmount", a, b), 2), ice: r1(total("iceAccumulation", a, b), 2), src: "mapclick" };
      });
      if (mp.every(function (x) { return isFinite(x.s) && isFinite(x.temp); })) periods = mp;
    }

    // ---- observations: latest full reading + hourly history (24h) ----
    var obsF = ((raw.obs && raw.obs.features) || []).map(function (f) { return f.properties; })
      .filter(function (o) { return o && o.timestamp; })
      .sort(function (a, b) { return Date.parse(b.timestamp) - Date.parse(a.timestamp); });
    function ob(o) {
      var p = val(o.barometricPressure) || val(o.seaLevelPressure);
      var rh = val(o.relativeHumidity);
      var vis = val(o.visibility);
      var r = {
        ms: Date.parse(o.timestamp), desc: o.textDescription || "", t: F(val(o.temperature)),
        td: F(val(o.dewpoint)), rh: rh == null ? null : Math.round(rh), ws: MPH(val(o.windSpeed)),
        wd: compass(val(o.windDirection)), wdd: val(o.windDirection), wg: MPH(val(o.windGust)),
        vis: vis == null ? null : r1(vis / 1609.344, vis < 16000 ? 2 : 0),
        inHg: p ? r1(p / 3386.389, 2) : null, mb: p ? r1(p / 100, 1) : null,
        wc: F(val(o.windChill)), hi: F(val(o.heatIndex)),
        p1: val(o.precipitationLastHour) == null ? null : r1(IN(val(o.precipitationLastHour)), 2),
        icon: iconCodes(o.icon), metar: !!o.rawMessage };
      // wind straight from the station's own report when there is one (e.g. "05015G20KT" = NE 15 kt gusting 20):
      //   the API's processed values can lag or round differently from the METAR the station actually sent
      var m = /\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/.exec(o.rawMessage || "");
      if (m) {
        var KT = function (k) { return Math.round(k * 1.150779); };
        r.ws = KT(+m[2]); r.wg = m[3] ? KT(+m[3]) : null;
        if (m[1] !== "VRB") { r.wdd = +m[1]; r.wd = r.ws ? compass(+m[1]) : null; } else { r.wdd = null; r.wd = "Variable"; }
      }
      return r;
    }
    var latest = null;
    // prefer the latest routine METAR (tenths-precision) when under 90 min old, like weather.gov
    for (var i = 0; i < obsF.length; i++) {
      var oi = obsF[i];
      if (val(oi.temperature) == null) continue;
      if (Date.parse(oi.timestamp) < now - 90 * 60000) break;
      if (oi.rawMessage) { latest = ob(oi); break; }
    }
    if (!latest) for (i = 0; i < obsF.length; i++) if (val(obsF[i].temperature) != null) { latest = ob(obsF[i]); break; }
    // hourly history: routine METARs (rawMessage present) or, if absent, one per clock hour
    if (latest && !latest.desc) {
      for (i = 0; i < obsF.length; i++) {
        if (Date.parse(obsF[i].timestamp) < latest.ms - 90 * 60000) break;
        if (obsF[i].textDescription) { latest.desc = obsF[i].textDescription; latest.icon = iconCodes(obsF[i].icon); break; }
      }
    }
    // still nothing (some stations send no text at all): name it from the observation's own icon, as weather.gov does
    if (latest && !latest.desc) latest.desc = iconName(latest.icon);
    var hist = [], seen = {};
    obsF.forEach(function (o) {
      var ms = Date.parse(o.timestamp);
      if (ms < now - 24 * H - 10 * 60000) return;
      if (val(o.temperature) == null) return;
      var key = Math.floor((ms + 10 * 60000) / H);
      if (o.rawMessage || !seen[key]) { if (!seen[key] || o.rawMessage) { seen[key] = 1; hist.push(ob(o)); } }
    });
    // de-dup by hour keeping the METAR if present
    var byH = {};
    hist.forEach(function (o) {
      var k = Math.floor((o.ms + 10 * 60000) / H);
      if (!byH[k] || (o.metar && !byH[k].metar)) byH[k] = o;
    });
    hist = Object.keys(byH).map(function (k) { return byH[k]; }).sort(function (a, b) { return b.ms - a.ms; });
    var st = raw.station || {};

    // ---- alerts ----
    var alerts = ((raw.alerts && raw.alerts.features) || []).map(function (f) {
      var p = f.properties;
      return { id: p.id, event: p.event, headline: p.headline, severity: p.severity, urgency: p.urgency,
        certainty: p.certainty, onset: Date.parse(p.onset || p.effective) || null,
        ends: Date.parse(p.ends || p.expires) || null, sent: Date.parse(p.sent) || null, expires: Date.parse(p.expires) || null, sender: p.senderName,
        desc: p.description || "", instr: p.instruction || "", area: p.areaDesc || "" };
    }).sort(function (a, b) {
      var o = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4 };
      return (o[a.severity] || 4) - (o[b.severity] || 4);
    });

    // ---- area forecast discussion ----
    var afd = raw.afd ? { id: raw.afd.id, issued: Date.parse(raw.afd.issuanceTime), text: raw.afd.productText || "" } : null;

    // ---- hazardous weather outlook: the segment covering this point's zone ----
    var hwo = null;
    function ugcHas(line, zone) {
      var st = null, ok = false;
      line.replace(/\s+/g, "").split("-").forEach(function (tok) {
        var m = /^([A-Z]{2}[ZC])?(\d{3})(?:>(\d{3}))?$/.exec(tok); if (!m) return;
        if (m[1]) st = m[1]; if (!st) return;
        var a = +m[2], b = m[3] ? +m[3] : a, zs = zone.slice(0, 3), zn = +zone.slice(3);
        if (st === zs && zn >= a && zn <= b) ok = true;
      });
      return ok;
    }
    // the zone-code header of a segment: from the first line that starts with a zone/county code through the line that ends
    //   with the 6-digit expiration time ("…-200800-"), which offices sometimes wrap onto a line of its own
    function ugcHeader(sg) {
      var lines = sg.split("\n"), i0 = -1, i;
      for (i = 0; i < lines.length; i++) {
        if (i0 < 0 && /^[A-Z]{2}[ZC]\d{3}/.test(lines[i])) i0 = i;
        if (i0 >= 0 && /(^|-)\d{6}-\s*$/.test(lines[i])) return lines.slice(i0, i + 1).join("");
      }
      return null;
    }
    if (raw.hwo && raw.hwo.productText) {
      var zone = (pt.forecastZone || "").split("/").pop(), cty = (pt.county || "").split("/").pop();
      var segs = raw.hwo.productText.split(/\n\$\$/), seg = null;
      segs.forEach(function (sg) {
        var hdr = ugcHeader(sg);
        if (hdr && !seg && (ugcHas(hdr, zone) || ugcHas(hdr, cty))) seg = sg;
      });
      if (seg) {
        var sect = function (re) { var m = re.exec(seg); return m ? m[1].replace(/\s+/g, " ").trim() : ""; };
        var d1 = sect(/\.DAY ONE\.\.\.[^\n]*\n([\s\S]*?)(?=\n\.[A-Z]|$)/), d27 = sect(/\.DAYS TWO THROUGH SEVEN\.\.\.[^\n]*\n([\s\S]*?)(?=\n\.[A-Z]|$)/);
        var none = function (t) { return !t || /^No hazardous weather is expected/i.test(t); };
        // full segment text verbatim, from "This hazardous weather outlook is for..." on (skips the zone/UGC header)
        var body = /\n(This hazardous weather outlook[\s\S]*)$/i.exec(seg);
        // expiration: the 6-digit DDHHMM (UTC) code ending the header, resolved to the first such moment after the issue time
        var issuedMs = Date.parse(raw.hwo.issuanceTime), xm = /(\d{2})(\d{2})(\d{2})-\s*$/.exec(ugcHeader(seg) || ""), expiresMs = null;
        if (xm && isFinite(issuedMs)) {
          var d0 = new Date(issuedMs), c = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), +xm[1], +xm[2], +xm[3]);
          for (var k = 0; k < 3 && c < issuedMs; k++) c = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + k + 1, +xm[1], +xm[2], +xm[3]);
          if (c >= issuedMs && new Date(c).getUTCDate() === +xm[1]) expiresMs = c;
        }
        hwo = { id: raw.hwo.id, issued: issuedMs, expires: expiresMs, day1: d1, days27: d27, hazard: !(none(d1) && none(d27)),
          text: (body ? body[1] : "").trim() };
      }
    }

    // ---- EPA daily UV index forecast (city) ----
    var uv = null, u0 = Array.isArray(raw.uv) && raw.uv[0];
    if (u0 && u0.UV_INDEX != null) uv = { date: u0.DATE, index: +u0.UV_INDEX, alert: u0.UV_ALERT === "1" };
    // hourly UV forecast, keyed by EPA's local "Sep/27/2026 06 AM" stamps
    if (uv && Array.isArray(raw.uvh)) uv.hourly = raw.uvh.filter(function (h) { return h && h.DATE_TIME; }).map(function (h) { return [h.DATE_TIME, +h.UV_VALUE || 0]; });

    var rel = pt.relativeLocation && pt.relativeLocation.properties || {};
    var lat = raw.lat, lon = raw.lon;
    return {
      v: 1,
      fetchedAt: now,
      via: raw.via || "task",
      loc: { label: raw.label || (rel.city ? rel.city + ", " + rel.state : ""), lat: lat, lon: lon, tz: pt.timeZone,
        office: pt.cwa, grid: pt.gridX + "," + pt.gridY,
        elevFt: gd.elevation && gd.elevation.value != null ? Math.round(gd.elevation.value * 3.28084) : null,
        zone: (pt.forecastZone || "").split("/").pop(), county: (pt.county || "").split("/").pop() },
      updated: { forecast: Date.parse(fc.updateTime), grid: Date.parse(gd.updateTime) },
      cur: latest, station: { id: st.id || null, name: st.name || null, elevFt: st.elevFt || null },
      obs: hist, alerts: alerts, periods: periods, grid: grid, afd: afd, hwo: hwo, uv: uv
    };
  }

  var api = { normalize: normalize, TYPE: TYPE, COV: COV }; // TYPE/COV are exposed for check.html
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WXNormalize = api;
})(typeof window !== "undefined" ? window : globalThis);
