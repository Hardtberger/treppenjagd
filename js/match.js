/* Treppen-Erkennung: gleicht GPS-Spuren mit den Treppen-Geometrien ab.
   Läuft komplett im Browser – Standortdaten verlassen das Gerät nicht. */
(function (root) {
  'use strict';
  const LAT0 = 51.256;
  const MX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
  const MY = 110540;
  const CELL = 60; // m
  const SAMPLE = 6; // m Abstand der Prüfpunkte auf einer Treppe

  const toXY = (lat, lon) => [lon * MX, lat * MY];
  const distM = (a, b) => Math.hypot((a[1] - b[1]) * MX, (a[0] - b[0]) * MY);

  /** Profile: wie streng wird abgeglichen? */
  const PROFILES = {
    live: { tol: 14, maxGap: 120, cover: 0.65 },      // eigenes GPS, hohe Genauigkeit
    gpx: { tol: 16, maxGap: 200, cover: 0.6 },        // aufgezeichnete Tracks
    timeline: { tol: 28, maxGap: 450, cover: 0.5 },   // Google-Zeitachse: grob
  };

  function buildIndex(stairs) {
    const grid = new Map();
    const items = [];
    stairs.forEach((s, idx) => {
      const pts = [];
      for (const line of s.g) {
        for (let i = 0; i < line.length - 1; i++) {
          const a = toXY(line[i][0], line[i][1]);
          const b = toXY(line[i + 1][0], line[i + 1][1]);
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const n = Math.max(1, Math.round(len / SAMPLE));
          for (let k = i === 0 ? 0 : 1; k <= n; k++) {
            pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
          }
        }
      }
      items.push({ id: s.id, pts });
      const seen = new Set();
      for (const p of pts) {
        const key = Math.floor(p[0] / CELL) + ':' + Math.floor(p[1] / CELL);
        if (!seen.has(key)) {
          seen.add(key);
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(idx);
        }
      }
    });
    return { grid, items };
  }

  function segDist2(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = p[0] - a[0] - t * dx, ey = p[1] - a[1] - t * dy;
    return ex * ex + ey * ey;
  }

  /** Fortlaufender Abgleich: Segmente einfüttern, fertige Treppen kommen zurück. */
  class Matcher {
    constructor(index, profile) {
      this.index = index;
      this.p = typeof profile === 'string' ? PROFILES[profile] : profile;
      this.cov = new Map(); // idx -> {hit:Uint8Array, n:number, t:number|null}
      this.done = new Map(); // id -> t
      this.last = null;
    }
    /** Punkt = [lat, lon, zeitMs|null]. Gibt neu erkannte Treppen-IDs zurück. */
    push(pt) {
      const cur = { xy: toXY(pt[0], pt[1]), t: pt[2] || null };
      const prev = this.last;
      this.last = cur;
      if (!prev) return this._feed(cur.xy, cur.xy, cur.t);
      const gap = Math.hypot(cur.xy[0] - prev.xy[0], cur.xy[1] - prev.xy[1]);
      if (gap > this.p.maxGap) return this._feed(cur.xy, cur.xy, cur.t);
      return this._feed(prev.xy, cur.xy, cur.t);
    }
    reset() { this.last = null; }
    _feed(a, b, t) {
      const { tol, cover } = this.p;
      const tol2 = tol * tol;
      const x0 = Math.floor((Math.min(a[0], b[0]) - tol) / CELL), x1 = Math.floor((Math.max(a[0], b[0]) + tol) / CELL);
      const y0 = Math.floor((Math.min(a[1], b[1]) - tol) / CELL), y1 = Math.floor((Math.max(a[1], b[1]) + tol) / CELL);
      const cand = new Set();
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const c = this.index.grid.get(x + ':' + y);
        if (c) for (const i of c) cand.add(i);
      }
      const fresh = [];
      for (const i of cand) {
        const it = this.index.items[i];
        if (this.done.has(it.id)) continue;
        let c = this.cov.get(i);
        for (let k = 0; k < it.pts.length; k++) {
          if (c && c.hit[k]) continue;
          if (segDist2(it.pts[k], a, b) <= tol2) {
            if (!c) { c = { hit: new Uint8Array(it.pts.length), n: 0 }; this.cov.set(i, c); }
            c.hit[k] = 1; c.n++;
          }
        }
        if (!c) continue;
        const need = it.pts.length <= 3 ? it.pts.length : Math.ceil(it.pts.length * cover);
        if (c.n >= need) { this.done.set(it.id, t); fresh.push(it.id); }
      }
      return fresh;
    }
  }

  /** Ganze Spuren abgleichen. tracks = [[ [lat,lon,t], ... ], ...] → [{id, t}] */
  function matchTracks(index, tracks, profile) {
    const out = new Map(); // id + Tag -> {id,t}
    for (const tr of tracks) {
      // pro Kalendertag eigener Matcher, damit Wiederholungen an anderen Tagen zählen
      let m = new Matcher(index, profile), day = null;
      for (const pt of tr) {
        const d = pt[2] ? dayKey(pt[2]) : 'x';
        if (d !== day) { m = new Matcher(index, profile); day = d; }
        for (const id of m.push(pt)) out.set(id + '|' + d, { id, t: pt[2] || null });
      }
    }
    return [...out.values()];
  }

  function dayKey(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ---------- Import-Parser ------------------------------------------------
  function parseGPX(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const tracks = [];
    const collect = (nodes) => {
      const tr = [];
      for (const n of nodes) {
        const lat = parseFloat(n.getAttribute('lat')), lon = parseFloat(n.getAttribute('lon'));
        if (!isFinite(lat) || !isFinite(lon)) continue;
        const tEl = n.getElementsByTagName('time')[0];
        const t = tEl ? Date.parse(tEl.textContent) : NaN;
        tr.push([lat, lon, isFinite(t) ? t : null]);
      }
      if (tr.length > 1) tracks.push(tr);
    };
    const segs = doc.getElementsByTagName('trkseg');
    for (const s of segs) collect(s.getElementsByTagName('trkpt'));
    const rtes = doc.getElementsByTagName('rte');
    for (const r of rtes) collect(r.getElementsByTagName('rtept'));
    return tracks;
  }

  const RE_GEO = /^(?:geo:)?\s*(-?\d{1,2}\.\d+)\s*°?\s*,\s*(-?\d{1,3}\.\d+)\s*°?$/;
  function coordOf(o) {
    if (o == null) return null;
    if (typeof o === 'string') {
      const m = RE_GEO.exec(o.trim());
      return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
    }
    if (typeof o !== 'object') return null;
    if (typeof o.latitudeE7 === 'number' && typeof o.longitudeE7 === 'number') return [o.latitudeE7 / 1e7, o.longitudeE7 / 1e7];
    if (typeof o.latE7 === 'number' && typeof o.lngE7 === 'number') return [o.latE7 / 1e7, o.lngE7 / 1e7];
    if (typeof o.lat === 'number' && typeof (o.lng ?? o.lon) === 'number') return [o.lat, o.lng ?? o.lon];
    for (const k of ['point', 'LatLng', 'latLng', 'position']) {
      if (typeof o[k] === 'string') { const c = coordOf(o[k]); if (c) return c; }
    }
    return null;
  }
  function timeOf(o, base) {
    if (!o || typeof o !== 'object') return base || null;
    if (o.duration && o.duration.startTimestamp) {
      const t = Date.parse(o.duration.startTimestamp);
      if (isFinite(t)) return t;
    }
    for (const k of ['time', 'timestamp', 'startTime', 'startTimestamp', 'timestampMs']) {
      if (o[k] != null) {
        const t = k === 'timestampMs' ? Number(o[k]) : Date.parse(o[k]);
        if (isFinite(t)) return t;
      }
    }
    if (base && o.durationMinutesOffsetFromStartTime != null) return base + Number(o.durationMinutesOffsetFromStartTime) * 60000;
    return base || null;
  }

  /** Google-Zeitachse (alle bekannten Export-Varianten) und GeoJSON: tolerant alle Wegpunkte einsammeln. */
  function parseTimelineJSON(text) {
    const data = JSON.parse(text);
    const pts = [];
    const BOX = [50.9, 51.6, 6.7, 7.7]; // nur Großraum Wuppertal behalten
    const add = (c, t) => { if (c && c[0] > BOX[0] && c[0] < BOX[1] && c[1] > BOX[2] && c[1] < BOX[3]) pts.push([c[0], c[1], t]); };
    const walk = (o, base) => {
      if (Array.isArray(o)) {
        // GeoJSON-Koordinatenpaar [lon, lat]
        if (o.length >= 2 && o.length <= 3 && typeof o[0] === 'number' && typeof o[1] === 'number') { add([o[1], o[0]], base); return; }
        for (const x of o) walk(x, base);
        return;
      }
      if (!o || typeof o !== 'object') return;
      const t = timeOf(o, base);
      const c = coordOf(o);
      if (c) add(c, t);
      for (const k in o) {
        const v = o[k];
        if (typeof v === 'string') { if (k === 'start' || k === 'end') add(coordOf(v), k === 'end' && o.endTime ? Date.parse(o.endTime) : t); }
        else if (v && typeof v === 'object') walk(v, t);
      }
    };
    walk(data, null);
    const timed = pts.filter((p) => p[2]).sort((a, b) => a[2] - b[2]);
    const untimed = pts.filter((p) => !p[2]);
    const tracks = [];
    const split = (arr, byTime) => {
      let cur = [];
      for (const p of arr) {
        const prev = cur[cur.length - 1];
        if (prev && ((byTime && p[2] - prev[2] > 20 * 60000) || distM(prev, p) > 600)) { if (cur.length > 1) tracks.push(cur); cur = []; }
        cur.push(p);
      }
      if (cur.length > 1) tracks.push(cur);
    };
    split(timed, true);
    split(untimed, false);
    return tracks;
  }

  function parseFile(name, text) {
    const head = text.slice(0, 400).trimStart();
    if (/\.gpx$/i.test(name) || head.startsWith('<')) return { kind: 'gpx', tracks: parseGPX(text) };
    return { kind: 'timeline', tracks: parseTimelineJSON(text) };
  }

  root.TJMatch = { buildIndex, Matcher, matchTracks, parseGPX, parseTimelineJSON, parseFile, distM, dayKey, PROFILES };
})(typeof window !== 'undefined' ? window : globalThis);
