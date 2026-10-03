// Official NWS precipitation map for the Forecast tab: the Weather Prediction Center's own forecast polygons, drawn on
//   the same canvas base map as the model viewer (wx-vmap.js) instead of WPC's GIF images. Data: NOAA's GIS map
//   services (mapservices.weather.noaa.gov, ArcGIS REST, queried as JSON in lat/lon):
//   - precip/wpc_qpf: official QPF, layer 1 = 24-hour Day 1, layer 8 = 48-hour Days 1–2; one multipolygon per contour
//     level (field qpf, inches), and the levels are exclusive bands (each has holes where the next level starts), so
//     each is filled even-odd and a tap reads the one band holding the point;
//   - precip/wpc_prob_winter_precip: official chance of 4/8/12"+ snow (Day 1 layers 1/2/3, Day 2 layers 6/7/8) and
//     0.25"+ ice (Day 1 layer 4, Day 2 layer 9); field outlook = "Slight (10-39%)", "Moderate (40-69%)", "High (70-100%)"
//     or "Less than 10 percent".
//   start_time/end_time (UTC) give the forecast period. If the service can't be reached the caller falls back to WPC's
//   images. Pan, pinch, wheel and double-tap zoom like the model maps; tap for the value at a point.
(function (root) {
  "use strict";
  var BASE = "https://mapservices.weather.noaa.gov/vector/rest/services/precip/";
  var D2R = Math.PI / 180, TS = 256, K = 1e4, TTL = 30 * 60000;
  var VM = root.WXVMap;
  // WPC's own QPF colours (from the service's renderer)
  var QL = [[0.01, "127,255,0"], [0.1, "0,255,0"], [0.25, "8,139,0"], [0.5, "16,78,139"], [0.75, "30,144,255"], [1, "0,178,238"], [1.25, "0,238,238"], [1.5, "137,104,205"],
    [1.75, "145,44,238"], [2, "139,0,139"], [2.5, "139,0,0"], [3, "255,0,0"], [4, "238,64,0"], [5, "255,127,0"], [7, "206,133,0"], [10, "255,215,0"], [15, "255,255,0"], [20, "255,192,183"]];
  var CAT = { snow: [null, "125,182,255", "36,98,228", "128,40,190"], ice: [null, "255,170,215", "226,80,165", "140,16,104"] };
  var CATL = [null, "10–39%", "40–69%", "70%+"];

  function wx(lon) { return (lon + 180) / 360; }
  function wy(lat) { var s = Math.sin(Math.max(-85, Math.min(85, lat)) * D2R); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); }
  function lonOf(x) { return x * 360 - 180; }
  function latOf(y) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / D2R; }
  function scaleZ(z) { return TS * Math.pow(2, z); }
  function utc(s) { var m = /(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/.exec(s || ""); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null; }
  function dark() { var t = document.documentElement.dataset.theme; return t ? t === "dark" : !!(root.matchMedia && root.matchMedia("(prefers-color-scheme: dark)").matches); }
  function num(v) { return v < 1 ? v.toFixed(2).replace(/^0/, "") : String(+v.toFixed(2)); }

  // ---------- data ----------
  function layerOf(s) {
    var d = s.p === 48 ? 2 : 1;
    if (s.k === "qpf") return { svc: "wpc_qpf", id: d === 2 ? 8 : 1, f: "qpf" };
    if (s.k === "ice") return { svc: "wpc_prob_winter_precip", id: d === 2 ? 9 : 4, f: "outlook" };
    return { svc: "wpc_prob_winter_precip", id: (d === 2 ? 5 : 0) + ({ "04": 1, "08": 2, "12": 3 }[s.th] || 1), f: "outlook" };
  }
  var cache = {};
  function load(L) {
    var key = L.svc + "/" + L.id, c = cache[key];
    if (c && (c.p || Date.now() - c.t < TTL)) return c.p || Promise.resolve(c.d);
    var url = BASE + L.svc + "/MapServer/" + L.id + "/query?where=1%3D1&outFields=" + L.f + ",start_time,end_time,issue_time" +
      "&returnGeometry=true&outSR=4326&geometryPrecision=3&maxAllowableOffset=0.03&f=json";
    var ac = root.AbortController ? new AbortController() : null, to = setTimeout(function () { if (ac) ac.abort(); }, 25000);
    var p = fetch(url, ac ? { signal: ac.signal } : {}).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (j) {
      clearTimeout(to);
      if (!j || j.error || !Array.isArray(j.features)) throw new Error("bad reply");
      var d = prep(j.features, L.f);
      cache[key] = { t: Date.now(), d: d }; return d;
    }).catch(function (e) { clearTimeout(to); delete cache[key]; throw e; });
    cache[key] = { p: p }; return p;
  }
  // features → { list: [{ v, rings (world units), path, bb }], start, end, issue }, lowest level first
  function prep(fs, f) {
    var out = { list: [], start: null, end: null, issue: null };
    fs.forEach(function (ft) {
      var a = ft.attributes || {}, g = ft.geometry;
      if (out.start == null) { out.start = utc(a.start_time); out.end = utc(a.end_time); out.issue = utc(a.issue_time); }
      var v;
      if (f === "qpf") v = +a.qpf; else { var m = /(\d+)\s*-\s*\d+/.exec(a.outlook || ""), lo = m ? +m[1] : 0; v = lo >= 70 ? 3 : lo >= 40 ? 2 : lo >= 10 ? 1 : 0; }
      if (!(v > 0) || !g || !g.rings) return;
      var rings = [], path = new Path2D(), bb = [Infinity, Infinity, -Infinity, -Infinity];
      g.rings.forEach(function (r) {
        if (r.length < 3) return;
        var w = new Float64Array(r.length * 2);
        for (var i = 0; i < r.length; i++) {
          var x = wx(r[i][0]), y = wy(r[i][1]); w[2 * i] = x; w[2 * i + 1] = y;
          if (i) path.lineTo(x * K, y * K); else path.moveTo(x * K, y * K);
          if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
        }
        path.closePath(); rings.push(w);
      });
      if (rings.length) out.list.push({ v: v, rings: rings, path: path, bb: bb });
    });
    out.list.sort(function (p, q) { return p.v - q.v; });
    return out;
  }
  function inRings(rings, x, y) {
    var c = false;
    rings.forEach(function (w) {
      for (var i = 0, n = w.length / 2, j = n - 1; i < n; j = i++) {
        var xi = w[2 * i], yi = w[2 * i + 1], xj = w[2 * j], yj = w[2 * j + 1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
      }
    });
    return c;
  }
  function colorOf(v) {
    if (cur.k === "qpf") { var c = QL[0][1]; QL.forEach(function (l) { if (v >= l[0] - 1e-6) c = l[1]; }); return "rgb(" + c + ")"; }
    return "rgb(" + CAT[cur.k][v] + ")";
  }

  // ---------- map ----------
  var el, stage, cvB, cvF, cvT, cvO, cxB, cxF, cxT, cxO, ro, stat, reg;
  var W = 0, HH = 0, M = 0, SW = 0, SH = 0, dpr = 1, view = { x: 0, y: 0, z: 5.2 }, drawn = null, raf = 0;
  var loc = null, cur = { k: "qpf", p: 24, th: "04" }, data = null, gen = 0, on = false;
  function mk(t, c, p) { var e = document.createElement(t); e.className = c; p.appendChild(e); return e; }
  function setup() {
    el = document.createElement("div"); el.className = "mm oqmap";
    stage = mk("div", "mmst", el);
    [cvB, cvF, cvT, cvO] = [0, 1, 2, 3].map(function (i) { return mk("canvas", "mml" + (i === 1 ? " oqf" : ""), stage); });
    cxB = cvB.getContext("2d"); cxF = cvF.getContext("2d"); cxT = cvT.getContext("2d"); cxO = cvO.getContext("2d");
    stat = mk("div", "mmstat", el); ro = mk("div", "mmro", el); reg = mk("div", "mmreg", el);
    stat.hidden = true; ro.hidden = true;
    reg.innerHTML = '<button type="button" data-z="7">Local</button><button type="button" data-z="5.2">Region</button><button type="button" data-z="us">U.S.</button>';
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
    [cvB, cvF, cvT, cvO].forEach(function (c) { c.width = Math.round(SW * dpr); c.height = Math.round(SH * dpr); });
    drawn = null; paint();
  }
  function paint() { if (on && !raf) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0; if (!on || !W) return;
    drawn = { x: view.x, y: view.y, z: view.z }; stage.style.transform = "";
    drawBase(); drawField(); drawTop(); drawOver();
  }
  function slots(zt) {
    var n = Math.pow(2, zt), s = scaleZ(drawn.z), out = [];
    var l = drawn.x - SW / 2 / s, r = drawn.x + SW / 2 / s, t = drawn.y - SH / 2 / s, b = drawn.y + SH / 2 / s;
    var px = function (x) { return Math.round(((x - drawn.x) * s + SW / 2) * dpr); }, py = function (y) { return Math.round(((y - drawn.y) * s + SH / 2) * dpr); };
    for (var j = Math.max(0, Math.floor(t * n)); j <= Math.min(n - 1, Math.floor(b * n)); j++)
      for (var i = Math.floor(l * n); i <= Math.floor(r * n); i++) out.push({ i: i, j: j, n: n, z: zt, x0: px(i / n), y0: py(j / n), x1: px((i + 1) / n), y1: py((j + 1) / n) });
    return out;
  }
  function vec() { return VM && VM.ok(); }
  function drawBase() {
    cxB.setTransform(1, 0, 0, 1, 0, 0);
    if (vec()) VM.drawBase(cxB, slots(VM.tileZoom(drawn.z)), { dark: dark(), dpr: dpr, z: drawn.z });
    else { cxB.fillStyle = dark() ? "#000" : "#f3f3f1"; cxB.fillRect(0, 0, cvB.width, cvB.height); }
  }
  function drawTop() {
    cxT.setTransform(1, 0, 0, 1, 0, 0); cxT.clearRect(0, 0, cvT.width, cvT.height);
    if (vec()) VM.drawTop(cxT, slots(VM.tileZoom(drawn.z)), { dark: dark(), dpr: dpr, z: drawn.z, w: SW, h: SH });
  }
  function drawField() {
    cxF.setTransform(1, 0, 0, 1, 0, 0); cxF.clearRect(0, 0, cvF.width, cvF.height);
    if (!data) return;
    var s = scaleZ(drawn.z), k = s * dpr / K, l = drawn.x - SW / 2 / s, r = drawn.x + SW / 2 / s, t = drawn.y - SH / 2 / s, b = drawn.y + SH / 2 / s;
    cxF.setTransform(k, 0, 0, k, (SW / 2 - drawn.x * s) * dpr, (SH / 2 - drawn.y * s) * dpr);
    data.list.forEach(function (p) {
      if (p.bb[2] < l || p.bb[0] > r || p.bb[3] < t || p.bb[1] > b) return;
      cxF.fillStyle = colorOf(p.v); cxF.fill(p.path, "evenodd");
    });
    cxF.setTransform(1, 0, 0, 1, 0, 0);
  }
  function drawOver() {
    cxO.setTransform(1, 0, 0, 1, 0, 0); cxO.clearRect(0, 0, cvO.width, cvO.height);
    if (!loc) return;
    var s = scaleZ(drawn.z), x = ((wx(loc.lon) - drawn.x) * s + SW / 2) * dpr, y = ((wy(loc.lat) - drawn.y) * s + SH / 2) * dpr;
    cxO.beginPath(); cxO.arc(x, y, 5.5 * dpr, 0, 2 * Math.PI);
    cxO.fillStyle = "#1a73e8"; cxO.fill(); cxO.lineWidth = 2 * dpr; cxO.strokeStyle = "#fff"; cxO.stroke();
  }
  function valueAt(lat, lon) {
    if (!data) return null;
    var x = wx(lon), y = wy(lat), hit = 0;
    data.list.forEach(function (p) { if (x >= p.bb[0] && x <= p.bb[2] && y >= p.bb[1] && y <= p.bb[3] && inRings(p.rings, x, y)) hit = Math.max(hit, p.v); });
    var conus = lat > 24 && lat < 50 && lon > -125.5 && lon < -66;
    if (cur.k === "qpf") {
      if (!hit) return conus ? "Under .01 in" : null;
      var i = 0; QL.forEach(function (l, j) { if (Math.abs(l[0] - hit) < 1e-6) i = j; });
      return QL[i + 1] ? num(hit) + "–" + num(QL[i + 1][0]) + " in" : num(hit) + "+ in";
    }
    var what = cur.k === "ice" ? '0.25"+ ice' : +cur.th + '"+ snow';
    if (!hit) return conus ? "Under 10% chance of " + what : null;
    return CATL[hit] + " chance of " + what;
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
  function settle() { clearTimeout(settleT); settleT = setTimeout(paint, 0); }
  function fly(x, y, z) {
    cancelAnimationFrame(tween); var a = { x: view.x, y: view.y, z: view.z }, t0 = performance.now();
    (function stepT(t) { var f = Math.min(1, (t - t0) / 380), e = f * (2 - f); setView(a.x + (x - a.x) * e, a.y + (y - a.y) * e, a.z + (z - a.z) * e); if (f < 1) tween = requestAnimationFrame(stepT); else settle(); })(t0);
  }
  function snap() {
    var a = Array.from(pts.values()), n = a.length; if (!n) return null;
    var cx = a.reduce(function (s, p) { return s + p.x; }, 0) / n, cy = a.reduce(function (s, p) { return s + p.y; }, 0) / n;
    var d = n > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0, r = el.getBoundingClientRect();
    return { n: n, cx: cx, cy: cy, d: d, z: view.z, w: at(cx - r.left, cy - r.top) };
  }
  function gestures() {
    el.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button")) return;
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

  // ---------- legend ----------
  function legendHTML(k) {
    if (k === "qpf") {
      var n = QL.length, show = { 0.01: 1, 0.25: 1, 0.5: 1, 1: 1, 1.5: 1, 2: 1, 3: 1, 5: 1, 10: 1, 20: 1 };
      return '<div class="mlbar">' + QL.map(function (l) { return '<b style="background:rgb(' + l[1] + ')"></b>'; }).join("") + "</div>" +
        '<div class="mlticks">' + QL.map(function (l, i) { return show[l[0]] ? '<span style="left:' + (i / n * 100).toFixed(2) + '%">' + num(l[0]) + "</span>" : ""; }).join("") + "</div>" +
        '<div class="mlunit">in (liquid)</div>';
    }
    return '<div class="oqcats">' + [1, 2, 3].map(function (c) { return '<span><i style="background:rgb(' + CAT[k][c] + ')"></i>' + CATL[c] + "</span>"; }).join("") + "</div>";
  }

  // show(host, place, { k, p, th }) → Promise of { start, end, issue } once drawn; rejects if the data can't load
  //   (the caller then shows WPC's image instead)
  function show(host, l, s) {
    if (!el) setup();
    if (el.parentNode !== host) host.appendChild(el);
    var moved2 = !loc || Math.abs(loc.lat - l.lat) > 1e-4 || Math.abs(loc.lon - l.lon) > 1e-4;
    loc = { lat: l.lat, lon: l.lon };
    if (moved2) view = { x: wx(loc.lon), y: wy(loc.lat), z: view.z || 5.2 };
    var same = data && cur.k === s.k && cur.p === s.p && (s.k !== "snow" || cur.th === s.th);
    cur = { k: s.k, p: s.p, th: s.th || "04" }; on = true; ro.hidden = true;
    if (!same) data = null;
    status(data ? "" : "Loading…"); size(); paint();
    var g = ++gen;
    return load(layerOf(cur)).then(function (d) {
      if (g !== gen) return null;
      data = d; status(""); paint();
      return { start: d.start, end: d.end, issue: d.issue, n: d.list.length };
    }, function (e) { if (g === gen) { data = null; status(""); } throw e; });
  }
  root.WXOfficial = {
    show: show, legend: legendHTML,
    hide: function () { on = false; },
    // for check.html: fetch and parse one product without drawing it
    _probe: function (s) { return load(layerOf(s)).then(function (d) { return { start: d.start, end: d.end, issue: d.issue, n: d.list.length, levels: d.list.map(function (p) { return p.v; }) }; }); },
    _value: function (lat, lon) { return valueAt(lat, lon); }
  };
})(typeof self !== "undefined" ? self : this);
