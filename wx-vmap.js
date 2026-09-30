// Vector base map for the Radar tab: OpenStreetMap vector tiles (OpenMapTiles schema, served free by OpenFreeMap)
//   decoded in the browser and drawn on canvas at the screen's native resolution, so coastlines, state and county
//   lines, roads and place names stay sharp at every zoom. Dependency-free: a small protobuf reader decodes the
//   Mapbox Vector Tile format. wx-radar.js asks this module to draw the land/water layer under the radar and the
//   lines and labels over it; if the tiles can't be reached it keeps using its raster base map.
(function (root) {
  "use strict";
  var TILEJSON = "https://tiles.openfreemap.org/planet";
  var tmpl = null, maxz = 14, state = "idle", onReady = null, onTile = null;
  var tiles = new Map(), tick = 0;

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
    return out;
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
  function init(cb, tileCb) {
    onReady = cb; onTile = tileCb;
    if (state !== "idle") { if (state === "ok" && cb) cb(true); return; }
    state = "loading";
    fetch(TILEJSON).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
      tmpl = j && j.tiles && j.tiles[0]; maxz = Math.min(14, j.maxzoom || 14); if (!tmpl) throw 0;
      state = "ok"; if (onReady) onReady(true);
    }).catch(function () { state = "fail"; if (onReady) onReady(false); });
  }
  function get(z, x, y, request) {
    var k = z + "/" + x + "/" + y, e = tiles.get(k);
    if (e) { e.t = ++tick; return e; }
    if (!request || state !== "ok") return null;
    e = { t: ++tick }; tiles.set(k, e);
    fetch(tmpl.replace("{z}", z).replace("{x}", x).replace("{y}", y)).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(function (b) { e.L = decode(b); e.ok = true; if (onTile) onTile(); })
      .catch(function () { e.err = true; });
    if (tiles.size > 400) { var all = Array.from(tiles.entries()).sort(function (a, b) { return a[1].t - b[1].t; }); for (var i = 0; i < 120; i++) tiles.delete(all[i][0]); }
    return e;
  }
  // vector tiles are designed for 512-px rendering: use one zoom level lower than 256-px tiles would
  function tileZoom(z) { return Math.max(0, Math.min(maxz, Math.round(z) - 1)); }

  // ---------- styling ----------
  var PAL = {
    dark: { bg: "#000000", water: "#0a1119", waterway: "#0e1722", county: "rgba(255,255,255,.10)", state: "rgba(255,255,255,.46)", country: "rgba(255,255,255,.6)",
      road: [ "rgba(255,255,255,.34)", "rgba(255,255,255,.24)", "rgba(255,255,255,.17)", "rgba(255,255,255,.11)" ], text: "#ffffff", text2: "#c9d0d8", text3: "#9aa3ad", halo: "rgba(0,0,0,.92)", stateText: "rgba(255,255,255,.42)" },
    light: { bg: "#f3f3f1", water: "#d3dee8", waterway: "#c3d2e0", county: "rgba(0,0,0,.10)", state: "rgba(0,0,0,.38)", country: "rgba(0,0,0,.5)",
      road: [ "rgba(0,0,0,.26)", "rgba(0,0,0,.19)", "rgba(0,0,0,.13)", "rgba(0,0,0,.09)" ], text: "#141b24", text2: "#2e3845", text3: "#56616d", halo: "rgba(255,255,255,.95)", stateText: "rgba(0,0,0,.4)" }
  };
  function roadRank(c) { return c === "motorway" ? 0 : c === "trunk" || c === "primary" ? 1 : c === "secondary" ? 2 : c === "tertiary" || c === "minor" ? 3 : -1; }
  function roadMinZ(r) { return [5, 7, 9, 11][r]; }
  function roadWidth(r, z) { var b = [1.3, 1.0, 0.8, 0.7][r]; return b * Math.max(0.6, Math.min(3, Math.pow(1.3, z - 8))); }

  // Visit the loaded tile (or nearest loaded ancestor) for each visible tile slot, with a transform from tile
  //   units to device pixels and a clip to that slot. cb(layers, s, zt) draws; s = device px per tile unit.
  function eachTile(ctx, slots, cb) {
    slots.forEach(function (v) {
      var i = ((v.i % v.n) + v.n) % v.n;
      for (var d = 0; d <= 5 && v.z - d >= 0; d++) {
        var e = get(v.z - d, i >> d, v.j >> d, d === 0);
        if (!e || !e.ok) continue;
        var w = v.x1 - v.x0, ext = 4096, s = w * (1 << d) / ext;
        var ox = v.x0 - (i - ((i >> d) << d)) * w, oy = v.y0 - (v.j - ((v.j >> d) << d)) * w;
        ctx.save(); ctx.beginPath(); ctx.rect(v.x0, v.y0, w, v.y1 - v.y0); ctx.clip();
        ctx.setTransform(s, 0, 0, s, ox, oy);
        cb(e.L, s, v.z - d);
        ctx.restore();
        return;
      }
    });
  }
  function path(ctx, g, close) { ctx.beginPath(); g.forEach(function (r) { ctx.moveTo(r[0], r[1]); for (var k = 2; k < r.length; k += 2) ctx.lineTo(r[k], r[k + 1]); if (close) ctx.closePath(); }); }

  // land and water, under the radar
  function drawBase(ctx, slots, o) {
    var P = o.dark ? PAL.dark : PAL.light;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = P.bg; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    eachTile(ctx, slots, function (L, s) {
      if (L.water) { ctx.fillStyle = P.water; L.water.f.forEach(function (f) { if (f.t === 3) { path(ctx, f.g, true); ctx.fill(); } }); }
      if (L.waterway && o.z >= 8) { ctx.strokeStyle = P.waterway; ctx.lineWidth = 1 * o.dpr / s; ctx.lineJoin = ctx.lineCap = "round"; L.waterway.f.forEach(function (f) { if (f.t === 2) { path(ctx, f.g); ctx.stroke(); } }); }
    });
  }
  // county/state lines and roads over the radar, then place names
  function drawTop(ctx, slots, o) {
    var P = o.dark ? PAL.dark : PAL.light, z = o.z, d = o.dpr, places = [];
    eachTile(ctx, slots, function (L, s) {
      ctx.lineJoin = ctx.lineCap = "round";
      if (L.transportation) {
        var by = [[], [], [], []];
        L.transportation.f.forEach(function (f) { var r = roadRank(f.p["class"]); if (f.t === 2 && r >= 0 && z >= roadMinZ(r) && f.p.brunnel !== "tunnel") by[r].push(f); });
        for (var r = 3; r >= 0; r--) { if (!by[r].length) continue; ctx.strokeStyle = P.road[r]; ctx.lineWidth = roadWidth(r, z) * d / s; by[r].forEach(function (f) { path(ctx, f.g); ctx.stroke(); }); }
      }
      if (L.boundary) {
        L.boundary.f.forEach(function (f) {
          if (f.t !== 2 || f.p.maritime === 1 || f.p.maritime === true) return;
          var a = +f.p.admin_level;
          if (a === 6 && z >= 7) { ctx.strokeStyle = P.county; ctx.lineWidth = 0.7 * d / s; }
          else if (a === 4) { ctx.strokeStyle = P.state; ctx.lineWidth = (z < 6 ? 0.9 : 1.2) * d / s; }
          else if (a === 2) { ctx.strokeStyle = P.country; ctx.lineWidth = 1.4 * d / s; }
          else return;
          path(ctx, f.g); ctx.stroke();
        });
      }
      if (L.place) L.place.f.forEach(function (f) {
        if (f.t !== 1 || !f.g[0]) return;
        var m = ctx.getTransform(), x = (f.g[0][0] * m.a + m.e) / d, y = (f.g[0][1] * m.d + m.f) / d;
        places.push({ p: f.p, x: x, y: y });
      });
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    labels(ctx, places, P, z, d, o.w, o.h);
  }
  // place names: biggest places first, skipping any that would overlap one already placed; sizes grow gently with zoom
  var CLS = { state: 0, city: 1, town: 2, village: 3 };
  function labels(ctx, places, P, z, d, w, h) {
    var seen = {}, list = [];
    places.forEach(function (pl) {
      var c = pl.p["class"], name = pl.p["name:en"] || pl.p.name_en || pl.p.name; if (!name || CLS[c] == null) return;
      if (c === "state" && (z < 4 || z > 7.5)) return;
      if (c === "town" && z < 7.5 || c === "village" && z < 9.5) return;
      var k = name + "|" + Math.round(pl.x / 60) + "|" + Math.round(pl.y / 60); if (seen[k]) return; seen[k] = 1;
      if (pl.x < -50 || pl.y < -20 || pl.x > w + 50 || pl.y > h + 20) return;
      list.push({ c: c, name: c === "state" ? String(pl.p.name_en || name).toUpperCase() : name, x: pl.x, y: pl.y, r: (CLS[c] * 100) + (+pl.p.rank || 50) - (pl.p.capital ? 20 : 0) });
    });
    list.sort(function (a, b) { return a.r - b.r; });
    var boxes = [], zz = Math.max(4, Math.min(12, z));
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    list.slice(0, 400).forEach(function (L) {
      var size = L.c === "state" ? 10.5 + (zz - 4) * 0.4 : L.c === "city" ? 12 + (zz - 5) * 0.5 : L.c === "town" ? 11.5 + (zz - 8) * 0.45 : 11 + (zz - 10) * 0.4;
      size = Math.min(L.c === "city" ? 17 : 15, size);
      var wt = L.c === "city" ? 600 : L.c === "state" ? 600 : 500, sp = L.c === "state" ? 1.5 : 0;
      ctx.font = wt + " " + (size * d).toFixed(1) + "px -apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif";
      if (sp && "letterSpacing" in ctx) ctx.letterSpacing = (sp * d) + "px";
      var tw = ctx.measureText(L.name).width / d, bx = { x0: L.x - tw / 2 - 3, x1: L.x + tw / 2 + 3, y0: L.y - size * 0.7, y1: L.y + size * 0.7 };
      for (var i = 0; i < boxes.length; i++) { var q = boxes[i]; if (bx.x0 < q.x1 && bx.x1 > q.x0 && bx.y0 < q.y1 && bx.y1 > q.y0) { if ("letterSpacing" in ctx) ctx.letterSpacing = "0px"; return; } }
      boxes.push(bx);
      ctx.strokeStyle = P.halo; ctx.lineWidth = 3 * d; ctx.strokeText(L.name, L.x * d, L.y * d);
      ctx.fillStyle = L.c === "state" ? P.stateText : L.c === "city" ? P.text : L.c === "town" ? P.text2 : P.text3;
      ctx.fillText(L.name, L.x * d, L.y * d);
      if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    });
  }

  root.WXVMap = { init: init, ok: function () { return state === "ok"; }, failed: function () { return state === "fail"; }, tileZoom: tileZoom, drawBase: drawBase, drawTop: drawTop, _decode: decode };
})(this);
