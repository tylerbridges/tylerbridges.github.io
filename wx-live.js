// wx-live.js — pulls weather.gov (and EPA UV, ArcGIS geocoding) straight from the browser and builds the
// dashboard's data document with wx-normalize.js. All of these services allow cross-origin requests.
(function (root) {
  "use strict";
  var API = "https://api.weather.gov";
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function get(url, optional) {
    var tries = 0;
    // extras (UV, discussion, outlook, MapClick wording, observations) can't hold up the forecast: give them 8 s
    if (optional) return Promise.race([getNow(), sleep(8000).then(function () { console.warn("optional timed out:", url); return null; })]);
    return getNow();
    function getNow() { tries = 0; return once(); }
    function once() {
      return fetch(url, { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error(r.status + " " + url);
        return r.json();
      }).catch(function (e) {
        if (++tries < 2) return sleep(1200).then(once);
        if (optional) { console.warn("optional failed:", e.message); return null; }
        throw e;
      });
    }
  }
  // same geocoder forecast.weather.gov's search box uses
  function geocode(q) {
    var u = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&countryCode=USA&maxLocations=1&outFields=City,RegionAbbr,Type&SingleLine=" + encodeURIComponent(q);
    return fetch(u).then(function (r) { if (!r.ok) throw new Error("geocoder " + r.status); return r.json(); }).then(function (j) {
      var c = (j.candidates || [])[0];
      if (!c || c.score < 80) return null;
      var a = c.attributes || {};
      return { lat: +c.location.y.toFixed(4), lon: +c.location.x.toFixed(4), label: a.City && a.RegionAbbr ? a.City.replace(/^City of /, "") + ", " + a.RegionAbbr : c.address };
    });
  }
  // The /points lookup (which grid, office and URLs serve a place) gates every other request, but it rarely changes:
  //   keep the parts read here and in wx-normalize.js per place (same 4-decimal key as the request) for 7 days, 12
  //   places at most. Not read or saved with ?nostore=1, in test scenarios, or when the live check turns it off.
  var PKEY = "wx-points", PTTL = 7 * 864e5, PMAX = 12;
  function pOk() { return root.WXLive.useCache !== false && !/[?&](?:nostore=1|test=)/.test(root.location.search); }
  function pAll() { try { var a = JSON.parse(localStorage.getItem(PKEY) || "{}"); return a && typeof a === "object" ? a : {}; } catch (e) { return {}; } }
  function pGet(k) { var e = pOk() && pAll()[k]; return e && e.p && Date.now() - e.t < PTTL ? e.p : null; }
  function pSet(k, pts) {
    if (!pOk()) return;
    var a = pAll(), now = Date.now(), P = pts && pts.properties;
    if (P) {
      var rl = (P.relativeLocation && P.relativeLocation.properties) || {};
      a[k] = { t: now, p: { properties: { cwa: P.cwa, gridId: P.gridId, gridX: P.gridX, gridY: P.gridY, timeZone: P.timeZone, forecastZone: P.forecastZone, county: P.county,
        forecast: P.forecast, forecastGridData: P.forecastGridData, observationStations: P.observationStations,
        relativeLocation: { properties: { city: rl.city, state: rl.state } } } } };
    } else delete a[k];
    Object.keys(a).filter(function (q) { return !a[q] || !(now - a[q].t < PTTL); }).forEach(function (q) { delete a[q]; });
    Object.keys(a).sort(function (x, y) { return a[y].t - a[x].t; }).slice(PMAX).forEach(function (q) { delete a[q]; });
    try { localStorage.setItem(PKEY, JSON.stringify(a)); } catch (e) {}
  }
  function load(loc) {
    var lat = +(+loc.lat).toFixed(4), lon = +(+loc.lon).toFixed(4), key = lat + "," + lon, hit = pGet(key);
    // a cached grid that no longer works (NWS moved it: forecast/grid 404) is dropped and the place looked up again, once
    return run(hit).catch(function (e) { if (!hit) throw e; console.warn("cached grid failed, looking it up again:", e.message); pSet(key, null); return run(null); });
    function run(cachedPts) {
    var P, points;
    return (cachedPts ? Promise.resolve(cachedPts) : get(API + "/points/" + key).then(function (j) { if (j && j.properties && j.properties.forecast) pSet(key, j); return j; })).then(function (pts) {
      points = pts; P = pts.properties;
      var since = new Date(Date.now() - 25 * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
      var rl = (P.relativeLocation && P.relativeLocation.properties) || {};
      var epa = function (kind) { return rl.city ? get("https://data.epa.gov/efservice/getEnvirofactsUV" + kind + "/CITY/" + encodeURIComponent(rl.city) + "/STATE/" + rl.state + "/JSON", true) : Promise.resolve(null); };
      // forecast.weather.gov's MapClick JSON is also the fallback for finding the nearest observation station: for some
      //   grids (International Falls, MN) the gridpoint station list is a 404, but MapClick still names the station
      var mcP = get("https://forecast.weather.gov/MapClick.php?lat=" + lat + "&lon=" + lon + "&FcstType=json", true);
      var stP = get(P.observationStations, true).then(function (s) {
        var f = s && s.features && s.features[0];
        if (f) return { id: f.properties.stationIdentifier, name: f.properties.name,
          elevFt: f.properties.elevation && f.properties.elevation.value != null ? Math.round(f.properties.elevation.value * 3.28084) : null };
        return mcP.then(function (m) {
          var co = m && m.currentobservation, id = (m && m.location && m.location.metar) || (co && co.id);
          return id ? { id: id, name: (co && co.name) || id, elevFt: co && isFinite(+co.elev) ? Math.round(+co.elev) : null } : null;
        });
      }).then(function (st) {
        if (!st) return { station: {}, obs: null };
        return get(API + "/stations/" + st.id + "/observations?start=" + since, true).then(function (o) { return { station: st, obs: o }; });
      });
      var first = function (type) {
        return get(API + "/products/types/" + type + "/locations/" + P.cwa, true).then(function (l) {
          return l && l["@graph"] && l["@graph"][0] ? get(l["@graph"][0]["@id"], true) : null;
        });
      };
      return Promise.all([
        get(P.forecast), get(P.forecastGridData), stP,
        get(API + "/alerts/active?point=" + lat + "," + lon, true),
        first("AFD"), first("HWO"), epa("DAILY"), epa("HOURLY"),
        mcP
      ]);
    }).then(function (r) {
      return root.WXNormalize.normalize({ points: points, forecast: r[0], grid: r[1], station: r[2].station, obs: r[2].obs, alerts: r[3],
        afd: r[4], hwo: r[5], uv: r[6], uvh: r[7], mapclick: r[8], label: loc.label || null, lat: lat, lon: lon, via: "live" });
    });
    }
  }
  // does weather.gov forecast this point? (US only)
  function covers(lat, lon) { return fetch(API + "/points/" + lat + "," + lon).then(function (r) { return r.ok; }).catch(function () { return false; }); }
  // weather.gov's own place name for a point: "City, ST", null if unknown, false if it has no forecast there
  function place(lat, lon) {
    return fetch(API + "/points/" + lat + "," + lon).then(function (r) {
      if (!r.ok) return r.status === 404 ? false : null;
      return r.json().then(function (j) {
        var rl = j.properties && j.properties.relativeLocation && j.properties.relativeLocation.properties;
        return rl && rl.city ? rl.city + ", " + rl.state : null;
      });
    }).catch(function () { return null; });
  }
  root.WXLive = { load: load, geocode: geocode, covers: covers, place: place };
})(window);
