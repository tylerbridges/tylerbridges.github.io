// Model maps, Pivotal Weather style: forecast maps drawn in the browser straight from NOAA model output.
//   HRRR (3 km, hourly), NAM 3 km and GFS (0.25°) GRIB2 files on NOAA Open Data on AWS (CORS-open, byte ranges);
//   each field is fetched by its byte range from the file's .idx, decoded here (GRIB2 complex packing with spatial
//   differencing, Lambert conformal and lat/lon grids), turned into a product (shading, contours, wind barbs) and
//   drawn on the same vector base map as the radar. Fetching and decoding run in background workers (this same
//   file, INW branch).
(function (root) {
  "use strict";
  var INW = typeof importScripts === "function" && typeof document === "undefined";
  var SELF = !INW && typeof document !== "undefined" && document.currentScript ? document.currentScript.src : null;

  // ---------- GRIB2 ----------
  function u16(b, p) { return b[p] << 8 | b[p + 1]; }
  function u32(b, p) { return b[p] * 16777216 + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; }
  function s16(b, p) { var v = u16(b, p); return v & 0x8000 ? -(v & 0x7fff) : v; }
  function s32(b, p) { var v = u32(b, p); return v >= 2147483648 ? -(v - 2147483648) : v; }
  function f32(b, p) { return new DataView(b.buffer, b.byteOffset + p, 4).getFloat32(0); }
  function uN(b, p, n) { var v = 0; for (var i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; }
  function sN(b, p, n) { var v = uN(b, p, n), top = Math.pow(2, 8 * n - 1); return v >= top ? -(v - top) : v; }
  // n bits (n ≤ 32) starting at bit pos
  function bitsAt(b, pos, n) {
    if (!n) return 0;
    var i = pos >>> 3, off = pos & 7, need = off + n;
    if (need <= 32) return (((b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) << off) >>> 0) >>> (32 - n);
    var v = 0, nb = (need + 7) >> 3; for (var k = 0; k < nb; k++) v = v * 256 + (b[i + k] || 0);
    return Math.floor(v / Math.pow(2, nb * 8 - need)) % Math.pow(2, n);
  }
  function gridDef(s) {
    var t = u16(s, 12), sh = s[14], g = { t: t };
    g.R = sh === 0 ? 6367470 : sh === 1 ? u32(s, 16) * Math.pow(10, -s[15]) : 6371229;
    if (t === 30) {
      g.nx = u32(s, 30); g.ny = u32(s, 34); g.la1 = s32(s, 38) / 1e6; g.lo1 = s32(s, 42) / 1e6; g.rf = s[46];
      g.lov = s32(s, 51) / 1e6; g.dx = u32(s, 55) / 1e3; g.dy = u32(s, 59) / 1e3; g.scan = s[64]; g.l1 = s32(s, 65) / 1e6; g.l2 = s32(s, 69) / 1e6;
    } else if (t === 0) {
      g.nx = u32(s, 30); g.ny = u32(s, 34); g.la1 = s32(s, 46) / 1e6; g.lo1 = s32(s, 50) / 1e6; g.rf = s[54];
      g.dx = u32(s, 63) / 1e6; g.dy = u32(s, 67) / 1e6; g.scan = s[71];
    } else if (t === 32769) { // NCEP rotated lat/lon (RAP): corners in true lat/lon, rotated so the centre is (0, 0)
      g.nx = u32(s, 30); g.ny = u32(s, 34); g.la1 = s32(s, 46) / 1e6; g.lo1 = s32(s, 50) / 1e6; g.rf = s[54];
      g.lac = s32(s, 55) / 1e6; g.loc = s32(s, 59) / 1e6; g.scan = s[71]; g.la2 = s32(s, 72) / 1e6; g.lo2 = s32(s, 76) / 1e6;
    } else throw new Error("unsupported grid " + t);
    return g;
  }
  // one GRIB2 message; a message can hold several fields (NAM puts U and V wind in one), sub picks which (1-based)
  function parse(b, sub) {
    if (b[0] !== 71 || b[1] !== 82 || b[2] !== 73 || b[3] !== 66) throw new Error("not GRIB");
    var p = 16, m = {}, n = 0, want = sub || 1;
    while (p < b.length - 4) {
      if (b[p] === 55 && b[p + 1] === 55 && b[p + 2] === 55 && b[p + 3] === 55) break;
      var L = u32(b, p), s = b[p + 4], sec = b.subarray(p, p + L);
      if (s === 3) m.g = gridDef(sec); else if (s === 5) m.s5 = sec; else if (s === 6) { if (sec[5] === 0) m.bm = sec.subarray(6); else if (sec[5] === 255) m.bm = null; }
      else if (s === 7) { m.d = sec.subarray(5); if (++n === want) break; }
      p += L;
    }
    if (!m.g || !m.s5 || !m.d || n < want) throw new Error("incomplete GRIB message");
    return m;
  }
  // values in file order (NaN = missing)
  function unpack(m) {
    var s5 = m.s5, t = u16(s5, 9), n = u32(s5, 5), R = f32(s5, 11), E = s16(s5, 15), D = s16(s5, 17), nb = s5[19];
    var bs = Math.pow(2, E), ds = Math.pow(10, -D), d = m.d, out = new Float32Array(n), i;
    if (t === 0) {
      if (!nb) out.fill(R * ds); else for (i = 0; i < n; i++) out[i] = (R + bitsAt(d, i * nb, nb) * bs) * ds;
    } else if (t === 2 || t === 3) {
      var miss = s5[22], NG = u32(s5, 31), refW = s5[35], nbW = s5[36], refL = u32(s5, 37), incL = s5[41], lastL = u32(s5, 42), nbL = s5[46];
      var order = t === 3 ? s5[47] : 0, no = t === 3 ? s5[48] : 0, pos = 0, iv1 = 0, iv2 = 0, mn = 0;
      if (order) { iv1 = uN(d, 0, no); pos = no; if (order === 2) { iv2 = uN(d, pos, no); pos += no; } mn = sN(d, pos, no); pos += no; }
      pos *= 8;
      var refs = new Float64Array(NG), wid = new Uint8Array(NG), len = new Float64Array(NG), g;
      for (g = 0; g < NG; g++) { refs[g] = bitsAt(d, pos, nb); pos += nb; } pos = Math.ceil(pos / 8) * 8;
      for (g = 0; g < NG; g++) { wid[g] = refW + bitsAt(d, pos, nbW); pos += nbW; } pos = Math.ceil(pos / 8) * 8;
      for (g = 0; g < NG; g++) { len[g] = refL + bitsAt(d, pos, nbL) * incL; pos += nbL; } pos = Math.ceil(pos / 8) * 8;
      len[NG - 1] = lastL;
      var v = new Float64Array(n), ms = miss ? new Uint8Array(n) : null, k = 0, all = Math.pow(2, nb) - 1;
      for (g = 0; g < NG && k < n; g++) {
        var w = wid[g], L = len[g], r = refs[g], j;
        if (!w) {
          var mz = miss && (r === all ? 1 : miss === 2 && r === all - 1 ? 1 : 0);
          for (j = 0; j < L && k < n; j++, k++) { if (mz) ms[k] = 1; else v[k] = r; }
        } else {
          var top = Math.pow(2, w) - 1;
          for (j = 0; j < L && k < n; j++, k++) {
            var x = bitsAt(d, pos, w); pos += w;
            if (miss && (x === top || miss === 2 && x === top - 1)) ms[k] = 1; else v[k] = r + x;
          }
        }
      }
      if (order) {
        var c = 0, p1 = 0, p2 = 0;
        for (i = 0; i < n; i++) {
          if (ms && ms[i]) continue;
          if (c === 0) v[i] = iv1;
          else if (c === 1 && order === 2) v[i] = iv2;
          else v[i] = order === 1 ? v[i] + mn + p1 : v[i] + mn + 2 * p1 - p2;
          p2 = p1; p1 = v[i]; c++;
        }
      }
      for (i = 0; i < n; i++) out[i] = ms && ms[i] ? NaN : (R + v[i] * bs) * ds;
    } else throw new Error("unsupported packing 5." + t);
    var N = m.g.nx * m.g.ny;
    if (m.bm) { var full = new Float32Array(N), q = 0; for (i = 0; i < N; i++) full[i] = m.bm[i >> 3] >> (7 - (i & 7)) & 1 ? out[q++] : NaN; out = full; }
    // scanning mode bit 0x10 (NBM): every other row runs the opposite way, so flip those rows back
    if (m.g.scan & 0x10) { var nx = m.g.nx; for (var r = 1; r < m.g.ny; r += 2) out.subarray(r * nx, r * nx + nx).reverse(); }
    return out;
  }
  // grid index (fractional, file order) <-> lat/lon
  var D2R = Math.PI / 180;
  function proj(g) {
    var sj = g.scan & 0x40 ? 1 : -1;
    if (g.t === 0) return {
      fwd: function (lat, lon, o) { o[0] = (((lon - g.lo1) % 360) + 360) % 360 / g.dx; o[1] = sj * (lat - g.la1) / g.dy; },
      inv: function (i, j, o) { o[0] = g.la1 + sj * j * g.dy; o[1] = g.lo1 + i * g.dx; if (o[1] > 180) o[1] -= 360; },
      rot: null
    };
    if (g.t === 32769) return rotProj(g, sj);
    var p1 = g.l1 * D2R, p2 = g.l2 * D2R, Q = Math.PI / 4;
    var n = Math.abs(p1 - p2) < 1e-9 ? Math.sin(p1) : Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(Math.tan(Q + p2 / 2) / Math.tan(Q + p1 / 2));
    var RF = g.R * Math.cos(p1) * Math.pow(Math.tan(Q + p1 / 2), n) / n, l0 = g.lov * D2R;
    function xy(lat, lon, o) { var rho = RF / Math.pow(Math.tan(Q + lat * D2R / 2), n), dl = lon * D2R - l0; dl -= 2 * Math.PI * Math.round(dl / (2 * Math.PI)); o[0] = rho * Math.sin(n * dl); o[1] = -rho * Math.cos(n * dl); }
    var O = [0, 0]; xy(g.la1, g.lo1, O); var x1 = O[0], y1 = O[1];
    return {
      fwd: function (lat, lon, o) { xy(lat, lon, o); o[0] = (o[0] - x1) / g.dx; o[1] = sj * (o[1] - y1) / g.dy; },
      inv: function (i, j, o) { var x = x1 + i * g.dx, y = y1 + sj * j * g.dy, rho = Math.sqrt(x * x + y * y); o[0] = (2 * Math.atan(Math.pow(RF / rho, 1 / n)) - Math.PI / 2) / D2R; o[1] = (l0 + Math.atan2(x, -y) / n) / D2R; o[1] = ((o[1] + 540) % 360) - 180; },
      // grid-relative winds (resolution flag bit 4) turn by n·(λ − λ0) to earth-relative
      rot: g.rf & 8 ? function (lon) { var dl = lon * D2R - l0; dl -= 2 * Math.PI * Math.round(dl / (2 * Math.PI)); return n * dl; } : null
    };
  }

  // rotated lat/lon: rotate so the grid centre sits at (0°, 0°); spacing comes from the two corners (the file's Di/Dj
  //   use NCEP's own scaling). Checked: both corners land symmetric (±50.743°, ±57.992°) at 0.121833° steps.
  function rotProj(g, sj) {
    var s0 = Math.sin(g.lac * D2R), c0 = Math.cos(g.lac * D2R), l0 = g.loc;
    function fw(lat, lon, o) {
      var cl = Math.cos(lat * D2R), dl = (lon - l0) * D2R, x = cl * Math.cos(dl), y = cl * Math.sin(dl), z = Math.sin(lat * D2R);
      o[0] = Math.atan2(y, x * c0 + z * s0) / D2R; o[1] = Math.asin(Math.max(-1, Math.min(1, -x * s0 + z * c0))) / D2R; // rotated lon, lat
    }
    var A = [0, 0], B = [0, 0]; fw(g.la1, g.lo1, A); fw(g.la2, g.lo2, B);
    var di = (B[0] - A[0]) / (g.nx - 1), dj = (B[1] - A[1]) / (g.ny - 1) * sj, q = [0, 0];
    var P2 = {
      fwd: function (lat, lon, o) { fw(lat, lon, q); o[0] = (q[0] - A[0]) / di; o[1] = (q[1] - A[1]) / dj; },
      inv: function (i, j, o) {
        var rl = (A[0] + i * di) * D2R, rp = (A[1] + j * dj) * D2R, xr = Math.cos(rp) * Math.cos(rl), y = Math.cos(rp) * Math.sin(rl), zr = Math.sin(rp);
        var x = xr * c0 - zr * s0, z = xr * s0 + zr * c0;
        o[0] = Math.asin(Math.max(-1, Math.min(1, z))) / D2R; o[1] = ((l0 + Math.atan2(y, x) / D2R) + 540) % 360 - 180;
      },
      rot: null
    };
    // grid-relative winds: the angle of the grid's x axis from east, found numerically
    if (g.rf & 8) P2.rot = function (lon, lat) {
      var a = [0, 0], b = [0, 0]; P2.fwd(lat, lon, a); P2.inv(a[0] + 0.5, a[1], b);
      var de = (((b[1] - lon) + 540) % 360 - 180) * Math.cos(lat * D2R), dn = b[0] - lat;
      return -Math.atan2(dn, de);
    };
    return P2;
  }

  // ---------- models ----------
  var H = 3600000;
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function p3(n) { return (n < 10 ? "00" : n < 100 ? "0" : "") + n; }
  function ymd(t) { return new Date(t).toISOString().slice(0, 10).replace(/-/g, ""); }
  function hh(t) { return p2(new Date(t).getUTCHours()); }
  var MODELS = {
    hrrr: { name: "HRRR", full: "HRRR (3 km)", base: "https://noaa-hrrr-bdp-pds.s3.amazonaws.com/", cycle: 1, step: 1, conus: true,
      max: function (run) { return new Date(run).getUTCHours() % 6 === 0 ? 48 : 18; },
      prefix: function (run) { return "hrrr." + ymd(run) + "/conus/hrrr.t" + hh(run) + "z.wrfsfcf"; },
      file: function (run, h) { return this.prefix(run) + p2(h) + ".grib2"; }, hourOf: /wrfsfcf(\d+)\.grib2\.idx$/ },
    nam: { name: "NAM 3 km", full: "NAM 3 km nest", base: "https://noaa-nam-pds.s3.amazonaws.com/", cycle: 6, step: 1, conus: true,
      max: function () { return 60; },
      prefix: function (run) { return "nam." + ymd(run) + "/nam.t" + hh(run) + "z.conusnest.hiresf"; },
      file: function (run, h) { return this.prefix(run) + p2(h) + ".tm00.grib2"; }, hourOf: /hiresf(\d+)\.tm00\.grib2\.idx$/ },
    nam12: { name: "NAM 12 km", full: "NAM 12 km", base: "https://noaa-nam-pds.s3.amazonaws.com/", cycle: 6, step: 1, conus: true,
      max: function () { return 84; },
      prefix: function (run) { return "nam." + ymd(run) + "/nam.t" + hh(run) + "z.awphys"; },
      file: function (run, h) { return this.prefix(run) + p2(h) + ".tm00.grib2"; }, hourOf: /awphys(\d+)\.tm00\.grib2\.idx$/ },
    // RAP: NOAA's AWS copy sends no CORS header, so it's read from Google Cloud's public mirror through the JSON API
    //   (CORS-open, byte ranges); its 13 km Lambert files are JPEG2000-packed, so the native rotated grid is used
    rap: { name: "RAP", full: "RAP (13 km)", base: "https://storage.googleapis.com/storage/v1/b/rapid-refresh/o", gcs: true, cycle: 1, step: 1, conus: false,
      covers: function (l) { return l.lat > 15 && l.lon < -50; },
      max: function (run) { return [3, 9, 15, 21].indexOf(new Date(run).getUTCHours()) >= 0 ? 51 : 21; },
      prefix: function (run) { return "rap." + ymd(run) + "/rap.t" + hh(run) + "z.wrfprsf"; },
      file: function (run, h) { return this.prefix(run) + p2(h) + ".grib2"; }, hourOf: /wrfprsf(\d+)\.grib2\.idx$/ },
    gfs: { name: "GFS", full: "GFS (0.25°)", base: "https://noaa-gfs-bdp-pds.s3.amazonaws.com/", cycle: 6, step: 6, conus: false,
      max: function () { return 384; },
      prefix: function (run) { return "gfs." + ymd(run) + "/" + hh(run) + "/atmos/gfs.t" + hh(run) + "z.pgrb2.0p25.f"; },
      file: function (run, h) { return this.prefix(run) + p3(h); }, hourOf: /pgrb2\.0p25\.f(\d+)\.idx$/ },
    // National Blend of Models: what NWS forecasts start from; its snowfall uses NBM's own snow-to-liquid ratios.
    //   Files: hourly to 36 h, 3-hourly to 192 h, 6-hourly to 264 h. Precip has 1-h buckets to 48 h and 6-h buckets
    //   every 6 h; snow and ice only 1-h buckets to 48 h; highs end at 00Z and lows at 12Z (12-h max/min).
    nbm: { name: "NBM", full: "National Blend of Models (2.5 km)", base: "https://noaa-nbm-grib2-pds.s3.amazonaws.com/", cycle: 1, step: 1, conus: true, nbm: true,
      max: function () { return 264; }, need: 48,
      prefix: function (run) { return "blend." + ymd(run) + "/" + hh(run) + "/core/blend.t" + hh(run) + "z.core.f"; },
      file: function (run, h) { return this.prefix(run) + p3(h) + ".co.grib2"; }, hourOf: /core\.f(\d+)\.co\.grib2\.idx$/ }
  };

  // S3 objects by path; Google Cloud through its JSON API (one URL per object, ?alt=media for the bytes)
  function fileUrl(M, path) { return M.gcs ? M.base + "/" + encodeURIComponent(path) + "?alt=media" : M.base + path; }

  // ---------- colour scales ----------
  function rgb(h, a) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a == null ? 1 : a]; }
  function S(list, o) { o = o || {}; o.stops = list.map(function (s) { return [s[0], typeof s[1] === "string" ? rgb(s[1], s[2]) : s[1]]; }); return o; }
  var SC = {
    tF: S([[-40, "#f6dcff"], [-30, "#d9a2ef"], [-20, "#a666d3"], [-10, "#6b3cad"], [0, "#3a3696"], [10, "#2457c5"], [20, "#3b8fe2"], [31.9, "#a7d8f6"], [32, "#4fc79b"], [40, "#33a35a"],
      [50, "#8bcf3d"], [60, "#f2df4c"], [70, "#f8b133"], [80, "#f47724"], [90, "#df331d"], [100, "#a3162f"], [110, "#6e0b3d"], [120, "#f2c2df"]], { under: true, ticks: [-20, 0, 20, 32, 50, 70, 90, 110], unit: "°F" }),
    tdF: S([[-10, "#6b4a2b"], [20, "#a87d4f"], [40, "#d9c39b"], [50, "#b5dd9b"], [55, "#5fbf5f"], [60, "#2e9e44"], [65, "#1c7a3a"], [70, "#2f8fb5"], [75, "#3e5fd1"], [80, "#7a3fb3"]], { under: true, ticks: [0, 20, 40, 50, 60, 70, 80], unit: "°F" }),
    tC: S([[-40, "#f0d0ff"], [-30, "#9b5fd0"], [-20, "#3c3fa5"], [-10, "#3b8fe2"], [-0.01, "#bfe3f5"], [0, "#c3eab0"], [10, "#6dbf4f"], [20, "#f2c94c"], [25, "#ef7a2a"], [30, "#c8231f"], [35, "#7a0b2f"]], { under: true, ticks: [-30, -20, -10, 0, 10, 20, 30], unit: "°C" }),
    qpf: S([[0.01, "#c4ecc0"], [0.1, "#7ccb78"], [0.25, "#2fa84f"], [0.5, "#17733a"], [0.75, "#2b8cbe"], [1, "#1f5fb5"], [1.5, "#5b3fb3"], [2, "#932fae"], [3, "#cf3f8b"], [4, "#e8742f"], [6, "#f2b134"], [10, "#fff1a8"]], { band: true, unit: "in" }),
    snow: S([[0.1, "#d8eaf8"], [1, "#9cc8ec"], [2, "#5ea3dd"], [3, "#2f6fc4"], [4, "#1d3f9e"], [6, "#6a3fb5"], [8, "#a13fb3"], [12, "#d83fa0"], [18, "#f06b6b"], [24, "#f7a35c"], [36, "#fbd769"], [48, "#fff6c2"]], { band: true, unit: "in" }),
    ice: S([[0.01, "#f7d3e8"], [0.05, "#ee9fcd"], [0.1, "#e06fb3"], [0.25, "#c43f96"], [0.5, "#8e2380"], [0.75, "#5b1667"], [1, "#2d0b3f"]], { band: true, unit: "in" }),
    mph: S([[10, "#d4ecf7"], [15, "#9fd0ee"], [20, "#5fb0e0"], [25, "#3a8ccf"], [30, "#4cbf6a"], [35, "#9ad94a"], [40, "#f5e04a"], [45, "#f6a93a"], [50, "#ef6a2a"], [60, "#d1263a"], [70, "#a3157a"], [80, "#7e2fb0"], [100, "#e7c6ff"]], { band: true, unit: "mph" }),
    kt500: S([[30, "#d7ecf6"], [40, "#a8d2ec"], [50, "#78b4e0"], [60, "#4b8fd0"], [70, "#4cae6a"], [80, "#a2d34a"], [90, "#f2d84a"], [100, "#f4a23a"], [110, "#e8602b"], [120, "#c92a3a"], [140, "#9a1f8a"]], { band: true, unit: "kt" }),
    kt250: S([[50, "#d7ecf6"], [70, "#9ccbe9"], [90, "#5b9fd6"], [110, "#3e6fc0"], [130, "#6a4fb5"], [150, "#a03fb0"], [170, "#d44593"], [190, "#ef7a5e"], [210, "#f7c35c"]], { band: true, unit: "kt" }),
    cape: S([[100, "#d9f0d3"], [250, "#a6dba0"], [500, "#5aae61"], [1000, "#f6e04a"], [1500, "#f5a83a"], [2000, "#ec6a2b"], [2500, "#d7301f"], [3000, "#a50f3f"], [4000, "#7a0177"], [5000, "#c38bd8"]], { band: true, unit: "J/kg" }),
    srh: S([[50, "#e3f1fa"], [100, "#a9d3ef"], [150, "#6aaee0"], [200, "#4c8fd1"], [250, "#5bbf5f"], [300, "#b6d94a"], [400, "#f5d548"], [500, "#f39a37"], [600, "#e2502b"], [800, "#b2182b"], [1000, "#7a0177"]], { band: true, unit: "m²/s²" }),
    uh: S([[25, "#9fd6f0"], [50, "#3a8ccf"], [75, "#5bbf5f"], [100, "#f5d548"], [150, "#f39a37"], [200, "#e2502b"], [300, "#b2182b"], [400, "#7a0177"]], { band: true, unit: "m²/s²" }),
    pwat: S([[0.25, "#7a5230"], [0.5, "#b08a5a"], [0.75, "#dccfa0"], [1, "#b8e0a8"], [1.25, "#6cc070"], [1.5, "#2e9e5b"], [1.75, "#2c8fb8"], [2, "#3f63c8"], [2.25, "#6a3fb5"], [2.5, "#a53fae"], [3, "#e07ac0"]], { band: true, unit: "in" }),
    cloud: S([[10, [205, 210, 218, 0.18]], [30, [196, 202, 210, 0.42]], [50, [184, 190, 198, 0.6]], [70, [170, 176, 185, 0.74]], [90, [156, 162, 172, 0.86]], [100, [146, 152, 162, 0.9]]], { band: true, unit: "%" })
  };
  // precipitation type × reflectivity (dBZ): rain, snow, freezing rain, sleet, mix
  var PT = [null,
    S([[10, [120, 214, 120, 0.55]], [20, [76, 190, 88, 0.8]], [25, [40, 165, 64, 0.88]], [30, [22, 132, 52, 0.92]], [35, [246, 214, 52, 0.95]], [40, [255, 176, 40, 0.97]], [45, [255, 128, 32, 1]], [50, [236, 58, 40, 1]], [55, [178, 18, 40, 1]], [60, [222, 44, 196, 1]]], { band: true }),
    S([[5, [200, 225, 255, 0.5]], [10, [160, 200, 250, 0.72]], [20, [110, 160, 240, 0.86]], [30, [60, 110, 220, 0.95]], [40, [30, 60, 180, 1]], [50, [90, 40, 160, 1]]], { band: true }),
    S([[5, [250, 200, 225, 0.55]], [15, [240, 150, 200, 0.8]], [25, [225, 90, 170, 0.95]], [35, [190, 40, 140, 1]], [50, [140, 20, 110, 1]]], { band: true }),
    S([[5, [255, 220, 170, 0.55]], [15, [250, 180, 100, 0.82]], [25, [240, 140, 50, 0.95]], [40, [210, 100, 20, 1]]], { band: true }),
    S([[5, [225, 200, 250, 0.55]], [15, [200, 150, 240, 0.8]], [25, [160, 100, 220, 0.95]], [40, [110, 50, 180, 1]]], { band: true })
  ];
  var PTN = ["", "Rain", "Snow", "Freezing rain", "Sleet", "Mix"];

  // ---------- products ----------
  // f: fields for one hour. Components: { v: name(s), l: level(s), t: "i" instantaneous | [a, b, "acc"|"ave"|"max"] }
  function C(v, l, t) { return { v: [].concat(v), l: [].concat(l), t: t || "i" }; }
  var EA = ["entire atmosphere", "entire atmosphere (considered as a single layer)"];
  var K2F = function (k) { return (k - 273.15) * 1.8 + 32; }, MS2MPH = 2.23694, MS2KT = 1.94384, MM2IN = 1 / 25.4;
  // accumulations from the start of the run: model-specific buckets, summed through earlier hours where needed
  // NBM's 6-h precip buckets only end at 00/06/12/18Z; NAM 12 km uses 0–12 h then 12-h buckets on 00/12Z runs and
  //   3-h buckets on 06/18Z runs (r0 = the run's UTC hour)
  function bucket(model, h, id, r0) { return model === "nam12" ? (r0 % 12 ? h - (h % 3 || 3) : h <= 12 ? 0 : h % 12 ? h - h % 12 : h - 12) : model === "nam" ? h - (h % 3 || 3) : model === "gfs" ? (id === "qpf" ? 0 : Math.max(0, h - 6)) : model === "nbm" ? (id === "qpf" && h >= 6 && (r0 + h) % 6 === 0 ? h - 6 : h - 1) : 0; }
  // the hours a product exists at for a model (default: every hour the run has)
  function okHour(p, model, run, h) {
    var f = p.hrs && p.hrs[model]; if (f) return f(h, new Date(run).getUTCHours());
    if (p.win && h < p.win) return false;
    return true;
  }
  // a product's calculation: window products (6-/24-hr totals) reuse a total product
  function calcOf(p, model) { return p.base ? PBY[typeof p.base === "function" ? p.base(model) : p.base] : p; }
  // which products a model has (NBM only carries surface precip/snow/ice and temperature here)
  // the All maps menu lists only these (Tyler's pick, Oct 4); the rest stay defined for the data check (WXModels._probe).
  //   One "Total snowfall": NBM's own snow ratios on NBM, 10:1 elsewhere.
  var MENU = ["ptype", "t2", "w10", "gust", "tcc", "qpf", "sn10", "snv", "nsn", "frz", "p6", "p24", "s6", "s24", "i6"]; // menu order
  // two modes above the menu: Precip (what's falling and the weather around it) and Amounts (accumulations); the menu
  //   lists only the selected mode's maps, amounts grouped as totals from now and per-period amounts
  function isAmt(p) { return !!(p && (p.accum || p.win)); }
  function grp(p) { return isAmt(p) ? (p.win ? "Per period" : "Totals from now") : p.g; }
  function inMenu(id) { return MENU.indexOf(id) >= 0; }
  function has(p, model) { return model === "nbm" ? !!p.nbm : !p.only || p.only.indexOf(model) >= 0; }
  var P = [
    { id: "ptype", g: "Precipitation", name: "Precip type & reflectivity", types: true,
      calc: function (F) { return F.all([C("REFC", EA), C("CRAIN", "surface"), C("CSNOW", "surface"), C("CFRZR", "surface"), C("CICEP", "surface")], [1, 2, 3, 4]).then(ptypeOut); } },
    { id: "qpf", g: "Precipitation", name: "Total precipitation", sc: "qpf", accum: true, nbm: true, hrs: { nbm: function (h, r0) { return h <= 48 || (r0 + h) % 6 === 0; } },
      calc: function (F) { return F.total("qpf", function (a, b) { return F.get(C("APCP", "surface", [a, b, "acc"])).then(function (x) { return scale(x, MM2IN); }); }).then(function (v) { return { v: v }; }); } },
    { id: "mslp", g: "Precipitation", name: "MSLP & precip type", types: true, cont: { iv: 4, fmt: "hpa", hl: true },
      calc: function (F) {
        return Promise.all([F.all([C("REFC", EA), C("CRAIN", "surface"), C("CSNOW", "surface"), C("CFRZR", "surface"), C("CICEP", "surface")], [1, 2, 3, 4]).then(ptypeOut), F.get(C(["PRMSL", "MSLMA"], "mean sea level"))])
          .then(function (r) { r[0].c = scale(r[1], 0.01); return r[0]; });
      } },
    { id: "sn10", g: "Winter", name: "Total snowfall", sc: "snow", accum: true,
      calc: function (F) {
        return F.total("sn10", function (a, b) {
          if (F.model === "gfs") return Promise.all([F.get(C("APCP", "surface", [a, b, "acc"])), F.get(C("CSNOW", "surface", [a, b, "ave"]))]).then(function (r) { return mul(r[0], r[1], 10 * MM2IN); });
          return F.get(C("WEASD", "surface", [a, b, "acc"])).then(function (x) { return scale(x, 10 * MM2IN); });
        }).then(function (v) { return { v: v }; });
      } },
    { id: "nsn", g: "Winter", name: "Total snowfall", sc: "snow", accum: true, nbm: true, only: [], hrs: { nbm: function (h) { return h <= 48; } },
      calc: function (F) { return F.total("nsn", function (a, b) { return F.get(C("ASNOW", "surface", [a, b, "acc"])).then(function (x) { return scale(x, 39.3701); }); }).then(function (v) { return { v: v }; }); } },
    { id: "snv", g: "Winter", name: "Total snowfall (variable density)", sc: "snow", accum: true, only: ["hrrr", "rap"],
      calc: function (F) { return F.total("snv", function (a, b) { return F.get(C("ASNOW", "surface", [a, b, "acc"])).then(function (x) { return scale(x, 39.3701); }); }).then(function (v) { return { v: v }; }); } },
    { id: "frz", g: "Winter", name: "Freezing rain accumulation", sc: "ice", accum: true, nbm: true, hrs: { nbm: function (h) { return h <= 48; } },
      calc: function (F) {
        return F.total("frz", function (a, b) {
          if (F.model === "nbm") return F.get(C("FICEAC", "surface", [a, b, "acc"])).then(function (x) { return scale(x, MM2IN); }); // flat ice accumulation, kg/m² = mm
          if (F.model === "hrrr" || F.model === "rap") return F.get(C("FRZR", "surface", [a, b, "acc"])).then(function (x) { return scale(x, MM2IN); });
          return Promise.all([F.get(C("APCP", "surface", [a, b, "acc"])), F.get(C("CFRZR", "surface", F.model === "gfs" ? [a, b, "ave"] : "i"))]).then(function (r) { return mul(r[0], r[1], MM2IN); });
        }).then(function (v) { return { v: v }; });
      } },
    // period totals (what the NWS 6-hour and WPC daily maps show): the total over the last 6 or 24 hours
    { id: "p6", g: "Precipitation", name: "6-hr precipitation", sc: "qpf", win: 6, base: "qpf", nbm: true, hrs: { nbm: function (h, r0) { return h >= 6 && (h <= 48 || (r0 + h) % 6 === 0); } } },
    { id: "p24", g: "Precipitation", name: "24-hr precipitation", sc: "qpf", win: 24, base: "qpf", nbm: true, hrs: { nbm: function (h, r0) { return h >= 24 && (h <= 48 || (r0 + h) % 6 === 0); } } },
    { id: "s6", g: "Winter", name: "6-hr snowfall", sc: "snow", win: 6, base: function (m) { return m === "nbm" ? "nsn" : "sn10"; }, nbm: true, hrs: { nbm: function (h) { return h >= 6 && h <= 48; } } },
    { id: "s24", g: "Winter", name: "24-hr snowfall", sc: "snow", win: 24, base: function (m) { return m === "nbm" ? "nsn" : "sn10"; }, nbm: true, hrs: { nbm: function (h) { return h >= 24 && h <= 48; } } },
    { id: "i6", g: "Winter", name: "6-hr ice", sc: "ice", win: 6, base: "frz", nbm: true, hrs: { nbm: function (h) { return h >= 6 && h <= 48; } } },
    // NBM daytime highs (12-h max ending 00Z) and overnight lows (ending 12Z), like the NWS MaxT/MinT maps
    { id: "maxt", g: "Temperature", name: "Daytime high", sc: "tF", nbm: true, only: [], day: "max", hrs: { nbm: function (h, r0) { return h >= 12 && (r0 + h) % 24 === 0; } },
      calc: function (F) { return F.get(C("TMAX", "2 m above ground", [F.h - 12, F.h, "max"])).then(function (x) { return { v: map(x, K2F) }; }); } },
    { id: "mint", g: "Temperature", name: "Overnight low", sc: "tF", nbm: true, only: [], day: "min", hrs: { nbm: function (h, r0) { return h >= 12 && (r0 + h) % 24 === 12; } },
      calc: function (F) { return F.get(C("TMIN", "2 m above ground", [F.h - 12, F.h, "min"])).then(function (x) { return { v: map(x, K2F) }; }); } },
    { id: "feels", g: "Temperature", name: "Feels-like temperature", sc: "tF", nbm: true, only: [],
      calc: function (F) { return F.get(C("APTMP", "2 m above ground")).then(function (x) { return { v: map(x, K2F) }; }); } },
    { id: "t2", g: "Temperature", name: "2-m temperature", sc: "tF", nbm: true, cont: { levels: [32], fmt: "int", bold: true },
      calc: function (F) { return F.get(C("TMP", "2 m above ground")).then(function (x) { var v = map(x, K2F); return { v: v, c: v }; }); } },
    { id: "td2", g: "Temperature", name: "2-m dew point", sc: "tdF",
      calc: function (F) { return F.get(C("DPT", "2 m above ground")).then(function (x) { return { v: map(x, K2F) }; }); } },
    { id: "t850", g: "Temperature", name: "850-mb temperature & height", sc: "tC", cont: { iv: 3, fmt: "dam" },
      calc: function (F) { return Promise.all([F.get(C("TMP", "850 mb")), F.get(C("HGT", "850 mb"))]).then(function (r) { return { v: map(r[0], function (k) { return k - 273.15; }), c: scale(r[1], 0.1) }; }); } },
    { id: "w10", g: "Wind", name: "10-m wind", sc: "mph", barbs: true,
      calc: function (F) { return Promise.all([F.get(C("UGRD", "10 m above ground")), F.get(C("VGRD", "10 m above ground"))]).then(function (r) { return { v: speed(r[0], r[1], MS2MPH), u: scale(r[0], MS2KT), w: scale(r[1], MS2KT) }; }); } },
    { id: "gust", g: "Wind", name: "Wind gusts", sc: "mph",
      calc: function (F) { return F.get(C("GUST", "surface")).then(function (x) { return { v: scale(x, MS2MPH) }; }); } },
    { id: "cape", g: "Severe", name: "Surface-based CAPE", sc: "cape",
      calc: function (F) { return F.get(C("CAPE", "surface")).then(function (x) { return { v: x }; }); } },
    { id: "srh", g: "Severe", name: "0–3 km storm-relative helicity", sc: "srh",
      calc: function (F) { return F.get(C("HLCY", "3000-0 m above ground")).then(function (x) { return { v: x }; }); } },
    { id: "uh", g: "Severe", name: "Updraft helicity (1-hr max)", sc: "uh", only: ["hrrr", "nam"],
      calc: function (F) { return F.h ? F.get(C("MXUPHL", "5000-2000 m above ground", [F.h - 1, F.h, "max"])).then(function (x) { return { v: x }; }) : F.zeros().then(function (z) { return { v: z }; }); } },
    { id: "h500", g: "Upper air", name: "500-mb height & wind", sc: "kt500", cont: { iv: 6, fmt: "dam" },
      calc: function (F) { return Promise.all([F.get(C("UGRD", "500 mb")), F.get(C("VGRD", "500 mb")), F.get(C("HGT", "500 mb"))]).then(function (r) { return { v: speed(r[0], r[1], MS2KT), c: scale(r[2], 0.1) }; }); } },
    { id: "j250", g: "Upper air", name: "250-mb jet stream", sc: "kt250", cont: { iv: 12, fmt: "dam" },
      calc: function (F) {
        return Promise.all([F.get(C("UGRD", "250 mb")), F.get(C("VGRD", "250 mb")), F.get(C("HGT", "250 mb")).catch(function () { return null; })])
          .then(function (r) { return { v: speed(r[0], r[1], MS2KT), c: r[2] ? scale(r[2], 0.1) : null }; });
      } },
    { id: "pwat", g: "Other", name: "Precipitable water", sc: "pwat",
      calc: function (F) { return F.get(C("PWAT", EA)).then(function (x) { return { v: scale(x, MM2IN) }; }); } },
    { id: "tcc", g: "Other", name: "Total cloud cover", sc: "cloud",
      calc: function (F) { return F.get(C("TCDC", EA)).then(function (x) { return { v: x }; }); } }
  ];
  var PBY = {}; P.forEach(function (p) { PBY[p.id] = p; });
  function map(a, f) { var o = new Float32Array(a.length); for (var i = 0; i < a.length; i++) o[i] = f(a[i]); return o; }
  function scale(a, k) { var o = new Float32Array(a.length); for (var i = 0; i < a.length; i++) o[i] = a[i] * k; return o; }
  function mul(a, b, k) { var o = new Float32Array(a.length); for (var i = 0; i < a.length; i++) o[i] = Number.isFinite(a[i]) && Number.isFinite(b[i]) ? a[i] * Math.max(0, b[i]) * k : NaN; return o; }
  function speed(u, v, k) { var o = new Float32Array(u.length); for (var i = 0; i < u.length; i++) o[i] = Math.sqrt(u[i] * u[i] + v[i] * v[i]) * k; return o; }
  // type code: freezing rain beats sleet beats snow (snow with rain = mix); rain when nothing else is flagged
  function ptypeOut(r) {
    var z = r[0], n = z.length, t = new Uint8Array(n), R = r[1], Sn = r[2], Z = r[3], I = r[4];
    for (var i = 0; i < n; i++) t[i] = Z && Z[i] > 0.5 ? 3 : I && I[i] > 0.5 ? 4 : Sn && Sn[i] > 0.5 ? (R && R[i] > 0.5 ? 5 : 2) : 1;
    return { v: z, t: t };
  }

  // ---------- worker: fetch, decode, compute, crop ----------
  if (INW) {
    var CK = "wx-model-1", IDX = {}, ACC = new Map(), nproj = {};
    var cache = typeof caches !== "undefined" ? caches.open(CK).catch(function () { return null; }) : Promise.resolve(null);
    // range reads are kept in the Cache API (published files never change), so reopening and re-cropping are free
    cache.then(function (c) {
      if (!c) return;
      c.keys().then(function (ks) { ks.forEach(function (q) { var m = /\.(\d{8})\/.*?\.t(\d\d)z/.exec(decodeURIComponent(q.url)); var t = m ? Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8), +m[2]) : 0; if (Date.now() - t > 30 * H) c.delete(q); }); });
    });
    var getRange = function (url, a, b) {
      var key = url + "?bytes=" + a + "-" + (b == null ? "" : b);
      var net = function () {
        return fetch(url, { headers: { Range: "bytes=" + a + "-" + (b == null ? "" : b) } }).then(function (r) {
          // a full-file reply (200) to a range request would be hundreds of MB: stop it rather than read it
          if (r.status !== 206) { if (r.body) r.body.cancel().catch(function () {}); throw new Error("download failed (" + r.status + ")"); }
          return r.arrayBuffer();
        });
      };
      return cache.then(function (c) {
        if (!c) return net();
        return c.match(key).then(function (hit) {
          if (hit) return hit.arrayBuffer();
          return net().then(function (buf) { c.put(key, new Response(buf)).catch(function () {}); return buf; });
        });
      });
    };
    var getIdx = function (url) {
      if (IDX[url]) return IDX[url];
      var p = IDX[url] = fetch(url).then(function (r) { if (!r.ok) throw new Error("hour not published yet"); return r.text(); }).then(function (tx) {
        // "303.2" = second field of the message at that offset; a message ends where the next one starts
        var L = tx.trim().split("\n").map(function (s) { var f = s.split(":"); return { a: +f[1], sub: +(String(f[0]).split(".")[1] || 1), v: f[3], l: f[4], t: f[5], x: f.slice(6).join(":") }; });
        L.forEach(function (e, i) { var k = i + 1; while (k < L.length && L[k].a <= e.a) k++; e.b = k < L.length ? L[k].a - 1 : null; });
        return L;
      });
      p.catch(function () { delete IDX[url]; });
      return p;
    };
    var timeStr = function (t, h) {
      if (t === "i") return [h === 0 ? "anl" : h + " hour fcst"];
      var s = t[0] + "-" + t[1] + " hour " + t[2] + " fcst", o = [s];
      if (t[0] === 0 && t[1] % 24 === 0 && t[1] > 0) o.unshift("0-" + t[1] / 24 + " day " + t[2] + " fcst");
      return o;
    };
    var FCACHE = new Map();
    var fieldGrid = function (model, run, h, c) {
      var M = MODELS[model], path = M.file(run, h), url = fileUrl(M, path), ts = timeStr(c.t, h), key = url + "|" + c.v + "|" + c.l + "|" + ts[0];
      if (FCACHE.has(key)) { var hit = FCACHE.get(key); FCACHE.delete(key); FCACHE.set(key, hit); return hit; }
      var p = getIdx(fileUrl(M, path + ".idx")).then(function (L) {
        var e = null;
        for (var a = 0; a < c.v.length && !e; a++) for (var b = 0; b < c.l.length && !e; b++) for (var k = 0; k < ts.length && !e; k++)
          // the plain field only: NBM lists probabilities/percentiles under the same name and time ("prob >0.254")
          e = L.filter(function (x) { return x.v === c.v[a] && x.l === c.l[b] && x.t === ts[k] && !x.x; })[0] || null;
        if (!e) throw new Error("no " + c.v[0] + " " + c.l[0] + " " + ts[0]);
        return getRange(url, e.a, e.b).then(function (buf) { return [buf, e.sub]; });
      }).then(function (x) {
        var m = parse(new Uint8Array(x[0]), x[1]), v = unpack(m);
        return { g: m.g, v: v };
      });
      FCACHE.set(key, p); p.catch(function () { FCACHE.delete(key); });
      if (FCACHE.size > 10) FCACHE.delete(FCACHE.keys().next().value);
      return p;
    };
    var runJob = function (m) {
      var g0 = null, F = {
        model: m.model, h: m.h,
        get: function (c, h) { return fieldGrid(m.model, m.run, h == null ? m.h : h, c).then(function (r) { g0 = g0 || r.g; return r.v; }); },
        all: function (cs, opt) { return Promise.all(cs.map(function (c, i) { var p = F.get(c); return opt.indexOf(i) >= 0 ? p.catch(function () { return null; }) : p; })); },
        zeros: function () { return F.get(C("TMP", "2 m above ground")).then(function (x) { return new Float32Array(x.length); }); },
        // total from the start of the run: total(start of this hour's bucket) + bucket
        total: function (id, inc) {
          function tot(h) {
            var key = m.model + m.run + id + "|" + h;
            if (ACC.has(key)) return ACC.get(key);
            var p = h === 0 ? F.zeros() : (function () {
              var a = bucket(m.model, h, id, new Date(m.run).getUTCHours());
              return Promise.all([a > 0 ? tot(a) : null, withHour(h, function () { return inc(a, h); })]).then(function (r) {
                if (!r[0]) return r[1]; var o = new Float32Array(r[1].length); for (var i = 0; i < o.length; i++) o[i] = Number.isFinite(r[0][i]) && Number.isFinite(r[1][i]) ? r[0][i] + Math.max(0, r[1][i]) : NaN; return o;
              });
            })();
            ACC.set(key, p); p.catch(function () { ACC.delete(key); });
            if (ACC.size > 8) ACC.delete(ACC.keys().next().value);
            return p;
          }
          // upcoming totals: from the hour now (m.from) to this hour
          if (!m.from) return tot(m.h);
          return Promise.all([tot(m.h), tot(m.from)]).then(function (r) { var o = new Float32Array(r[0].length); for (var i = 0; i < o.length; i++) { var d = r[0][i] - r[1][i]; o[i] = Number.isFinite(d) ? Math.max(0, d) : NaN; } return o; });
        }
      };
      // run inc() with F.get reading hour h
      function withHour(h, fn) { var keep = F.get; F.get = function (c) { return keep(c, h); }; try { return fn(); } finally { F.get = keep; } }
      return calcOf(PBY[m.param], m.model).calc(F).then(function (r) {
        if (!g0) return F.get(C("TMP", "2 m above ground")).then(function () { return [r, g0]; });
        return [r, g0];
      }).then(function (x) { return crop(x[0], x[1], m); });
    };
    // crop to the area around the view, at a stride that matches the screen
    var crop = function (r, g, m) {
      var key = JSON.stringify([g.t, g.nx, g.ny, g.la1, g.lo1, g.dx, g.lov]), pr = nproj[key] || (nproj[key] = proj(g)), o = [0, 0];
      var i0 = 1e9, j0 = 1e9, i1 = -1e9, j1 = -1e9, b = m.box;
      for (var k = 0; k <= 16; k++) for (var q = 0; q <= 16; q++) {
        if (k && k < 16 && q && q < 16) continue;
        pr.fwd(b.s + (b.n - b.s) * k / 16, b.w + (b.e - b.w) * q / 16, o);
        i0 = Math.min(i0, o[0]); i1 = Math.max(i1, o[0]); j0 = Math.min(j0, o[1]); j1 = Math.max(j1, o[1]);
      }
      i0 = Math.max(0, Math.floor(i0) - 2); j0 = Math.max(0, Math.floor(j0) - 2); i1 = Math.min(g.nx - 1, Math.ceil(i1) + 2); j1 = Math.min(g.ny - 1, Math.ceil(j1) + 2);
      if (i1 <= i0 || j1 <= j0) return { empty: true, g: g };
      var s = Math.max(1, Math.floor(Math.max((i1 - i0) / m.want, (j1 - j0) / m.want)));
      function cut(a, st, T) {
        if (!a) return null;
        var nx = Math.floor((i1 - i0) / st) + 1, ny = Math.floor((j1 - j0) / st) + 1, out = new (T || Float32Array)(nx * ny);
        for (var y = 0; y < ny; y++) { var row = (j0 + y * st) * g.nx + i0; for (var x = 0; x < nx; x++) out[y * nx + x] = a[row + x * st]; }
        return { a: out, nx: nx, ny: ny, s: st };
      }
      return { g: g, i0: i0, j0: j0, v: cut(r.v, s), t: cut(r.t, s, Uint8Array), c: smooth(cut(r.c, s * (s > 1 ? 1 : 2))), u: cut(r.u, s * 3), w: cut(r.w, s * 3) };
    };
    // contour fields get one light 3×3 average so lines follow the pattern rather than every grid wiggle
    var smooth = function (A) {
      if (!A) return A;
      var a = A.a, nx = A.nx, ny = A.ny, o = new Float32Array(a.length);
      for (var y = 0; y < ny; y++) for (var x = 0; x < nx; x++) {
        var sum = 0, n = 0;
        for (var dy = -1; dy <= 1; dy++) { var yy = y + dy; if (yy < 0 || yy >= ny) continue; for (var dx = -1; dx <= 1; dx++) { var xx = x + dx; if (xx < 0 || xx >= nx) continue; var q = a[yy * nx + xx]; if (q === q) { sum += q; n++; } } }
        o[y * nx + x] = n ? sum / n : NaN;
      }
      A.a = o; return A;
    };
    root.onmessage = function (ev) {
      var m = ev.data;
      runJob(m).then(function (r) {
        var tr = []; ["v", "t", "c", "u", "w"].forEach(function (k) { if (r[k]) tr.push(r[k].a.buffer); });
        root.postMessage({ id: m.id, r: r }, tr);
      }, function (e) { root.postMessage({ id: m.id, err: String(e && e.message || e) }); });
    };
    return;
  }
  if (typeof document === "undefined") { root.WXModelsCore = { parse: parse, unpack: unpack, proj: proj, MODELS: MODELS, P: P }; return; }

  // ---------- page side ----------
  var VM = root.WXVMap, TS = 256;
  var el, stage, cvB, cvF, cvT, cvO, cxB, cxF, cxT, cxO, ui = {}, W = 0, HH = 0, M = 0, SW = 0, SH = 0, dpr = 1, on = false, opts = {}, loc = null;
  var view = { x: 0.5, y: 0.5, z: 5.5 }, drawn = null, need = 0, raf = 0;
  var st = (function () { try { return JSON.parse(localStorage.getItem("wx-model") || "null"); } catch (e) { return null; } })() || {};
  var winter = [10, 11, 0, 1, 2, 3].indexOf(new Date().getMonth()) >= 0;
  var cur = { model: st.model || "hrrr", param: st.param || (winter ? "sn10" : "qpf"), run: null, k: 0 }, userRun = false;
  if (!PBY[cur.param] || !has(PBY[cur.param], cur.model) || !inMenu(cur.param)) cur.param = "qpf";
  var lockedWindow = null, timeRequest = 0;
  var runs = {}, frames = {}, gen = 0, playing = false, playT = 0, readout = null;
  function save() { try { localStorage.setItem("wx-model", JSON.stringify({ model: cur.model, param: cur.param })); } catch (e) {} }
  function dark() { var t = document.documentElement.dataset.theme; return t ? t === "dark" : !!(root.matchMedia && root.matchMedia("(prefers-color-scheme: dark)").matches); }
  function scaleZ(z) { return TS * Math.pow(2, z); }
  function wx(lon) { return (lon + 180) / 360; }
  function wy(lat) { var s = Math.sin(lat * D2R); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); }
  function lonOf(x) { return x * 360 - 180; }
  function latOf(y) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / D2R; }
  function inConus(l) { return l.lat > 21 && l.lat < 53 && l.lon > -134 && l.lon < -60; }

  // ---------- runs and hours ----------
  function listRun(model, run) {
    var Mo = MODELS[model], pre = Mo.prefix(run), hs = [];
    // S3 lists 1000 keys per page (NBM has 10 files per hour), so follow continuation tokens
    function add(k) { var m = Mo.hourOf.exec(k); if (m && +m[1] % Mo.step === 0 && +m[1] <= Mo.max(run)) hs.push(+m[1]); }
    // Google Cloud's JSON API lists names as JSON, also in pages
    function gpage(tok, n) {
      return fetch(Mo.base + "?prefix=" + encodeURIComponent(pre) + "&fields=items(name),nextPageToken&maxResults=1000" + (tok ? "&pageToken=" + encodeURIComponent(tok) : "")).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
        (j.items || []).forEach(function (o) { add(o.name); });
        return j.nextPageToken && n < 4 ? gpage(j.nextPageToken, n + 1) : null;
      });
    }
    function page(tok, n) {
      if (Mo.gcs) return gpage(tok, n);
      return fetch(Mo.base + "?list-type=2&prefix=" + encodeURIComponent(pre) + (tok ? "&continuation-token=" + encodeURIComponent(tok) : "")).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (x) {
        var re = /<Key>([^<]+)<\/Key>/g, k;
        while ((k = re.exec(x))) add(k[1]);
        var nt = /<NextContinuationToken>([^<]+)</.exec(x);
        return nt && n < 4 ? page(nt[1].replace(/&amp;/g, "&"), n + 1) : null;
      });
    }
    return page(null, 0).then(function () { return hs.sort(function (a, b) { return a - b; }); }).catch(function () { return null; });
  }
  function findRuns(model) {
    if (runs[model] && Date.now() - runs[model].at < 5 * 60000) return Promise.resolve(runs[model].list);
    var Mo = MODELS[model], c = Mo.cycle * H, t0 = Math.floor(Date.now() / c) * c, cand = [];
    for (var i = 0; i < (model === "hrrr" ? 8 : 5); i++) cand.push(t0 - i * c);
    // Keep prior 48-hour HRRR cycles available for exact-window run trends.
    if (model === "hrrr") {
      var synoptic = Math.floor(Date.now() / (6 * H)) * 6 * H;
      for (var j = 0; j < 4; j++) { var older = synoptic - j * 6 * H; if (cand.indexOf(older) < 0) cand.push(older); }
      cand.sort(function (a, b) { return b - a; });
    }
    return Promise.all(cand.map(function (r) { return listRun(model, r).then(function (hs) { return { run: r, hours: hs, max: Mo.max(r) }; }); })).then(function (L) {
      // every listing failed: NOAA's bucket couldn't be reached (try again on the next refresh)
      if (L.every(function (x) { return !x.hours; })) { runs[model] = { at: 0, list: [], fail: true }; return []; }
      L = L.filter(function (x) { return x.hours && x.hours.length; });
      runs[model] = { at: Date.now(), list: L };
      return L;
    });
  }
  // newest run that's at least half published (a run fills in over 1–5 hours)
  function pickRun(L, model) {
    var Mo = MODELS[model || cur.model], full = function (x) { return x.hours.length >= (Mo.need || (x.max / Mo.step + 1) * 0.5); };
    return (L.filter(full)[0] || L[0] || null);
  }
  function R() { var L = runs[cur.model] && runs[cur.model].list || []; return L.filter(function (x) { return x.run === cur.run; })[0] || null; }
  // accumulations count from the hour now (upcoming totals), so their slider starts after it
  function fromH() {
    if (lockedWindow) return (lockedWindow.start - cur.run) / H;
    var r = R(); if (!r || !PBY[cur.param].accum) return 0;
    var f = 0; r.hours.forEach(function (h) { if (r.run + h * H <= Date.now() + 10 * 60000) f = h; });
    return f;
  }
  function hours() {
    var r = R(); if (!r) return [];
    if (lockedWindow) return [(lockedWindow.end - cur.run) / H];
    var p = PBY[cur.param], f = fromH(), now = Date.now() - 30 * 60000;
    return r.hours.filter(function (h) {
      if (!okHour(p, cur.model, r.run, h)) return false;
      if (p.accum) return h > f;
      if (p.win || p.day) return r.run + h * H > now; // periods ending from now on
      return true;
    });
  }

  // ---------- workers ----------
  var WK = null, wjobs = {}, wid = 0, Q = [], busy = 0;
  function workers() {
    if (WK !== null) return WK;
    WK = false;
    if (!SELF || typeof Worker === "undefined") return WK;
    try { WK = [0, 1].map(function () { var w = new Worker(SELF); w.onmessage = fromW; w.onerror = function (e) { e.preventDefault(); }; return w; }); } catch (x) { WK = false; }
    return WK;
  }
  function fromW(ev) { var r = ev.data, j = wjobs[r.id]; if (!j) return; delete wjobs[r.id]; busy--; j.cb(r); pump(); }
  function pump() {
    while (busy < 4 && Q.length) {
      var j = Q.shift(); if (j.gen !== gen && !j.keep) continue;
      j.m.id = ++wid; wjobs[j.m.id] = j; busy++; WK[j.m.id % WK.length].postMessage(j.m);
    }
  }
  function fkey(h) { return cur.model + "|" + cur.run + "|" + cur.param + "|" + fromH() + "|" + h; }
  // the area to crop to: the view plus half its size on each side
  function boxNow() {
    var s = scaleZ(view.z), hw = W / s, hh2 = HH / s;
    return { w: lonOf(view.x - hw), e: lonOf(view.x + hw), n: latOf(Math.max(0.001, view.y - hh2)), s: latOf(Math.min(0.999, view.y + hh2)), z: view.z, x: view.x, y: view.y };
  }
  var BOX = null;
  // a frame needs reloading when the view has left its area or zoomed in well past its detail
  function boxOk(b) { if (!b) return false; var s = scaleZ(view.z), hw = W / 2 / s, hh2 = HH / 2 / s; return Math.abs(view.x - b.x) + hw < (W / scaleZ(b.z)) * 1.02 && Math.abs(view.y - b.y) + hh2 < (HH / scaleZ(b.z)) * 1.02 && view.z - b.z < 0.8; }
  function request(h, front) {
    var k = fkey(h), f = frames[k];
    if (f && (f.loading || f.err || f.box === BOX)) return;
    var pp = PBY[cur.param], job = { gen: gen, m: { model: cur.model, run: cur.run, h: h, from: pp.win ? h - pp.win : fromH(), param: cur.param, box: BOX, want: Math.round(Math.max(W, HH) * 1.6) }, cb: null };
    var fr = frames[k] = f || {}; fr.loading = true;
    job.cb = function (r) {
      fr.loading = false;
      if (r.err) { if (!fr.r) fr.err = r.err; } else { fr.r = prep(r.r); fr.box = job.m.box; fr.err = null; }
      if (!r.err && fr.r && fr.r.types && on && PBY[cur.param].types) legend();
      if (on && hours()[cur.k] === h) paint(6);
      status();
    };
    if (front) Q.unshift(job); else Q.push(job);
    pump(); status();
  }
  function prep(r) {
    if (r.empty) return r;
    r.P = projFor(r.g);
    // which precipitation types have a visible echo in this frame (for the legend)
    if (r.t && r.v) { var T = r.t.a, V = r.v.a, has = {}, out = []; for (var i = 0; i < T.length; i++) { var t = T[i]; if (t && !has[t] && V[i] >= (t === 1 ? 10 : 5)) { has[t] = 1; out.push(t); } } r.types = out; }
    return r;
  }
  var PJ = {};
  function projFor(g) { var k = JSON.stringify([g.t, g.nx, g.ny, g.la1, g.lo1, g.dx, g.lov]); return PJ[k] || (PJ[k] = { k: k, p: proj(g) }); }
  function loadAround() {
    var hs = hours(); if (!hs.length) return;
    if (!boxOk(BOX)) BOX = boxNow();
    request(hs[cur.k], true);
    var order = [];
    if (playing) { for (var i = 1; i < hs.length; i++) order.push(hs[(cur.k + i) % hs.length]); }
    else [1, -1, 2, -2].forEach(function (d) { var h = hs[cur.k + d]; if (h != null) order.push(h); });
    order.forEach(function (h) { request(h); });
  }
  function status() {
    if (!ui.st) return;
    var hs = hours(), f = frames[fkey(hs[cur.k])], loading = Q.length + busy, t = "";
    if (!R()) t = !runs[cur.model] ? "Loading model runs…" : runs[cur.model].fail ? "Model data couldn't load right now" : "No recent " + MODELS[cur.model].name + " runs found";
    else if (f && f.err && !f.r) t = /not published/.test(f.err) ? "This hour isn't published yet" : "This map isn't available for this hour";
    else if (!f || !f.r) t = "Loading…";
    else if (playing && loading) { var n = hs.filter(function (h) { var x = frames[fkey(h)]; return x && x.r; }).length; t = "Loading loop " + n + "/" + hs.length; }
    if (ui.st.textContent !== t) { ui.st.textContent = t; ui.st.hidden = !t; }
  }

  // ---------- drawing ----------
  function paint(bits) { need |= bits == null ? 15 : bits; if (on && !raf) raf = requestAnimationFrame(frame); }
  function frame() {
    raf = 0; if (!on || !W) return;
    if (need & 16 || !drawn) { drawn = { x: view.x, y: view.y, z: view.z }; need |= 15; stage.style.transform = ""; }
    var n = need; need = 0;
    if (n & 1) drawBase();
    if (n & 2) drawField();
    if (n & 4) drawOver();
    if (n & 8) drawTop();
    inspect();
  }
  function slots(zt, dp) {
    var n = Math.pow(2, zt), s = scaleZ(drawn.z), out = [];
    var l = drawn.x - SW / 2 / s, r = drawn.x + SW / 2 / s, t = drawn.y - SH / 2 / s, b = drawn.y + SH / 2 / s;
    var px = function (x) { return Math.round(((x - drawn.x) * s + SW / 2) * dp); }, py = function (y) { return Math.round(((y - drawn.y) * s + SH / 2) * dp); };
    for (var j = Math.max(0, Math.floor(t * n)); j <= Math.min(n - 1, Math.floor(b * n)); j++)
      for (var i = Math.floor(l * n); i <= Math.floor(r * n); i++) out.push({ i: i, j: j, n: n, z: zt, x0: px(i / n), y0: py(j / n), x1: px((i + 1) / n), y1: py((j + 1) / n) });
    return out;
  }
  function vec() { return VM && VM.ok(); }
  function drawBase() {
    cxB.setTransform(1, 0, 0, 1, 0, 0);
    if (vec()) VM.drawBase(cxB, slots(VM.tileZoom(drawn.z), dpr), { dark: dark(), dpr: dpr, z: drawn.z });
    else { cxB.fillStyle = dark() ? "#000" : "#f3f3f1"; cxB.fillRect(0, 0, cvB.width, cvB.height); }
  }
  function drawTop() {
    cxT.setTransform(1, 0, 0, 1, 0, 0); cxT.clearRect(0, 0, cvT.width, cvT.height);
    if (vec()) VM.drawTop(cxT, slots(VM.tileZoom(drawn.z), dpr), { dark: dark(), dpr: dpr, z: drawn.z, w: SW, h: SH });
  }
  // field samples: one per CSS pixel (the fields are smooth; the canvas upscales)
  var FV = { key: "" }, img = null;
  // the field is drawn at up to 2 device pixels per CSS pixel (crisp band edges like Pivotal's maps), capped at ~1 M pixels
  var FD = { f: 1, w: 0, h: 0 };
  function fdims() { var f = Math.min(2, dpr || 1); while (f > 1 && SW * SH * f * f > 1.1e6) f -= 0.25; FD = { f: f, w: Math.round(SW * f), h: Math.round(SH * f) }; }
  function sampleGrid(P) {
    fdims(); var FW = FD.w, FH = FD.h, f = FD.f;
    var vk = drawn.x + "," + drawn.y + "," + drawn.z + "," + FW + "," + FH;
    if (FV.key !== vk) { FV = { key: vk, pk: {} }; }
    if (FV.pk[P.k]) return FV.pk[P.k];
    var n = FW * FH, gi = new Float32Array(n), gj = new Float32Array(n), s = scaleZ(drawn.z), o = [0, 0], lat = new Float32Array(FH);
    for (var y = 0; y < FH; y++) lat[y] = latOf(drawn.y + ((y + 0.5) / f - SH / 2) / s);
    for (y = 0; y < FH; y++) for (var x = 0; x < FW; x++) { P.p.fwd(lat[y], lonOf(drawn.x + ((x + 0.5) / f - SW / 2) / s), o); gi[y * FW + x] = o[0]; gj[y * FW + x] = o[1]; }
    return (FV.pk[P.k] = { gi: gi, gj: gj });
  }
  var LUTS = {};
  function lut(sc) {
    if (sc.L) return sc.L;
    var N = 4096, st2 = sc.stops, lo = st2[0][0], hi = st2[st2.length - 1][0], L = new Uint32Array(N);
    for (var i = 0; i < N; i++) {
      var v = lo + (hi - lo) * i / (N - 1), a = 0;
      while (a < st2.length - 2 && v >= st2[a + 1][0]) a++;
      var c0 = st2[a][1], c1 = st2[a + 1][1], f = sc.band ? (v >= st2[a + 1][0] ? 1 : 0) : Math.max(0, Math.min(1, (v - st2[a][0]) / (st2[a + 1][0] - st2[a][0]))), c = [0, 1, 2, 3].map(function (q) { return c0[q] + (c1[q] - c0[q]) * f; });
      L[i] = (Math.round(c[3] * 255) << 24 | Math.round(c[2]) << 16 | Math.round(c[1]) << 8 | Math.round(c[0])) >>> 0;
    }
    return (sc.L = { lo: lo, k: (N - 1) / (hi - lo), N: N, L: L, under: !!sc.under });
  }
  function cur3() { var hs = hours(), f = frames[fkey(hs[cur.k])]; return f && f.r && !f.r.empty ? f.r : null; }
  function drawField() {
    var r = cur3(), p = PBY[cur.param];
    fdims(); var FW = FD.w, FH = FD.h;
    if (cvF.width !== FW || cvF.height !== FH) { cvF.width = FW; cvF.height = FH; img = null; }
    if (!r) { cxF.clearRect(0, 0, FW, FH); return; }
    if (!img) img = cxF.createImageData(FW, FH);
    var d32 = new Uint32Array(img.data.buffer), G = sampleGrid(r.P), V = r.v, nx = V.nx, ny = V.ny, s = V.s, a = V.a, T = r.t, i0 = r.i0, j0 = r.j0;
    var Ls = p.types ? PT.map(function (sc) { return sc && lut(sc); }) : null, L1 = p.types ? null : lut(SC[p.sc]);
    for (var k = 0, n = FW * FH; k < n; k++) {
      var fi = (G.gi[k] - i0) / s, fj = (G.gj[k] - j0) / s;
      if (!(fi >= 0 && fj >= 0 && fi <= nx - 1 && fj <= ny - 1)) { d32[k] = 0; continue; }
      var x0 = fi | 0, y0 = fj | 0, x1 = x0 < nx - 1 ? x0 + 1 : x0, y1 = y0 < ny - 1 ? y0 + 1 : y0, fx = fi - x0, fy = fj - y0;
      var q00 = a[y0 * nx + x0], q10 = a[y0 * nx + x1], q01 = a[y1 * nx + x0], q11 = a[y1 * nx + x1];
      var v = (q00 * (1 - fx) + q10 * fx) * (1 - fy) + (q01 * (1 - fx) + q11 * fx) * fy;
      if (v !== v) { v = fx < 0.5 ? (fy < 0.5 ? q00 : q01) : (fy < 0.5 ? q10 : q11); if (v !== v) { d32[k] = 0; continue; } }
      var L = L1;
      if (Ls) { var tc = T ? T.a[Math.round(fj) * nx + Math.round(fi)] : 1; L = Ls[tc || 1]; }
      if (v < L.lo) { d32[k] = L.under ? L.L[0] : 0; continue; }
      var ix = ((v - L.lo) * L.k) | 0; d32[k] = L.L[ix < L.N ? ix : L.N - 1];
    }
    cxF.putImageData(img, 0, 0);
  }
  // node positions on screen for a crop grid (contours, barbs)
  function nodes(r, A) {
    var key = FV.key + "|" + r.P.k + "|" + r.i0 + "," + r.j0 + "," + A.s + "," + A.nx + "," + A.ny;
    if (A.scr && A.scr.key === key) return A.scr;
    var n = A.nx * A.ny, X = new Float32Array(n), Y = new Float32Array(n), LON = new Float32Array(n), s = scaleZ(drawn.z), o = [0, 0];
    for (var y = 0; y < A.ny; y++) for (var x = 0; x < A.nx; x++) {
      r.P.p.inv(r.i0 + x * A.s, r.j0 + y * A.s, o); var k = y * A.nx + x;
      X[k] = ((wx(o[1]) - drawn.x) * s + SW / 2); Y[k] = ((wy(o[0]) - drawn.y) * s + SH / 2); LON[k] = o[1];
    }
    return (A.scr = { key: key, X: X, Y: Y, LON: LON });
  }
  function drawOver() {
    var d = dpr, c = cxO; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cvO.width, cvO.height); c.setTransform(d, 0, 0, d, 0, 0);
    var r = cur3(), p = PBY[cur.param], dk = dark();
    if (r && p.cont && r.c) contours(c, r, r.c, p.cont, dk);
    if (r && p.barbs && r.u) barbs(c, r, dk);
    if (gps && gpsMode !== "off") { var g = toScr(gps.lat, gps.lon); c.beginPath(); c.arc(g.x, g.y, 6.5, 0, 7); c.fillStyle = "#0a84ff"; c.fill(); c.lineWidth = 2.5; c.strokeStyle = "#fff"; c.stroke(); }
    if (loc) { var q = toScr(loc.lat, loc.lon); c.beginPath(); c.arc(q.x, q.y, 5.5, 0, 7); c.lineWidth = 2.5; c.strokeStyle = dk ? "#000" : "#fff"; c.stroke(); c.lineWidth = 1.6; c.strokeStyle = dk ? "#fff" : "#15202b"; c.stroke(); }
  }
  function toScr(lat, lon) { var s = scaleZ(drawn.z); return { x: (wx(lon) - drawn.x) * s + SW / 2, y: (wy(lat) - drawn.y) * s + SH / 2 }; }
  // marching squares on the crop grid, drawn as screen segments with labels
  function contours(c, r, A, cf, dk) {
    var N = nodes(r, A), a = A.a, nx = A.nx, ny = A.ny, X = N.X, Y = N.Y, lo = Infinity, hi = -Infinity, i;
    for (i = 0; i < a.length; i++) { var q = a[i]; if (q < lo) lo = q; if (q > hi) hi = q; }
    var levels = cf.levels || []; if (cf.iv) for (var lv = Math.ceil(lo / cf.iv) * cf.iv; lv <= hi; lv += cf.iv) levels.push(lv);
    var segs = levels.map(function () { return []; });
    for (var y = 0; y < ny - 1; y++) for (var x = 0; x < nx - 1; x++) {
      var k0 = y * nx + x, k1 = k0 + 1, k2 = k0 + nx + 1, k3 = k0 + nx, v0 = a[k0], v1 = a[k1], v2 = a[k2], v3 = a[k3];
      if (v0 !== v0 || v1 !== v1 || v2 !== v2 || v3 !== v3) continue;
      var mn = Math.min(v0, v1, v2, v3), mx = Math.max(v0, v1, v2, v3);
      if (X[k0] < -40 && X[k1] < -40 || X[k0] > SW + 40 && X[k1] > SW + 40 || Y[k0] < -40 && Y[k3] < -40 || Y[k0] > SH + 40 && Y[k3] > SH + 40) continue;
      for (var li = 0; li < levels.length; li++) {
        var L = levels[li]; if (L <= mn || L > mx) continue;
        var pts = [], e = [[k0, k1, v0, v1], [k1, k2, v1, v2], [k2, k3, v2, v3], [k3, k0, v3, v0]];
        for (var t = 0; t < 4; t++) { var E = e[t]; if ((E[2] < L) !== (E[3] < L)) { var f = (L - E[2]) / (E[3] - E[2]); pts.push(X[E[0]] + (X[E[1]] - X[E[0]]) * f, Y[E[0]] + (Y[E[1]] - Y[E[0]]) * f); } }
        if (pts.length === 4) segs[li].push(pts);
        else if (pts.length === 8) { var cv = (v0 + v1 + v2 + v3) / 4; if ((cv < L) === (v0 < L)) segs[li].push([pts[0], pts[1], pts[6], pts[7]], [pts[2], pts[3], pts[4], pts[5]]); else segs[li].push([pts[0], pts[1], pts[2], pts[3]], [pts[4], pts[5], pts[6], pts[7]]); }
      }
    }
    var ink = dk ? "rgba(255,255,255,.92)" : "rgba(10,14,20,.9)", halo = dk ? "rgba(0,0,0,.6)" : "rgba(255,255,255,.65)";
    [[halo, cf.bold ? 4.2 : 3], [ink, cf.bold ? 2 : 1.15]].forEach(function (sty) {
      c.strokeStyle = sty[0]; c.lineWidth = sty[1]; c.lineJoin = c.lineCap = "round"; c.beginPath();
      segs.forEach(function (S2) { S2.forEach(function (sg) { c.moveTo(sg[0], sg[1]); c.lineTo(sg[2], sg[3]); }); }); c.stroke();
    });
    // labels: same level at least 170 px apart, any two at least 44 px apart, away from the edges
    var placed = []; c.font = "600 11px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    segs.forEach(function (S2, li) {
      for (var s2 = 0; s2 < S2.length; s2 += 7) {
        var sg = S2[s2], mx2 = (sg[0] + sg[2]) / 2, my2 = (sg[1] + sg[3]) / 2;
        if (mx2 < M + 20 || my2 < M + 16 || mx2 > SW - M - 20 || my2 > SH - M - 40) continue;
        var near = false;
        for (var q2 = 0; q2 < placed.length && !near; q2++) { var pp = placed[q2], dd = Math.hypot(pp.x - mx2, pp.y - my2); if (dd < 44 || pp.l === li && dd < 170) near = true; }
        if (near) continue; placed.push({ x: mx2, y: my2, l: li });
        var tx = fmtC(levels[li], cf.fmt), w = c.measureText(tx).width + 6;
        c.fillStyle = dk ? "rgba(0,0,0,.72)" : "rgba(255,255,255,.85)"; c.fillRect(mx2 - w / 2, my2 - 7, w, 14);
        c.fillStyle = ink; c.fillText(tx, mx2, my2 + 0.5);
      }
    });
    if (cf.hl) highsLows(c, A, X, Y, dk);
  }
  function fmtC(v, f) { return f === "dam" ? String(Math.round(v)) : f === "hpa" ? String(Math.round(v)) : String(Math.round(v)); }
  // pressure centres: points that are the highest/lowest within ~10 grid steps
  function highsLows(c, A, X, Y, dk) {
    var a = A.a, nx = A.nx, ny = A.ny, R2 = Math.max(4, Math.round(Math.min(nx, ny) / 12)), out = [];
    for (var y = R2; y < ny - R2; y += 2) for (var x = R2; x < nx - R2; x += 2) {
      var v = a[y * nx + x], isH = true, isL = true;
      for (var yy = y - R2; yy <= y + R2 && (isH || isL); yy += 2) for (var xx = x - R2; xx <= x + R2; xx += 2) { var w2 = a[yy * nx + xx]; if (w2 > v) isH = false; if (w2 < v) isL = false; }
      if (isH !== isL) out.push({ h: isH, v: v, x: X[y * nx + x], y: Y[y * nx + x] });
    }
    c.textAlign = "center"; c.textBaseline = "middle";
    out.forEach(function (o) {
      if (o.x < M || o.y < M || o.x > SW - M || o.y > SH - M) return;
      c.font = "800 20px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"; c.lineWidth = 3; c.strokeStyle = dk ? "#000" : "#fff";
      c.fillStyle = o.h ? "#2f6fe0" : "#e0342b"; c.strokeText(o.h ? "H" : "L", o.x, o.y); c.fillText(o.h ? "H" : "L", o.x, o.y);
      c.font = "700 10.5px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif"; c.strokeText(Math.round(o.v), o.x, o.y + 15); c.fillText(Math.round(o.v), o.x, o.y + 15);
    });
  }
  // wind barbs (knots), every ~40 px; grid-relative winds are turned to true north first
  function barbs(c, r, dk) {
    var U = r.u, Wd = r.w, N = nodes(r, U), sp = 40, s = scaleZ(drawn.z), o = [0, 0];
    c.strokeStyle = dk ? "rgba(255,255,255,.9)" : "rgba(10,14,20,.88)"; c.fillStyle = c.strokeStyle; c.lineWidth = 1.2; c.lineCap = "round";
    c.shadowColor = dk ? "rgba(0,0,0,.85)" : "rgba(255,255,255,.9)"; c.shadowBlur = 2.5;
    for (var py = M + sp / 2; py < SH - M; py += sp) for (var px = M + sp / 2; px < SW - M; px += sp) {
      var lat = latOf(drawn.y + (py - SH / 2) / s), lon = lonOf(drawn.x + (px - SW / 2) / s);
      r.P.p.fwd(lat, lon, o);
      var fi = (o[0] - r.i0) / U.s, fj = (o[1] - r.j0) / U.s; if (!(fi >= 0 && fj >= 0 && fi < U.nx - 1 && fj < U.ny - 1)) continue;
      var x0 = fi | 0, y0 = fj | 0, fx = fi - x0, fy = fj - y0, k = y0 * U.nx + x0;
      var bl = function (A) { return (A[k] * (1 - fx) + A[k + 1] * fx) * (1 - fy) + (A[k + U.nx] * (1 - fx) + A[k + U.nx + 1] * fx) * fy; };
      var u = bl(U.a), v = bl(Wd.a);
      if (r.P.p.rot) { var al = r.P.p.rot(lon, lat), ca = Math.cos(al), sa = Math.sin(al), ue = u * ca + v * sa; v = -u * sa + v * ca; u = ue; }
      barb(c, px, py, u, v);
    }
    c.shadowBlur = 0; c.shadowColor = "transparent";
    void N;
  }
  function barb(c, x, y, u, v) {
    var spd = Math.sqrt(u * u + v * v), kt = Math.round(spd / 5) * 5;
    if (kt < 5) { c.beginPath(); c.arc(x, y, 3, 0, 7); c.stroke(); return; }
    var sx = -u / spd, sy = -v / spd, L = 17, ex = x + sx * L, ey = y - sy * L, fx = sy, fy = -sx; // staff toward where the wind comes from; feathers clockwise
    c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey);
    var p = 0, step = 3.2, fl = 8;
    function at(t) { return [ex - sx * t, ey + sy * t]; }
    while (kt >= 50) { var a1 = at(p), a2 = at(p + 4); c.moveTo(a1[0], a1[1]); c.lineTo(a1[0] + fx * fl, a1[1] - fy * fl); c.lineTo(a2[0], a2[1]); c.closePath(); c.fill(); p += 5; kt -= 50; }
    while (kt >= 10) { var b1 = at(p); c.moveTo(b1[0], b1[1]); c.lineTo(b1[0] + fx * fl + sx * 2.5, b1[1] - fy * fl - sy * 2.5); p += step; kt -= 10; }
    if (kt >= 5) { if (p === 0) p = step; var h1 = at(p); c.moveTo(h1[0], h1[1]); c.lineTo(h1[0] + fx * fl / 2 + sx * 1.3, h1[1] - fy * fl / 2 - sy * 1.3); }
    c.stroke();
  }

  // ---------- value at a point ----------
  function valueAt(lat, lon) {
    var r = cur3(), p = PBY[cur.param]; if (!r) return null;
    var o = [0, 0]; r.P.p.fwd(lat, lon, o);
    var V = r.v, fi = (o[0] - r.i0) / V.s, fj = (o[1] - r.j0) / V.s; if (!(fi >= 0 && fj >= 0 && fi <= V.nx - 1 && fj <= V.ny - 1)) return null;
    var v = V.a[Math.round(fj) * V.nx + Math.round(fi)], t = r.t ? r.t.a[Math.round(fj) * V.nx + Math.round(fi)] : 0;
    if (v !== v) return null;
    if (p.types) return v < ((t || 1) === 1 ? 10 : 5) ? "No precipitation" : PTN[t || 1] + " · " + Math.round(v) + " dBZ";
    var u = SC[p.sc].unit, dg = u === "in" ? (v < 1 ? 2 : 1) : u === "%" || u === "J/kg" || u === "m²/s²" || u === "kt" || u === "mph" ? 0 : u === "°F" || u === "°C" ? 0 : 1;
    if (u === "in" && v < 0.005) return "0 in";
    return v.toFixed(dg) + (u[0] === "°" ? u : " " + u);
  }

  // ---------- UI ----------
  var PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg>', PAUSE = '<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
  function setup(host) {
    el = host; el.innerHTML = "";
    el.classList.add("mm");
    stage = document.createElement("div"); stage.className = "mmst"; el.appendChild(stage);
    [cvB, cvF, cvT, cvO] = [0, 1, 2, 3].map(function (i) { var c = document.createElement("canvas"); c.className = "mml" + (i === 1 ? " mmf" : ""); stage.appendChild(c); return c; });
    cxB = cvB.getContext("2d"); cxF = cvF.getContext("2d"); cxT = cvT.getContext("2d"); cxO = cvO.getContext("2d");
    var box = el.closest(".mview") || el.parentNode;
    ui = {
      st: mk("div", "mmstat", el), ro: mk("div", "mmro", el), reg: mk("div", "mmreg", el), hdr: mk("div", "mhdr num", el),
      cross: mk("div", "mcross", el), iro: mk("div", "minsro num", el),
      model: box.querySelector("#mmodel"), param: box.querySelector("#mparam"), run: box.querySelector("#mrun"),
      locate: box.querySelector("#mlocate"), home: box.querySelector("#mhome"), locationStatus: box.querySelector("#mlocation-status"),
      play: box.querySelector("#mplay"), prev: box.querySelector("#mprev"), next: box.querySelector("#mnext"), range: box.querySelector("#mrange"), time: box.querySelector("#mtime"),
      leg: box.querySelector("#mleg"), src: document.getElementById("msrc"), note: document.getElementById("mnote"), title: box.querySelector("#mtitle"), quick: box.querySelector("#mquick")
    };
    if (ui.quick) ui.quick.addEventListener("click", function (e) { var b = e.target.closest("[data-q]"); if (!b || b.disabled) return; setParam(b.dataset.q); });
    ui.st.hidden = true; ui.ro.hidden = true;
    ui.reg.innerHTML = '<button type="button" data-z="7.4">Local</button><button type="button" data-z="5.7">Region</button><button type="button" data-z="us">U.S.</button>';
    ui.reg.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; var z = b.dataset.z; if (z === "us") fly(wx(-96.5), wy(38.5), 3.9); else fly(wx(loc.lon), wy(loc.lat), +z); });
    ui.model.addEventListener("click", function (e) { var b = e.target.closest("[data-m]"); if (!b || b.disabled) return; switchModel(b.dataset.m); });
    // the model is a compact menu (one row with the map and run menus) rather than six buttons
    ui.model.addEventListener("change", function (e) { var v = e.target.value; if (v && v !== cur.model && modelOk(v)) switchModel(v); });
    ui.param.addEventListener("change", function () { setParam(this.value); });
    ui.run.addEventListener("change", function () { userRun = true; setRun(+this.value); });
    // locate / back-to-place work as on Radar: locate flies to the device and stays locked on it as it moves; while
    //   locked the pin (back to the forecast location) replaces it; dragging unlocks (both show)
    // inspector (as in RadarScope): a fixed crosshair in the middle of the map; pan the map under it and the value at that
    //   spot shows right above it, updating as you move, change hour or product
    ui.insp = box.querySelector("#minspect"); ui.cross.hidden = ui.iro.hidden = true;
    if (ui.insp) ui.insp.addEventListener("click", function () { inspTap(); });
    ui.locate.addEventListener("click", locate);
    ui.home.addEventListener("click", toForecast);
    ui.play.addEventListener("click", function () { play(!playing); });
    ui.time.addEventListener("click", function () { play(false); cur.k = 0; showHour(); });
    ui.prev.addEventListener("click", function () { play(false); step(-1); });
    ui.next.addEventListener("click", function () { play(false); step(1); });
    ui.range.addEventListener("input", function () { play(false); cur.k = +this.value; showHour(); });
    if (VM) VM.init(function () { paint(9); }, function () { if (on) paint(9); });
    new ResizeObserver(size).observe(el);
    if (root.matchMedia) root.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { paint(); });
    gestures();
  }
  function mk(t, c, p) { var e = document.createElement(t); e.className = c; p.appendChild(e); return e; }
  function size() {
    var r = el.getBoundingClientRect(); if (!r.width) return;
    W = Math.round(r.width); HH = Math.round(r.height); M = Math.round(Math.max(W, HH) * 0.2); SW = W + 2 * M; SH = HH + 2 * M; dpr = Math.min(2, root.devicePixelRatio || 1);
    stage.style.cssText = "left:" + -M + "px;top:" + -M + "px;width:" + SW + "px;height:" + SH + "px";
    [cvB, cvT, cvO].forEach(function (c) { c.width = Math.round(SW * dpr); c.height = Math.round(SH * dpr); });
    paint(31);
  }
  function modelOk(m) { var Mo = MODELS[m]; return !loc || (Mo.covers ? Mo.covers(loc) : !Mo.conus || inConus(loc)); }
  function uiModels() {
    ui.model.innerHTML = '<select class="msel mmsel" aria-label="Model">' + Object.keys(MODELS).map(function (m) { return '<option value="' + m + '"' + (m === cur.model ? " selected" : "") + (modelOk(m) ? "" : " disabled") + ">" + MODELS[m].name + "</option>"; }).join("") + "</select>";
  }
  function uiParams() {
    var gs = [], html = "";
    var amt = isAmt(PBY[cur.param]);
    P.slice().sort(function (a, b) { return MENU.indexOf(a.id) - MENU.indexOf(b.id); }).forEach(function (p) { if (!has(p, cur.model) || !inMenu(p.id) || isAmt(p) !== amt) return; var g = grp(p), gg = gs.filter(function (x) { return x.g === g; })[0]; if (!gg) gs.push(gg = { g: g, l: [] }); gg.l.push(p); });
    gs.forEach(function (g) { html += '<optgroup label="' + g.g + '">' + g.l.map(function (p) { return '<option value="' + p.id + '"' + (p.id === cur.param ? " selected" : "") + ">" + productName(p) + "</option>"; }).join("") + "</optgroup>"; });
    ui.param.innerHTML = html;
  }
  function fmtT(ms, o) { return opts.fmt ? opts.fmt(ms, o) : new Date(ms).toLocaleString([], o); }
  function uiRuns() {
    var L = runs[cur.model] && runs[cur.model].list || [];
    ui.run.innerHTML = L.map(function (x) {
      var done = x.hours.length >= x.max / MODELS[cur.model].step + 1, last = x.hours[x.hours.length - 1];
      return '<option value="' + x.run + '"' + (x.run === cur.run ? " selected" : "") + ">" + hh(x.run) + "Z " + fmtT(x.run, { weekday: "short" }) + (done ? "" : " (to " + last + " h)") + "</option>";
    }).join("");
    ui.run.disabled = !L.length;
  }
  function legend() {
    var p = PBY[cur.param], html = "";
    if (p.types) {
      // only the types that show anywhere on this run's loaded hours (no snow/sleet key in summer); rain until known
      var seen = {}, pre = cur.model + "|" + cur.run + "|" + cur.param + "|";
      Object.keys(frames).forEach(function (k) { var f = frames[k]; if (k.indexOf(pre) === 0 && f && f.r && f.r.types) f.r.types.forEach(function (t) { seen[t] = 1; }); });
      var show = [1, 2, 5, 3, 4].filter(function (t) { return seen[t]; }); if (!show.length) show = [1];
      html = show.map(function (t) { var st2 = PT[t].stops; return '<div class="mlrow"><span>' + PTN[t] + '</span><i style="background:linear-gradient(90deg,' + st2.map(function (s2) { return "rgba(" + s2[1].slice(0, 3).join(",") + "," + Math.max(0.5, s2[1][3]) + ")"; }).join(",") + ')"></i></div>'; }).join("");
      html = '<div class="mltypes">' + html + "</div>";
    } else {
      var sc = SC[p.sc], stp = sc.stops;
      if (sc.band) {
        html = '<div class="mlbar">' + stp.map(function (s2, i) { return i < stp.length - 1 || stp.length < 3 ? '<b style="background:rgba(' + s2[1].slice(0, 3).join(",") + "," + Math.max(0.35, s2[1][3]) + ')"></b>' : ""; }).join("") + "</div>";
        var n = stp.length - 1, every = n > 10 ? 2 : 1;
        html += '<div class="mlticks">' + stp.map(function (s2, i) { return i % every && i !== n ? "" : '<span style="left:' + (i / n * 100).toFixed(2) + '%">' + num(s2[0]) + "</span>"; }).join("") + "</div>";
      } else {
        var lo = stp[0][0], hi = stp[stp.length - 1][0];
        html = '<div class="mlbar" style="background:linear-gradient(90deg,' + stp.map(function (s2) { return "rgb(" + s2[1].slice(0, 3).join(",") + ") " + ((s2[0] - lo) / (hi - lo) * 100).toFixed(2) + "%"; }).join(",") + ')"></div>';
        html += '<div class="mlticks">' + sc.ticks.map(function (t) { return '<span style="left:' + ((t - lo) / (hi - lo) * 100).toFixed(2) + '%">' + t + "</span>"; }).join("") + "</div>";
      }
      // one compact line, the same height as the precip-type key: scale with its ticks, then the unit
      html = '<div class="mlone"><div class="mlscale">' + html + '</div><span class="mlunit">' + sc.unit + "</span></div>";
    }
    ui.leg.innerHTML = html;
  }
  function num(v) { return v >= 1 || v === 0 ? String(+v.toFixed(1)) : String(v).replace(/^0/, ""); }
  function uiTime() {
    var hs = hours(), h = hs[cur.k], r = R();
    ui.range.max = Math.max(0, hs.length - 1); ui.range.value = cur.k; ui.range.disabled = hs.length < 2;
    ui.play.disabled = hs.length < 2; ui.prev.disabled = hs.length < 2; ui.next.disabled = hs.length < 2; ui.time.disabled = !!lockedWindow;
    var lock = document.getElementById("model-window-lock");
    if (lock) { lock.hidden = !lockedWindow; if (lockedWindow) lock.querySelector("span").textContent = "Forecast period locked · " + fmtT(lockedWindow.start, { weekday: "short", hour: "numeric", timeZoneName: "short" }) + " – " + fmtT(lockedWindow.end, { weekday: "short", hour: "numeric", timeZoneName: "short" }); }
    var p = PBY[cur.param];
    ui.title.textContent = MODELS[cur.model].name + " · " + productName(p);
    if (!r || h == null) { ui.time.innerHTML = ""; ui.src.textContent = "Run unavailable"; if (ui.note) ui.note.textContent = ""; if (ui.hdr) ui.hdr.innerHTML = ""; return; }
    var v = r.run + h * H;
    var f0 = fromH();
    var lab = p.accum ? "Total from " + fmtT(r.run + f0 * H, { hour: "numeric" }) : p.win ? p.win + " hours ending" : "Hour " + h;
    var big = p.day ? fmtT(v - 6 * H, { weekday: "short" }) + (p.day === "max" ? " day" : " night") : fmtT(v, { weekday: "short", hour: "numeric" });
    if (p.day) lab = (p.day === "max" ? "High, " : "Low, ") + fmtT(v - 12 * H, { hour: "numeric" }) + "–" + fmtT(v, { hour: "numeric" });
    ui.time.innerHTML = "<b>" + big + "</b><span>" + lab + "</span>";
    // Pivotal-style header on the map: model and product, then the period the map covers (or its valid time) and the run
    var hm = { weekday: "short", hour: "numeric" }, per = p.day ? lab : p.accum ? fmtT(r.run + f0 * H, hm) + " – " + fmtT(v, hm) : p.win ? fmtT(v - p.win * H, hm) + " – " + fmtT(v, hm) : "Valid " + fmtT(v, hm);
    // the row with the step arrows names the hour (model and product are in the map header)
    ui.title.textContent = "Forecast hour " + h + (hs.length > 1 ? " of " + hs[hs.length - 1] : "");
    if (ui.hdr) ui.hdr.innerHTML = "<b>" + MODELS[cur.model].name + " · " + productName(p) + "</b><span>" + per.replace(/(\w{3}), /g, "$1 ") + " · " + hh(r.run) + "Z run</span>";
    ui.range.setAttribute("aria-valuetext", MODELS[cur.model].name + " · " + big + " · " + lab);
    ui.time.setAttribute("title", "Return to the first forecast hour");
    var ageMin = Math.max(0, Math.floor((Date.now() - r.run) / 60000)), age = ageMin < 60 ? ageMin + " min" : Math.floor(ageMin / 60) + " hr" + (ageMin % 60 ? " " + ageMin % 60 + " min" : "");
    ui.src.textContent = MODELS[cur.model].full + " · NOAA · " + fmtT(r.run, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " (" + age + " old)";
    if (ui.note) ui.note.textContent = productNote(p);
    if (ui.hdr) ui.hdr.title = productName(p) + " · " + per + " · " + ui.src.textContent;
  }
  function productName(p) {
    if (p.id === "sn10") return "Snowfall (10:1)";
    if (p.id === "snv") return "Snowfall (native)";
    if (p.id === "nsn") return "Snowfall (NBM)";
    if (p.id === "frz") return cur.model === "nbm" ? "Ice accretion" : "Freezing-rain liquid";
    if (p.id === "i6") return cur.model === "nbm" ? "6-hr ice accretion" : "6-hr freezing-rain liquid";
    return p.name;
  }
  function productNote(p) {
    var note = "Model guidance, not an observed amount or the official NWS forecast.";
    if (p.id === "sn10" || p.id === "s6" || p.id === "s24") note += cur.model === "nbm" ? " Snowfall uses NBM's modeled snow ratios." : " Snowfall is estimated with a 10:1 snow-to-liquid ratio; actual snow density can vary.";
    else if (p.id === "nsn") note += " Snowfall uses NBM's modeled snow ratios.";
    else if (p.id === "snv") note += " Native variable-density snowfall from HRRR/RAP (ASNOW), not snow depth; actual accumulation can differ.";
    if (p.id === "frz" || p.id === "i6") note += cur.model === "nbm" ? " Estimated ice accretion uses NBM's flat-surface model (FRAM); actual buildup depends on surface and exposure." : " This is liquid-equivalent freezing rain, not ice thickness on trees, wires, or roads.";
    if ((p.id === "frz" || p.id === "i6") && cur.model !== "nbm" && cur.model !== "hrrr" && cur.model !== "rap") note += " Derived from precipitation and modeled precipitation type; changing types between forecast hours add uncertainty.";
    if (p.accum) note += lockedWindow ? " Total covers exactly the locked comparison window." : " Total covers the period shown on the map, starting at the model hour nearest now.";
    else if (p.win) note += " Amount covers the " + p.win + " hours ending at the selected time.";
    return note;
  }
  function showHour() { readout = null; ui.ro.hidden = true; uiTime(); loadAround(); paint(6); status(); }
  function step(d) { var n = hours().length; if (!n) return; cur.k = (cur.k + d + n) % n; showHour(); }
  function play(onp) {
    playing = !!onp; clearTimeout(playT);
    ui.play.innerHTML = playing ? PAUSE : PLAY; ui.play.setAttribute("aria-label", playing ? "Pause" : "Play");
    if (playing) { loadAround(); tick(); } else status();
  }
  // steps through loaded hours only, holding on the last one a little longer
  function tick() {
    if (!playing || !on) return;
    var hs = hours(), n = hs.length, k = cur.k;
    for (var i = 1; i <= n; i++) { var c2 = (cur.k + i) % n, f = frames[fkey(hs[c2])]; if (f && f.r) { k = c2; break; } }
    if (k !== cur.k) { cur.k = k; uiTime(); paint(6); }
    status();
    playT = setTimeout(tick, cur.k === n - 1 ? 1300 : 420);
  }
  function resetFrames() { gen++; Q = Q.filter(function (j) { return j.keep; }); frames = {}; }
  function switchModel(m) {
    if (!modelOk(m)) return;
    var vt = lockedWindow ? lockedWindow.end : R() ? R().run + (hours()[cur.k] || 0) * H : Date.now();
    lockedWindow = null;
    cur.model = m; cur.run = null; userRun = false; save(); resetFrames(); play(false);
    if (!has(PBY[cur.param], m)) cur.param = /^(sn10|nsn|snv)$/.test(cur.param) ? (m === "nbm" ? "nsn" : "sn10") : "qpf";
    uiModels(); uiParams(); uiQuick(); legend(); uiTime(); status();
    findRuns(m).then(function (L) { if (cur.model !== m) return; var x = pickRun(L); if (x) setRun(x.run, vt); else { uiRuns(); status(); } });
  }
  function setRun(run, vt) {
    var old = R(), was = vt != null ? vt : lockedWindow ? lockedWindow.end : old ? old.run + (hours()[cur.k] || 0) * H : Date.now();
    lockedWindow = null;
    cur.run = run; resetFrames(); uiRuns();
    // keep the same valid time when changing run or model (or the hour nearest now)
    var hs = hours(), best = 0; hs.forEach(function (h, i) { if (Math.abs(run + h * H - was) < Math.abs(run + hs[best] * H - was)) best = i; });
    cur.k = best; showHour();
  }
  function setParam(id) {
    if (!PBY[id] || !has(PBY[id], cur.model) || !inMenu(id)) return;
    var r = R(), hs0 = hours(), vt = r && hs0[cur.k] != null ? r.run + hs0[cur.k] * H : null;
    lockedWindow = null;
    cur.param = id; save(); LAST[isAmt(PBY[id]) ? "a" : "p"] = id; try { localStorage.setItem("wx-model-last", JSON.stringify(LAST)); } catch (e) {}
    resetFrames(); uiParams(); uiQuick(); legend();
    var hs = hours(); if (!r || !hs.length) { uiTime(); status(); return; }
    var best = 0; if (vt != null) hs.forEach(function (h, i) { if (Math.abs(r.run + h * H - vt) < Math.abs(r.run + hs[best] * H - vt)) best = i; });
    cur.k = best; showHour();
  }
  // the four maps most people want, one tap away (everything else is in the menu)
  // the mode switch: each mode reopens the last map used in it (Precip type / Total precipitation by default)
  var LAST = (function () { try { return JSON.parse(localStorage.getItem("wx-model-last")) || {}; } catch (e) { return {}; } })();
  function modeTarget(amt) {
    var want = LAST[amt ? "a" : "p"] || (amt ? "qpf" : "ptype");
    if (want === "sn10" || want === "nsn") want = snowId();
    if (PBY[want] && has(PBY[want], cur.model) && inMenu(want)) return want;
    return MENU.filter(function (id) { return isAmt(PBY[id]) === amt && has(PBY[id], cur.model); })[0] || null;
  }
  function snowId() { return cur.model === "nbm" ? "nsn" : "sn10"; }
  function uiQuick() {
    if (!ui.quick) return;
    var amt = isAmt(PBY[cur.param]);
    ui.quick.innerHTML = [[false, "Precip"], [true, "Amounts"]].map(function (q) {
      var id = q[0] === amt ? cur.param : modeTarget(q[0]);
      return '<button type="button" class="chip' + (q[0] === amt ? " on" : "") + '" aria-pressed="' + (q[0] === amt) + '" data-q="' + (id || "") + '"' + (id ? "" : " disabled") + ">" + q[1] + "</button>";
    }).join("");
  }
  // re-check for new hours and runs while open
  var refreshT = 0, lastRefresh = Date.now();
  function refresh() {
    lastRefresh = Date.now();
    var m = cur.model; runs[m] = null;
    findRuns(m).then(function (L) {
      if (cur.model !== m) return;
      if (!cur.run) { var y = pickRun(L); if (y) setRun(y.run); else status(); return; }
      if (!userRun) { var x = pickRun(L); if (x && x.run !== cur.run) { setRun(x.run); return; } }
      uiRuns(); var hs = hours(); ui.range.max = Math.max(0, hs.length - 1);
    });
  }

  // ---------- gestures ----------
  var pts = new Map(), g0 = null, moved = false, tween = 0, lastTap = 0;
  function at(sx, sy) { var s = scaleZ(view.z); return { x: view.x + (sx - W / 2) / s, y: view.y + (sy - HH / 2) / s }; }
  function setView(x, y, z) {
    view.z = Math.max(2.5, Math.min(10, z)); view.x = x; var s = scaleZ(view.z), hh2 = HH / 2 / s; view.y = Math.max(hh2 - 0.02, Math.min(1.02 - hh2, y));
    if (!drawn) return paint(16);
    var k = Math.pow(2, view.z - drawn.z), sv = scaleZ(view.z), tx = (drawn.x - view.x) * sv, ty = (drawn.y - view.y) * sv;
    stage.style.transform = "translate(" + tx.toFixed(1) + "px," + ty.toFixed(1) + "px) scale(" + k.toFixed(4) + ")";
    if (Math.abs(tx) > M * 0.8 || Math.abs(ty) > M * 0.8 || k < 0.8 || k > 1.6) settle();
    inspect();
  }
  var settleT = 0;
  function settle() { clearTimeout(settleT); settleT = setTimeout(function () { paint(31); if (!boxOk(BOX)) loadAround(); }, 0); }
  function fly(x, y, z) {
    cancelAnimationFrame(tween); var a = { x: view.x, y: view.y, z: view.z }, t0 = performance.now();
    (function stepT(t) { var f = Math.min(1, (t - t0) / 380), e = f * (2 - f); setView(a.x + (x - a.x) * e, a.y + (y - a.y) * e, a.z + (z - a.z) * e); if (f < 1) tween = requestAnimationFrame(stepT); else settle(); })(t0);
  }
  var gps = null, gpsMode = "off", watchId = null, locT = 0; // gpsMode: off | wait | locked | free
  function locMsg(t) { clearTimeout(locT); if (!ui.locationStatus) return; ui.locationStatus.textContent = t || ""; if (t && !/…$/.test(t)) locT = setTimeout(function () { ui.locationStatus.textContent = ""; }, 3500); }
  function locate() {
    if (!root.navigator.geolocation) { locMsg("Location isn't available in this browser"); return; }
    if (gps) { gpsMode = "locked"; locUi(); locMsg(""); fly(wx(gps.lon), wy(gps.lat), Math.max(view.z, 8)); }
    else { gpsMode = "wait"; locUi(); locMsg("Finding your location…"); }
    startWatch();
  }
  function startWatch() {
    if (watchId != null || !root.navigator.geolocation) return;
    watchId = root.navigator.geolocation.watchPosition(function (p) {
      var first = !gps || gpsMode === "wait";
      gps = { lat: p.coords.latitude, lon: p.coords.longitude }; paint(4);
      if (gpsMode === "wait") { gpsMode = "locked"; locUi(); locMsg(""); if (on) fly(wx(gps.lon), wy(gps.lat), Math.max(view.z, 8)); }
      else if (gpsMode === "locked" && !first && on && !pts.size) setView(wx(gps.lon), wy(gps.lat), view.z);
    }, function (err) {
      var denied = err && err.code === 1;
      if (gps && !denied) return;
      stopWatch(); if (gpsMode === "wait") { gpsMode = "off"; locUi(); }
      locMsg(denied ? "Location permission is off for this site" : "Couldn't get your location");
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
  }
  function stopWatch() { if (watchId != null && root.navigator.geolocation) root.navigator.geolocation.clearWatch(watchId); watchId = null; }
  function toForecast() { gpsMode = "off"; stopWatch(); locUi(); locMsg(""); paint(4); if (loc) fly(wx(loc.lon), wy(loc.lat), 7.4); }
  function unlock() { if (gpsMode === "locked") { gpsMode = "free"; locUi(); } }
  function locUi() {
    if (!ui.locate) return;
    ui.locate.hidden = gpsMode === "locked" || gpsMode === "wait" && !!gps;
    ui.locate.classList.toggle("on", gpsMode === "wait");
    ui.home.hidden = gpsMode === "off" || gpsMode === "wait";
  }
  function gestures() {
    el.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button")) return;
      el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); cancelAnimationFrame(tween);
      g0 = snap(); moved = false; ui.ro.hidden = true;
    });
    el.addEventListener("pointermove", function (e) {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      var g = snap(); if (!g0 || g.n !== g0.n) { g0 = g; return; }
      if (Math.abs(g.cx - g0.cx) + Math.abs(g.cy - g0.cy) > 4 || g.n > 1) moved = true;
      if (!moved) return;
      unlock();
      var z = g0.z + (g.n > 1 && g0.d > 0 ? Math.log2(g.d / g0.d) : 0), s = scaleZ(z), r = el.getBoundingClientRect();
      var wpt = g0.w, x = wpt.x - (g.cx - r.left - W / 2) / s, y = wpt.y - (g.cy - r.top - HH / 2) / s;
      setView(x, y, z);
    });
    var end = function (e) {
      if (!pts.has(e.pointerId)) return; pts.delete(e.pointerId);
      if (pts.size) { g0 = snap(); return; }
      var r = el.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (!moved && e.type === "pointerup") {
        var now = Date.now();
        if (now - lastTap < 300) { var w = at(sx, sy); fly(view.x + (w.x - view.x) * 0.5, view.y + (w.y - view.y) * 0.5, view.z + 1); lastTap = 0; return; }
        lastTap = now; if (insp) return; var w2 = at(sx, sy); showRO(latOf(w2.y), lonOf(w2.x), sx, sy);
      }
      if (moved) settle();
      g0 = null;
    };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    el.addEventListener("wheel", function (e) {
      e.preventDefault(); var r = el.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, w = at(sx, sy), z = view.z - e.deltaY * (e.deltaMode ? 0.05 : 0.0022); unlock();
      var s = scaleZ(Math.max(2.5, Math.min(10, z))); setView(w.x - (sx - W / 2) / s, w.y - (sy - HH / 2) / s, z); clearTimeout(settleT); settleT = setTimeout(settle, 160);
    }, { passive: false });
  }
  function snap() {
    var a = Array.from(pts.values()), n = a.length; if (!n) return null;
    var cx = a.reduce(function (s, p) { return s + p.x; }, 0) / n, cy = a.reduce(function (s, p) { return s + p.y; }, 0) / n;
    var d = n > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0, r = el.getBoundingClientRect();
    return { n: n, cx: cx, cy: cy, d: d, z: view.z, w: at(cx - r.left, cy - r.top) };
  }
  var insp = (function () { try { return !!localStorage.getItem("wx-minsp"); } catch (e) { return false; } })();
  // crosshair button: off → on and centred on the forecast location; on but moved away → back to the location;
  //   on and already on the location → off
  function atHomeView() { return !!loc && Math.hypot(view.x - wx(loc.lon), view.y - wy(loc.lat)) * scaleZ(view.z) < 3; }
  function inspTap() {
    if (insp && atHomeView()) insp = false;
    else { insp = true; if (loc) fly(wx(loc.lon), wy(loc.lat), view.z); }
    try { localStorage.setItem("wx-minsp", insp ? "1" : ""); } catch (e) {}
    inspUi();
  }
  function inspUi() { if (!ui.cross) return; ui.cross.hidden = !insp; if (ui.insp) { ui.insp.classList.toggle("on", insp); ui.insp.setAttribute("aria-pressed", String(insp)); } if (insp) ui.ro.hidden = true; inspect(); }
  function inspect() {
    if (!ui.iro) return; if (!insp || !on) { ui.iro.hidden = true; return; }
    var v = valueAt(latOf(view.y), lonOf(view.x)); ui.iro.textContent = v == null ? "No data here" : v; ui.iro.hidden = false;
  }
  function showRO(lat, lon, sx, sy) {
    var v = valueAt(lat, lon); if (v == null) { ui.ro.hidden = true; return; }
    ui.ro.textContent = v; ui.ro.hidden = false;
    ui.ro.style.left = Math.max(6, Math.min(W - ui.ro.offsetWidth - 6, sx - ui.ro.offsetWidth / 2)) + "px"; ui.ro.style.top = Math.max(6, sy - 38) + "px";
  }

  function exactWindow(r, p, model, start, end) {
    var a = (start - r.run) / H, b = (end - r.run) / H;
    return a >= 0 && b > a && Number.isInteger(a) && Number.isInteger(b) &&
      r.hours.indexOf(b) >= 0 && (a === 0 || r.hours.indexOf(a) >= 0 && okHour(p, model, r.run, a)) && okHour(p, model, r.run, b);
  }
  function compareWindow(o) {
    if (!workers() || !loc) return Promise.reject(new Error("Open Models first"));
    var p = PBY[o.param], point = { lat: loc.lat, lon: loc.lon };
    if (!p || !p.accum || !(o.end > o.start) || o.end - o.start > 72 * H) return Promise.reject(new Error("Choose a valid accumulation window"));
    var ms = o.models || Object.keys(MODELS).filter(function (m) { return has(p, m); });
    return Promise.all(ms.map(function (m) {
      if (!MODELS[m] || !has(p, m) || !modelOk(m)) return [{ model: m, state: "unsupported", reason: "Product unavailable for this model or location" }];
      return findRuns(m).then(function (L) {
        var eligible = L.filter(function (r) { return exactWindow(r, p, m, o.start, o.end); });
        if (!eligible.length) return [{ model: m, state: "unavailable", reason: "No published run covers this exact window" }];
        return Promise.all((o.trend ? eligible.slice(0, 4) : eligible.slice(0, 1)).map(function (r) {
          return api._probe(m, o.param, (o.end - r.run) / H, { run: r.run, from: (o.start - r.run) / H, lat: point.lat, lon: point.lon, want: 1200 }).then(function (v) {
            return { model: m, param: o.param, run: r.run, start: o.start, end: o.end, value: v.at, state: Number.isFinite(v.at) && v.at >= 0 ? "available" : "unavailable" };
          }, function () { return { model: m, run: r.run, state: "unavailable", reason: "Exact-window data could not load" }; });
        }));
      });
    })).then(function (all) { return [].concat.apply([], all); });
  }
  function useWindow(r) {
    var known = runs[r.model] && runs[r.model].list.filter(function (x) { return x.run === r.run; })[0];
    if (r.state !== "available" || !known || !exactWindow(known, PBY[r.param], r.model, r.start, r.end)) return false;
    play(false); cur.model = r.model; cur.param = r.param; cur.run = r.run; userRun = true;
    lockedWindow = { start: r.start, end: r.end }; cur.k = 0; resetFrames(); save();
    uiModels(); uiParams(); uiQuick(); uiRuns(); legend(); showHour(); return true;
  }
  function clearWindow() { if (!lockedWindow) return; var end = lockedWindow.end; lockedWindow = null; setRun(cur.run, end); }
  function openTime(param, t, end) {
    if (!PBY[param]) return Promise.resolve(null);
    var token = ++timeRequest, m = has(PBY[param], cur.model) && modelOk(cur.model) ? cur.model : modelOk("hrrr") ? "hrrr" : "gfs";
    if (cur.model !== m || !cur.run) switchModel(m);
    return findRuns(m).then(function (L) {
      if (token !== timeRequest || cur.model !== m || !on) return null;
      var r = R() || pickRun(L, m); if (!r) return null;
      if (PBY[param].accum && end != null) {
        return compareWindow({ param: param, models: [m], start: t, end: end }).then(function (rows) {
          if (token !== timeRequest || cur.model !== m || !on) return null;
          var row = rows.filter(function (x) { return x.state === "available"; })[0];
          return row && useWindow(row) ? row.end : null;
        });
      }
      setParam(param); setRun(r.run, t); return cur.run + hours()[cur.k] * H;
    });
  }
  var api = {
    show: function (host, l, o) {
      opts = o || {}; if (!workers()) { host.textContent = "Model maps need a newer browser."; return; }
      if (el !== host) setup(host);
      (opts.regions || el).appendChild(ui.reg);
      var moved2 = !loc || Math.abs(loc.lat - l.lat) > 1e-4 || Math.abs(loc.lon - l.lon) > 1e-4;
      loc = { lat: l.lat, lon: l.lon };
      if (moved2) { view = { x: wx(loc.lon), y: wy(loc.lat), z: view.z && drawn ? view.z : 5.7 }; drawn = null; BOX = null; resetFrames(); }
      if (!modelOk(cur.model)) cur.model = "gfs";
      on = true; if (gpsMode !== "off") startWatch(); locUi(); inspUi(); size(); uiModels(); uiParams(); uiQuick(); legend(); uiTime();
      if (!cur.run) switchModel(cur.model); else if (moved2) showHour();
      else if (Date.now() - lastRefresh > 10 * 60000) refresh();
      clearInterval(refreshT); refreshT = setInterval(function () { if (on && !document.hidden) refresh(); }, 10 * 60000);
      paint(31);
    },
    hide: function () { on = false; if (el) play(false); clearInterval(refreshT); if (gpsMode !== "off") { stopWatch(); if (gpsMode === "wait") gpsMode = "off"; locUi(); } },
    _state: function () { var hs = hours(), f = frames[fkey(hs[cur.k])]; var c3 = f && f.r && f.r.c; return { model: cur.model, param: cur.param, run: cur.run, hours: hs, k: cur.k, ready: !!(f && f.r), err: f && f.err, view: view, queue: Q.length + busy, window: lockedWindow, c: c3 ? { nx: c3.nx, ny: c3.ny, s: c3.s, a0: c3.a[0], mid: c3.a[c3.a.length >> 1] } : null, v: f && f.r && f.r.v ? { nx: f.r.v.nx, ny: f.r.v.ny, s: f.r.v.s } : null }; },
    _set: function (o) { if (o.model && o.model !== cur.model) switchModel(o.model); if (o.param) setParam(o.param); if (o.k != null) { cur.k = o.k; showHour(); } },
    // one product at one hour, decoded off-screen (for check.html): value range and share of missing values
    _probe: function (model, param, h, o) {
      o = o || {};
      return new Promise(function (ok, no) {
        var run = o.run ? { run: o.run, hours: [h] } : runs[model] && runs[model].list && pickRun(runs[model].list, model);
        var go = function (rr) {
          var cl = o.lat != null ? o : loc;
          var pp = PBY[param], ok2 = rr.hours.filter(function (x) { return okHour(pp, model, rr.run, x); }), hh2 = h != null ? h : ok2[Math.min(ok2.length - 1, 6)];
          if (hh2 == null) return no(new Error("no hours for this product"));
          var job = { keep: true, m: { model: model, run: rr.run, h: hh2, from: pp.win ? hh2 - pp.win : o.from || 0, param: param, box: { w: cl.lon - 6, e: cl.lon + 6, s: cl.lat - 4, n: cl.lat + 4 }, want: o.want || 200 } };
          job.cb = function (r) {
            if (r.err) return no(new Error(r.err));
            if (r.r.empty) return no(new Error("outside this model's area"));
            var a = r.r.v.a, lo = Infinity, hi = -Infinity, nan = 0; for (var i = 0; i < a.length; i++) { if (a[i] !== a[i]) { nan++; continue; } if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
            var res = { run: rr.run, h: job.m.h, min: lo, max: hi, nan: nan / a.length, n: a.length };
            if (o.lat != null) { var q = [0, 0], V = r.r.v; projFor(r.r.g).p.fwd(o.lat, o.lon, q); res.at = V.a[Math.round((q[1] - r.r.j0) / V.s) * V.nx + Math.round((q[0] - r.r.i0) / V.s)]; }
            ok(res);
          };
          Q.unshift(job); pump();
        };
        if (run) go(run); else findRuns(model).then(function (L) { var x = pickRun(L, model); if (x) go(x); else no(new Error("no runs found")); });
      });
    },
    compareWindow: compareWindow, useWindow: useWindow, clearWindow: clearWindow, openTime: openTime,
    MODELS: MODELS, PARAMS: P, has: has
  };
  root.WXModels = api;
})(typeof self !== "undefined" ? self : this);
