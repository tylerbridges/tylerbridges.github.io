// wx-live.js — pulls weather.gov (and EPA UV, ArcGIS geocoding) straight from the browser and builds the
// dashboard's data document with wx-normalize.js. All of these services allow cross-origin requests.
(function (root) {
  "use strict";
  var API = "https://api.weather.gov";
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function get(url, optional) {
    var tries = 0;
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
    return once();
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
  function load(loc) {
    var lat = +(+loc.lat).toFixed(4), lon = +(+loc.lon).toFixed(4), P, points;
    return get(API + "/points/" + lat + "," + lon).then(function (pts) {
      points = pts; P = pts.properties;
      var since = new Date(Date.now() - 25 * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
      var rl = (P.relativeLocation && P.relativeLocation.properties) || {};
      var epa = function (kind) { return rl.city ? get("https://data.epa.gov/efservice/getEnvirofactsUV" + kind + "/CITY/" + encodeURIComponent(rl.city) + "/STATE/" + rl.state + "/JSON", true) : Promise.resolve(null); };
      var stP = get(P.observationStations, true).then(function (s) {
        var f = s && s.features && s.features[0];
        if (!f) return { station: {}, obs: null };
        var st = { id: f.properties.stationIdentifier, name: f.properties.name,
          elevFt: f.properties.elevation && f.properties.elevation.value != null ? Math.round(f.properties.elevation.value * 3.28084) : null };
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
        get("https://forecast.weather.gov/MapClick.php?lat=" + lat + "&lon=" + lon + "&FcstType=json", true)
      ]);
    }).then(function (r) {
      return root.WXNormalize.normalize({ points: points, forecast: r[0], grid: r[1], station: r[2].station, obs: r[2].obs, alerts: r[3],
        afd: r[4], hwo: r[5], uv: r[6], uvh: r[7], mapclick: r[8], label: loc.label || null, lat: lat, lon: lon, via: "live" });
    });
  }
  // does weather.gov forecast this point? (US only)
  function covers(lat, lon) { return fetch(API + "/points/" + lat + "," + lon).then(function (r) { return r.ok; }).catch(function () { return false; }); }
  root.WXLive = { load: load, geocode: geocode, covers: covers };
})(window);
