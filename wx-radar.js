// Radar tab: a small dependency-free slippy map drawn on three stacked canvases (base map, radar, labels).
//   Radar: the NEXRAD base-reflectivity mosaic for the lower 48 (NWS Level III N0Q, ~1 km, every 5 min) as map
//   tiles from the Iowa Environmental Mesonet, the last 50 minutes in 11 frames. When the tile server allows
//   pixel access (CORS), each tile's colours are read back to reflectivity (dBZ) and redrawn in a smooth palette;
//   otherwise the NWS colours are drawn as served. Tiles are drawn with bilinear smoothing and frames crossfade.
//   Base map and labels: Esri Canvas (dark or light grey to match the theme).
(function (root) {
  "use strict";
  var TS = 256, MINZ = 3, MAXZ = 12, RMAX = 8, NF = 11, STEP = 5 * 60000;
  var IEM = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/";
  var META = "https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json";
  var ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/";
  var el, cvB, cvR, cvL, cxB, cxR, cxL, ui = {}, W = 0, HH = 0, dpr = 1, on = false, opts = {};
  var view = { x: 0.5, y: 0.5, z: 7 }, home = null;
  var cache = new Map(), tick = 0, corsOK = null, style = "smooth";
  var frames = null, pending = null, cur = NF - 1, frac = 0, playing = false, ph = 0, userPaused = false;
  var need = 0, raf = 0, lastT = 0, refreshT = 0;
  try { style = localStorage.getItem("wx-radar-style") || "smooth"; } catch (e) {}

  // ---------- projection (web mercator, x/y in 0..1) ----------
  function mx(lon) { return (lon + 180) / 360; }
  function my(lat) { var s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); }
  function scale() { return TS * Math.pow(2, view.z); }
  function dark() {
    var t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : !!(root.matchMedia && root.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  // ---------- palettes ----------
  // NWS reflectivity colours (dBZ → rgb), used to read a served tile back to dBZ: each pixel is projected onto this
  //   colour ramp and takes the dBZ of the nearest point on it.
  var NWS = [[5, 4, 233, 231], [10, 1, 159, 244], [15, 3, 0, 244], [20, 2, 253, 2], [25, 1, 197, 1], [30, 0, 142, 0], [35, 253, 248, 2],
    [40, 229, 188, 0], [45, 253, 149, 0], [50, 253, 0, 0], [55, 212, 0, 0], [60, 188, 0, 0], [65, 248, 0, 253], [70, 152, 84, 198], [75, 253, 253, 253]];
  // smooth display palette: dBZ, r, g, b, alpha (light returns fade in; blues for rain, yellow→red→magenta for the cores)
  var SMOOTH = [[8, 110, 180, 255, 0], [14, 110, 180, 255, 0.34], [20, 86, 156, 252, 0.6], [28, 52, 112, 238, 0.8], [35, 34, 76, 206, 0.9],
    [40, 250, 206, 64, 0.93], [46, 255, 146, 42, 0.95], [52, 240, 66, 52, 0.97], [58, 214, 36, 112, 1], [64, 188, 64, 222, 1], [72, 255, 226, 255, 1]];
  function ramp(P, v) {
    if (v <= P[0][0]) return P[0].slice(1);
    for (var i = 1; i < P.length; i++) if (v <= P[i][0]) {
      var a = P[i - 1], b = P[i], t = (v - a[0]) / (b[0] - a[0]);
      return a.slice(1).map(function (x, k) { return x + (b[k + 1] - x) * t; });
    }
    return P[P.length - 1].slice(1);
  }
  function toDbz(r, g, b) {
    var best = 1e9, dbz = null;
    for (var i = 1; i < NWS.length; i++) {
      var a = NWS[i - 1], c = NWS[i], vx = c[1] - a[1], vy = c[2] - a[2], vz = c[3] - a[3], L = vx * vx + vy * vy + vz * vz;
      var t = Math.max(0, Math.min(1, ((r - a[1]) * vx + (g - a[2]) * vy + (b - a[3]) * vz) / L));
      var dx = r - (a[1] + vx * t), dy = g - (a[2] + vy * t), dz = b - (a[3] + vz * t), d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; dbz = a[0] + (c[0] - a[0]) * t; }
    }
    return best < 110 * 110 ? dbz : null; // not a reflectivity colour (map furniture, missing-data grey)
  }
  var LUT = new Map();
  function recolor(im) {
    var c = document.createElement("canvas"); c.width = im.naturalWidth || TS; c.height = im.naturalHeight || TS;
    var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0);
    var d = x.getImageData(0, 0, c.width, c.height), p = d.data; // throws if the server doesn't allow CORS
    for (var i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      var k = (p[i] << 16) | (p[i + 1] << 8) | p[i + 2], o = LUT.get(k);
      if (o === undefined) {
        var z = toDbz(p[i], p[i + 1], p[i + 2]);
        o = z == null ? null : ramp(SMOOTH, z).map(function (v, j) { return j < 3 ? Math.round(v) : Math.round(v * 255); });
        LUT.set(k, o);
      }
      if (!o) { p[i + 3] = 0; continue; }
      p[i] = o[0]; p[i + 1] = o[1]; p[i + 2] = o[2]; p[i + 3] = Math.round(o[3] * p[i + 3] / 255);
    }
    x.putImageData(d, 0, 0); return c;
  }

  // ---------- tiles ----------
  function get(key, url, radar) {
    var e = cache.get(key); if (e) { e.t = ++tick; return e; }
    e = { t: ++tick }; cache.set(key, e); load(e, url, radar, corsOK !== false && radar);
    if (cache.size > 700) { // drop the least recently drawn
      var all = Array.from(cache.entries()).sort(function (a, b) { return a[1].t - b[1].t; });
      for (var i = 0; i < 200; i++) cache.delete(all[i][0]);
    }
    return e;
  }
  function load(e, url, radar, cors) {
    var im = new Image(); im.decoding = "async"; if (cors) im.crossOrigin = "anonymous";
    im.onload = function () {
      e.raw = im;
      if (radar && cors) { try { e.sm = recolor(im); corsOK = true; } catch (x) { corsOK = false; } }
      if (radar && !cors && e.corsFail) corsOK = false; // loads fine without CORS: the server just doesn't allow pixel access
      e.ok = true; paint(radar ? 2 : 5);
    };
    im.onerror = function () {
      if (cors) { e.corsFail = true; load(e, url, radar, false); return; }
      e.err = true; paint(0);
    };
    im.src = url;
  }
  function img(e) { return !e || !e.ok ? null : style === "smooth" && e.sm ? e.sm : e.raw; }
  function baseUrl(kind, z, x, y) { return ESRI + (dark() ? "World_Dark_Gray_" : "World_Light_Gray_") + kind + "/MapServer/tile/" + z + "/" + y + "/" + x; }
  function radarUrl(f, k, z, x, y) { return IEM + f.layers[k] + "/" + z + "/" + x + "/" + y + ".png?b=" + f.bucket; }

  // visible tile range at tile zoom zt: [{i, j, x0, y0, x1, y1}] in device pixels (edges rounded so tiles never overlap)
  function visible(zt) {
    var n = Math.pow(2, zt), s = scale(), out = [];
    var l = view.x - W / 2 / s, r = view.x + W / 2 / s, t = view.y - HH / 2 / s, b = view.y + HH / 2 / s;
    for (var j = Math.max(0, Math.floor(t * n)); j <= Math.min(n - 1, Math.floor(b * n)); j++)
      for (var i = Math.floor(l * n); i <= Math.floor(r * n); i++) {
        var px = function (wx) { return Math.round(((wx - view.x) * s + W / 2) * dpr); }, py = function (wy) { return Math.round(((wy - view.y) * s + HH / 2) * dpr); };
        out.push({ i: i, j: j, n: n, z: zt, x0: px(i / n), y0: py(j / n), x1: px((i + 1) / n), y1: py((j + 1) / n) });
      }
    return out;
  }
  // draw one tile, or the nearest loaded ancestor's matching quarter while it loads
  function drawTile(ctx, v, getE) {
    var i = ((v.i % v.n) + v.n) % v.n;
    for (var d = 0; d <= 4 && v.z - d >= 0; d++) {
      var e = getE(v.z - d, i >> d, v.j >> d, d === 0), im = img(e);
      if (!im) continue;
      var sz = (im.width || im.naturalWidth) / (1 << d), sx = (i - ((i >> d) << d)) * sz, sy = (v.j - ((v.j >> d) << d)) * sz;
      ctx.drawImage(im, sx, sy, sz, sz, v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
      return true;
    }
    return false;
  }
  function peek(key) { var e = cache.get(key); if (e) e.t = ++tick; return e; }
  function layerGet(kind) {
    var th = dark() ? "d" : "l";
    return function (z, x, y, request) { var k = kind + th + z + "/" + x + "/" + y; return request ? get(k, baseUrl(kind, z, x, y), false) : peek(k); };
  }
  function radarGet(f, k) {
    return function (z, x, y, request) { var key = "r" + f.bucket + ":" + k + ":" + z + "/" + x + "/" + y; return request ? get(key, radarUrl(f, k, z, x, y), true) : peek(key); };
  }
  function tz() { return Math.max(0, Math.min(16, Math.round(view.z))); }
  function rz() { return Math.max(MINZ, Math.min(RMAX, Math.round(view.z))); }

  // ---------- drawing ----------
  function paint(bits) { need |= bits || 7; if (on && !raf) raf = requestAnimationFrame(frame); }
  function drawBase() {
    cxB.fillStyle = dark() ? "#1e1e1e" : "#e8e8e6"; cxB.fillRect(0, 0, cvB.width, cvB.height);
    var g = layerGet("Base"); visible(tz()).forEach(function (v) { drawTile(cxB, v, g); });
  }
  function drawLabels() {
    cxL.clearRect(0, 0, cvL.width, cvL.height);
    var g = layerGet("Reference"); visible(tz()).forEach(function (v) { drawTile(cxL, v, g); });
    if (home) { // location dot
      var s = scale(), x = ((home.x - view.x) * s + W / 2) * dpr, y = ((home.y - view.y) * s + HH / 2) * dpr;
      cxL.beginPath(); cxL.arc(x, y, 9 * dpr, 0, 7); cxL.fillStyle = "rgba(47,125,246,.22)"; cxL.fill();
      cxL.beginPath(); cxL.arc(x, y, 5.5 * dpr, 0, 7); cxL.fillStyle = "#fff"; cxL.fill();
      cxL.beginPath(); cxL.arc(x, y, 4 * dpr, 0, 7); cxL.fillStyle = "#2F7DF6"; cxL.fill();
    }
  }
  // two frames blended exactly: A at (1-f) and B at f with additive compositing = a linear crossfade
  function drawRadar() {
    cxR.globalCompositeOperation = "source-over"; cxR.globalAlpha = 1; cxR.clearRect(0, 0, cvR.width, cvR.height);
    if (!frames) return;
    cxR.imageSmoothingEnabled = true; cxR.imageSmoothingQuality = "high";
    var vs = visible(rz()), a = cur, b = (cur + 1) % NF, f = playing || frac ? frac : 0;
    cxR.globalCompositeOperation = "lighter";
    [[a, 1 - f], [b, f]].forEach(function (p) {
      if (p[1] <= 0.001) return;
      cxR.globalAlpha = p[1]; var g = radarGet(frames, p[0]);
      vs.forEach(function (v) { drawTile(cxR, v, g); });
    });
    cxR.globalCompositeOperation = "source-over"; cxR.globalAlpha = 1;
  }
  function frame(ts) {
    raf = 0; if (!on) return;
    var dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
    if (playing) { advance(dt); need |= 2; }
    if (inertia) { stepInertia(dt); }
    if (tween) { stepTween(ts); }
    if (need & 1) drawBase();
    if (need & 2) drawRadar();
    if (need & 4) drawLabels();
    if (need) { need = 0; timeUi(); }
    checkPending();
    if (playing || inertia || tween) raf = requestAnimationFrame(frame); else lastT = 0;
  }

  // ---------- frames and playback ----------
  function makeFrames(valid) {
    var bucket = Math.floor(Date.now() / STEP), layers = [];
    for (var k = 0; k < NF; k++) { var m = (NF - 1 - k) * 5; layers.push("nexrad-n0q-900913" + (m ? "-m" + (m < 10 ? "0" : "") + m + "m" : "")); }
    return { bucket: bucket, layers: layers, valid: valid || null };
  }
  function loadFrames() {
    var f = makeFrames(null);
    fetch(META + "?b=" + f.bucket).then(function (r) { return r.json(); }).then(function (j) {
      var v = Date.parse(j && j.meta && j.meta.valid); if (isFinite(v)) { f.valid = v; paint(0); timeUi(); }
    }).catch(function () {});
    if (!frames) { frames = f; preload(); paint(2); } else { pending = f; preload(); }
  }
  // request every frame's visible tiles so playback never waits on the network
  function preload() {
    [frames, pending].forEach(function (f) { if (!f) return; var vs = visible(rz()); for (var k = 0; k < NF; k++) { var g = radarGet(f, k); vs.forEach(function (v) { g(v.z, ((v.i % v.n) + v.n) % v.n, v.j, true); }); } });
  }
  function ready(f) {
    var vs = visible(rz()), n = 0, ok = 0;
    for (var k = 0; k < NF; k++) vs.forEach(function (v) { var e = peek("r" + f.bucket + ":" + k + ":" + v.z + "/" + (((v.i % v.n) + v.n) % v.n) + "/" + v.j); n++; if (e && (e.ok || e.err)) ok++; });
    return n ? ok / n : 1;
  }
  function checkPending() {
    if (pending && ready(pending) >= 1) { frames = pending; pending = null; paint(2); }
    var r = frames ? ready(frames) : 0;
    status(outUS ? "Radar mosaic covers the lower 48 states" : r < 1 ? "Loading radar… " + Math.round(r * 100) + "%" : "");
    if (r >= 1 && !playing && !userPaused && !started) { started = true; if (!reduced()) play(true); }
  }
  var started = false, outUS = false;
  function reduced() { return root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function advance(dt) {
    ph += dt; var d = cur === NF - 1 ? 1.8 : 0.62, fade = 0.26;
    if (ph >= d) { ph -= d; cur = (cur + 1) % NF; d = cur === NF - 1 ? 1.8 : 0.62; }
    frac = ph > d - fade ? smooth((ph - (d - fade)) / fade) : 0;
  }
  function play(p) {
    playing = p; ui.play.innerHTML = p ? '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';
    ui.play.setAttribute("aria-label", p ? "Pause" : "Play");
    if (p) { ph = 0; frac = 0; if (cur === NF - 1) cur = 0; }
    paint(2);
  }
  function timeUi() {
    if (!ui.time) return;
    var pos = cur + frac, k = Math.round(pos) % NF, ago = (NF - 1 - k) * 5;
    ui.range.value = pos > NF - 1 ? NF - 1 : pos;
    var abs = frames && frames.valid ? (opts.fmtTime ? opts.fmtTime(frames.valid - ago * 60000) : new Date(frames.valid - ago * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) : "";
    ui.time.textContent = (abs ? abs + " · " : "") + (ago ? ago + " min ago" : "Latest");
  }
  function status(t) { if (ui.stat.textContent !== t) { ui.stat.textContent = t; ui.stat.hidden = !t; } }

  // ---------- gestures ----------
  var pts = new Map(), g0 = null, inertia = null, tween = null, lastTap = 0, samples = [];
  function worldAt(sx, sy) { var s = scale(); return { x: view.x + (sx - W / 2) / s, y: view.y + (sy - HH / 2) / s }; }
  function zoomAt(sx, sy, z) {
    z = Math.max(MINZ, Math.min(MAXZ, z)); var w = worldAt(sx, sy); view.z = z;
    var s = scale(); view.x = w.x - (sx - W / 2) / s; view.y = w.y - (sy - HH / 2) / s; clampView();
  }
  function clampView() { view.y = Math.max(0.05, Math.min(0.95, view.y)); view.x = ((view.x % 1) + 1) % 1; }
  function moved() { paint(7); clearTimeout(moved.t); moved.t = setTimeout(preload, 150); }
  function local(e) { var r = cvL.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function gesture() {
    var p = Array.from(pts.values());
    if (p.length === 1) g0 = { n: 1, x: p[0].x, y: p[0].y, vx: view.x, vy: view.y };
    else if (p.length >= 2) g0 = { n: 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, m: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }, z: view.z, w: null };
    if (g0 && g0.n === 2) g0.w = worldAt(g0.m.x, g0.m.y);
  }
  function wire() {
    var t = cvL;
    t.addEventListener("pointerdown", function (e) {
      t.setPointerCapture(e.pointerId); var p = local(e); pts.set(e.pointerId, p); inertia = null; tween = null;
      if (pts.size === 1) { samples = [{ x: p.x, y: p.y, t: e.timeStamp }]; t._down = { x: p.x, y: p.y, t: e.timeStamp }; }
      gesture();
    });
    t.addEventListener("pointermove", function (e) {
      if (!pts.has(e.pointerId)) return; var p = local(e); pts.set(e.pointerId, p);
      var ps = Array.from(pts.values()), s = scale();
      if (g0 && g0.n === 1 && ps.length === 1) {
        view.x = g0.vx - (p.x - g0.x) / s; view.y = g0.vy - (p.y - g0.y) / s; clampView();
        samples.push({ x: p.x, y: p.y, t: e.timeStamp }); if (samples.length > 6) samples.shift();
      } else if (g0 && g0.n === 2 && ps.length >= 2) {
        var d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), m = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
        view.z = Math.max(MINZ, Math.min(MAXZ, g0.z + Math.log2(d / g0.d))); var s2 = scale();
        view.x = g0.w.x - (m.x - W / 2) / s2; view.y = g0.w.y - (m.y - HH / 2) / s2; clampView();
      }
      moved();
    });
    function up(e) {
      if (!pts.has(e.pointerId)) return; var p = local(e), d0 = t._down; pts.delete(e.pointerId);
      if (pts.size === 0) {
        var tap = d0 && Math.hypot(p.x - d0.x, p.y - d0.y) < 8 && e.timeStamp - d0.t < 300;
        if (tap) { if (e.timeStamp - lastTap < 320) { zoomTo(p.x, p.y, Math.round(view.z) + 1); lastTap = 0; } else lastTap = e.timeStamp; }
        else if (g0 && g0.n === 1 && samples.length > 1) {
          var a = samples[0], b = samples[samples.length - 1], dt = Math.max(16, b.t - a.t);
          if (e.timeStamp - b.t < 80) { inertia = { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt }; paint(0); }
        }
        g0 = null;
      } else gesture();
    }
    t.addEventListener("pointerup", up); t.addEventListener("pointercancel", up);
    t.addEventListener("wheel", function (e) {
      e.preventDefault(); var p = local(e), k = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0022;
      zoomAt(p.x, p.y, view.z - e.deltaY * k); moved();
    }, { passive: false });
  }
  function stepInertia(dt) {
    var ms = dt * 1000, s = scale(); view.x -= inertia.vx * ms / s; view.y -= inertia.vy * ms / s; clampView();
    var k = Math.exp(-ms / 260); inertia.vx *= k; inertia.vy *= k; need |= 7;
    if (Math.hypot(inertia.vx, inertia.vy) < 0.02) { inertia = null; preload(); }
  }
  function zoomTo(sx, sy, z) { tween = { sx: sx, sy: sy, z0: view.z, z1: Math.max(MINZ, Math.min(MAXZ, z)), t0: 0 }; paint(0); }
  function stepTween(ts) {
    if (!tween.t0) tween.t0 = ts; var t = Math.min(1, (ts - tween.t0) / 260);
    zoomAt(tween.sx, tween.sy, tween.z0 + (tween.z1 - tween.z0) * smooth(t)); need |= 7;
    if (t >= 1) { tween = null; preload(); }
  }
  function recenter(animate) {
    if (!home) return; view.x = home.x; view.y = home.y; if (!animate) view.z = 7; paint(7); preload();
  }

  // ---------- setup ----------
  function build(host) {
    el = host; el.innerHTML =
      '<canvas class="rl rb"></canvas><canvas class="rl rr"></canvas><canvas class="rl rt"></canvas>' +
      '<div class="rstat" hidden></div>' +
      '<button type="button" class="rleg" aria-label="Switch radar colours"><i></i><span class="rlt"><b>Light</b><b>Heavy</b></span><em></em></button>' +
      '<button type="button" class="rloc" aria-label="Back to your location"><svg viewBox="0 0 24 24"><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" class="f"/></svg></button>' +
      '<div class="rbar"><button type="button" class="rplay" aria-label="Play"></button><input type="range" class="rrange" min="0" max="' + (NF - 1) + '" step="0.01" value="' + (NF - 1) + '" aria-label="Radar time"><span class="rtime num"></span></div>';
    var cs = el.querySelectorAll("canvas"); cvB = cs[0]; cvR = cs[1]; cvL = cs[2];
    cxB = cvB.getContext("2d"); cxR = cvR.getContext("2d"); cxL = cvL.getContext("2d");
    ui = { stat: el.querySelector(".rstat"), play: el.querySelector(".rplay"), range: el.querySelector(".rrange"), time: el.querySelector(".rtime"), leg: el.querySelector(".rleg") };
    ui.play.addEventListener("click", function () { userPaused = playing; play(!playing); started = true; });
    ui.range.addEventListener("input", function () { var v = +ui.range.value; playing && play(false); userPaused = true; started = true; cur = Math.min(NF - 1, Math.floor(v)); frac = v - cur; if (cur === NF - 1) frac = 0; paint(2); });
    el.querySelector(".rloc").addEventListener("click", function () { recenter(false); });
    ui.leg.addEventListener("click", function () {
      if (corsOK === false) return;
      style = style === "smooth" ? "nws" : "smooth"; try { localStorage.setItem("wx-radar-style", style); } catch (e) {}
      legend(); paint(2);
    });
    legend(); play(false); wire();
    new ResizeObserver(size).observe(el);
    if (root.matchMedia) root.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { paint(7); });
  }
  function legend() {
    var P = style === "smooth" && corsOK !== false ? SMOOTH : NWS.map(function (s) { return s.concat(1); });
    ui.leg.querySelector("i").style.background = "linear-gradient(90deg," + P.filter(function (s) { return s[0] >= 10; }).map(function (s) {
      return "rgba(" + s[1] + "," + s[2] + "," + s[3] + "," + Math.max(0.35, s[4]) + ")"; }).join(",") + ")";
    ui.leg.querySelector("em").textContent = corsOK === false ? "NWS colours" : style === "smooth" ? "Smooth" : "NWS colours";
  }
  function size() {
    var r = el.getBoundingClientRect(); if (!r.width) return;
    W = r.width; HH = r.height; dpr = Math.min(3, root.devicePixelRatio || 1);
    [cvB, cvR, cvL].forEach(function (c) { c.width = Math.round(W * dpr); c.height = Math.round(HH * dpr); });
    paint(7); preload();
  }

  var api = {
    // show the radar in `host` centred on {lat, lon}; opts.fmtTime(ms) formats frame times in the location's zone
    show: function (host, loc, o) {
      opts = o || {};
      if (el !== host) build(host);
      var h = { x: mx(loc.lon), y: my(loc.lat) }, changed = !home || Math.abs(h.x - home.x) > 1e-6 || Math.abs(h.y - home.y) > 1e-6;
      home = h; if (changed) { view.x = h.x; view.y = h.y; view.z = 7; }
      outUS = !(loc.lat > 24 && loc.lat < 50.5 && loc.lon > -126 && loc.lon < -66);
      on = true; size();
      if (!frames || Math.floor(Date.now() / STEP) !== frames.bucket) loadFrames();
      clearInterval(refreshT); refreshT = setInterval(function () { if (on && !pending) loadFrames(); }, STEP);
      paint(7);
    },
    hide: function () { on = false; playing && play(false); started = false; userPaused = false; clearInterval(refreshT); if (raf) cancelAnimationFrame(raf); raf = 0; },
    refresh: function () { if (on) loadFrames(); },
    // for the live data check
    _state: function () { return { corsOK: corsOK, frames: frames && frames.layers.length, valid: frames && frames.valid, ready: frames ? ready(frames) : 0, view: view, playing: playing, cur: cur, frac: frac }; },
    _dbz: toDbz
  };
  root.WXRadar = api;
})(this);
