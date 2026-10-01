#!/usr/bin/env python3
"""Deep radar audit: compares what the Radar tab draws with each NEXRAD's own Level II scan (what RadarScope shows).

Not part of the site. Run it after changing radar sources, colours or display rules, or when radar looks off:
    pip install metpy xarray cfgrib eccodes scipy numpy
    python tools/radar_audit.py              # radars with the most precipitation right now (CONUS)
    python tools/radar_audit.py KOAX KDMX    # specific radars
Downloads the latest Level II volume per radar (unidata-nexrad-level2 on AWS) and the matching MRMS SeamlessHSR and
PrecipFlag grids (noaa-mrms-pds), applies the site's display rule (>=20 dBZ, or >=10 where PrecipFlag says
precipitation), and compares on 1 km cells 15-150 km from each radar:
  detect   share of Level II weather cells (max gate >=20 dBZ with CC>=0.9) the map shows
  heavy    share of echo area at 35+ / 40+ dBZ, map vs Level II (cell mean in linear Z)
  cores    Level II 40+ dBZ cells shown as >=35 / >=40
  bias     map minus Level II cell mean, cells where both >=20 dBZ
  birds    cells with only low-CC (<0.8) echo that the map shows
Exits 1 if the all-radar totals miss these targets: bias within ±1.5 dB, heavy 35+ area >=80% of Level II's,
40+ cores shown >=35 in >=85% of cells, birds shown <=5%. (Oct 1 2026 baseline, 22 radars: bias -0.1 dB,
35+ area 14.3% vs 15.1%, cores >=35 91%, birds 1.5%.)
"""
import datetime as dt, os, re, subprocess, sys, tempfile, warnings
import numpy as np, xarray as xr
from scipy.ndimage import maximum_filter
from metpy.io import Level2File
warnings.filterwarnings("ignore")
S3M, S3L = "https://noaa-mrms-pds.s3.amazonaws.com/", "https://unidata-nexrad-level2.s3.amazonaws.com/"
SITES = {'KOAX':(41.32,-96.37),'KDMX':(41.73,-93.72),'KARX':(43.82,-91.19),'KMPX':(44.85,-93.57),'KFSD':(43.59,-96.73),'KUEX':(40.32,-98.44),'KTWX':(38.997,-96.23),'KICT':(37.65,-97.44),'KEAX':(38.81,-94.26),'KLSX':(38.70,-90.68),'KDVN':(41.61,-90.58),'KLOT':(41.60,-88.08),'KMKX':(42.97,-88.55),'KGRB':(44.50,-88.11),'KGRR':(42.89,-85.54),'KDTX':(42.70,-83.47),'KIWX':(41.36,-85.70),'KIND':(39.71,-86.28),'KILN':(39.42,-83.82),'KCLE':(41.41,-81.86),'KBUF':(42.95,-78.74),'KTYX':(43.76,-75.68),'KENX':(42.59,-74.06),'KBOX':(41.96,-71.14),'KOKX':(40.87,-72.86),'KDIX':(39.95,-74.41),'KLWX':(38.98,-77.48),'KAKQ':(36.98,-77.01),'KRAX':(35.67,-78.49),'KFFC':(33.36,-84.57),'KJAX':(30.48,-81.70),'KTBW':(27.71,-82.40),'KAMX':(25.61,-80.41),'KMLB':(28.11,-80.65),'KTLH':(30.40,-84.33),'KMOB':(30.68,-88.24),'KLIX':(30.34,-89.83),'KHGX':(29.47,-95.08),'KFWS':(32.57,-97.30),'KGRK':(30.72,-97.38),'KEWX':(29.70,-98.03),'KCRP':(27.78,-97.51),'KBRO':(25.92,-97.42),'KTLX':(35.33,-97.28),'KINX':(36.18,-95.56),'KSRX':(35.29,-94.36),'KLZK':(34.84,-92.26),'KSHV':(32.45,-93.84),'KFDR':(34.36,-98.98),'KAMA':(35.23,-101.71),'KLBB':(33.65,-101.81),'KMAF':(31.94,-102.19),'KDDC':(37.76,-99.97),'KGLD':(39.37,-101.70),'KLNX':(41.96,-100.58),'KABR':(45.46,-98.41),'KBIS':(46.77,-100.76),'KMVX':(47.53,-97.33),'KDLH':(46.84,-92.21),'KFTG':(39.79,-104.55),'KPUX':(38.46,-104.18),'KCYS':(41.15,-104.81),'KABX':(35.15,-106.82),'KIWA':(33.29,-111.67),'KMTX':(41.26,-112.45),'KATX':(48.19,-122.50),'KRTX':(45.71,-122.97),'KDAX':(38.50,-121.68),'KMUX':(37.16,-121.90),'KSOX':(33.82,-117.64),'KNKX':(32.92,-117.04),'KESX':(35.70,-114.89),'KPAH':(37.07,-88.77),'KOHX':(36.25,-86.56),'KNQA':(35.34,-89.87),'KHTX':(34.93,-86.08),'KBMX':(33.17,-86.77),'KJKL':(37.59,-83.31),'KRLX':(38.31,-81.72),'KPBZ':(40.53,-80.22),'KCCX':(40.92,-78.00)}
TMP = tempfile.mkdtemp(prefix="radar_audit_")
def sh(cmd): return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout
def keys(base, prefix): return re.findall(r"<Key>([^<]+)</Key>", sh(f'curl -s "{base}?list-type=2&prefix={prefix}"'))
def ktime(k): return dt.datetime.strptime(re.search(r"(\d{8}[-_]\d{6})", k).group(1).replace("_", "-"), "%Y%m%d-%H%M%S")
def mrms_list(prod, t):
    out = []
    for h in {t - dt.timedelta(hours=1), t}: out += keys(S3M, f"CONUS/{prod}/{h:%Y%m%d}/MRMS_{prod}_{h:%Y%m%d-%H}")
    return [(ktime(k), k) for k in out]
_c = {}
def grid(k):
    if k not in _c:
        f = os.path.join(TMP, os.path.basename(k)[:-3]); sh(f"curl -s {S3M}{k} | gunzip > {f}")
        ds = xr.open_dataset(f, engine="cfgrib", indexpath=""); _c[k] = ds[list(ds.data_vars)[0]].values.astype(np.float32)
    return _c[k]
def near(lst, t): return min(lst, key=lambda x: abs((x[0] - t).total_seconds()))[1]
def dest(lat0, lon0, az, s):
    p1, l1, th, d = np.radians(lat0), np.radians(lon0), np.radians(az), s / 6371.0
    p2 = np.arcsin(np.sin(p1) * np.cos(d) + np.cos(p1) * np.sin(d) * np.cos(th))
    return np.degrees(p2), np.degrees(l1 + np.arctan2(np.sin(th) * np.sin(d) * np.cos(p1), np.cos(d) - np.sin(p1) * np.sin(p2)))
def main():
    now = dt.datetime.utcnow(); H = mrms_list("SeamlessHSR_00.00", now); F = mrms_list("PrecipFlag_00.00", now)
    radars = sys.argv[1:]
    if not radars:  # radars with the most precipitation now
        A = grid(H[-1][1]); sc = []
        for s, (la, lo) in SITES.items():
            i, j = int(round((54.995 - la) / .01)), int(round((lo + 129.995) / .01)); w = A[max(0, i - 130):i + 131, max(0, j - 170):j + 171]
            sc.append(((w >= 20).mean(), s))
        radars = [s for f, s in sorted(sc, reverse=True) if f > 0.03][:20]
    tot = dict(det=[0, 0], c35=[0, 0], bias=[0, 0], bird=[0, 0], a35s=0, a35r=0, es=0, er=0)
    print("radar | detect | heavy 35+ map/L2 | 40+ map/L2 | 40+ cores >=35/>=40 | bias | birds")
    for s in radars:
        ks = [k for k in keys(S3L, f"{now:%Y/%m/%d}/{s}/") + keys(S3L, f"{now - dt.timedelta(hours=1):%Y/%m/%d}/{s}/") if not k.endswith("_MDM")]
        if not ks: print(s, "no Level II"); continue
        k = max(ks, key=ktime); f = os.path.join(TMP, os.path.basename(k)); sh(f"curl -s -o {f} {S3L}{k}")
        try: lf = Level2File(f)
        except Exception as e: print(s, "unreadable", e); continue
        sw = lf.sweeps[0]; vc = sw[0][1]; el = sw[0][0].el_angle
        t = dt.datetime(1970, 1, 1) + dt.timedelta(days=sw[0][0].date - 1, milliseconds=sw[len(sw) // 2][0].time_ms) + dt.timedelta(minutes=1)
        az = np.array([r[0].az_angle for r in sw]); h = sw[0][4][b"REF"][0]; ng = max(len(r[4][b"REF"][1]) for r in sw)
        Z = np.full((len(sw), ng), np.nan, np.float32); C = Z.copy(); rng = h.first_gate + np.arange(ng) * h.gate_width
        for i, r in enumerate(sw):
            d = r[4][b"REF"][1]; Z[i, :len(d)] = d
            if b"RHO" in r[4]: hh, d2 = r[4][b"RHO"]; C[i] = np.interp(rng, hh.first_gate + np.arange(len(d2)) * hh.gate_width, d2, left=np.nan, right=np.nan)
        AZ, RG = np.meshgrid(az, rng, indexing="ij"); m = (RG >= 15) & (RG <= 150)
        la, lo = dest(vc.lat, vc.lon, AZ[m], RG[m] * np.cos(np.radians(el)))
        key = np.round((54.995 - la) / .01).astype(int).clip(0, 3499) * 7000 + np.round((lo + 129.995) / .01).astype(int).clip(0, 6999)
        z, c = Z[m], C[m]; o = np.argsort(key); u, idx = np.unique(key[o], return_index=True); zo, co = z[o], c[o]; wo = ~np.isnan(zo) & (co >= .9)
        lin = np.where(wo, 10 ** (np.nan_to_num(zo, nan=-30) / 10), .1); cmean = 10 * np.log10(np.add.reduceat(lin, idx) / np.add.reduceat(np.ones_like(lin), idx))
        cmax = np.maximum.reduceat(np.where(wo, zo, -30), idx)
        bird = (np.maximum.reduceat(np.where(~np.isnan(zo) & (co < .8), zo, -30), idx) >= 15) & (cmax < 10)
        M = grid(near(H, t)); Fl = grid(near(F, t)); V = np.where((M >= 20) | ((M >= 10) & (Fl > 0)), M, -30)
        v = V.ravel()[u]; vn = maximum_filter(V, 3).ravel()[u]; wx = cmax >= 20; e = cmean >= 15; es = v >= 15; core = cmax >= 40; both = (cmean >= 20) & (v >= 20)
        pc = lambda a: 100 * a.mean() if a.size else float("nan")
        row = (pc(vn[wx] >= 10), pc(v[es] >= 35), pc(cmean[e] >= 35), pc(v[es] >= 40), pc(cmean[e] >= 40), pc(vn[core] >= 35), pc(vn[core] >= 40), (v[both] - cmean[both]).mean() if both.any() else float("nan"), pc(v[bird] >= 10))
        print(f"{s} | {row[0]:5.1f}% | {row[1]:4.1f}/{row[2]:4.1f}% | {row[3]:4.1f}/{row[4]:4.1f}% | {row[5]:5.1f}/{row[6]:5.1f}% (n={core.sum()}) | {row[7]:+5.1f} | {row[8]:5.1f}%")
        for kk, val, w in (("det", row[0], wx.sum()), ("c35", row[5], core.sum()), ("bias", row[7], both.sum()), ("bird", row[8], bird.sum())):
            if w and not np.isnan(val): tot[kk][0] += val * w; tot[kk][1] += w
        tot["a35s"] += (v[es] >= 35).sum(); tot["a35r"] += (cmean[e] >= 35).sum(); tot["es"] += es.sum(); tot["er"] += e.sum()
    W = lambda k: tot[k][0] / tot[k][1] if tot[k][1] else float("nan")
    a35m, a35r = 100 * tot["a35s"] / max(1, tot["es"]), 100 * tot["a35r"] / max(1, tot["er"])
    print(f"\nALL: detect {W('det'):.1f}% | heavy 35+ area {a35m:.1f}% vs {a35r:.1f}% | 40+ cores shown >=35 {W('c35'):.1f}% | bias {W('bias'):+.1f} dB | birds {W('bird'):.1f}%")
    bad = [n for n, ok in (("bias", abs(W("bias")) <= 1.5), ("heavy area", a35r == 0 or a35m >= 0.8 * a35r), ("cores", np.isnan(W("c35")) or W("c35") >= 85), ("birds", np.isnan(W("bird")) or W("bird") <= 5)) if not ok]
    print("RESULT:", "PASS" if not bad else "FAIL (" + ", ".join(bad) + ")"); sys.exit(1 if bad else 0)
if __name__ == "__main__": main()
