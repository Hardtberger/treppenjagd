#!/usr/bin/env python3
"""Baut data/stairs.json aus OpenStreetMap-Rohdaten (Overpass-Exporte).

Aufruf:  python3 -I tools/build_data.py <osm-rohdaten> <ausgabe-ordner> <stadt-rohdaten>

Schreibt stairs.json (Treppen) und areas.json (Quartiere als Spielbereiche).

Erwartet im Rohdaten-Ordner:
  steps.json    way[highway=steps] in Wuppertal            (out tags geom)
  streets.json  benannte Wege im 25-m-Umkreis der Treppen  (out tags geom)
  bezirke.json  Stadtbezirke admin_level=9                 (out geom)
  extra.json    Relation "Ronsdorf" + Stadtgrenze          (out geom)
  oelberg_roads.json  Hochstraße u. a. (zum Abtrennen des Ölbergs)
Im Stadt-Ordner:
  quartiere.json  69 Quartiere, Stadt Wuppertal, CC BY 4.0
                  https://daten.wuppertal.de/Infrastruktur_Bauen_Wohnen/Quartiere_EPSG4326_JSON.json
"""
import json
import math
import sys
from collections import Counter, defaultdict

RAW, OUT, CITY = sys.argv[1], sys.argv[2], sys.argv[3]
LAT0 = 51.256
MX = 111320 * math.cos(math.radians(LAT0))
MY = 110540

STEP_RUN_M = 0.33      # geschätzte Lauflänge je Stufe, wenn step_count fehlt
STEP_RISE_M = 0.165    # geschätzte Höhe je Stufe
MERGE_GAP_M = 9        # Podeste/kurze Lücken zwischen Abschnitten überbrücken
MIN_STEPS, MIN_LEN = 20, 15   # ab hier zählt eine Treppe für die Sammlung


def xy(p):
    return (p[1] * MX, p[0] * MY)


def dist(a, b):
    ax, ay = xy(a)
    bx, by = xy(b)
    return math.hypot(ax - bx, ay - by)


def seg_dist(p, a, b):
    px, py = xy(p)
    ax, ay = xy(a)
    bx, by = xy(b)
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0 if l2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def load(name):
    with open(f"{RAW}/{name}", encoding="utf-8") as f:
        return json.load(f)["elements"]


# ---------- Bezirke -------------------------------------------------------
def rings(rel):
    segs = [[(g["lat"], g["lon"]) for g in m["geometry"]]
            for m in rel.get("members", [])
            if m.get("type") == "way" and m.get("role") != "inner" and m.get("geometry")]
    out = []
    while segs:
        ring = segs.pop()
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == ring[-1]:
                    ring += s[1:]
                elif s[-1] == ring[-1]:
                    ring += s[::-1][1:]
                elif s[-1] == ring[0]:
                    ring = s[:-1] + ring
                elif s[0] == ring[0]:
                    ring = s[::-1][:-1] + ring
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if len(ring) > 3:
            out.append(ring)
    return out


def inside(p, ring):
    lat, lon = p
    c = False
    j = len(ring) - 1
    for i in range(len(ring)):
        (yi, xi), (yj, xj) = ring[i], ring[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


districts = []
for rel in load("bezirke.json"):
    districts.append((rel["tags"]["name"], rings(rel)))
city = []
for rel in load("extra.json"):
    if rel["tags"].get("name") == "Ronsdorf":
        b = rel.get("bounds", {})
        if 51.15 < b.get("minlat", 0) < 51.35:
            districts.append(("Ronsdorf", rings(rel)))
    elif rel["tags"].get("name") == "Wuppertal":
        city = rings(rel)


def district_of(p):
    for name, rs in districts:
        if any(inside(p, r) for r in rs):
            return name
    return "Ronsdorf" if not any(n == "Ronsdorf" for n, _ in districts) else "Stadtrand"



# ---------- Quartiere (Spielbereiche) -------------------------------------
BEZIRKE = ["Elberfeld", "Elberfeld-West", "Uellendahl-Katernberg", "Vohwinkel", "Cronenberg",
           "Barmen", "Oberbarmen", "Heckinghausen", "Langerfeld-Beyenburg", "Ronsdorf"]
RENAME = {"Elberfeld": "Elberfeld-Mitte", "Nevigeser Str": "Nevigeser Straße", "Industriestr.": "Industriestraße",
          "Fr.-Engels-Allee": "Friedrich-Engels-Allee", "Jesinghauser Str.": "Jesinghauser Straße",
          "Schenkstr.": "Schenkstraße", "Zoo": "Zooviertel"}


def hochstrasse():
    """Mittellinie der Hochstraße als Funktion lat(lon) – sie trennt den Ölberg von der übrigen Nordstadt."""
    pts = [(g["lon"], g["lat"]) for w in load("oelberg_roads.json") if w["tags"]["name"] == "Hochstraße" for g in w["geometry"]]
    lo, hi = min(p[0] for p in pts), max(p[0] for p in pts)
    n = 14
    line = []
    for i in range(n):
        a, b = lo + (hi - lo) * i / n, lo + (hi - lo) * (i + 1) / n
        sel = [p for p in pts if a <= p[0] <= b]
        if sel:
            line.append((sum(p[0] for p in sel) / len(sel), sum(p[1] for p in sel) / len(sel)))
    (x0, y0), (x1, y1) = line[0], line[1]
    line.insert(0, (x0 - 0.01, y0 - 0.01 * (y1 - y0) / (x1 - x0)))
    (x0, y0), (x1, y1) = line[-2], line[-1]
    line.append((x1 + 0.01, y1 + 0.01 * (y1 - y0) / (x1 - x0)))
    return line


def split_by_line(ring, line):
    """Teilt einen Ring (lat, lon) an der Linie lat(lon). Gibt (südlich, nördlich) zurück."""
    def f(p):
        lon = p[1]
        for (xa, ya), (xb, yb) in zip(line, line[1:]):
            if xa <= lon <= xb:
                return p[0] - (ya + (yb - ya) * (lon - xa) / (xb - xa))
        return p[0] - line[-1][1]

    def cross(a, b):
        lo, hi = 0.0, 1.0
        fa = f(a)
        for _ in range(40):
            m = (lo + hi) / 2
            p = (a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m)
            if (f(p) > 0) == (fa > 0):
                lo = m
            else:
                hi = m
        return (a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo)

    def along(p, q):
        a, b = sorted((p[1], q[1]))
        mid = [(y, x) for x, y in line if a < x < b]
        return mid if p[1] < q[1] else mid[::-1]

    ring = ring[:-1] if ring[0] == ring[-1] else ring
    out = {True: [], False: []}
    pending = {True: None, False: None}   # letzter Austrittspunkt je Seite
    first = {True: None, False: None}
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        sa, sb = f(a) > 0, f(b) > 0
        out[sa].append(a)
        if sa != sb:
            c = cross(a, b)
            out[sa].append(c)
            pending[sa] = c                       # Seite sa wird verlassen
            if pending[sb] is not None:           # Seite sb wird wieder betreten
                out[sb] += along(pending[sb], c)
                pending[sb] = None
            elif first[sb] is None:
                first[sb] = c
            out[sb].append(c)
    for side in (True, False):
        if pending[side] is not None and first[side] is not None:
            out[side] += along(pending[side], first[side])
    return out[False], out[True]


def simplify(ring, tol=2.5):
    """Douglas-Peucker in Metern."""
    def rec(pts):
        if len(pts) < 3:
            return pts
        a, b = pts[0], pts[-1]
        dmax, idx = 0, 0
        for i in range(1, len(pts) - 1):
            d = seg_dist(pts[i], a, b)
            if d > dmax:
                dmax, idx = d, i
        if dmax <= tol:
            return [a, b]
        return rec(pts[:idx + 1])[:-1] + rec(pts[idx:])
    half = len(ring) // 2
    return rec(ring[:half + 1])[:-1] + rec(ring[half:] + [ring[0]])[:-1]


areas = []
with open(f"{CITY}/quartiere.json", encoding="utf-8-sig") as fh:
    for feat in json.load(fh)["features"]:
        pr = feat["properties"]
        ring = [(c[1], c[0]) for c in feat["geometry"]["coordinates"][0]]
        name = RENAME.get(pr["NAME"], pr["NAME"])
        bez = BEZIRKE[int(pr["QUARTIER"][0])]
        if pr["NAME"] == "Nordstadt":
            south, north = split_by_line(ring, hochstrasse())
            areas.append({"id": "01a", "n": "Ölberg", "b": bez, "ring": south})
            areas.append({"id": "01", "n": "Nordstadt", "b": bez, "ring": north})
        else:
            areas.append({"id": pr["QUARTIER"], "n": name, "b": bez, "ring": ring})
for a in areas:
    a["ring"] = simplify(a["ring"])


def area_of(p):
    for a in areas:
        if inside(p, a["ring"]):
            return a
    return min(areas, key=lambda a: min(dist(p, q) for q in a["ring"]))

# ---------- Treppen-Abschnitte -------------------------------------------
ways = []
for w in load("steps.json"):
    t = w.get("tags", {})
    if t.get("access") in ("private", "no", "customers", "permit", "delivery"):
        continue
    if t.get("indoor") == "yes" or t.get("conveying") or t.get("tunnel") == "building_passage":
        continue
    if t.get("foot") in ("no", "private"):
        continue
    geom = [(round(g["lat"], 6), round(g["lon"], 6)) for g in w["geometry"]]
    if len(geom) < 2:
        continue
    length = sum(dist(geom[i], geom[i + 1]) for i in range(len(geom) - 1))
    sc = None
    try:
        sc = int(float(t.get("step_count", "")))
    except ValueError:
        pass
    if sc is not None and not (0 < sc < 800):
        sc = None
    ways.append({"id": w["id"], "geom": geom, "len": length, "steps": sc,
                 "name": t.get("name"), "level": t.get("level"), "layer": t.get("layer")})

# Union-Find: Abschnitte verbinden, deren Endpunkte (fast) aneinanderstoßen
parent = list(range(len(ways)))


def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i


def union(a, b):
    parent[find(a)] = find(b)


cell = defaultdict(list)
for i, w in enumerate(ways):
    for end in (w["geom"][0], w["geom"][-1]):
        x, y = xy(end)
        cell[(int(x // 20), int(y // 20))].append((i, end))
for i, w in enumerate(ways):
    for end in (w["geom"][0], w["geom"][-1]):
        x, y = xy(end)
        cx, cy = int(x // 20), int(y // 20)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j, other in cell.get((cx + dx, cy + dy), []):
                    if j <= i:
                        continue
                    d = dist(end, other)
                    same_name = w["name"] and w["name"] == ways[j]["name"]
                    if d <= MERGE_GAP_M or (same_name and d <= 30):
                        union(i, j)

groups = defaultdict(list)
for i in range(len(ways)):
    groups[find(i)].append(ways[i])

# ---------- Straßennamen für namenlose Treppen ----------------------------
streets = []
sgrid = defaultdict(list)
for s in load("streets.json"):
    g = [(p["lat"], p["lon"]) for p in s.get("geometry", [])]
    name = s.get("tags", {}).get("name")
    if len(g) < 2 or not name:
        continue
    idx = len(streets)
    streets.append((name, g))
    seen = set()
    for a, b in zip(g, g[1:]):
        n = max(1, int(dist(a, b) // 40))
        for k in range(n + 1):
            p = (a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)
            x, y = xy(p)
            key = (int(x // 60), int(y // 60))
            if key not in seen:
                seen.add(key)
                sgrid[key].append(idx)


def nearest_street(p, maxd=30):
    x, y = xy(p)
    cx, cy = int(x // 60), int(y // 60)
    best = (maxd, None)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for idx in sgrid.get((cx + dx, cy + dy), []):
                name, g = streets[idx]
                d = min(seg_dist(p, a, b) for a, b in zip(g, g[1:]))
                if d < best[0]:
                    best = (d, name)
    return best[1]


# ---------- Treppen zusammensetzen ---------------------------------------
stairs = []
for members in groups.values():
    members.sort(key=lambda w: w["id"])
    length = sum(w["len"] for w in members)
    steps, estimated = 0, False
    for w in members:
        if w["steps"] is not None:
            steps += w["steps"]
        else:
            steps += max(2, round(w["len"] / STEP_RUN_M))
            estimated = True
    pts = [p for w in members for p in w["geom"]]
    center = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    if city and not any(inside(center, r) for r in city):
        continue
    names = Counter(w["name"] for w in members if w["name"])
    name, named = None, False
    if names:
        name, named = names.most_common(1)[0][0], True
    # Enden = die zwei am weitesten voneinander entfernten Endpunkte
    ends = [w["geom"][0] for w in members] + [w["geom"][-1] for w in members]
    a, b = max(((p, q) for p in ends for q in ends), key=lambda pq: dist(*pq))
    if not name:
        sa, sb = nearest_street(a), nearest_street(b)
        if sa and sb and sa != sb:
            name = f"{sa} ↔ {sb}"
        elif sa or sb:
            name = f"Treppe {sa or sb}"
        else:
            name = None
    stairs.append({
        "id": members[0]["id"],
        "n": name,
        "o": 1 if named else 0,                    # offizieller OSM-Name
        "s": steps,
        "e": 1 if estimated else 0,                # Stufenzahl geschätzt
        "l": round(length),
        "h": round(steps * STEP_RISE_M, 1),        # geschätzte Höhe
        "d": area_of(center)["b"],
        "q": area_of(center)["id"],
        "c": [round(center[0], 5), round(center[1], 5)],
        "g": [[[round(p[0], 5), round(p[1], 5)] for p in w["geom"]] for w in members],
        "k": 1 if (steps >= MIN_STEPS or length >= MIN_LEN) else 0,   # sammelbar
    })

# Namenlose ohne Straße: nach Bezirk durchnummerieren; doppelte Namen eindeutig machen
stairs.sort(key=lambda s: (s["d"], -s["s"]))
cnt = Counter()
for s in stairs:
    if not s["n"]:
        cnt[s["d"]] += 1
        s["n"] = f"Namenlose Treppe {s['d']} #{cnt[s['d']]}"
dups = Counter(s["n"] for s in stairs)
seen = Counter()
for s in stairs:
    if dups[s["n"]] > 1:
        seen[s["n"]] += 1
        s["n"] = f"{s['n']} ({seen[s['n']]})" if seen[s["n"]] > 1 else s["n"]

coll = [s for s in stairs if s["k"]]
meta = {
    "generated": "2026-11-11",
    "source": "Treppen: © OpenStreetMap-Mitwirkende, ODbL 1.0 · Quartiere: Stadt Wuppertal, CC BY 4.0, offenedaten-wuppertal.de",
    "total": len(stairs),
    "collectible": len(coll),
    "steps": sum(s["s"] for s in coll),
    "districts": BEZIRKE,
}
with open(f"{OUT}/stairs.json", "w", encoding="utf-8") as f:
    json.dump({"meta": meta, "stairs": stairs}, f, ensure_ascii=False, separators=(",", ":"))
per_area = Counter(s["q"] for s in coll)
with open(f"{OUT}/areas.json", "w", encoding="utf-8") as f:
    json.dump([{"id": a["id"], "n": a["n"], "b": a["b"],
                "r": [[round(p[0], 5), round(p[1], 5)] for p in a["ring"]]} for a in areas],
              f, ensure_ascii=False, separators=(",", ":"))

print(json.dumps(meta, ensure_ascii=False, indent=1))
print("pro Bezirk (sammelbar):", Counter(s["d"] for s in coll).most_common())
print("Quartiere:", len(areas), "Punkte:", sum(len(a["ring"]) for a in areas))
print("pro Quartier:", sorted(((a["n"], per_area[a["id"]]) for a in areas), key=lambda x: -x[1]))
for n in ("Ölberg", "Nordstadt"):
    a = next(x for x in areas if x["n"] == n)
    print(n, len(a["ring"]), [s["n"] for s in coll if s["q"] == a["id"] and s["o"]])
