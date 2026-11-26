// Vector base map for the Radar tab: OpenStreetMap vector tiles (OpenMapTiles schema, served free by OpenFreeMap)
//   decoded in the browser and drawn on canvas at the screen's native resolution, so coastlines, state and county
//   lines, roads and place names stay sharp at every zoom. Dependency-free: a small protobuf reader decodes the
//   Mapbox Vector Tile format. wx-radar.js asks this module to draw the land/water layer under the radar and the
//   lines and labels over it; if the tiles can't be reached it keeps using its raster base map.
(function (root) {
  "use strict";
  var TILEJSON = "https://tiles.openfreemap.org/planet";
  var tmpl = null, maxz = 14, state = "idle", onReady = [], onTile = [];
  var tiles = new Map(), tick = 0;
  // tiles are fetched and decoded by a background worker (this same file) so decoding never stalls the map
  var INW = typeof document === "undefined", SELF = !INW && document.currentScript ? document.currentScript.src : null;

  // ---------- protobuf / Mapbox Vector Tile decoding ----------
  function Pbf(buf) { this.b = buf; this.p = 0; this.end = buf.length; }
  Pbf.prototype.varint = function () {
    var b = this.b, v = 0, s = 0, c;
    do { c = b[this.p++]; if (s < 28) v |= (c & 0x7f) << s; else v += (c & 0x7f) * Math.pow(2, s); s += 7; } while (c & 0x80);
    return v < 0 ? v + 4294967296 : v;
  };
  Pbf.prototype.svarint = function () { var n = this.varint(); return n % 2 === 1 ? (n + 1) / -2 : n / 2; };
  Pbf.prototype.bytes = function () { var n = this.varint(), s = this.p; this.p += n; return this.b.subarray(s, s + n); };
  Pbf.prototype.string = function () { var u = this.bytes(), s = ""; try { s = new TextDecoder().decode(u); } catch (e) { for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); } return s; };
  Pbf.prototype.skip = function (t) { if (t === 0) this.varint(); else if (t === 1) this.p += 8; else if (t === 2) this.p += this.varint(); else if (t === 5) this.p += 4; };
  Pbf.prototype.packed = function () { var n = this.varint(), end = this.p + n, out = []; while (this.p < end) out.push(this.varint()); return out; };
  function readValue(pb) {
    var end = pb.p + pb.varint(), v = null;
    while (pb.p < end) {
      var k = pb.varint(), f = k >> 3, t = k & 7;
      if (f === 1) v = pb.string();
      else if (f === 2) { v = new DataView(pb.b.buffer, pb.b.byteOffset + pb.p, 4).getFloat32(0, true); pb.p += 4; }
      else if (f === 3) { v = new DataView(pb.b.buffer, pb.b.byteOffset + pb.p, 8).getFloat64(0, true); pb.p += 8; }
      else if (f === 4 || f === 5) v = pb.varint();
      else if (f === 6) v = pb.svarint();
      else if (f === 7) v = !!pb.varint();
      else pb.skip(t);
    }
    return v;
  }
  // geometry → array of rings/lines/points, each a flat [x0, y0, x1, y1, …] in tile units (0..extent)
  function geom(cmds) {
    var out = [], cur = null, x = 0, y = 0, i = 0;
    while (i < cmds.length) {
      var c = cmds[i++], id = c & 7, n = c >> 3;
      if (id === 7) { if (cur && cur.length >= 2) cur.push(cur[0], cur[1]); continue; }
      for (var k = 0; k < n; k++) {
        var dx = cmds[i++], dy = cmds[i++]; x += (dx >>> 1) ^ -(dx & 1); y += (dy >>> 1) ^ -(dy & 1);
        if (id === 1) { cur = [x, y]; out.push(cur); } else if (cur) cur.push(x, y);
      }
    }
    // drop points closer than 3/4096 of the tile to the last kept one (well under a screen pixel at any zoom this
    //   tile is drawn at) — detailed borders and coastlines lose most of their points, with no visible change
    return out.map(function (r) {
      if (r.length <= 4) return new Int16Array(r);
      var o = [r[0], r[1]], lx = r[0], ly = r[1];
      for (var k = 2; k < r.length - 2; k += 2) { var px = r[k], py = r[k + 1]; if (Math.abs(px - lx) >= 3 || Math.abs(py - ly) >= 3) { o.push(px, py); lx = px; ly = py; } }
      o.push(r[r.length - 2], r[r.length - 1]);
      return new Int16Array(o); // compact, and cheap to hand over from the worker
    });
  }
  var WANT = { water: 1, waterway: 1, boundary: 1, transportation: 1, place: 1, water_name: 0 };
  function decode(buf) {
    var pb = new Pbf(new Uint8Array(buf)), layers = {};
    while (pb.p < pb.end) {
      var key = pb.varint();
      if (key >> 3 !== 3) { pb.skip(key & 7); continue; }
      var end = pb.p + pb.varint(), name = "", keys = [], vals = [], feats = [], ext = 4096;
      while (pb.p < end) {
        var k = pb.varint(), f = k >> 3;
        if (f === 1) name = pb.string();
        else if (f === 2) feats.push(pb.bytes());
        else if (f === 3) keys.push(pb.string());
        else if (f === 4) vals.push(readValue(pb));
        else if (f === 5) ext = pb.varint();
        else pb.skip(k & 7);
      }
      if (!WANT[name]) continue;
      layers[name] = { ext: ext, f: feats.map(function (fb) {
        var q = new Pbf(fb), tags = [], type = 0, g = [], props = {};
        while (q.p < q.end) { var kk = q.varint(), ff = kk >> 3; if (ff === 2) tags = q.packed(); else if (ff === 3) type = q.varint(); else if (ff === 4) g = q.packed(); else q.skip(kk & 7); }
        for (var i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
        return { t: type, p: props, g: geom(g) };
      }) };
    }
    return layers;
  }

  // ---------- tiles ----------
  // Two modes, chosen once at start-up:
  //   render (OffscreenCanvas 2D in workers: Safari/iOS 16.4+, Chromium, Firefox): the worker keeps the decoded tiles
  //     and draws whole layers into an OffscreenCanvas; the page only swaps in the finished ImageBitmap
  //     (render()/present()), so stroking thousands of road and boundary segments never runs on the page's thread.
  //     The page keeps just each tile's place layer (placeNear) and learns of arrivals for its redraws.
  //   decode (older browsers): the worker only decodes; the page draws, time-sliced in ~4 ms steps into a back
  //     buffer that is swapped in when complete (render() with the same callback), so no task blocks a frame for long.
  function init(cb, tileCb) {
    // shared by the radar and the model maps: each registers its own callbacks
    if (tileCb && onTile.indexOf(tileCb) < 0) onTile.push(tileCb);
    if (state === "ok" || state === "fail") { if (cb) cb(state === "ok"); return; }
    if (cb) onReady.push(cb);
    if (state !== "idle") return;
    state = "loading";
    // ask the worker whether it can draw (it answers at once) while the tile index loads
    var hello = new Promise(function (ok) {
      if (!worker() || INW) return ok(false);
      var t = setTimeout(function () { ok(false); }, 4000); helloCb = function (r) { clearTimeout(t); ok(r); };
      WK.postMessage({ hello: 1 });
    });
    fetch(TILEJSON).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
      tmpl = j && j.tiles && j.tiles[0]; maxz = Math.min(14, j.maxzoom || 14); if (!tmpl) throw 0;
      return hello;
    }).then(function (can) {
      REND = !!can && !NOREND; if (REND) WK.postMessage({ init: { tmpl: tmpl, maxz: maxz } });
      state = "ok"; onReady.forEach(function (f) { f(true); });
    }).catch(function () { state = "fail"; onReady.forEach(function (f) { f(false); }); });
  }
  // ?vmsync=1 forces the page-drawn (decode) mode, for testing the fallback
  var REND = false, helloCb = null, NOREND = !INW && /[?&]vmsync=1/.test(root.location ? root.location.search : "");
  var WK = null, wid = 0, wjobs = {}, rjobs = {};
  function worker() {
    if (WK !== null) return WK;
    WK = false; if (!SELF || typeof Worker === "undefined") return WK;
    try {
      WK = new Worker(SELF);
      WK.onmessage = function (ev) {
        var r = ev.data;
        if (r.hello) { if (helloCb) helloCb(r.can); helloCb = null; return; }
        if (r.tile) { var e = tiles.get(r.tile) || { t: ++tick }; e.L = { place: r.place }; e.ok = true; tiles.set(r.tile, e); trim(); onTile.forEach(function (f) { f(); }); return; }
        if (r.rid) { var rj = rjobs[r.rid]; delete rjobs[r.rid]; if (rj) rj(r.skip ? null : { bmp: r.bmp, boxes: r.boxes }); return; }
        var cb = wjobs[r.id]; delete wjobs[r.id]; if (cb) cb(r.err ? null : r.L, r.err);
      };
      WK.onerror = function (ev) {
        ev.preventDefault(); WK.terminate(); WK = false; if (helloCb) helloCb(false); helloCb = null;
        var js = wjobs; wjobs = {}; Object.keys(js).forEach(function (k) { js[k](null, "redo"); });
        // a worker that dies in render mode: draw on the page from now on (tiles are fetched again as needed)
        if (REND) { REND = false; tiles.clear(); var rs = rjobs; rjobs = {}; Object.keys(rs).forEach(function (k) { rs[k](null); }); onTile.forEach(function (f) { f(); }); }
      };
    } catch (x) { WK = false; }
    return WK;
  }
  function fetchTile(url, cb) {
    if (!INW && worker()) { var id = ++wid; wjobs[id] = function (L, err) { if (err === "redo") fetchTile(url, cb); else cb(L); }; WK.postMessage({ id: id, url: url }); return; }
    fetch(url).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(function (b) { cb(decode(b)); }).catch(function () { cb(null); });
  }
  function trim() { if (tiles.size > 400) { var all = Array.from(tiles.entries()).sort(function (a, b) { return a[1].t - b[1].t; }); for (var i = 0; i < 120; i++) tiles.delete(all[i][0]); } }
  function get(z, x, y, request) {
    var k = z + "/" + x + "/" + y, e = tiles.get(k);
    if (e) { e.t = ++tick; return e; }
    if (!request || state !== "ok" || REND && !INW) return null;
    e = { t: ++tick }; tiles.set(k, e);
    fetchTile(tmpl.replace("{z}", z).replace("{x}", x).replace("{y}", y), function (L) {
      if (L) { e.L = L; e.ok = true; if (INW) root.postMessage({ tile: k, place: L.place || null }); else onTile.forEach(function (f) { f(); }); } else e.err = true;
    });
    trim();
    return e;
  }
  // Tiles at the view's own zoom (not one lower): OpenMapTiles only includes county lines from tile zoom 7, trunk
  //   roads from 7, primary from 8 and secondary from 9, so a coarser tile would drop them a whole zoom level early.
  //   Past zoom 7 tiles drop back one level (drawn at 512 px, about a quarter as many to draw); county lines and
  //   trunk roads are already in those, primary roads then show from zoom 9 and secondary from 10.
  function tileZoom(z) { var r = Math.round(z); return Math.max(0, Math.min(maxz, Math.max(r - 1, Math.min(7, r)))); }

  // ---------- styling ----------
  var PAL = {
    dark: { bg: "#000000", water: "#0f2033", waterway: "#1a3450", county: "rgba(255,255,255,.24)", state: "rgba(255,255,255,.78)", country: "rgba(255,255,255,.9)",
      road: [ "rgba(255,255,255,.58)", "rgba(255,255,255,.44)", "rgba(255,255,255,.32)", "rgba(255,255,255,.22)" ], text: "#ffffff", text2: "#dde3ea", text3: "#b4bcc6", halo: "rgba(0,0,0,.92)", stateText: "rgba(255,255,255,.62)" },
    light: { bg: "#f3f3f1", water: "#bfd3e6", waterway: "#a9c2da", county: "rgba(0,0,0,.2)", state: "rgba(0,0,0,.62)", country: "rgba(0,0,0,.75)",
      road: [ "rgba(0,0,0,.42)", "rgba(0,0,0,.32)", "rgba(0,0,0,.23)", "rgba(0,0,0,.16)" ], text: "#10161e", text2: "#26303c", text3: "#47525e", halo: "rgba(255,255,255,.95)", stateText: "rgba(0,0,0,.55)" }
  };

  // which roads show is mostly decided by what each tile zoom contains; only minor streets are held back
  function roadRank(c) { return c === "motorway" ? 0 : c === "trunk" || c === "primary" ? 1 : c === "secondary" ? 2 : c === "tertiary" || c === "minor" ? 3 : -1; }
  function roadMinZ(r) { return [0, 0, 0, 9.5][r]; }
  function roadWidth(r, z) { var b = [1.5, 1.15, 0.9, 0.75][r]; return b * Math.max(0.6, Math.min(3, Math.pow(1.3, z - 8))); }

  // Visit the loaded tile (or nearest loaded ancestor) for each visible tile slot, with a transform from tile
  //   units to device pixels and a clip to that slot. cb(layers, s, zt) draws; s = device px per tile unit.
  // draw one loaded tile's content into a slot rect (tile units → device pixels, clipped to the rect)
  function put(ctx, L, zt, x0, y0, x1, y1, ox, oy, s, cb) {
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    ctx.setTransform(s, 0, 0, s, ox, oy); cb(L, s, zt); ctx.restore();
  }
  // missing tile while zooming out: use its loaded children (two levels down) before falling back to an ancestor
  function kids(ctx, v, i, cb, lv) {
    var any = false, w = (v.x1 - v.x0) / 2, h = (v.y1 - v.y0) / 2;
    for (var b = 0; b < 2; b++) for (var a = 0; a < 2; a++) {
      var c = { z: v.z + 1, x0: v.x0 + a * w, y0: v.y0 + b * h, x1: v.x0 + (a + 1) * w, y1: v.y0 + (b + 1) * h }, ci = 2 * i + a, cj = 2 * v.j + b;
      var e = get(c.z, ci, cj, false);
      if (e && e.ok) { put(ctx, e.L, c.z, c.x0, c.y0, c.x1, c.y1, c.x0, c.y0, w / 4096, cb); any = true; }
      else if (lv > 1) { c.j = cj; if (kids(ctx, c, ci, cb, lv - 1)) any = true; }
    }
    return any;
  }
  // one slot (drawn by itself, so a time-sliced redraw can stop between slots)
  function eachTile(ctx, slots, cb) { slots.forEach(function (v) { slot(ctx, v, cb); }); }
  function slot(ctx, v, cb) {
    var i = ((v.i % v.n) + v.n) % v.n, e0 = get(v.z, i, v.j, true);
    if (!(e0 && e0.ok) && v.z < maxz && kids(ctx, v, i, cb, 2)) return;
    for (var d = 0; d <= 5 && v.z - d >= 0; d++) {
      var e = get(v.z - d, i >> d, v.j >> d, d === 0);
      if (!e || !e.ok) continue;
      var w = v.x1 - v.x0, ext = 4096, s = w * (1 << d) / ext;
      var ox = v.x0 - (i - ((i >> d) << d)) * w, oy = v.y0 - (v.j - ((v.j >> d) << d)) * w;
      put(ctx, e.L, v.z - d, v.x0, v.y0, v.x1, v.y1, ox, oy, s, cb);
      return;
    }
  }
  // one path per style (all features batched): far fewer draw calls, and overlapping segments don't double up
  function add(ctx, g, close) { g.forEach(function (r) { ctx.moveTo(r[0], r[1]); for (var k = 2; k < r.length; k += 2) ctx.lineTo(r[k], r[k + 1]); if (close) ctx.closePath(); }); }
  function strokeAll(ctx, list) { if (!list.length) return; ctx.beginPath(); list.forEach(function (f) { add(ctx, f.g); }); ctx.stroke(); }
  function run(g) { var r; do { r = g.next(); } while (!r.done); return r.value; }

  // land and water, under the radar
  function drawBase(ctx, slots, o) { return run(genBase(ctx, slots, o)); }
  function* genBase(ctx, slots, o) {
    var P = o.dark ? PAL.dark : PAL.light;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = P.bg; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (var q = 0; q < slots.length; q++) {
      slot(ctx, slots[q], function (L, s) {
        if (L.water) { ctx.fillStyle = P.water; ctx.beginPath(); L.water.f.forEach(function (f) { if (f.t === 3) add(ctx, f.g, true); }); ctx.fill(); }
        if (L.waterway && o.z >= 8) { ctx.strokeStyle = P.waterway; ctx.lineWidth = 1.2 * o.dpr / s; ctx.lineJoin = ctx.lineCap = "round"; strokeAll(ctx, L.waterway.f.filter(function (f) { return f.t === 2; })); }
      });
      yield;
    }
  }
  // county/state lines and roads over the radar, then place names
  function drawTop(ctx, slots, o) { return run(genTop(ctx, slots, o)); }
  function* genTop(ctx, slots, o) {
    var P = o.dark ? PAL.dark : PAL.light, z = o.z, d = o.dpr, places = [];
    for (var q = 0; q < slots.length; q++) { slot(ctx, slots[q], function (L, s) {
      ctx.lineJoin = ctx.lineCap = "round";
      if (L.transportation && !o.placesOnly) {
        var by = [[], [], [], []];
        L.transportation.f.forEach(function (f) { var r = roadRank(f.p["class"]); if (f.t === 2 && r >= 0 && z >= roadMinZ(r) && f.p.brunnel !== "tunnel") by[r].push(f); });
        for (var r = 3; r >= 0; r--) { if (!by[r].length) continue; ctx.strokeStyle = P.road[r]; ctx.lineWidth = roadWidth(r, z) * d / s; strokeAll(ctx, by[r]); }
      }
      if (L.boundary && !o.placesOnly) {
        var bl = { 6: [], 4: [], 2: [] };
        L.boundary.f.forEach(function (f) { if (f.t === 2 && f.p.maritime !== 1 && f.p.maritime !== true && bl[+f.p.admin_level]) bl[+f.p.admin_level].push(f); });
        if (z >= 6.5) { ctx.strokeStyle = P.county; ctx.lineWidth = 0.8 * d / s; strokeAll(ctx, bl[6]); }
        ctx.strokeStyle = P.state; ctx.lineWidth = (z < 6 ? 1.1 : 1.5) * d / s; strokeAll(ctx, bl[4]);
        ctx.strokeStyle = P.country; ctx.lineWidth = 1.7 * d / s; strokeAll(ctx, bl[2]);
      }
      if (L.place) L.place.f.forEach(function (f) {
        if (f.t !== 1 || !f.g[0]) return;
        var m = ctx.getTransform(), x = (f.g[0][0] * m.a + m.e) / d, y = (f.g[0][1] * m.d + m.f) / d;
        places.push({ p: f.p, x: x, y: y });
      });
    }); yield; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return labels(ctx, places, P, z, d, o.w, o.h, o);
  }
  // place names: biggest places first, skipping any that would overlap one already placed; sizes grow gently with zoom
  var CLS = { state: 0, city: 1, town: 2, village: 3 };
  // o.placesOnly (official county map): no state names, each place gets a dot with its name beside it, names skip
  //   the boxes in o.avoid (the county numbers), o.classes limits which classes draw, o.text/o.halo override the palette;
//   returns the boxes taken (including o.avoid) so the caller can place more labels around them
  function labels(ctx, places, P, z, d, w, h, o) {
    o = o || {};
    var seen = {}, list = [];
    places.forEach(function (pl) {
      var c = pl.p["class"], name = pl.p["name:en"] || pl.p.name_en || pl.p.name; if (!name || CLS[c] == null) return;
      if (c === "state" && (z < 4 || z > 7.5 || o.placesOnly)) return;
      if (c === "town" && z < 7.5 || c === "village" && z < 9.5) return;
      if (o.classes && !o.classes[c]) return;
      var k = name + "|" + Math.round(pl.x / 60) + "|" + Math.round(pl.y / 60); if (seen[k]) return; seen[k] = 1;
      if (pl.x < -50 || pl.y < -20 || pl.x > w + 50 || pl.y > h + 20) return;
      list.push({ c: c, name: c === "state" ? String(pl.p.name_en || name).toUpperCase() : name, x: pl.x, y: pl.y, r: (CLS[c] * 100) + (+pl.p.rank || 50) - (pl.p.capital ? 20 : 0) });
    });
    list.sort(function (a, b) { return a.r - b.r; });
    var boxes = (o.avoid || []).slice(), zz = Math.max(4, Math.min(12, z)), dots = !!o.placesOnly;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    list.slice(0, 400).forEach(function (L) {
      var size = L.c === "state" ? 10.5 + (zz - 4) * 0.4 : L.c === "city" ? 12 + (zz - 5) * 0.5 : L.c === "town" ? 11.5 + (zz - 8) * 0.45 : 11 + (zz - 10) * 0.4;
      size = Math.min(L.c === "city" ? 17 : 15, size); if (dots) size *= 0.85;
      var wt = dots ? (L.c === "city" ? 500 : 400) : L.c === "city" ? 600 : L.c === "state" ? 600 : 500, sp = L.c === "state" ? 1.5 : 0;
      ctx.font = wt + " " + (size * d).toFixed(1) + "px -apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif";
      if (sp && "letterSpacing" in ctx) ctx.letterSpacing = (sp * d) + "px";
      var tw = ctx.measureText(L.name).width / d, tx = dots ? L.x + 5 + tw / 2 : L.x, bx = { x0: tx - tw / 2 - 3, x1: tx + tw / 2 + 3, y0: L.y - size * 0.7, y1: L.y + size * 0.7 };
      if (dots) bx.x0 = L.x - 3.5;
      var hit = function (b) { for (var i = 0; i < boxes.length; i++) { var q = boxes[i]; if (b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0) return true; } return false; };
      if (hit(bx) && dots) { tx = L.x - 5 - tw / 2; bx = { x0: tx - tw / 2 - 3, x1: L.x + 3.5, y0: bx.y0, y1: bx.y1 }; } // try the left side
      if (hit(bx)) { if ("letterSpacing" in ctx) ctx.letterSpacing = "0px"; return; }
      boxes.push(bx);
      ctx.strokeStyle = o.halo || P.halo; ctx.lineWidth = 3 * d; ctx.strokeText(L.name, tx * d, L.y * d);
      ctx.fillStyle = o.text ? o.text : L.c === "state" ? P.stateText : L.c === "city" ? P.text : L.c === "town" ? P.text2 : P.text3;
      ctx.fillText(L.name, tx * d, L.y * d);
      if (dots) { ctx.beginPath(); ctx.arc(L.x * d, L.y * d, 2.2 * d, 0, 2 * Math.PI); ctx.fill(); }
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    });
    // o.extra (official map's county numbers): placed after the place names, in the given order, each at its point or
    //   1.15 text heights below/above it, skipping any that would overlap; { size, halo, items: [{ t, x, y, c }] }
    var X = o.extra;
    if (X && X.items && X.items.length) {
      ctx.font = "600 " + (X.size * d).toFixed(1) + "px -apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif";
      X.items.forEach(function (it) {
        var tw = ctx.measureText(it.t).width / d, bx = null, yy = it.y;
        var free = function (b) { for (var i = 0; i < boxes.length; i++) { var q = boxes[i]; if (b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0) return false; } return true; };
        [0, 1.15, -1.15].some(function (dy) { var y = it.y + dy * X.size, b = { x0: it.x - tw / 2 - 1.5, x1: it.x + tw / 2 + 1.5, y0: y - X.size * 0.6, y1: y + X.size * 0.6 }; if (free(b)) { bx = b; yy = y; return true; } return false; });
        if (!bx) return;
        boxes.push(bx);
        ctx.strokeStyle = X.halo; ctx.lineWidth = 3 * d; ctx.strokeText(it.t, it.x * d, yy * d);
        ctx.fillStyle = it.c; ctx.fillText(it.t, it.x * d, yy * d);
      });
    }
    return boxes;
  }

  // ---------- drawing off the page's thread ----------
  // A recorder with the few canvas calls the maps draw around the base map (warning outlines under the names, the
  //   location dots over them); its op list is replayed onto the worker's canvas (or the page's back buffer).
  function Rec() { this.o = []; }
  ["save", "restore", "beginPath", "closePath", "stroke"].forEach(function (n, c) { Rec.prototype[n] = function () { this.o.push(c); }; });
  Rec.prototype.fill = function (rule) { this.o.push(5, rule === "evenodd" ? 1 : 0); };
  Rec.prototype.moveTo = function (x, y) { this.o.push(6, x, y); };
  Rec.prototype.lineTo = function (x, y) { this.o.push(7, x, y); };
  Rec.prototype.arc = function (x, y, r, a, b) { this.o.push(8, x, y, r, a, b); };
  var PROPS = ["fillStyle", "strokeStyle", "lineWidth", "globalAlpha", "lineJoin", "lineCap"];
  PROPS.forEach(function (p, k) { Object.defineProperty(Rec.prototype, p, { set: function (v) { this.o.push(9, k, v); }, get: function () { return undefined; } }); });
  function replay(ctx, o) {
    if (!o) return;
    for (var i = 0; i < o.length;) {
      var c = o[i++];
      if (c === 0) ctx.save(); else if (c === 1) ctx.restore(); else if (c === 2) ctx.beginPath(); else if (c === 3) ctx.closePath(); else if (c === 4) ctx.stroke();
      else if (c === 5) ctx.fill(o[i++] ? "evenodd" : "nonzero");
      else if (c === 6) { ctx.moveTo(o[i], o[i + 1]); i += 2; } else if (c === 7) { ctx.lineTo(o[i], o[i + 1]); i += 2; }
      else if (c === 8) { ctx.arc(o[i], o[i + 1], o[i + 2], o[i + 3], o[i + 4]); i += 5; }
      else if (c === 9) { ctx[PROPS[o[i]]] = o[i + 1]; i += 2; }
    }
  }
  // the whole layer: pre ops, the base map layer, post ops; returns the label boxes ("top" only)
  function* genLayer(ctx, q) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    replay(ctx, q.pre); ctx.setTransform(1, 0, 0, 1, 0, 0);
    var boxes = q.layer === "base" ? yield* genBase(ctx, q.slots, q.o) : yield* genTop(ctx, q.slots, q.o);
    ctx.setTransform(1, 0, 0, 1, 0, 0); replay(ctx, q.post);
    return boxes || null;
  }

  if (INW) {
    var OC = null, OX = null, rq = {}, rqT = 0;
    var canDraw = function () { try { return typeof OffscreenCanvas !== "undefined" && !!new OffscreenCanvas(1, 1).getContext("2d") && "transferToImageBitmap" in OffscreenCanvas.prototype; } catch (x) { return false; } };
    // newest request per map layer only (a pan can ask again before the last one is drawn)
    var renders = function () {
      rqT = 0; var all = rq; rq = {};
      Object.keys(all).forEach(function (ch) {
        var q = all[ch];
        try {
          if (!OC) { OC = new OffscreenCanvas(q.w, q.h); OX = OC.getContext("2d"); }
          if (OC.width !== q.w) OC.width = q.w; if (OC.height !== q.h) OC.height = q.h;
          var boxes = run(genLayer(OX, q)), bmp = OC.transferToImageBitmap();
          root.postMessage({ rid: q.rid, bmp: bmp, boxes: boxes }, [bmp]);
        } catch (x) { root.postMessage({ rid: q.rid, skip: true }); }
      });
    };
    root.onmessage = function (ev) {
      var m = ev.data;
      if (m.hello) { root.postMessage({ hello: 1, can: canDraw() }); return; }
      if (m.init) { tmpl = m.init.tmpl; maxz = m.init.maxz; state = "ok"; return; }
      if (m.pre) { m.pre.forEach(function (v) { if (v.z <= maxz) get(v.z, ((v.i % v.n) + v.n) % v.n, v.j, true); }); return; }
      if (m.render) { var old = rq[m.render.ch]; if (old) root.postMessage({ rid: old.rid, skip: true }); rq[m.render.ch] = m.render; if (!rqT) rqT = setTimeout(renders, 0); return; }
      fetch(m.url).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(function (b) {
        var L = decode(b), tr = [];
        Object.keys(L).forEach(function (n) { L[n].f.forEach(function (f) { f.g.forEach(function (r) { tr.push(r.buffer); }); }); });
        root.postMessage({ id: m.id, L: L }, tr);
      }).catch(function () { root.postMessage({ id: m.id, err: true }); });
    };
    return;
  }
  // Draw a whole map layer away from the gesture: ch names the map layer (one request in flight per ch), q =
  //   { layer: "base" | "top", w, h (device px), slots, o (drawBase/drawTop options), pre, post (Rec) }; cb(res) gets
  //   { bmp } or { cv } (and boxes for "top") to hand to present(), or null if the request was replaced or failed.
  var jobs = {}, jobRaf = 0, rid = 0;
  function render(ch, q, cb) {
    var m = { ch: ch, rid: ++rid, layer: q.layer, w: Math.max(1, Math.round(q.w)), h: Math.max(1, Math.round(q.h)), slots: q.slots, o: q.o, pre: q.pre ? q.pre.o : null, post: q.post ? q.post.o : null };
    if (REND && WK) { rjobs[m.rid] = cb; WK.postMessage({ render: m }); return; }
    // page-drawn: a back buffer per layer, drawn ~4 ms per frame (a tile at a time, names last), then handed over
    var old = jobs[ch]; if (old && old.cb) old.cb(null);
    var j = jobs[ch] = old || {}; j.cb = cb;
    if (!j.cv) { j.cv = document.createElement("canvas"); j.cx = j.cv.getContext("2d"); }
    if (j.cv.width !== m.w) j.cv.width = m.w; if (j.cv.height !== m.h) j.cv.height = m.h;
    j.g = genLayer(j.cx, m);
    if (!jobRaf) jobRaf = requestAnimationFrame(slice);
  }
  function slice() {
    jobRaf = 0; var t0 = performance.now(), left = false;
    Object.keys(jobs).forEach(function (ch) {
      var j = jobs[ch]; if (!j.g) return;
      while (performance.now() - t0 < 4) { var r = j.g.next(); if (r.done) { var cb = j.cb; j.g = null; j.cb = null; if (cb) cb({ cv: j.cv, boxes: r.value }); break; } }
      if (j.g) left = true;
    });
    if (left) jobRaf = requestAnimationFrame(slice);
  }
  // put a finished layer on a map canvas; returns the canvas now showing it (a bitmap needs a "bitmaprenderer"
  //   canvas: the first time, a fresh element with the same class and style replaces one that has a 2D context)
  function present(cv, res) {
    if (res.bmp) {
      var bx = cv._bx || (cv._bx = cv._2d ? null : cv.getContext("bitmaprenderer"));
      if (!bx) { var n = document.createElement("canvas"); n.className = cv.className; n.style.cssText = cv.style.cssText; cv.parentNode.replaceChild(n, cv); cv = n; bx = cv._bx = cv.getContext("bitmaprenderer"); }
      if (cv.width !== res.bmp.width) cv.width = res.bmp.width; if (cv.height !== res.bmp.height) cv.height = res.bmp.height;
      bx.transferFromImageBitmap(res.bmp); return cv;
    }
    var cx = cv._2d || (cv._bx ? null : (cv._2d = cv.getContext("2d")));
    if (!cx) { var n2 = document.createElement("canvas"); n2.className = cv.className; n2.style.cssText = cv.style.cssText; cv.parentNode.replaceChild(n2, cv); cv = n2; cx = cv._2d = cv.getContext("2d"); }
    if (cv.width !== res.cv.width) cv.width = res.cv.width; if (cv.height !== res.cv.height) cv.height = res.cv.height;
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height); cx.drawImage(res.cv, 0, 0); return cv;
  }
  // ask for tiles just off screen ahead of time ({ z, i, j, n } list, nearest first), so panning finds them loaded
  function prefetch(list) {
    if (state !== "ok") return;
    if (REND && WK) { WK.postMessage({ pre: list.slice(0, 40).map(function (v) { return { z: v.z, i: v.i, j: v.j, n: v.n }; }) }); return; }
    list.slice(0, 40).forEach(function (v) { if (v.z <= maxz) get(v.z, ((v.i % v.n) + v.n) % v.n, v.j, true); }); }
  // One vector layer of a forecast map, whose canvases share one stage transform from the drawn view: ask(q, v) asks
  //   for a drawing of view v ({x, y, z} world units); once ready it is swapped onto the canvas (newer drawings only)
  //   and fit() gives the canvas its own transform from the view it shows to the stage's drawn view, so a layer still
  //   waiting for its redraw stays registered with the others. layer.cv is the canvas showing it (present() may
  //   replace the element); onShow(cv) runs after each swap.
  function Layer(ch, cv) { this.ch = ch; this.cv = cv; this.seq = 0; this.shown = 0; this.v = null; this.to = null; this.onShow = null; }
  Layer.prototype.ask = function (q, v) {
    var L = this, my = ++L.seq; v = { x: v.x, y: v.y, z: v.z };
    render(L.ch, q, function (res) {
      if (!res) return;
      if (my < L.shown) { if (res.bmp && res.bmp.close) res.bmp.close(); return; }
      L.shown = my; L.cv = present(L.cv, res); L.v = v; L.fit(L.to); if (L.onShow) L.onShow(L.cv, res);
    });
  };
  Layer.prototype.fit = function (to) {
    this.to = to; var v = this.v, tf = "";
    if (v && to) {
      var s = 256 * Math.pow(2, to.z), k = Math.pow(2, to.z - v.z), dx = v.x - to.x; dx -= Math.round(dx);
      var tx = dx * s, ty = (v.y - to.y) * s;
      if (Math.abs(tx) > 0.005 || Math.abs(ty) > 0.005 || Math.abs(k - 1) > 1e-6) tf = "translate(" + tx.toFixed(2) + "px," + ty.toFixed(2) + "px) scale(" + k.toFixed(5) + ")";
    }
    if (this.cv.style.transform !== tf) this.cv.style.transform = tf;
  };
  // nearest named place (city/town/village/hamlet/suburb) to a point, from tiles already loaded around it:
  //   { name, km, dir } or null — used by the official map's readouts so they name the town, not the county
  var PCLS = { city: 1, town: 1, village: 1, hamlet: 1, suburb: 1, neighbourhood: 0 };
  function placeNear(lat, lon, z, maxKm) {
    if (state !== "ok") return null;
    var X = (lon + 180) / 360, sn = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180), Y = 0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI);
    var best = null, cosl = Math.cos(lat * Math.PI / 180);
    for (var zt = Math.min(maxz, Math.max(8, tileZoom(z))); zt >= 6 && !best; zt--) {
      var n = 1 << zt, ci = Math.floor(X * n), cj = Math.floor(Y * n);
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
        var e = tiles.get(zt + "/" + (((ci + di) % n) + n) % n + "/" + (cj + dj)); if (!e || !e.ok || !e.L.place) continue;
        var ext = e.L.place.ext || 4096;
        e.L.place.f.forEach(function (f) {
          var c = f.p["class"], name = f.p["name:en"] || f.p.name_en || f.p.name; if (f.t !== 1 || !f.g[0] || !PCLS[c] || !name) return;
          var px = (ci + di + f.g[0][0] / ext) / n, py = (cj + dj + f.g[0][1] / ext) / n;
          var plon = px * 360 - 180, plat = Math.atan(Math.sinh(Math.PI * (1 - 2 * py))) * 180 / Math.PI;
          var dx = (plon - lon) * cosl * 111.32, dy = (plat - lat) * 110.57, km = Math.sqrt(dx * dx + dy * dy);
          if (km <= (maxKm || 25) && (!best || km < best.km)) best = { name: name, km: km, dir: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((Math.atan2(-dx, -dy) * 180 / Math.PI + 360) % 360 / 45) % 8] };
        });
      }
    }
    return best;
  }
  root.WXVMap = { placeNear: placeNear, prefetch: prefetch, init: init, ok: function () { return state === "ok"; }, failed: function () { return state === "fail"; }, tileZoom: tileZoom, drawBase: drawBase, drawTop: drawTop, _decode: decode,
    render: render, present: present, layer: function (ch, cv) { return new Layer(ch, cv); }, rec: function () { return new Rec(); }, offThread: function () { return REND; } };
})(this);
