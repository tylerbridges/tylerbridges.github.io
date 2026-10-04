// Official NWS precipitation map for the Forecast tab, drawn as a monochrome county map: white lines and numbers on
//   black in dark mode, black on white in light mode, no colour fills and no colour key. Each county is labelled with
//   its amount from the Weather Prediction Center's official forecast, the way local NWS offices publish county totals.
//   Data: NOAA's GIS map services (mapservices.weather.noaa.gov, ArcGIS REST, queried as JSON in lat/lon):
//   - precip/wpc_qpf: official QPF, layer 1 = 24-hour Day 1, layer 8 = 48-hour Days 1–2; one multipolygon per contour
//     level (field qpf, inches), and the levels are exclusive bands (each has holes where the next level starts);
//   - precip/wpc_prob_winter_precip: official chance of 4/8/12"+ snow (Day 1 layers 1/2/3, Day 2 layers 6/7/8) and
//     0.25"+ ice (Day 1 layer 4, Day 2 layer 9); field outlook = "Slight (10-39%)", "Moderate (40-69%)", "High (70-100%)"
//     or "Less than 10 percent";
//   - static/nws_reference_maps/nws_reference_map: layer 2 = NWS county borders (countyname, state, fips, lat/lon label
//     point), layer 3 = state borders. Counties load by 6°×4° cell around the view (detailed), or all of CONUS at once
//     (simplified) when zoomed out.
//   County value: the WPC polygons are rasterised once onto a 0.04° lat/lon grid (~4 km), and each county takes the
//   grid cells inside it: precipitation = area average, using the middle of each WPC band (.01–.10 counts as .055,
//   the top band as its floor); snow/ice chance = the highest category covering at least a quarter of the county.
//   Labels sit at the county's label point, largest values first, skipping any that would overlap; city and town
//   names (OpenFreeMap tiles via wx-vmap.js, a dot plus the name beside it) fill in around them without covering them. Tap for the county
//   name and value. start_time/end_time (UTC) give the forecast period. If the service can't be reached the caller
//   falls back to WPC's images.
(function (root) {
  "use strict";
  var MS = "https://mapservices.weather.noaa.gov/";
  var PRECIP = MS + "vector/rest/services/precip/", REF = MS + "static/rest/services/nws_reference_maps/nws_reference_map/MapServer/";
  var VM = root.WXVMap, D2R = Math.PI / 180, TS = 256, K = 1e4, TTL = 30 * 60000;
  var QL = [0.01, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 7, 10, 15, 20]; // WPC's contour levels
  var CATL = [null, "10%", "40%", "70%"], CATLONG = [null, "10–39%", "40–69%", "70%+"];
  // rasterised WPC grid: covers CONUS and nearby waters
  var GX0 = -130, GY1 = 55, GR = 0.04, GW = 1750, GH = 900;

  function wx(lon) { return (lon + 180) / 360; }
  function wy(lat) { var s = Math.sin(Math.max(-85, Math.min(85, lat)) * D2R); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); }
  function lonOf(x) { return x * 360 - 180; }
  function latOf(y) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / D2R; }
  function scaleZ(z) { return TS * Math.pow(2, z); }
  function utc(s) { var m = /(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/.exec(s || ""); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null; }
  function dark() { var t = document.documentElement.dataset.theme; return t ? t === "dark" : !!(root.matchMedia && root.matchMedia("(prefers-color-scheme: dark)").matches); }
  // WPC's lowest band is .01–.10, so anything averaging under .10 can only honestly read "<.1"; above that, county
  //   averages round to .05 (to .1 from 1 in up)
  function amt(v) { if (v < 0.1) return "<.1"; var r = v < 0.975 ? Math.round(v * 20) / 20 : Math.round(v * 10) / 10; return r < 1 ? r.toFixed(2).replace(/^0/, "") : r.toFixed(1); }
  function num(v) { return v < 1 ? v.toFixed(2).replace(/^0/, "") : String(v); }

  function getJSON(url) {
    var ac = root.AbortController ? new AbortController() : null, to = setTimeout(function () { if (ac) ac.abort(); }, 25000);
    return fetch(url, ac ? { signal: ac.signal } : {}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) {
      clearTimeout(to); if (!j || j.error || !Array.isArray(j.features)) throw new Error("bad reply"); return j;
    }, function (e) { clearTimeout(to); throw e; });
  }
  // rings in lat/lon (flat Float64Array lon,lat,…) plus a Path2D in world units ×K and a lat/lon bounding box
  function shape(g) {
    var rings = [], path = new Path2D(), bb = [Infinity, Infinity, -Infinity, -Infinity];
    (g && g.rings || []).forEach(function (r) {
      if (r.length < 3) return;
      var a = new Float64Array(r.length * 2);
      for (var i = 0; i < r.length; i++) {
        var lo = r[i][0], la = r[i][1]; a[2 * i] = lo; a[2 * i + 1] = la;
        if (i) path.lineTo(wx(lo) * K, wy(la) * K); else path.moveTo(wx(lo) * K, wy(la) * K);
        if (lo < bb[0]) bb[0] = lo; if (la < bb[1]) bb[1] = la; if (lo > bb[2]) bb[2] = lo; if (la > bb[3]) bb[3] = la;
      }
      path.closePath(); rings.push(a);
    });
    return rings.length ? { rings: rings, path: path, bb: bb } : null;
  }
  function inRings(rings, x, y) {
    var c = false;
    for (var k = 0; k < rings.length; k++) {
      var w = rings[k];
      for (var i = 0, n = w.length / 2, j = n - 1; i < n; j = i++) {
        var xi = w[2 * i], yi = w[2 * i + 1], xj = w[2 * j], yj = w[2 * j + 1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
      }
    }
    return c;
  }

  // ---------- WPC product ----------
  function layerOf(s) {
    var d = s.p === 48 ? 2 : 1;
    if (s.k === "qpf") return { svc: "wpc_qpf", id: d === 2 ? 8 : 1, f: "qpf" };
    if (s.k === "ice") return { svc: "wpc_prob_winter_precip", id: d === 2 ? 9 : 4, f: "outlook" };
    return { svc: "wpc_prob_winter_precip", id: (d === 2 ? 5 : 0) + ({ "04": 1, "08": 2, "12": 3 }[s.th] || 1), f: "outlook" };
  }
  var cache = {};
  function loadProduct(L) {
    var key = L.svc + "/" + L.id, c = cache[key];
    if (c && (c.p || Date.now() - c.t < TTL)) return c.p || Promise.resolve(c.d);
    var p = getJSON(PRECIP + L.svc + "/MapServer/" + L.id + "/query?where=1%3D1&outFields=" + L.f + ",start_time,end_time,issue_time" +
      "&returnGeometry=true&outSR=4326&geometryPrecision=3&maxAllowableOffset=0.03&f=json").then(function (j) {
      var d = prepProduct(j.features, L.f, key); cache[key] = { t: Date.now(), d: d }; return d;
    }).catch(function (e) { delete cache[key]; throw e; });
    cache[key] = { p: p }; return p;
  }
  // band index (1-based; 0 = none) per 0.04° cell
  function prepProduct(fs, f, key) {
    var d = { key: key, qpf: f === "qpf", start: null, end: null, issue: null, grid: null, vals: {}, rng: {} };
    var cv = document.createElement("canvas"); cv.width = GW; cv.height = GH;
    var cx = cv.getContext("2d"); cx.setTransform(1 / GR, 0, 0, -1 / GR, -GX0 / GR, GY1 / GR);
    fs.forEach(function (ft) {
      var a = ft.attributes || {};
      if (d.start == null) { d.start = utc(a.start_time); d.end = utc(a.end_time); d.issue = utc(a.issue_time); }
      var v;
      if (d.qpf) { v = QL.indexOf(+a.qpf) + 1; if (!v) QL.forEach(function (l, i) { if (Math.abs(l - a.qpf) < 1e-6) v = i + 1; }); }
      else { var m = /(\d+)\s*-\s*\d+/.exec(a.outlook || ""), lo = m ? +m[1] : 0; v = lo >= 70 ? 3 : lo >= 40 ? 2 : lo >= 10 ? 1 : 0; }
      if (!v || !ft.geometry || !ft.geometry.rings) return;
      var p = new Path2D();
      ft.geometry.rings.forEach(function (r) { r.forEach(function (q, i) { if (i) p.lineTo(q[0], q[1]); else p.moveTo(q[0], q[1]); }); p.closePath(); });
      cx.fillStyle = "rgb(" + v * 12 + ",0,0)"; cx.fill(p, "evenodd");
    });
    var px = cx.getImageData(0, 0, GW, GH).data, g = new Uint8Array(GW * GH);
    for (var i = 0; i < g.length; i++) g[i] = Math.round(px[4 * i] / 12); // edge pixels blend between neighbouring bands
    d.grid = g;
    return d;
  }
  function cell(lon, lat) {
    var i = Math.floor((lon - GX0) / GR), j = Math.floor((GY1 - lat) / GR);
    return i >= 0 && j >= 0 && i < GW && j < GH ? data.grid[j * GW + i] : 0;
  }
  function rep(b) { return !b ? 0 : b >= QL.length ? QL[QL.length - 1] : (QL[b - 1] + QL[b]) / 2; }
  // the county's value (cached per product): precip average in inches, or snow/ice chance category 0–3
  function countyVal(c) {
    var key = c.fips, v = data.vals[key]; if (v !== undefined) return v;
    var n = 0, sum = 0, cats = [0, 0, 0, 0], b = c.bb, lo = 99, hi = 0;
    for (var lat = Math.ceil(b[1] / GR) * GR + GR / 2; lat < b[3]; lat += GR)
      for (var lon = Math.ceil(b[0] / GR) * GR + GR / 2; lon < b[2]; lon += GR) {
        if (!inRings(c.rings, lon, lat)) continue;
        var q = cell(lon, lat); n++; if (q < lo) lo = q; if (q > hi) hi = q;
        if (data.qpf) sum += rep(q); else cats[Math.min(3, q)]++;
      }
    if (!n) { var q2 = cell(c.lon, c.lat); n = 1; lo = hi = q2; if (data.qpf) sum = rep(q2); else cats[Math.min(3, q2)] = 1; }
    data.rng[key] = [lo, hi];
    if (data.qpf) v = sum / n;
    else { v = 0; for (var k = 3; k >= 1; k--) { var s = 0; for (var m = k; m <= 3; m++) s += cats[m]; if (s / n >= 0.25) { v = k; break; } } }
    data.vals[key] = v; return v;
  }

  // ---------- counties and states ----------
  var counties = {}, cellsDone = {}, usDone = null, states = null, statesP = null;
  function addCounties(j, detail) {
    j.features.forEach(function (ft) {
      var a = ft.attributes || {}, k = a.fips || a.countyname + a.state, old = counties[k];
      if (old && old.detail >= detail) return;
      var sh = shape(ft.geometry); if (!sh) return;
      sh.fips = k; sh.name = a.countyname; sh.st = a.state; sh.detail = detail;
      sh.lat = a.lat != null ? +a.lat : (sh.bb[1] + sh.bb[3]) / 2; sh.lon = a.lon != null ? +a.lon : (sh.bb[0] + sh.bb[2]) / 2;
      counties[k] = sh;
      if (old && data) delete data.vals[k];
    });
  }
  function countyQuery(env, off, offset) {
    return REF + "2/query?where=1%3D1&geometry=" + env.join("%2C") + "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects" +
      "&outFields=countyname,state,fips,lat,lon&returnGeometry=true&outSR=4326&geometryPrecision=3&maxAllowableOffset=" + off + "&resultOffset=" + offset + "&f=json";
  }
  function loadPaged(env, off, detail, offset) {
    return getJSON(countyQuery(env, off, offset || 0)).then(function (j) {
      addCounties(j, detail);
      if (j.exceededTransferLimit && (offset || 0) < 6000) return loadPaged(env, off, detail, (offset || 0) + j.features.length);
    });
  }
  // counties for the current view: detailed 6°×4° cells when zoomed in, else all of CONUS simplified
  function needCounties() {
    var s = scaleZ(view.z), l = lonOf(view.x - W / s), r = lonOf(view.x + W / s), t = latOf(view.y - HH / s), b = latOf(view.y + HH / s), list = [];
    if (view.z < 5.5) {
      if (!usDone) usDone = loadPaged([-125, 24, -66.5, 49.5], 0.04, 1).then(paint, function (e) { usDone = null; throw e; });
      list.push(usDone);
    } else {
      for (var cx0 = Math.floor(l / 6) * 6; cx0 < r; cx0 += 6)
        for (var cy0 = Math.floor(b / 4) * 4; cy0 < t; cy0 += 4) {
          var k = cx0 + "," + cy0;
          if (!cellsDone[k]) cellsDone[k] = loadPaged([cx0, cy0, cx0 + 6, cy0 + 4], 0.008, 2).then(paint, (function (kk) { return function (e) { delete cellsDone[kk]; throw e; }; })(k));
          list.push(cellsDone[k]);
        }
    }
    if (!statesP) statesP = getJSON(REF + "3/query?where=1%3D1&outFields=state&returnGeometry=true&outSR=4326&geometryPrecision=2&maxAllowableOffset=0.05&f=json").then(function (j) {
      states = j.features.map(function (ft) { return shape(ft.geometry); }).filter(Boolean); paint();
    }, function (e) { statesP = null; throw e; });
    list.push(statesP);
    return Promise.all(list);
  }

  // ---------- map ----------
  var el, stage, cv, cx, ro, stat, reg;
  var W = 0, HH = 0, M = 0, SW = 0, SH = 0, dpr = 1, view = { x: 0, y: 0, z: 6.6 }, drawn = null, raf = 0;
  var loc = null, cur = { k: "qpf", p: 24, th: "04" }, data = null, gen = 0, on = false;
  // map settings (gear menu, saved as wx-oqset): place names, county lines, number size, map colours, 0 for dry counties
  var SET = { cities: true, lines: true, size: "m", theme: "auto", zeros: false }, setEl = null, gear = null;
  try { var sv = JSON.parse(localStorage.getItem("wx-oqset") || "null"); if (sv) Object.keys(SET).forEach(function (k) { if (sv[k] != null) SET[k] = sv[k]; }); } catch (e) {}
  function saveSet() { try { localStorage.setItem("wx-oqset", JSON.stringify(SET)); } catch (e) {} }
  function isDark() { return SET.theme === "dark" ? true : SET.theme === "light" ? false : dark(); }
  var GEAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/></svg>';
  function setRow(label, key, opts) {
    return '<div class="oqsr"><span>' + label + '</span><div>' + opts.map(function (o) {
      return '<button type="button" class="chip' + (SET[key] === o[0] ? " on" : "") + '" data-sk="' + key + '" data-sv="' + o[0] + '">' + o[1] + "</button>";
    }).join("") + "</div></div>";
  }
  function setUI() {
    setEl.innerHTML = '<div class="oqst">Map settings</div>' +
      setRow("Cities &amp; towns", "cities", [[true, "Show"], [false, "Hide"]]) +
      setRow("County lines", "lines", [[true, "Show"], [false, "Hide"]]) +
      setRow("Number size", "size", [["s", "S"], ["m", "M"], ["l", "L"]]) +
      setRow("Map colors", "theme", [["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]]) +
      setRow("Dry counties", "zeros", [[false, "Blank"], [true, "Show 0"]]);
  }
  function mk(t, c, p) { var e = document.createElement(t); e.className = c; p.appendChild(e); return e; }
  function setup() {
    el = document.createElement("div"); el.className = "mm oqmap";
    stage = mk("div", "mmst", el);
    cv = mk("canvas", "mml", stage); cx = cv.getContext("2d");
    stat = mk("div", "mmstat", el); ro = mk("div", "mmro", el); reg = mk("div", "mmreg", el);
    stat.hidden = true; ro.hidden = true;
    gear = mk("button", "oqgear", el); gear.type = "button"; gear.innerHTML = GEAR; gear.setAttribute("aria-label", "Map settings");
    setEl = mk("div", "oqset", el); setEl.hidden = true;
    gear.addEventListener("click", function () { setEl.hidden = !setEl.hidden; if (!setEl.hidden) setUI(); });
    setEl.addEventListener("click", function (e) {
      var b = e.target.closest("[data-sk]"); if (!b) return;
      var k = b.dataset.sk, v = b.dataset.sv; SET[k] = v === "true" ? true : v === "false" ? false : v;
      saveSet(); setUI(); paint();
    });
    reg.innerHTML = '<button type="button" data-z="7.6">Local</button><button type="button" data-z="6.6">Region</button><button type="button" data-z="us">U.S.</button>';
    reg.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; var z = b.dataset.z; if (z === "us") fly(wx(-96.5), wy(38.5), 3.9); else fly(wx(loc.lon), wy(loc.lat), +z); });
    if (VM) VM.init(function () { paint(); }, function () { if (on) paint(); });
    new ResizeObserver(size).observe(el);
    if (root.matchMedia) root.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { paint(); });
    gestures();
  }
  function size() {
    var r = el.getBoundingClientRect(); if (!r.width) return;
    W = Math.round(r.width); HH = Math.round(r.height); M = Math.round(Math.max(W, HH) * 0.2); SW = W + 2 * M; SH = HH + 2 * M; dpr = Math.min(2, root.devicePixelRatio || 1);
    stage.style.cssText = "left:" + -M + "px;top:" + -M + "px;width:" + SW + "px;height:" + SH + "px";
    cv.width = Math.round(SW * dpr); cv.height = Math.round(SH * dpr);
    drawn = null; paint();
  }
  function paint() { if (on && !raf) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0; if (!on || !W) return;
    drawn = { x: view.x, y: view.y, z: view.z }; stage.style.transform = "";
    draw();
  }
  function toScr(lat, lon) { var s = scaleZ(drawn.z); return { x: (wx(lon) - drawn.x) * s + SW / 2, y: (wy(lat) - drawn.y) * s + SH / 2 }; }
  function viewLL() { var s = scaleZ(drawn.z); return [lonOf(drawn.x - SW / 2 / s), latOf(drawn.y + SH / 2 / s), lonOf(drawn.x + SW / 2 / s), latOf(drawn.y - SH / 2 / s)]; }
  function draw() {
    var dk = isDark(), ink = dk ? "#fff" : "#000", s = scaleZ(drawn.z), k = s * dpr / K, V = viewLL();
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = dk ? "#000" : "#fff"; cx.fillRect(0, 0, cv.width, cv.height);
    var vis = function (bb) { return !(bb[2] < V[0] || bb[0] > V[2] || bb[3] < V[1] || bb[1] > V[3]); };
    var list = Object.keys(counties).map(function (f) { return counties[f]; }).filter(function (c) { return vis(c.bb); });
    cx.setTransform(k, 0, 0, k, (SW / 2 - drawn.x * s) * dpr, (SH / 2 - drawn.y * s) * dpr);
    cx.lineJoin = "round";
    // county lines, then state lines over them
    if (drawn.z >= 4.6 && SET.lines) {
      var cp = new Path2D(); list.forEach(function (c) { cp.addPath(c.path); });
      cx.strokeStyle = dk ? "rgba(255,255,255,.34)" : "rgba(0,0,0,.30)"; cx.lineWidth = (drawn.z < 6 ? 0.5 : 0.75) * dpr / k; cx.stroke(cp);
    }
    if (states) { var sp = new Path2D(); states.forEach(function (st) { if (vis(st.bb)) sp.addPath(st.path); }); cx.strokeStyle = ink; cx.lineWidth = (drawn.z < 5 ? 1 : 1.4) * dpr / k; cx.stroke(sp); }
    cx.setTransform(1, 0, 0, 1, 0, 0);
    // place names from the OpenFreeMap tiles (the radar's base map), each a dot with its name beside it: cities first,
    //   then the county numbers around them (nudged a line up or down if a city is in the way), then towns in the gaps
    var vm = SET.cities && VM && VM.ok(), sl = vm && slots(VM.tileZoom(drawn.z));
    var po = function (cls, avoid) {
      var r = VM.drawTop(cx, sl, { dark: dk, dpr: dpr, z: drawn.z, w: SW, h: SH, placesOnly: true, classes: cls, avoid: avoid,
        text: dk ? "rgba(255,255,255,.86)" : "rgba(0,0,0,.8)", halo: dk ? "rgba(0,0,0,.95)" : "rgba(255,255,255,.95)" });
      cx.setTransform(1, 0, 0, 1, 0, 0); return r || avoid;
    };
    var boxes = vm ? po({ city: 1 }, []) : [];
    if (data) boxes = labels(list, ink, dk, boxes);
    if (vm) po({ town: 1, village: 1 }, boxes);
    if (loc) {
      var m = toScr(loc.lat, loc.lon);
      cx.beginPath(); cx.arc(m.x * dpr, m.y * dpr, 4.5 * dpr, 0, 2 * Math.PI); cx.lineWidth = 2 * dpr; cx.strokeStyle = dk ? "#000" : "#fff"; cx.stroke();
      cx.fillStyle = "#1a73e8"; cx.fill();
    }
  }
  // county numbers: biggest first, skipping overlaps; text size grows a little with zoom
  function labels(list, ink, dk, taken) {
    var size = Math.max(9.5, Math.min(14, 9.5 + (drawn.z - 5.5) * 1.6)) * ({ s: 0.85, l: 1.2 }[SET.size] || 1), boxes = (taken || []).slice(), items = [];
    list.forEach(function (c) {
      var v = countyVal(c), dry = data.qpf ? v < 0.005 : !v; if (dry && !SET.zeros) return;
      var p = toScr(c.lat, c.lon); if (p.x < 0 || p.y < 0 || p.x > SW || p.y > SH) return;
      items.push({ v: dry ? -1 : v, x: p.x, y: p.y, t: dry ? (data.qpf ? "0" : "0%") : data.qpf ? amt(v) : CATL[v], dry: dry });
    });
    items.sort(function (a, b) { return b.v - a.v; });
    cx.textAlign = "center"; cx.textBaseline = "middle"; cx.lineJoin = "round";
    cx.font = "600 " + (size * dpr).toFixed(1) + "px -apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif";
    items.forEach(function (it) {
      var w = cx.measureText(it.t).width / dpr, bx = null;
      var free = function (b) { for (var i = 0; i < boxes.length; i++) { var q = boxes[i]; if (b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0) return false; } return true; };
      [0, 1.15, -1.15].some(function (dy) { var y = it.y + dy * size, b = { x0: it.x - w / 2 - 1.5, x1: it.x + w / 2 + 1.5, y0: y - size * 0.6, y1: y + size * 0.6 }; if (free(b)) { bx = b; it.y = y; return true; } return false; });
      if (!bx) return;
      boxes.push(bx);
      cx.strokeStyle = dk ? "#000" : "#fff"; cx.lineWidth = 3 * dpr; cx.strokeText(it.t, it.x * dpr, it.y * dpr);
      cx.fillStyle = it.dry ? (dk ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.45)") : ink; cx.fillText(it.t, it.x * dpr, it.y * dpr);
    });
    return boxes;
  }
  function slots(zt) {
    var n = Math.pow(2, zt), s = scaleZ(drawn.z), out = [];
    var l = drawn.x - SW / 2 / s, r = drawn.x + SW / 2 / s, t = drawn.y - SH / 2 / s, b = drawn.y + SH / 2 / s;
    var px = function (x) { return Math.round(((x - drawn.x) * s + SW / 2) * dpr); }, py = function (y) { return Math.round(((y - drawn.y) * s + SH / 2) * dpr); };
    for (var j = Math.max(0, Math.floor(t * n)); j <= Math.min(n - 1, Math.floor(b * n)); j++)
      for (var i = Math.floor(l * n); i <= Math.floor(r * n); i++) out.push({ i: i, j: j, n: n, z: zt, x0: px(i / n), y0: py(j / n), x1: px((i + 1) / n), y1: py((j + 1) / n) });
    return out;
  }
  function countyAt(lat, lon) {
    var hit = null;
    Object.keys(counties).forEach(function (f) { var c = counties[f], b = c.bb; if (!hit && lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && inRings(c.rings, lon, lat)) hit = c; });
    return hit;
  }
  function valueAt(lat, lon) {
    if (!data) return null;
    var c = countyAt(lat, lon); if (!c) return null;
    var v = countyVal(c), nm = c.name + ", " + c.st + ": ";
    if (data.qpf) {
      if (v < 0.005) return nm + "under .01 in";
      // the WPC bands the county spans, e.g. ".25–.75 in", and its average
      var r = data.rng[c.fips] || [0, 0], a = r[0] ? QL[r[0] - 1] : 0, z = QL[r[1]];
      return nm + (a ? num(a) : "0") + (z != null ? "–" + num(z) : "+") + " in" + (v >= 0.1 ? " (avg " + amt(v) + ")" : "");
    }
    var what = cur.k === "ice" ? '0.25"+ ice' : +cur.th + '"+ snow';
    return nm + (v ? CATLONG[v] : "under 10%") + " chance of " + what;
  }
  function status(t) { stat.textContent = t || ""; stat.hidden = !t; }

  // ---------- gestures (CSS transform while moving, redraw at the end) ----------
  var pts = new Map(), g0 = null, moved = false, tween = 0, lastTap = 0, settleT = 0;
  function at(sx, sy) { var s = scaleZ(view.z); return { x: view.x + (sx - W / 2) / s, y: view.y + (sy - HH / 2) / s }; }
  function setView(x, y, z) {
    view.z = Math.max(2.5, Math.min(10, z)); view.x = x; var s = scaleZ(view.z), hh2 = HH / 2 / s; view.y = Math.max(hh2 - 0.02, Math.min(1.02 - hh2, y));
    if (!drawn) return paint();
    var k = Math.pow(2, view.z - drawn.z), tx = (drawn.x - view.x) * s, ty = (drawn.y - view.y) * s;
    stage.style.transform = "translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px) scale(" + k.toFixed(4) + ")";
    if (Math.abs(tx) > M * 0.8 || Math.abs(ty) > M * 0.8 || k < 0.8 || k > 1.6) settle();
  }
  function settle() { clearTimeout(settleT); settleT = setTimeout(function () { paint(); needCounties().catch(function () {}); }, 0); }
  function fly(x, y, z) {
    cancelAnimationFrame(tween); ro.hidden = true; var a = { x: view.x, y: view.y, z: view.z }, t0 = performance.now();
    (function stepT(t) { var f = Math.min(1, (t - t0) / 380), e = f * (2 - f); setView(a.x + (x - a.x) * e, a.y + (y - a.y) * e, a.z + (z - a.z) * e); if (f < 1) tween = requestAnimationFrame(stepT); else settle(); })(t0);
  }
  function snap() {
    var a = Array.from(pts.values()), n = a.length; if (!n) return null;
    var cx0 = a.reduce(function (s, p) { return s + p.x; }, 0) / n, cy0 = a.reduce(function (s, p) { return s + p.y; }, 0) / n;
    var d = n > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0, r = el.getBoundingClientRect();
    return { n: n, cx: cx0, cy: cy0, d: d, z: view.z, w: at(cx0 - r.left, cy0 - r.top) };
  }
  function gestures() {
    el.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button") || e.target.closest(".oqset")) return;
      if (!setEl.hidden) { setEl.hidden = true; return; } // a tap on the map closes the menu
      el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); cancelAnimationFrame(tween);
      g0 = snap(); moved = false; ro.hidden = true;
    });
    el.addEventListener("pointermove", function (e) {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      var g = snap(); if (!g0 || g.n !== g0.n) { g0 = g; return; }
      if (Math.abs(g.cx - g0.cx) + Math.abs(g.cy - g0.cy) > 4 || g.n > 1) moved = true;
      if (!moved) return;
      var z = g0.z + (g.n > 1 && g0.d > 0 ? Math.log2(g.d / g0.d) : 0), s = scaleZ(z), r = el.getBoundingClientRect();
      setView(g0.w.x - (g.cx - r.left - W / 2) / s, g0.w.y - (g.cy - r.top - HH / 2) / s, z);
    });
    var end = function (e) {
      if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId);
      if (pts.size) { g0 = snap(); return; }
      var r = el.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (!moved && e.type === "pointerup") {
        var now = Date.now();
        if (now - lastTap < 300) { var w = at(sx, sy); fly(view.x + (w.x - view.x) * 0.5, view.y + (w.y - view.y) * 0.5, view.z + 1); lastTap = 0; return; }
        lastTap = now; var w2 = at(sx, sy); showRO(latOf(w2.y), lonOf(w2.x), sx, sy);
      }
      if (moved) settle();
      g0 = null;
    };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    el.addEventListener("wheel", function (e) {
      e.preventDefault(); var r = el.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, w = at(sx, sy), z = view.z - e.deltaY * (e.deltaMode ? 0.05 : 0.0022);
      var s = scaleZ(Math.max(2.5, Math.min(10, z))); setView(w.x - (sx - W / 2) / s, w.y - (sy - HH / 2) / s, z); clearTimeout(settleT); settleT = setTimeout(settle, 160);
    }, { passive: false });
  }
  function showRO(lat, lon, sx, sy) {
    var v = valueAt(lat, lon); if (v == null) { ro.hidden = true; return; }
    ro.textContent = v; ro.hidden = false;
    ro.style.left = Math.max(6, Math.min(W - ro.offsetWidth - 6, sx - ro.offsetWidth / 2)) + "px"; ro.style.top = Math.max(6, sy - 38) + "px";
  }

  // one line under the map saying what the numbers are (no colour key)
  function caption(s) {
    if (s.k === "qpf") return "Numbers: each county's average forecast precipitation, inches of liquid (rain + melted snow); <.1 = .01 to .10. Tap a county for its range.";
    return "Numbers: each county's chance of " + (s.k === "ice" ? '0.25"+ ice' : +s.th + '"+ snow') + " (10% = 10–39%, 40% = 40–69%, 70% = 70%+). Blank or 0%: under 10%.";
  }

  // show(host, place, { k, p, th }) → Promise of { start, end, issue } once drawn; rejects if the data can't load
  //   (the caller then shows WPC's image instead)
  function show(host, l, s, controlsHost) {
    if (!el) setup();
    if (el.parentNode !== host) host.appendChild(el);
    (controlsHost || el).appendChild(reg);
    var moved2 = !loc || Math.abs(loc.lat - l.lat) > 1e-4 || Math.abs(loc.lon - l.lon) > 1e-4;
    loc = { lat: l.lat, lon: l.lon };
    if (moved2) view = { x: wx(loc.lon), y: wy(loc.lat), z: view.z || 6.6 };
    var L = layerOf(s), same = data && data.key === L.svc + "/" + L.id;
    cur = { k: s.k, p: s.p, th: s.th || "04" }; on = true; ro.hidden = true;
    if (!same) data = null;
    status(data ? "" : "Loading…"); size(); paint();
    var g = ++gen;
    return Promise.all([loadProduct(L), needCounties()]).then(function (r) {
      if (g !== gen) return null;
      data = r[0]; status(""); paint();
      return { start: data.start, end: data.end, issue: data.issue };
    }, function (e) { if (g === gen) { data = null; status(""); } throw e; });
  }
  root.WXOfficial = {
    show: show, caption: caption,
    hide: function () { on = false; },
    // for check.html: fetch and parse one product without drawing it
    _probe: function (s) { return loadProduct(layerOf(s)).then(function (d) { return { start: d.start, end: d.end, issue: d.issue }; }); },
    _value: function (lat, lon) { return valueAt(lat, lon); },
    _labels: function () { var n = 0; Object.keys(counties).forEach(function (f) { var c = counties[f]; if (data && (data.qpf ? countyVal(c) >= 0.005 : countyVal(c))) n++; }); return { counties: Object.keys(counties).length, withValue: n }; }
  };
})(typeof self !== "undefined" ? self : this);
