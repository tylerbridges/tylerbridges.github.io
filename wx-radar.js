// Radar tab: a small dependency-free slippy map drawn on three stacked canvases (base map, radar, labels).
//   Radar, first choice: NOAA MRMS (Multi-Radar Multi-Sensor, lower 48, 1 km, every 2 min) from NCEP's GeoServer:
//   quality-controlled base reflectivity plus MRMS precipitation type, requested as WMS tiles for 11 frames over the
//   last hour. Each pixel's colour is decoded back to its exact value using the layers' own legends (fetched as JSON),
//   then redrawn by type: rain in greens → yellow → red, snow in white → light blue → blue, hail cores magenta.
//   Fallback (if NCEP can't be reached or doesn't allow pixel access): the NWS NEXRAD N0Q mosaic from the Iowa
//   Environmental Mesonet, read back to dBZ from IEM's exact N0Q colour table and drawn in the rain palette (no type).
//   Radar is requested one zoom level coarser than the map and drawn with bilinear smoothing; frames crossfade.
//   Base map and labels: Esri Canvas (dark or light grey to match the theme).
(function (root) {
  "use strict";
  var TS = 256, MINZ = 3, MAXZ = 12, RMAX = 8, NF = 11, STEP = 5 * 60000;
  var IEM = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/";
  var META = "https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json";
  var OG = "https://opengeo.ncep.noaa.gov/geoserver/conus/", REF = "conus_bref_qcd", TYP = "conus_pcpn_typ";
  var ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/";
  // this same file also runs as a background worker (decoding and smoothing radar tiles, storm-motion matching) so
  //   that heavy work never blocks drawing: INW is true inside the worker
  var INW = typeof document === "undefined", SELF = !INW && document.currentScript ? document.currentScript.src : null;
  var el, stage, cvB, cvR, cvL, cxB, cxR, cxL, ui = {}, W = 0, HH = 0, SW = 0, SH = 0, MG = 0, dpr = 1, rdpr = 1, ldpr = 1, on = false, opts = {};
  // rv: the view the canvases were last drawn at. While a finger moves the map, only a CSS transform on the canvas
  //   stage changes (composited by the browser at the display's full refresh rate); the canvases are redrawn when the
  //   gesture ends or the stage's spare margin runs out.
  //   Each layer keeps its own drawn view (RV.B base, RV.R radar, RV.L lines+labels) and its own transform, so when
  //   the margin runs low the layers are redrawn on separate frames (never all three at once), well before the edge
  //   shows. `rv` points at the view being drawn right now.
  var RV = { B: { x: 0.5, y: 0.5, z: 7 }, R: { x: 0.5, y: 0.5, z: 7 }, L: { x: 0.5, y: 0.5, z: 7 } }, rv = RV.R, redraws = 0;
  function at(v, fn) { var o = rv; rv = v; try { return fn(); } finally { rv = o; } }
  var view = { x: 0.5, y: 0.5, z: 7 }, home = null;
  var cache = new Map(), tick = 0, corsOK = null, style = "smooth";
  var frames = null, pending = null, cur = NF - 1, frac = 0, playing = false, ph = 0, userPaused = false;
  var need = 0, raf = 0, lastT = 0, refreshT = 0, LAYERS = [];
  try { style = localStorage.getItem("wx-radar-style") || "smooth"; } catch (e) {}

  // ---------- projection (web mercator, x/y in 0..1) ----------
  function mx(lon) { return (lon + 180) / 360; }
  function my(lat) { var s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); }
  function scale() { return TS * Math.pow(2, view.z); }
  function rscale() { return TS * Math.pow(2, rv.z); }
  function dark() {
    var t = document.documentElement.getAttribute("data-theme");
    return t ? t === "dark" : !!(root.matchMedia && root.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  // ---------- palettes ----------
  // NWS reflectivity colours (dBZ → rgb), used to read a served tile back to dBZ: each pixel is projected onto this
  //   colour ramp and takes the dBZ of the nearest point on it.
  var NWS = [[5, 4, 233, 231], [10, 1, 159, 244], [15, 3, 0, 244], [20, 2, 253, 2], [25, 1, 197, 1], [30, 0, 142, 0], [35, 253, 248, 2],
    [40, 229, 188, 0], [45, 253, 149, 0], [50, 253, 0, 0], [55, 212, 0, 0], [60, 188, 0, 0], [65, 248, 0, 253], [70, 152, 84, 198], [75, 253, 253, 253]];
  // display palettes by precipitation type: dBZ, r, g, b, alpha (the lightest returns fade in)
  var RAIN = [[10, 120, 214, 120, 0], [15, 120, 214, 120, 0.42], [20, 76, 190, 88, 0.68], [28, 34, 156, 62, 0.84], [35, 18, 118, 48, 0.9],
    [40, 246, 214, 52, 0.93], [45, 255, 156, 32, 0.95], [50, 236, 58, 40, 0.97], [56, 178, 18, 40, 1], [62, 222, 44, 196, 1], [70, 255, 222, 255, 1]];
  var SNOW = [[5, 236, 246, 255, 0], [10, 236, 246, 255, 0.5], [18, 196, 226, 255, 0.72], [26, 132, 188, 250, 0.86], [33, 78, 138, 238, 0.93], [42, 44, 88, 206, 1]];
  var HAIL = [[30, 18, 118, 48, 0.9], [45, 255, 156, 32, 0.95], [52, 236, 58, 40, 1], [58, 222, 44, 196, 1], [70, 255, 222, 255, 1]];
  var MINDBZ = 10; // below this is mostly clutter and drizzle-level noise: not drawn in the smooth style
  function pack(c) { return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), Math.round(c[3] * 255)]; }
  function ramp(P, v) {
    if (v <= P[0][0]) return P[0].slice(1);
    for (var i = 1; i < P.length; i++) if (v <= P[i][0]) {
      var a = P[i - 1], b = P[i], t = (v - a[0]) / (b[0] - a[0]);
      return a.slice(1).map(function (x, k) { return x + (b[k + 1] - x) * t; });
    }
    return P[P.length - 1].slice(1);
  }
  // colour → value along a colour ramp [[value, r, g, b], …]: the value at the nearest point on the ramp, or null
  //   when no ramp colour is within `tol` (map furniture, missing-data grey)
  function project(P, r, g, b, tol) {
    var best = 1e9, v = null;
    if (P.length === 1) { var q = P[0]; best = (r - q[1]) * (r - q[1]) + (g - q[2]) * (g - q[2]) + (b - q[3]) * (b - q[3]); v = q[0]; }
    for (var i = 1; i < P.length; i++) {
      var a = P[i - 1], c = P[i], vx = c[1] - a[1], vy = c[2] - a[2], vz = c[3] - a[3], L = vx * vx + vy * vy + vz * vz || 1;
      var t = Math.max(0, Math.min(1, ((r - a[1]) * vx + (g - a[2]) * vy + (b - a[3]) * vz) / L));
      var dx = r - (a[1] + vx * t), dy = g - (a[2] + vy * t), dz = b - (a[3] + vz * t), d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; v = a[0] + (c[0] - a[0]) * t; }
    }
    return best <= tol * tol ? v : null;
  }
  function toDbz(r, g, b) { return project(NWS, r, g, b, 110); }
  // MRMS legends: reflectivity is a colour ramp (value → colour, interpolated); precipitation type is exact colours
  //   per class. Built from GeoServer's JSON legend so the decoding matches NCEP's own styling exactly.
  var REFP = null, TYPC = null;
  function hex(c) { c = String(c || "").replace("#", ""); return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; }
  function entries(j) {
    var out = [];
    (function walk(o) { if (!o || typeof o !== "object") return; if (Array.isArray(o.entries) && o.entries.length && o.entries[0].color) { out = out.concat(o.entries); return; } Object.keys(o).forEach(function (k) { walk(o[k]); }); })(j);
    return out;
  }
  function typeOf(label, q) {
    var t = String(label || "").toLowerCase();
    if (/no ?precip|no ?coverage|missing|none/.test(t) || q === 0 || q < 0) return null;
    if (/snow/.test(t) || q === 3) return "s";
    if (/hail/.test(t) || q === 7) return "h";
    return "r";
  }
  var LREF = new Map(), LTYP = new Map();
  function refDbz(r, g, b) { var k = (r << 16) | (g << 8) | b, v = LREF.get(k); if (v === undefined) { v = project(REFP, r, g, b, 40); LREF.set(k, v); } return v; }
  function typAt(r, g, b) {
    var k = (r << 16) | (g << 8) | b, v = LTYP.get(k);
    if (v === undefined) { var best = 1e9; v = null; TYPC.forEach(function (c) { var d = (r - c[0]) * (r - c[0]) + (g - c[1]) * (g - c[1]) + (b - c[2]) * (b - c[2]); if (d < best) { best = d; v = c[3]; } }); if (best > 30 * 30) v = null; LTYP.set(k, v); }
    return v;
  }
  function mk(w, h) { if (INW) return new OffscreenCanvas(w, h); var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  var EMPTY = INW ? {} : mk(1, 1); // a tile with nothing to draw
  function pixels(im) {
    var c = mk(TS, TS);
    var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(im, 0, 0, TS, TS);
    return { c: c, x: x, d: x.getImageData(0, 0, TS, TS) }; // getImageData throws if the server doesn't allow CORS
  }
  // colour tables per type (index: dBZ×2, 0–99.5 dBZ) as packed RGBA words for direct writes into image data
  var PALS = null;
  function pal() {
    if (PALS) return PALS;
    var le = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    PALS = [RAIN, RAIN, SNOW, HAIL].map(function (P) {
      var a = new Uint32Array(200);
      for (var i = 0; i < 200; i++) { var c = pack(ramp(P, i / 2)); a[i] = le ? ((c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0 : ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) >>> 0; }
      return a;
    });
    return PALS;
  }
  // Smooth rendering: decode every pixel to its value (dBZ) and type, then resample the value field at twice the
  //   resolution with bilinear interpolation and colour each output pixel from its value: smooth contour edges
  //   instead of blocky 1 km pixels, with colours that still come from the measured values. No extra blur: in a
  //   comparison against single-site NEXRAD Level II, blurring shaved storm cores (fewer 35+ dBZ areas shown) for no
  //   gain in average accuracy. Type is nearest-pixel.
  function smoothTile(im, dec, imT) {
    var R = pixels(im), p = R.d.data, q = imT ? pixels(imT).d.data : null, N = TS, LOW = MINDBZ - 12;
    var f = new Float32Array(N * N), ty = new Uint8Array(N * N), any = false;
    for (var i = 0, k = 0; k < N * N; k++, i += 4) {
      var z = p[i + 3] ? dec(p[i], p[i + 1], p[i + 2]) : null;
      f[k] = z == null ? LOW : Math.max(LOW, z); if (z != null && z >= MINDBZ - 4) any = true;
      if (z != null) { var t = q ? (q[i + 3] ? typAt(q[i], q[i + 1], q[i + 2]) : null) : "r"; ty[k] = t === "s" ? 2 : t === "h" ? 3 : 1; }
    }
    if (!any) return EMPTY; // nothing to draw (most tiles)
    var M = N * 2, c = mk(M, M);
    var h = f, x, y;
    var cx = c.getContext("2d"), out = cx.createImageData(M, M), d32 = new Uint32Array(out.data.buffer), L = pal();
    for (y = 0; y < M; y++) {
      var sy = Math.max(0, Math.min(N - 1.001, (y + 0.5) / 2 - 0.5)), y0 = sy | 0, fy = sy - y0;
      for (x = 0; x < M; x++) {
        var sx = Math.max(0, Math.min(N - 1.001, (x + 0.5) / 2 - 0.5)), x0 = sx | 0, fx = sx - x0, a = y0 * N + x0;
        var v = (h[a] * (1 - fx) + h[a + 1] * fx) * (1 - fy) + (h[a + N] * (1 - fx) + h[a + N + 1] * fx) * fy;
        if (v < MINDBZ) continue;
        var tk = ty[((sy + 0.5) | 0) * N + ((sx + 0.5) | 0)] || ty[a] || ty[a + 1] || ty[a + N] || ty[a + N + 1] || 1;
        d32[y * M + x] = L[tk][Math.min(199, (v * 2) | 0)];
      }
    }
    cx.putImageData(out, 0, 0); return c;
  }
  // MRMS: reflectivity tile + type tile → one smooth, type-coloured tile
  function compose(imR, imT) { return smoothTile(imR, refDbz, imT || null); }
  // IEM fallback: reflectivity only (read back from the NWS colour ramp), drawn in the rain palette
  // The IEM mosaic tiles use IEM's own 255-colour N0Q table (index i = -32 + (i-1)/2 dBZ, 0.5 dBZ steps; from
  //   mesonet.agron.iastate.edu/GIS/rasters.php?rid=2), not the 15-colour NWS ramp, so pixels are decoded against
  //   that exact table: an exact colour match, else the nearest table colour if it is close.
  var IEMP = "85718f85728f86738d87758b87768b887789897987897a878a7b858b7d848b7e848c7f828d81808d82808e837e8f847c8f857c90877b918879918979928b77938d759691539894579b975b9d9a60a09d64a3a068a5a36da8a671aaa976adac7ab0af7eb2b283b7b88cbabb90bdbe94bfc199c2c49dc4c7a2c7caa6cacdaaccd0afd2d4b4cfd2b4c9ccb4c6c9b4c3c7b4c0c4b4bdc1b4b9beb4b6bbb4b3b9b4b0b6b4adb3b4aab0b4a4abb4a0a8b49da5b49aa2b497a0b4949db4919ab4949bb59098b48c95b38892b2808cb07c89af7886ae7483ac7080ab6c7daa6779a96376a85f73a75b70a6576da44f67a24b64a14761a0435e9f415b9e4361a24568a6486faa4a76ae4d7db24f84b6518bbb5699c3599fc75ba6cb5eadcf60b4d462bbd865c2dc67c9e06ad0e46fd6e868d6d759d6b352d6a24bd69043d67e3cd66d35d65b11d51811d11710cd1710c81610c4160fbc150fb7140eb3140eaf130eab130da6120da2120d9e110c99110c95100c91100b880f0b840e0a800e0a7c0d0a770d09730c096f0c096b0b08660b08620a095e09327308467d085b88076f9207849d0698a806adb205c1bd05d6c704ead204ffe200ffd800ffd300ffce00ffc900ffc400ffc000ffbb00ffb600ffb100ffac00ffa700ffa200ff9900ff9400ff8f00ff8a00ff8500ff8000ff0000f80000f10000ea0000e30000d50000cd0000c60000bf0000b80000b10000aa0000a300009b00009400008d00007f0000780000710000fffffffff5ffffeaffffdfffffd4ffffc9ffffbeffffb3ffff9dffff92ffff75fffc6bfdf960faf656f7f34bf4f040f1ed36efea2bece720e9e10be3b200ffac00fca400f79b00f49300ef8800ea8300e87900e27200dd6900db05ecf005ebf005eaf005dde005dce005dbe005cdd005ccd004bdc004bcc004bbc004aeb004adb0049ea0049da0049ca0038e90038d90038c90037e80037d80036f70036e70036d70025f60025e60024f50024e50024d50023f40023e40023d40013030012f30012020011f20011e203a67b53a66b53a65b53a64b53a63b53a62b5";
  var LIEM = new Map(), IEMC = null;
  function iemDbz(r, g, b) {
    var k = (r << 16) | (g << 8) | b, v = LIEM.get(k);
    if (v !== undefined) return v;
    if (!IEMC) { IEMC = []; for (var i = 0; i < IEMP.length / 6; i++) { var c = parseInt(IEMP.substr(i * 6, 6), 16); IEMC.push([c >> 16, (c >> 8) & 255, c & 255, -32 + i / 2]); LIEM.set(c, -32 + i / 2); } v = LIEM.get(k); if (v !== undefined) return v; }
    var best = 1e9; v = null;
    IEMC.forEach(function (c) { var d = (r - c[0]) * (r - c[0]) + (g - c[1]) * (g - c[1]) + (b - c[2]) * (b - c[2]); if (d < best) { best = d; v = c[3]; } });
    if (best > 24 * 24) v = null; LIEM.set(k, v); return v;
  }
  function recolor(im) { return smoothTile(im, iemDbz, null); }

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
    if (radar && cors && workers()) return loadW(e, url);
    if (Array.isArray(url)) return loadMrms(e, url);
    var im = new Image(); im.decoding = "async"; if (cors) im.crossOrigin = "anonymous";
    im.onload = function () {
      e.raw = im;
      if (radar && !cors && e.corsFail) corsOK = false; // loads fine without CORS: the server just doesn't allow pixel access
      if (radar && cors) work(function () { try { e.sm = recolor(im); corsOK = true; } catch (x) { corsOK = false; } e.ok = true; soon(2); });
      else { e.ok = true; soon(radar ? 2 : 5); }
    };
    im.onerror = function () {
      if (cors) { e.corsFail = true; load(e, url, radar, false); return; }
      e.err = true; paint(0);
    };
    im.src = url;
  }
  // MRMS tile: reflectivity and type images, composed once both are in (a missing type tile just means "rain")
  function loadMrms(e, urls) {
    var ims = [null, null], left = 2;
    function done() {
      if (--left) return;
      if (!ims[0]) { e.err = true; paint(0); return; }
      e.raw = ims[0];
      work(function () { try { e.sm = compose(ims[0], ims[1]); corsOK = true; } catch (x) { corsOK = false; } e.ok = true; soon(2); });
    }
    urls.forEach(function (u, k) {
      var im = new Image(); im.crossOrigin = "anonymous"; im.decoding = "async";
      im.onload = function () { ims[k] = im; done(); }; im.onerror = done; im.src = u;
    });
  }
  // Background workers (2, this same script): fetch the tile(s), decode and smooth them and hand back ready-to-draw
  //   bitmaps, so a big rain shield or a refresh never stalls playback or panning. Without worker support (or if a
  //   worker fails) the same code runs here on the main thread in small slices.
  var WK = null, wkI = 0, wid = 0, wjobs = {};
  function workers() {
    if (WK !== null) return WK;
    WK = false;
    if (!SELF || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return WK;
    try { WK = [0, 1].map(function () { var w = new Worker(SELF); w.onmessage = fromW; w.onerror = wFail; return w; }); cfgW(); } catch (x) { WK = false; }
    return WK;
  }
  function cfgW() { if (WK && REFP) WK.forEach(function (w) { w.postMessage({ cfg: { REFP: REFP, TYPC: TYPC } }); }); }
  function toW(m, cb, tr) { m.id = ++wid; wjobs[m.id] = { cb: cb, m: m }; WK[wkI++ % WK.length].postMessage(m, tr || []); }
  function fromW(ev) {
    var r = ev.data, j = wjobs[r.id]; if (!j) return; delete wjobs[r.id];
    if (r.nosupport) { wFail(); j.cb(null, true); return; }
    j.cb(r);
  }
  // a worker that can't run: stop using workers and redo whatever was waiting on them here
  function wFail(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (!WK) return; WK.forEach(function (w) { w.terminate(); }); WK = false;
    var js = wjobs; wjobs = {}; Object.keys(js).forEach(function (k) { js[k].cb(null, true); });
  }
  function loadW(e, url) {
    var mrms = Array.isArray(url);
    toW({ kind: "tile", urls: mrms ? url : [url], mrms: mrms }, function (r, redo) {
      if (redo) return load(e, url, true, true);
      if (r.err) { if (mrms) { e.err = true; soon(0); } else { e.corsFail = true; load(e, url, true, false); } return; }
      e.raw = r.raw; e.sm = r.empty ? EMPTY : r.sm; corsOK = true; e.ok = true; soon(2);
    });
  }
  // tile arrivals repaint right away while the map is still; mid-gesture they're batched (a few per second at most)
  var soonT = 0, soonB = 0, dirty = 0;
  function soon(b) {
    if (!(pts.size || inertia || tween)) return paint(b);
    soonB |= b; if (!soonT) soonT = setTimeout(function () { soonT = 0; dirty |= soonB; soonB = 0; paint(0); }, 180);
  }
  // smoothing runs in small slices (~10 ms per turn) so a big rain shield never freezes scrolling or the map
  var jobs = [], jobT = 0;
  function work(fn) { jobs.push(fn); if (!jobT) jobT = setTimeout(runJobs, 0); }
  function runJobs() {
    var t0 = performance.now(); jobT = 0;
    while (jobs.length && performance.now() - t0 < 10) jobs.shift()();
    if (jobs.length) jobT = setTimeout(runJobs, 0);
  }
  function img(e) { return !e || !e.ok ? null : style === "smooth" && e.sm ? e.sm : e.raw; }
  function baseUrl(kind, z, x, y) { return ESRI + (dark() ? "World_Dark_Gray_" : "World_Light_Gray_") + kind + "/MapServer/tile/" + z + "/" + y + "/" + x; }
  var E = 20037508.342789244;
  function wms(layer, time, z, x, y) {
    var sz = 2 * E / Math.pow(2, z), x0 = -E + x * sz, y1 = E - y * sz;
    return OG + layer + "/ows?service=WMS&version=1.1.1&request=GetMap&layers=" + layer + "&styles=&format=image/png&transparent=true&srs=EPSG:3857" +
      "&width=256&height=256&bbox=" + [x0, y1 - sz, x0 + sz, y1].map(function (v) { return v.toFixed(1); }).join(",") + "&time=" + new Date(time).toISOString().replace(".000Z", "Z");
  }
  function radarUrl(f, k, z, x, y) {
    if (f.src === "mrms") return [wms(REF, f.times[k], z, x, y), wms(TYP, f.times[k], z, x, y)];
    return IEM + f.layers[k] + "/" + z + "/" + x + "/" + y + ".png?b=" + f.bucket;
  }

  // visible tile range at tile zoom zt: [{i, j, x0, y0, x1, y1}] in device pixels (edges rounded so tiles never overlap)
  function visible(zt, dp) {
    dp = dp || dpr; var n = Math.pow(2, zt), s = rscale(), out = [];
    var l = rv.x - SW / 2 / s, r = rv.x + SW / 2 / s, t = rv.y - SH / 2 / s, b = rv.y + SH / 2 / s;
    for (var j = Math.max(0, Math.floor(t * n)); j <= Math.min(n - 1, Math.floor(b * n)); j++)
      for (var i = Math.floor(l * n); i <= Math.floor(r * n); i++) {
        var px = function (wx) { return Math.round(((wx - rv.x) * s + SW / 2) * dp); }, py = function (wy) { return Math.round(((wy - rv.y) * s + SH / 2) * dp); };
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
      if (im === EMPTY) return true;
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
    return function (z, x, y, request) { var key = rkey(f, k, z, x, y); return request ? get(key, radarUrl(f, k, z, x, y), true) : peek(key); };
  }
  function rkey(f, k, z, x, y) { return "r" + f.src + (f.times ? f.times[k] : f.bucket + ":" + k) + ":" + z + "/" + x + "/" + y; }
  function tz() { return Math.max(0, Math.min(16, Math.round(rv.z))); }
  // radar one level coarser than the map (smoother, and MRMS/NEXRAD mosaics are ~1 km anyway), native in NWS colours
  function rz() { return Math.max(MINZ, Math.min(RMAX, Math.round(rv.z) - (style === "smooth" ? 1 : 0))); }

  // ---------- drawing ----------
  function paint(bits) { need |= bits == null ? 7 : bits; if (on && !raf) raf = requestAnimationFrame(frame); }
  // base map: the vector map (wx-vmap.js) when its tiles can be reached — pure black land in dark mode, sharp lines
  //   and text at any zoom — otherwise Esri's raster tiles
  var VM = root.WXVMap;
  function vec() { return VM && VM.ok(); }
  function drawBase() {
    if (vec()) { VM.drawBase(cxB, visible(VM.tileZoom(rv.z)), { dark: dark(), dpr: dpr, z: rv.z }); return; }
    cxB.setTransform(1, 0, 0, 1, 0, 0); cxB.fillStyle = dark() ? "#000" : "#f3f3f1"; cxB.fillRect(0, 0, cvB.width, cvB.height);
    if (VM && !VM.failed()) return; // vector map still starting up
    var g = layerGet("Base"); visible(tz()).forEach(function (v) { drawTile(cxB, v, g); });
  }
  function drawLabels() {
    cxL.setTransform(1, 0, 0, 1, 0, 0); cxL.clearRect(0, 0, cvL.width, cvL.height);
    if (vec()) VM.drawTop(cxL, visible(VM.tileZoom(rv.z), ldpr), { dark: dark(), dpr: ldpr, z: rv.z, w: SW, h: SH });
    else if (!VM || VM.failed()) { var g = layerGet("Reference"); visible(tz(), ldpr).forEach(function (v) { drawTile(cxL, v, g); }); }
    if (home) { // location dot
      var s = rscale(), hx = home.x - rv.x, d = ldpr; hx -= Math.round(hx); var x = (hx * s + SW / 2) * d, y = ((home.y - rv.y) * s + SH / 2) * d;
      cxL.beginPath(); cxL.arc(x, y, 9 * d, 0, 7); cxL.fillStyle = "rgba(47,125,246,.22)"; cxL.fill();
      cxL.beginPath(); cxL.arc(x, y, 5.5 * d, 0, 7); cxL.fillStyle = "#fff"; cxL.fill();
      cxL.beginPath(); cxL.arc(x, y, 4 * d, 0, 7); cxL.fillStyle = "#2F7DF6"; cxL.fill();
    }
  }
  // two frames blended exactly: A at (1-f) and B at f with additive compositing = a linear crossfade
  function drawRadar() {
    cxR.globalCompositeOperation = "source-over"; cxR.globalAlpha = 1; cxR.clearRect(0, 0, cvR.width, cvR.height);
    if (!frames) return;
    cxR.imageSmoothingEnabled = true; cxR.imageSmoothingQuality = "high";
    var vs = visible(rz(), rdpr), a = cur, b = (cur + 1) % NF, f = playing || frac ? frac : 0;
    // motion-compensated in-between: frame A slides forward along the storms' motion while frame B slides in from
    //   behind, so echoes glide between radar scans instead of fading in and out in place
    var mv = b === a + 1 ? motionFor(a) : null, s = rscale() * rdpr, mx = mv ? mv.x * s : 0, my = mv ? mv.y * s : 0;
    cxR.globalCompositeOperation = "lighter";
    [[a, 1 - f, f], [b, f, f - 1]].forEach(function (p) {
      if (p[1] <= 0.001) return;
      cxR.globalAlpha = p[1]; var g = radarGet(frames, p[0]), ox = mx * p[2], oy = my * p[2];
      vs.forEach(function (v) { drawTile(cxR, ox || oy ? shift(v, ox, oy) : v, g); });
    });
    cxR.globalCompositeOperation = "source-over"; cxR.globalAlpha = 1;
  }
  function shift(v, ox, oy) { return { i: v.i, j: v.j, n: v.n, z: v.z, x0: v.x0 + ox, y0: v.y0 + oy, x1: v.x1 + ox, y1: v.y1 + oy }; }

  // ---------- storm motion between consecutive frames ----------
  // For each pair of frames, the shift that best lines up their echoes (a coarse block match on a 1/6-scale copy of
  //   the view, refined to sub-cell with a parabola fit). Stored in world units, so it holds while panning nearby;
  //   recomputed for a new zoom level or area. Echo-free views get no motion (plain crossfade).
  var MV = {}, mvKey = "";
  function motionKey() { return frames ? frames.bucket + ":" + rz() + ":" + Math.round(rv.x * 16) + "," + Math.round(rv.y * 16) : ""; }
  function motionFor(k) { var e = MV[mvKey]; return e && e[k] ? e[k] : null; }
  function alphaGrid(f, k, C, gw, gh) {
    var c = mk(gw, gh);
    var x = c.getContext("2d", { willReadFrequently: true }), g = radarGet(f, k), q = 1 / (C * dpr);
    visible(rz()).forEach(function (v) { drawTile(x, { i: v.i, j: v.j, n: v.n, z: v.z, x0: v.x0 * q, y0: v.y0 * q, x1: v.x1 * q, y1: v.y1 * q }, g); });
    var d = x.getImageData(0, 0, gw, gh).data, a = new Uint8Array(gw * gh);
    for (var i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
    return a;
  }
  function estimate(f, k, cb) {
    var C = 6, gw = Math.ceil(SW / C), gh = Math.ceil(SH / C), R = 5, A, B, w = rscale();
    try { A = alphaGrid(f, k, C, gw, gh); B = alphaGrid(f, k + 1, C, gw, gh); } catch (e) { return cb(null); }
    function done(m) { cb(m ? { x: m.x * C / w, y: m.y * C / w } : { x: 0, y: 0 }); }
    if (workers()) toW({ kind: "sad", A: A, B: B, gw: gw, gh: gh, R: R }, function (r, redo) { done(redo ? sad(A, B, gw, gh, R) : r.mv); }, [A.buffer, B.buffer]);
    else done(sad(A, B, gw, gh, R));
  }
  // best shift (in grid cells, sub-cell) between two alpha grids, or null when there's too little echo to tell
  function sad(A, B, gw, gh, R) {
    var echo = 0; for (var i = 0; i < A.length; i++) if (A[i] > 40) echo++;
    if (echo < 60) return null;
    var sc = {}, best = 1e18, bx = 0, by = 0;
    for (var dy = -R; dy <= R; dy++) for (var dx = -R; dx <= R; dx++) {
      var sum = 0, n = 0, y0 = Math.max(0, -dy), y1 = Math.min(gh, gh - dy), x0 = Math.max(0, -dx), x1 = Math.min(gw, gw - dx);
      for (var y = y0; y < y1; y++) { var ra = y * gw, rb = (y + dy) * gw + dx; for (var x = x0; x < x1; x++) { var d = A[ra + x] - B[rb + x]; sum += d < 0 ? -d : d; } n += x1 - x0; }
      var v = sum / Math.max(1, n); sc[dx + "," + dy] = v; if (v < best) { best = v; bx = dx; by = dy; }
    }
    if (Math.abs(bx) === R || Math.abs(by) === R) return null; // at the edge of the search: not trustworthy
    function sub(m, c, p) { var den = m - 2 * c + p; return den > 0 ? Math.max(-0.5, Math.min(0.5, (m - p) / (2 * den))) : 0; }
    return { x: bx + sub(sc[(bx - 1) + "," + by], best, sc[(bx + 1) + "," + by]), y: by + sub(sc[bx + "," + (by - 1)], best, sc[bx + "," + (by + 1)]) };
  }
  function planMotion() {
    var key = motionKey(); if (!frames || !key || key === mvKey && MV[key]) return;
    mvKey = key; if (MV[key]) return;
    var f = frames, out = MV[key] = [];
    for (var k = 0; k < f.n - 1; k++) (function (k) { work(function () { if (frames === f && mvKey === key) at(RV.R, function () { estimate(f, k, function (m) { if (mvKey === key) { out[k] = m; paint(2); } }); }); }); })(k);
  }
  function frame(ts) {
    raf = 0; if (!on) return;
    var dt = lastT ? Math.min(0.1, (ts - lastT) / 1000) : 0; lastT = ts;
    if (playing) { advance(dt); need |= 2; }
    if (inertia) { stepInertia(dt); }
    if (tween) { stepTween(ts); }
    // Each layer shows its last drawing moved/scaled by a CSS transform until it is redrawn at the current view:
    //   right away for new content (need bits), when the gesture is over, or mid-gesture once its spare margin is
    //   half used. Stale layers are redrawn one per frame so no single frame does all the work. While playing, the
    //   radar is redrawn every frame anyway, so it simply follows the view.
    var gest = pts.size > 0 || inertia || tween, stale = 0, pick = null, worst = -1, sv = scale();
    LAYERS.forEach(function (L) {
      var v = RV[L.k], dx = view.x - v.x; dx -= Math.round(dx);
      var k = Math.pow(2, view.z - v.z), tx = -dx * sv, ty = (v.y - view.y) * sv, off = dx || view.y !== v.y || view.z !== v.z;
      L.tf = off ? "translate3d(" + tx.toFixed(2) + "px," + ty.toFixed(2) + "px,0) scale(" + k.toFixed(5) + ")" : "";
      if (dirty & L.b && !(need & L.b) && worst < 2) { worst = 2; pick = L; } // new tiles arrived mid-gesture
      if (!off) return;
      stale |= L.b;
      var use = Math.max(Math.abs(tx) + W / 2 * Math.abs(1 - k), Math.abs(ty) + HH / 2 * Math.abs(1 - k)) / MG + (k < 0.8 || k > 1.6 ? 1 : 0);
      if (need & L.b) return; // redrawn below anyway
      if ((!gest || use > 0.5) && use > worst) { worst = use; pick = L; }
    });
    if (pick) { need |= pick.b; dirty &= ~pick.b; if (worst < 2) redraws++; }
    if (need) {
      LAYERS.forEach(function (L) {
        if (!(need & L.b)) return;
        var v = RV[L.k]; v.x = view.x; v.y = view.y; v.z = view.z; L.tf = "";
        at(v, L.draw);
      });
      if (need & stale) { clearTimeout(moved.t); moved.t = setTimeout(preload, 120); }
      dirty &= ~need; need = 0; timeUi();
    }
    LAYERS.forEach(function (L) { if (L.c.style.transform !== L.tf) L.c.style.transform = L.tf; });
    checkPending();
    var left = LAYERS.some(function (L) { return L.tf; });
    if (playing || gest || left || dirty) raf = requestAnimationFrame(frame); else lastT = 0;
  }

  // ---------- frames and playback ----------
  function iemFrames() {
    var bucket = Math.floor(Date.now() / STEP), layers = [], n = 11;
    for (var k = 0; k < n; k++) { var m = (n - 1 - k) * 5; layers.push("nexrad-n0q-900913" + (m ? "-m" + (m < 10 ? "0" : "") + m + "m" : "")); }
    var f = { src: "iem", n: n, bucket: bucket, layers: layers, valid: null, times: null };
    fetch(META + "?b=" + bucket).then(function (r) { return r.json(); }).then(function (j) {
      var v = Date.parse(j && j.meta && j.meta.valid); if (isFinite(v)) { f.valid = v; timeUi(); }
    }).catch(function () {});
    return f;
  }
  // MRMS frame times from the layer's WMS capabilities: the latest time and ~6-minute steps back over the last hour
  function mrmsTimes(xml) {
    var m = /<(?:Dimension|Extent)[^>]*name="time"[^>]*>([^<]+)</i.exec(xml); if (!m) return null;
    var all = [];
    m[1].trim().split(",").forEach(function (part) {
      var r = part.trim().split("/");
      if (r.length === 3) { var a = Date.parse(r[0]), b = Date.parse(r[1]), pm = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(r[2]), st = pm ? ((+pm[1] || 0) * 60 + (+pm[2] || 0)) * 60000 : 0; if (st) for (var t = b; t >= a && all.length < 2000; t -= st) all.push(t); }
      else { var t1 = Date.parse(r[0]); if (isFinite(t1)) all.push(t1); }
    });
    all = all.filter(isFinite).sort(function (a, b) { return a - b; }); if (!all.length) return null;
    var last = all[all.length - 1], pick = [];
    for (var k = 10; k >= 0; k--) {
      var want = last - k * 6 * 60000, best = null;
      all.forEach(function (t) { if (Math.abs(t - want) <= 3 * 60000 && (best == null || Math.abs(t - want) < Math.abs(best - want))) best = t; });
      if (best != null && pick.indexOf(best) < 0) pick.push(best);
    }
    return pick.length >= 2 ? pick : null;
  }
  // try MRMS (needs NCEP to allow cross-origin reads: legends, capabilities and tile pixels); otherwise the IEM mosaic
  var mrmsOK = null;
  function mrmsFrames() {
    if (mrmsOK === false) return Promise.reject();
    var leg = function (l) { return fetch(OG + l + "/ows?service=WMS&request=GetLegendGraphic&format=application/json&layer=" + l).then(function (r) { if (!r.ok) throw 0; return r.json(); }); };
    return Promise.all([leg(REF), leg(TYP), fetch(OG + REF + "/ows?service=WMS&version=1.3.0&request=GetCapabilities&b=" + Math.floor(Date.now() / 120000)).then(function (r) { if (!r.ok) throw 0; return r.text(); })]).then(function (res) {
      var re = entries(res[0]).map(function (e) { var c = hex(e.color); return [parseFloat(e.quantity)].concat(c); }).filter(function (e) { return isFinite(e[0]); }).sort(function (a, b) { return a[0] - b[0]; });
      var te = entries(res[1]).map(function (e) { var c = hex(e.color); return c.concat(typeOf(e.label, parseFloat(e.quantity))); });
      var times = mrmsTimes(res[2]);
      if (re.length < 5 || !te.length || !times) throw 0;
      REFP = re; TYPC = te; LREF.clear(); LTYP.clear(); mrmsOK = true; cfgW();
      return { src: "mrms", n: times.length, times: times, valid: times[times.length - 1], bucket: times[times.length - 1] };
    }).catch(function (e) { mrmsOK = false; throw e; });
  }
  function loadFrames() {
    mrmsFrames().catch(function () { return iemFrames(); }).then(function (f) {
      if (!frames) { setFrames(f); preload(); paint(2); } else if (f.bucket !== frames.bucket || f.src !== frames.src) { pending = f; preload(); }
      legend();
    });
  }
  function setFrames(f) { frames = f; NF = f.n; ui.range.max = NF - 1; if (cur > NF - 1 || !started) cur = NF - 1; }
  // request every frame's visible tiles so playback never waits on the network
  function preload() {
    [frames, pending].forEach(function (f) { if (!f) return; var vs = at(view, function () { return visible(rz()); }); for (var k = 0; k < f.n; k++) { var g = radarGet(f, k); vs.forEach(function (v) { g(v.z, ((v.i % v.n) + v.n) % v.n, v.j, true); }); } });
  }
  function ready(f) {
    var vs = at(RV.R, function () { return visible(rz()); }), n = 0, ok = 0;
    for (var k = 0; k < f.n; k++) vs.forEach(function (v) { var e = peek(rkey(f, k, v.z, ((v.i % v.n) + v.n) % v.n, v.j)); n++; if (e && (e.ok || e.err)) ok++; });
    return n ? ok / n : 1;
  }
  function checkPending() {
    if (pending && ready(pending) >= 1) { setFrames(pending); pending = null; paint(2); }
    var r = frames ? ready(frames) : 0;
    status(outUS ? "Radar mosaic covers the lower 48 states" : r < 1 ? "Loading radar… " + Math.round(r * 100) + "%" : "");
    if (r >= 1) at(RV.R, planMotion);
    if (r >= 1 && !playing && !userPaused && !started) { started = true; if (!reduced()) play(true); }
  }
  var started = false, outUS = false;
  function reduced() { return root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  // continuous playback: each step glides from one scan to the next over its whole duration (no hold, no jump);
  //   the latest frame holds, then fades back to the first
  var STEPD = 0.55, HOLD = 1.6, BACK = 0.35;
  function advance(dt) {
    ph += dt;
    if (cur === NF - 1) { if (ph >= HOLD + BACK) { ph = 0; cur = 0; frac = 0; } else frac = ph > HOLD ? smooth((ph - HOLD) / BACK) : 0; return; }
    if (ph >= STEPD) { ph -= STEPD; cur++; if (cur === NF - 1) { frac = 0; return; } }
    frac = ph / STEPD;
  }
  function play(p) {
    playing = p; ui.play.innerHTML = p ? '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>';
    ui.play.setAttribute("aria-label", p ? "Pause" : "Play");
    if (p) { ph = 0; frac = 0; if (cur === NF - 1) cur = 0; }
    paint(2);
  }
  function timeUi() {
    if (!ui.time) return;
    var pos = cur + frac, k = Math.round(pos) % NF;
    var rvv = String(+(pos > NF - 1 ? NF - 1 : pos).toFixed(2)); if (ui.range.value !== rvv) ui.range.value = rvv;
    var t = !frames ? null : frames.times ? frames.times[k] : frames.valid ? frames.valid - (NF - 1 - k) * 5 * 60000 : null;
    var ago = frames && frames.times ? Math.round((frames.valid - t) / 60000) : (NF - 1 - k) * 5;
    var abs = t ? (opts.fmtTime ? opts.fmtTime(t) : new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) : "";
    var tt = (abs ? abs + " · " : "") + (k === NF - 1 ? "Latest" : ago + " min ago"); if (ui.time.textContent !== tt) ui.time.textContent = tt;
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
  function moved() { paint(0); clearTimeout(moved.t); moved.t = setTimeout(preload, 150); }
  function local(e) { var r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function gesture() {
    var p = Array.from(pts.values());
    if (p.length === 1) g0 = { n: 1, x: p[0].x, y: p[0].y, vx: view.x, vy: view.y };
    else if (p.length >= 2) g0 = { n: 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1, m: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }, z: view.z, w: null };
    if (g0 && g0.n === 2) g0.w = worldAt(g0.m.x, g0.m.y);
  }
  function wire() {
    var t = stage;
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
        g0 = null; paint(0);
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
    var k = Math.exp(-ms / 260); inertia.vx *= k; inertia.vy *= k;
    if (Math.hypot(inertia.vx, inertia.vy) < 0.02) { inertia = null; preload(); }
  }
  function zoomTo(sx, sy, z) { tween = { sx: sx, sy: sy, z0: view.z, z1: Math.max(MINZ, Math.min(MAXZ, z)), t0: 0 }; paint(0); }
  function stepTween(ts) {
    if (!tween.t0) tween.t0 = ts; var t = Math.min(1, (ts - tween.t0) / 260);
    zoomAt(tween.sx, tween.sy, tween.z0 + (tween.z1 - tween.z0) * smooth(t));
    if (t >= 1) { tween = null; preload(); }
  }
  function recenter(animate) {
    if (!home) return; view.x = home.x; view.y = home.y; if (!animate) view.z = 7; paint(7); preload();
  }

  // ---------- setup ----------
  function build(host) {
    el = host; el.innerHTML =
      '<div class="rstage"><canvas class="rl rb"></canvas><canvas class="rl rr"></canvas><canvas class="rl rt"></canvas></div>' +
      '<div class="rstat" hidden></div>' +
      '<button type="button" class="rleg" aria-label="Switch radar colours"><span class="lrow lr"><span>Rain</span><i></i></span><span class="lrow ls"><span>Snow</span><i></i></span><em></em></button>' +
      '<button type="button" class="rloc" aria-label="Back to your location"><svg viewBox="0 0 24 24"><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" class="f"/></svg></button>' +
      '<div class="rbar"><button type="button" class="rplay" aria-label="Play"></button><input type="range" class="rrange" min="0" max="' + (NF - 1) + '" step="0.01" value="' + (NF - 1) + '" aria-label="Radar time"><span class="rtime num"></span></div>';
    stage = el.querySelector(".rstage"); var cs = el.querySelectorAll("canvas"); cvB = cs[0]; cvR = cs[1]; cvL = cs[2];
    cxB = cvB.getContext("2d"); cxR = cvR.getContext("2d"); cxL = cvL.getContext("2d");
    LAYERS = [{ k: "R", b: 2, c: cvR, draw: drawRadar, tf: "" }, { k: "B", b: 1, c: cvB, draw: drawBase, tf: "" }, { k: "L", b: 4, c: cvL, draw: drawLabels, tf: "" }];
    ui = { stat: el.querySelector(".rstat"), play: el.querySelector(".rplay"), range: el.querySelector(".rrange"), time: el.querySelector(".rtime"), leg: el.querySelector(".rleg") };
    ui.play.addEventListener("click", function () { userPaused = playing; play(!playing); started = true; });
    ui.range.addEventListener("input", function () { var v = +ui.range.value; playing && play(false); userPaused = true; started = true; cur = Math.min(NF - 1, Math.floor(v)); frac = v - cur; if (cur === NF - 1) frac = 0; paint(2); });
    el.querySelector(".rloc").addEventListener("click", function () { recenter(false); });
    ui.leg.addEventListener("click", function () {
      if (corsOK === false) return;
      style = style === "smooth" ? "nws" : "smooth"; try { localStorage.setItem("wx-radar-style", style); } catch (e) {}
      legend(); paint(2); preload();
    });
    legend(); play(false); wire();
    if (VM) VM.init(function () { paint(7); }, function () { soon(5); });
    new ResizeObserver(size).observe(el);
    if (root.matchMedia) root.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { paint(7); });
  }
  function grad(P) { return "linear-gradient(90deg," + P.filter(function (s) { return s[4] == null || s[4] > 0; }).map(function (s) { return "rgba(" + s[1] + "," + s[2] + "," + s[3] + "," + Math.max(0.45, s[4] == null ? 1 : s[4]) + ")"; }).join(",") + ")"; }
  function legend() {
    if (!ui.leg) return;
    var sm = style === "smooth" && corsOK !== false, typed = sm && frames && frames.src === "mrms";
    ui.leg.querySelector(".lr i").style.background = grad(sm ? RAIN : NWS);
    ui.leg.querySelector(".lr span").textContent = sm ? "Rain" : "Radar";
    ui.leg.querySelector(".ls").hidden = !typed;
    ui.leg.querySelector(".ls i").style.background = grad(SNOW);
    ui.leg.querySelector("em").textContent = !sm ? "NWS colours" + (corsOK === false ? "" : " · tap to switch back") : "Light → heavy · tap for NWS colours";
  }
  function size() {
    var r = el.getBoundingClientRect(); if (!r.width) return;
    // the stage is the view plus a spare margin on every side, so a drag shows already-drawn map until it is redrawn
    // map and radar at up to 2x; the lines-and-labels layer at the screen's full resolution (up to 3x) for sharp text
    // radar at 1.5x: the smoothed radar has about one source pixel per CSS pixel, so more only costs time per frame
    W = r.width; HH = r.height; dpr = Math.min(2, root.devicePixelRatio || 1); rdpr = Math.min(1.5, root.devicePixelRatio || 1); ldpr = Math.min(3, root.devicePixelRatio || 1); MG = Math.round(Math.max(W, HH) * 0.2);
    SW = W + 2 * MG; SH = HH + 2 * MG;
    stage.style.cssText = "left:" + -MG + "px;top:" + -MG + "px;width:" + SW + "px;height:" + SH + "px";
    ["B", "R", "L"].forEach(function (k) { RV[k].x = view.x; RV[k].y = view.y; RV[k].z = view.z; });
    cvB.width = Math.round(SW * dpr); cvB.height = Math.round(SH * dpr);
    cvR.width = Math.round(SW * rdpr); cvR.height = Math.round(SH * rdpr);
    cvL.width = Math.round(SW * ldpr); cvL.height = Math.round(SH * ldpr);
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
    _state: function () { return { wk: !!WK, mv: (MV[mvKey] || []).map(function (m) { return m ? [+(m.x * rscale()).toFixed(1), +(m.y * rscale()).toFixed(1)] : null; }), redraws: redraws, tf: cvL && cvL.style.transform, tfs: LAYERS.map(function (L) { return L.c.style.transform; }), src: frames && frames.src, mrmsOK: mrmsOK, corsOK: corsOK, frames: frames && frames.n, valid: frames && frames.valid, ready: frames ? ready(frames) : 0, view: view, playing: playing, cur: cur, frac: frac }; },
    _dbz: toDbz, _iem: iemDbz, _test: function (im) { return recolor(im); }
  };
  if (!INW) { root.WXRadar = api; return; }
  // ---------- worker side ----------
  var can2d = false; try { can2d = !!new OffscreenCanvas(1, 1).getContext("2d"); } catch (x) {}
  function fetchBitmap(u) {
    return fetch(u, { mode: "cors", credentials: "omit" }).then(function (r) { if (!r.ok) throw 0; return r.blob(); })
      .then(function (b) { return createImageBitmap(b, { colorSpaceConversion: "none" }); });
  }
  root.onmessage = function (ev) {
    var m = ev.data;
    if (m.cfg) { REFP = m.cfg.REFP; TYPC = m.cfg.TYPC; LREF.clear(); LTYP.clear(); return; }
    if (!can2d) { root.postMessage({ id: m.id, nosupport: true }); return; }
    if (m.kind === "sad") { root.postMessage({ id: m.id, mv: sad(m.A, m.B, m.gw, m.gh, m.R) }); return; }
    // tile: a missing type tile just means "rain"; a missing reflectivity tile is an error
    Promise.all(m.urls.map(function (u, i) { return fetchBitmap(u).catch(function (x) { if (i === 0) throw x; return null; }); })).then(function (ims) {
      var sm = m.mrms ? compose(ims[0], ims[1]) : recolor(ims[0]), out = { id: m.id, raw: ims[0] }, tr = [ims[0]];
      if (ims[1]) ims[1].close();
      if (sm === EMPTY) out.empty = true; else { out.sm = sm.transferToImageBitmap(); tr.push(out.sm); }
      root.postMessage(out, tr);
    }).catch(function () { root.postMessage({ id: m.id, err: true }); });
  };
})(this);
