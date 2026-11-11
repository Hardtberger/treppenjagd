/* Treppenjagd Wuppertal – Oberfläche */
(function () {
  'use strict';
  const { buildIndex, Matcher, matchTracks, parseFile, distM, dayKey } = window.TJMatch;
  const { computeStats, milestones, quests, areaBadges, fmt } = window.TJGame;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'treppenjagd.v2', OLD_KEY = 'treppenjagd.v1';
  const COLORS = { open: '#e4572e', done: '#1f7a4d', bonus: '#7d8a92' };

  // ---------- Zustand: Profile ---------------------------------------------
  // store = alles auf diesem Gerät; state = das gerade aktive Profil.
  const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  const blank = (name) => ({ id: newId(), name: cleanName(name) || 'Ich', created: Date.now(), log: [], goal: 4, seen: {}, level: 1, onboarded: false });
  let store = { v: 2, active: null, profiles: {}, friends: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) store = Object.assign(store, JSON.parse(raw));
    else {
      const old = localStorage.getItem(OLD_KEY); // Stand aus der ersten Version übernehmen
      if (old) { const p = Object.assign(blank(), JSON.parse(old)); store.profiles[p.id] = p; store.active = p.id; }
    }
  } catch (e) { /* privater Modus */ }
  if (!store.profiles[store.active]) {
    const first = Object.keys(store.profiles)[0];
    if (first) store.active = first;
    else { const p = blank(); store.profiles[p.id] = p; store.active = p.id; }
  }
  if (!Array.isArray(store.friends)) store.friends = [];
  let state = store.profiles[store.active];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ohne Speicher weiterlaufen */ } };

  let DATA, AREAS, areaById, areaNames, byId, index, stats, map, pos = null;
  const layers = new Map(); // id -> {lines:[], dot}
  const areaLayers = new Map(); // Quartier-ID -> Polygon
  let selectedArea = null, hoverArea = null;
  const canHover = matchMedia('(hover: hover)').matches;
  let onlyOpen = false;
  const today = () => dayKey(Date.now());

  // ---------- Abzeichen-Grafik ---------------------------------------------
  const GLYPHS = {
    peak: 'M2 20 9 7l4 6 3-4 6 11Z',
    steps: 'M2 20v-4h6v-5h6V6h8v14Z',
    pin: 'M12 2C7.6 2 5 5.2 5 9c0 5 7 13 7 13s7-8 7-13c0-3.8-2.6-7-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z',
    flag: 'M5 2v20h2v-8h12l-3-5 3-5H7V2Z',
    star: 'm12 2 3 7 7 .5-5.5 5 2 7.5-6.5-4.2L5.500 22l2-7.500-5.500-5L9 9Z',
    bolt: 'M13 2 4 14h7l-1 8 10-13h-7Z',
    flame: 'M12 2c1 5 6 7 6 13a6 6 0 0 1-12 0c0-3 1.500-4.500 3-6 0 2 1 3 2 3 0-4 0-7 1-10Z',
    loop: 'M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z',
    sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM11 1h2v4h-2ZM11 19h2v4h-2ZM1 11h4v2H1ZM19 11h4v2h-4Z',
    moon: 'M20 14.500A9 9 0 1 1 9.500 4 7 7 0 0 0 20 14.500Z',
    crown: 'M3 18 2 7l6 5 4-8 4 8 6-5-1 11ZM3 20h18v2H3Z',
  };
  function badgeSVG(m, size) {
    const locked = !m.done;
    const fill = locked ? 'var(--lock)' : `url(#tj-${m.tier})`;
    const ink = locked ? 'var(--lock-ink)' : '#fff';
    let inner;
    if (m.glyph === 'num') {
      const fs = m.mark.length > 2 ? 30 : 38;
      inner = `<text x="50" y="${50 + fs * 0.36}" text-anchor="middle" font-size="${fs}" class="b-num" fill="${ink}">${esc(m.mark)}</text>`;
    } else {
      const hasMark = m.mark && m.mark !== '★';
      inner = `<path d="${GLYPHS[m.glyph]}" fill="${ink}" fill-rule="evenodd" transform="translate(${hasMark ? 30 : 26} ${hasMark ? 20 : 26}) scale(${hasMark ? 1.67 : 2})"/>` +
        (hasMark ? `<text x="50" y="80" text-anchor="middle" font-size="17" class="b-num" fill="${ink}">${esc(m.mark)}</text>` : '');
    }
    const ring = locked && m.progress > 0
      ? `<path d="M50 4 90 27V73L50 96 10 73V27Z" fill="none" stroke="var(--green)" stroke-width="5" stroke-linejoin="round" pathLength="100" stroke-dasharray="${Math.max(3, m.progress * 100)} 100"/>`
      : '';
    return `<svg class="badge${locked ? ' locked' : ''}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
      <path d="M50 4 90 27V73L50 96 10 73V27Z" fill="${fill}" stroke="${locked ? 'var(--lock-line)' : 'rgba(0,0,0,.28)'}" stroke-width="3" stroke-linejoin="round"/>
      <g clip-path="url(#tj-hex)"><path d="M10 84h18V72h16V60h16V48h16V36h14v60H10Z" fill="${locked ? 'rgba(0,0,0,.05)' : 'rgba(0,0,0,.16)'}"/>
      ${locked ? '' : '<path d="M10 27 50 4l40 23v8L50 12 10 35Z" fill="rgba(255,255,255,.28)"/>'}</g>
      ${inner}${ring}</svg>`;
  }
  const levelEmblem = (lv, size) => badgeSVG({ done: true, tier: lv >= 13 ? 'w' : lv >= 9 ? 'g' : lv >= 5 ? 's' : 'b', glyph: 'num', mark: String(lv) }, size);

  // ---------- Karte ---------------------------------------------------------
  function initMap() {
    map = L.map('map', { zoomControl: false, preferCanvas: true, renderer: L.canvas({ tolerance: 14 }) }).setView([51.2562, 7.1508], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    map.attributionControl.setPrefix(false);
    const gAreas = L.layerGroup().addTo(map);
    for (const a of AREAS) {
      const pg = L.polygon(a.r, { lineJoin: 'round' });
      pg.on('click', () => openArea(a.id, map.getZoom() < 15));
      pg.on('mouseover', () => { hoverArea = a.id; paintArea(a.id); });
      pg.on('mouseout', () => { hoverArea = null; paintArea(a.id); });
      if (canHover) pg.bindTooltip(() => areaTip(a), { sticky: true, direction: 'top', offset: [0, -8], className: 'area-tip' });
      areaLayers.set(a.id, pg);
      gAreas.addLayer(pg);
    }
    const gDots = L.layerGroup(), gLines = L.layerGroup(), gBonus = L.layerGroup();
    for (const s of DATA.stairs) {
      const entry = { lines: [], dot: null };
      for (const line of s.g) {
        const pl = L.polyline(line, { weight: s.k ? 6 : 4, lineCap: 'round', opacity: 0.95 });
        pl.on('click', () => openStair(s.id));
        entry.lines.push(pl);
        (s.k ? gLines : gBonus).addLayer(pl);
      }
      if (s.k) {
        entry.dot = L.circleMarker(s.c, { radius: 5, weight: 1.5, color: '#fff', fillOpacity: 1 });
        entry.dot.on('click', () => (map.getZoom() < 15 ? openArea(s.q, true) : openStair(s.id)));
        entry.dot.on('mouseover', () => { if (map.getZoom() < 15) { hoverArea = s.q; paintArea(s.q); areaLayers.get(s.q).openTooltip(s.c); } });
        entry.dot.on('mouseout', () => { if (hoverArea === s.q) { hoverArea = null; paintArea(s.q); areaLayers.get(s.q).closeTooltip(); } });
        gDots.addLayer(entry.dot);
      }
      layers.set(s.id, entry);
    }
    const sync = () => {
      const z = map.getZoom();
      z >= 15 ? map.addLayer(gLines) : map.removeLayer(gLines);
      z < 16 ? map.addLayer(gDots) : map.removeLayer(gDots);
      z >= 17 && !onlyOpen ? map.addLayer(gBonus) : map.removeLayer(gBonus);
    };
    map.on('zoomend', sync);
    map.syncLayers = sync;
    sync();
  }
  function paintStair(s) {
    const done = stats.per.has(s.id);
    const color = done ? COLORS.done : s.k ? COLORS.open : COLORS.bonus;
    const hidden = onlyOpen && done;
    const e = layers.get(s.id);
    for (const pl of e.lines) pl.setStyle({ color, opacity: hidden ? 0 : 0.95, dashArray: done || !s.k ? null : '1 9' });
    if (e.dot) e.dot.setStyle({ fillColor: color, opacity: hidden ? 0 : 1, fillOpacity: hidden ? 0 : 1, radius: done ? 4 : 5 });
  }
  // Quartiere: je mehr gesammelt, desto grüner. Hover hebt hervor, Auswahl bekommt einen Bernstein-Rand.
  const areaStat = (id) => stats.areas[id] || { total: 0, done: 0, steps: 0, doneSteps: 0, bonus: 0 };
  function paintArea(id) {
    const st = areaStat(id), f = st.total ? st.done / st.total : 0;
    const sel = selectedArea === id, hov = hoverArea === id;
    areaLayers.get(id).setStyle({
      color: sel ? '#f2a900' : hov ? '#22292e' : '#22292e',
      weight: sel ? 4 : hov ? 3 : 1.2,
      opacity: sel || hov ? 1 : 0.4,
      dashArray: st.total || sel || hov ? null : '3 6',
      fillColor: f === 0 && (hov || sel) ? '#f2a900' : '#1f7a4d',
      fillOpacity: (f === 0 ? 0 : 0.1 + 0.38 * f) + (hov || sel ? 0.16 : 0),
    });
  }
  function areaTip(a) {
    const st = areaStat(a.id);
    return `<b>${esc(a.n)}</b>${st.total ? `${st.done} von ${st.total} Treppen` : 'keine sammelbaren Treppen'}`;
  }
  function selectArea(id) {
    const old = selectedArea; selectedArea = id;
    if (old && old !== id) paintArea(old);
    if (id) paintArea(id);
  }
  const paintAll = () => { DATA.stairs.forEach(paintStair); AREAS.forEach((a) => paintArea(a.id)); };

  let posMarker, posCircle;
  function showPos(lat, lon, acc) {
    pos = [lat, lon];
    if (!posMarker) {
      posCircle = L.circle(pos, { radius: acc, color: '#2b7fff', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
      posMarker = L.circleMarker(pos, { radius: 7, color: '#fff', weight: 3, fillColor: '#2b7fff', fillOpacity: 1, interactive: false }).addTo(map);
    } else { posMarker.setLatLng(pos); posCircle.setLatLng(pos).setRadius(acc); }
  }
  function geoError(err) {
    toast(err && err.code === 1 ? 'Standort ist nicht freigegeben. Erlaube ihn in den Browser-Einstellungen.' : 'Standort gerade nicht verfügbar.');
  }
  function locateOnce() {
    if (!navigator.geolocation) return toast('Dieses Gerät liefert keinen Standort.');
    navigator.geolocation.getCurrentPosition((p) => {
      showPos(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
      map.setView(pos, Math.max(map.getZoom(), 16));
      if ($('#view-progress').classList.contains('active')) renderProgress();
    }, geoError, { enableHighAccuracy: true, timeout: 12000 });
  }

  // ---------- Tour (Live-GPS) ----------------------------------------------
  let tour = null;
  async function startTour() {
    if (!navigator.geolocation) return toast('Dieses Gerät liefert keinen Standort.');
    tour = { matcher: new Matcher(index, 'live'), found: [], steps: 0, started: Date.now(), follow: true, wake: null, watch: null };
    try { if (navigator.wakeLock) tour.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ }
    tour.watch = navigator.geolocation.watchPosition(onTourPos, (err) => { geoError(err); if (err.code === 1) stopTour(); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    $('#btn-tour').classList.add('on');
    $('#tour-label').textContent = 'Tour beenden';
    $('#tour-status').hidden = false;
    tourStatus('Suche GPS …');
  }
  function onTourPos(p) {
    if (!tour) return;
    const { latitude: lat, longitude: lon, accuracy: acc } = p.coords;
    showPos(lat, lon, acc);
    if (tour.follow) map.setView(pos, Math.max(map.getZoom(), 17), { animate: true });
    if (acc > 35) { tour.matcher.reset(); return tourStatus(`GPS noch ungenau (±${Math.round(acc)} m)`); }
    const hits = tour.matcher.push([lat, lon, Date.now()]);
    if (hits.length) {
      const added = addAscents(hits.map((id) => ({ id, t: Date.now(), src: 'gps' })));
      for (const a of added) { tour.found.push(a.id); tour.steps += byId.get(a.id).s; }
    }
    tourStatus(tour.found.length ? `${tour.found.length} ${tour.found.length === 1 ? 'Treppe' : 'Treppen'} · ${fmt(tour.steps)} Stufen` : 'Tour läuft – lauf einfach los');
  }
  const tourStatus = (t) => { $('#tour-status').textContent = t; };
  function stopTour() {
    if (!tour) return;
    navigator.geolocation.clearWatch(tour.watch);
    if (tour.wake) tour.wake.release().catch(() => {});
    const t = tour; tour = null;
    $('#btn-tour').classList.remove('on');
    $('#tour-label').textContent = 'Tour starten';
    $('#tour-status').hidden = true;
    const mins = Math.max(1, Math.round((Date.now() - t.started) / 60000));
    modal(`<h2>Tour beendet</h2>
      <div class="stats3"><div><b>${t.found.length}</b><span>Treppen</span></div><div><b>${fmt(t.steps)}</b><span>Stufen</span></div><div><b>${mins}</b><span>Minuten</span></div></div>
      ${t.found.length ? `<ul class="list">${t.found.map((id) => `<li>${esc(byId.get(id).n)}</li>`).join('')}</ul>` : '<p>Diesmal war keine Treppe dabei. Auf der Karte siehst du, wo die nächste wartet.</p>'}
      <button class="btn primary" data-close>Fertig</button>`);
  }
  document.addEventListener('visibilitychange', async () => {
    if (tour && document.visibilityState === 'visible' && navigator.wakeLock) { try { tour.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ } }
  });

  // ---------- Besteigungen verbuchen ---------------------------------------
  /** entries: [{id, t, src, d?}] → verbucht höchstens eine Besteigung je Treppe und Tag. */
  function addAscents(entries) {
    const have = new Set(state.log.map((e) => e.id + '|' + e.d));
    const before = stats;
    const added = [];
    for (const e of entries) {
      if (!byId.has(e.id)) continue;
      const d = e.d || (e.t ? dayKey(e.t) : today());
      if (have.has(e.id + '|' + d)) continue;
      have.add(e.id + '|' + d);
      const rec = { id: e.id, d, t: e.t || null, src: e.src };
      state.log.push(rec); added.push(rec);
    }
    if (!added.length) return added;
    refresh();
    celebrate(before, added);
    return added;
  }
  function refresh() {
    stats = computeStats(state.log, byId, DATA.meta, today());
    save();
    paintAll();
    renderHud();
    const active = document.querySelector('.view.active').id;
    if (active === 'view-progress') renderProgress();
    if (active === 'view-badges') renderBadges();
  }

  // ---------- Feiern --------------------------------------------------------
  const queue = [];
  function celebrate(before, added) {
    const fresh = added.filter((a) => !before.per.has(a.id) && byId.get(a.id).k);
    const gained = stats.xp - before.xp;
    if (navigator.vibrate) navigator.vibrate(fresh.length ? [60, 40, 120] : 40);
    if (added.length === 1) {
      const s = byId.get(added[0].id);
      toast(`${fresh.length ? 'Neu entdeckt: ' : ''}${s.n} · +${fmt(gained)} Punkte`, true);
    } else toast(`${added.length} Treppen verbucht · +${fmt(gained)} Punkte`, true);
    if (stats.level.level > state.level) {
      queue.push({ kind: 'level', lv: stats.level });
      state.level = stats.level.level;
    }
    for (const a of AREAS) {
      const was = before.areas[a.id], now = stats.areas[a.id];
      if (now && now.total && now.done === now.total && was.done < was.total) queue.push({ kind: 'area', a, st: now });
    }
    for (const m of milestones(stats)) {
      if (m.done && !state.seen[m.id]) { state.seen[m.id] = today(); queue.push({ kind: 'badge', m }); }
    }
    save();
    if (queue.length) { $('#badge-dot').hidden = false; nextCelebration(); }
  }
  function nextCelebration() {
    if (!$('#modal').hidden || !queue.length) return;
    const c = queue.shift();
    const more = queue.length ? `<p class="fine">Noch ${queue.length} weitere …</p>` : '';
    if (c.kind === 'level') {
      modal(`<div class="celebrate">${confetti()}<div class="pop">${levelEmblem(c.lv.level, 132)}</div>
        <p class="eyebrow">Level ${c.lv.level}</p><h2>${esc(c.lv.title)}</h2><p>${esc(c.lv.text)}</p>${more}
        <button class="btn primary" data-close>Weiter</button></div>`, nextCelebration);
    } else if (c.kind === 'area') {
      modal(`<div class="celebrate">${confetti()}<div class="pop">${badgeSVG({ done: true, tier: 'g', glyph: 'flag', mark: '' }, 132)}</div>
        <p class="eyebrow">Quartier komplett · ${esc(c.a.b)}</p><h2>${esc(c.a.n)}</h2><p>Alle ${c.st.total} Treppen und ${fmt(c.st.steps)} Stufen. Dieses Viertel kennst du jetzt besser als die meisten, die dort wohnen.</p>${more}
        <button class="btn primary" data-close>Weiter</button></div>`, nextCelebration);
    } else {
      modal(`<div class="celebrate">${confetti()}<div class="pop">${badgeSVG(c.m, 132)}</div>
        <p class="eyebrow">Meilenstein · ${esc(c.m.group)}</p><h2>${esc(c.m.title)}</h2><p>${esc(c.m.text)}</p>${more}
        <button class="btn primary" data-close>Weiter</button></div>`, nextCelebration);
    }
  }
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return '';
    const cols = ['#1f7a4d', '#f2a900', '#e4572e', '#2b7fff', '#22292e'];
    let h = '<div class="confetti" aria-hidden="true">';
    for (let i = 0; i < 28; i++) h += `<i style="left:${(i * 37) % 100}%;background:${cols[i % 5]};animation-delay:${(i % 7) * 0.07}s;animation-duration:${1.4 + (i % 5) * 0.25}s"></i>`;
    return h + '</div>';
  }

  // ---------- Bausteine: Toast, Modal, Sheet -------------------------------
  let toastTimer;
  function toast(text, good) {
    const t = $('#toast');
    t.textContent = text; t.className = 'toast' + (good ? ' good' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
  }
  let modalClosed = null;
  function modal(html, onClose) {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
    m.hidden = false; modalClosed = onClose || null;
  }
  function closeModal() {
    $('#modal').hidden = true; $('#modal').innerHTML = '';
    const cb = modalClosed; modalClosed = null;
    if (cb) cb();
  }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal(); });
  function sheet(html) { const s = $('#sheet'); s.innerHTML = `<button class="sheet-x" data-x aria-label="Schließen">×</button>${html}`; s.hidden = false; }
  const closeSheet = () => { $('#sheet').hidden = true; $('#sheet').classList.remove('tall', 'area'); if (selectedArea) selectArea(null); };

  // ---------- Treppen-Detail -----------------------------------------------
  const stepsLabel = (s) => `${s.e ? 'ca. ' : ''}${fmt(s.s)} Stufen`;
  function openStair(id) {
    const s = byId.get(id), p = stats.per.get(id);
    const doneToday = state.log.some((e) => e.id === id && e.d === today());
    const worth = s.k ? (p ? s.s : s.s * 2 + window.TJGame.DISCOVERY_BONUS) : s.s;
    if (selectedArea) selectArea(null);
    $('#sheet').classList.remove('tall', 'area');
    sheet(`<p class="eyebrow"><button class="crumb" data-area="${s.q}">${esc(areaNames.get(s.q))}</button> · ${esc(s.d)}${s.k ? '' : ' · Bonus-Treppe'}</p>
      <h2>${esc(s.n)}</h2>
      <div class="chips"><span>${stepsLabel(s)}</span><span>ca. ${fmt(s.h)} m hoch</span><span>${fmt(s.l)} m lang</span></div>
      <p class="status ${p ? 'done' : ''}">${p ? `Entdeckt am ${new Date(p.first + 'T12:00').toLocaleDateString('de-DE')} · ${p.n}× gestiegen` : s.k ? `Noch offen · bringt ${fmt(worth)} Punkte` : `Zählt nicht für die Sammlung · ${fmt(worth)} Punkte`}</p>
      <div class="row">
        <a class="btn" target="_blank" rel="noopener" href="https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=%3B${s.c[0]}%2C${s.c[1]}#map=17/${s.c[0]}/${s.c[1]}">Route</a>
        <button class="btn ${p ? '' : 'primary'}" data-check="${id}" ${doneToday ? 'disabled' : ''}>${doneToday ? 'Heute verbucht' : p ? 'Nochmal gestiegen' : 'Von Hand abhaken'}</button>
      </div>
      ${p ? `<button class="link" data-undo="${id}">Letzten Eintrag löschen</button>` : ''}`);
  }
  function openArea(id, fit) {
    const a = areaById.get(id), st = areaStat(id);
    const list = DATA.stairs.filter((s) => s.q === id && s.k).sort((x, y) => y.s - x.s);
    const open = list.filter((s) => !stats.per.has(s.id)), done = list.filter((s) => stats.per.has(s.id));
    const badges = st.total ? areaBadges(st) : [];
    const marks = milestones(stats).filter((m) => m.stair && byId.get(m.stair) && byId.get(m.stair).q === id);
    const row = (s) => `<button class="stair-row${stats.per.has(s.id) ? ' done' : ''}" data-stair="${s.id}"><span class="tick"></span><span><b>${esc(s.n)}</b><small>${stepsLabel(s)}${stats.per.has(s.id) ? ` · ${stats.per.get(s.id).n}× gestiegen` : ` · ${fmt(s.s * 2 + window.TJGame.DISCOVERY_BONUS)} Punkte`}</small></span><span class="chev">›</span></button>`;
    selectArea(id);
    if (fit) {
      const wide = matchMedia('(min-width: 900px)').matches;
      map.fitBounds(areaLayers.get(id).getBounds(), { maxZoom: 16, paddingTopLeft: wide ? [440, 80] : [24, 84], paddingBottomRight: wide ? [70, 30] : [24, Math.round(innerHeight * 0.5)] });
    }
    sheet(`<p class="eyebrow">Quartier · ${esc(a.b)}</p>
      <h2>${esc(a.n)}</h2>
      ${st.total ? `
        <div class="area-head">${bar(st.done / st.total, 'big')}<p><b>${st.done} von ${st.total}</b> Treppen · ${fmt(st.doneSteps)} von ${fmt(st.steps)} Stufen</p></div>
        <h3>Etappen</h3>
        <div class="area-badges">${badges.map((b) => `<div class="${b.done ? 'done' : ''}">${badgeSVG(b, 58)}<b>${esc(b.title)}</b><small>${b.done ? 'geschafft' : `${b.now} von ${b.goal}`}</small></div>`).join('')}</div>
        ${marks.length ? `<h3>Besondere Meilensteine hier</h3>${marks.map((m) => `<button class="stair-row${m.done ? ' done' : ''}" data-stair="${m.stair}">${badgeSVG(m, 40)}<span><b>${esc(m.title)}</b><small>${esc(m.text)}</small></span><span class="chev">›</span></button>`).join('')}` : ''}
        ${open.length ? `<h3>Fehlen noch (${open.length})</h3>${open.map(row).join('')}` : '<p class="status done">Alle Treppen hier gehören dir.</p>'}
        ${done.length ? `<h3>Schon gelaufen (${done.length})</h3>${done.map(row).join('')}` : ''}`
      : `<p>Hier gibt es keine sammelbaren Treppen${st.bonus ? ` – nur ${st.bonus} kleine Bonus-Treppen` : ''}. Flach ist auch mal schön.</p>`}
      ${st.total && st.bonus ? `<p class="fine">Dazu ${st.bonus} kleine Bonus-Treppen (ab Zoomstufe 17 sichtbar).</p>` : ''}`);
    $('#sheet').classList.add('area');
    $('#sheet').scrollTop = 0;
  }
  function focusArea(id) { switchView('map'); openArea(id, true); }
  function focusStair(id) {
    const s = byId.get(id);
    switchView('map');
    map.setView(s.c, 17);
    openStair(id);
  }
  $('#sheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) return closeSheet();
    const ar = e.target.closest('[data-area]');
    if (ar) return openArea(ar.dataset.area, true);
    const st = e.target.closest('[data-stair]');
    if (st) return focusStair(Number(st.dataset.stair));
    const c = e.target.closest('[data-check]');
    if (c) { const id = Number(c.dataset.check); addAscents([{ id, t: Date.now(), src: 'manual' }]); return openStair(id); }
    const u = e.target.closest('[data-undo]');
    if (u) {
      const id = Number(u.dataset.undo);
      for (let i = state.log.length - 1; i >= 0; i--) if (state.log[i].id === id) { state.log.splice(i, 1); break; }
      refresh(); return openStair(id);
    }
    const imp = e.target.closest('[data-import-ok]');
    if (imp) return confirmImport();
  });

  // ---------- HUD + Ansichten ----------------------------------------------
  function renderHud() {
    $('#hud-level').textContent = stats.level.level;
    $('#hud-title').textContent = stats.level.title;
    $('#hud-bar').style.width = Math.round(stats.level.progress * 100) + '%';
    $('#hud-found').textContent = stats.found;
    $('#hud-total').textContent = '/ ' + stats.total;
  }
  const bar = (f, cls = '') => `<span class="bar ${cls}"><span class="bar-fill" style="width:${Math.round(f * 100)}%"></span></span>`;

  function renderProgress() {
    const lv = stats.level, goal = state.goal, wk = stats.week;
    const r = 34, circ = 2 * Math.PI * r, f = Math.min(1, wk / goal);
    const qs = quests(stats, DATA.stairs, pos, distM, areaNames);
    const dists = Object.entries(stats.districts).sort((a, b) => b[1].done / b[1].total - a[1].done / a[1].total || a[0].localeCompare(b[0]));
    $('#progress-body').innerHTML = `
      <div class="card level-card">
        ${levelEmblem(lv.level, 96)}
        <div>
          <p class="eyebrow">Level ${lv.level} · ${esc(state.name)}</p>
          <h1>${esc(lv.title)}</h1>
          <p>${esc(lv.text)}</p>
        </div>
        <div class="level-bar">${bar(lv.progress, 'big')}
          <p class="fine">${lv.next ? `<b>${fmt(stats.xp)}</b> Punkte · noch ${fmt(lv.toGo)} bis „${esc(lv.nextTitle)}“` : `<b>${fmt(stats.xp)}</b> Punkte · höchstes Level erreicht`}</p>
        </div>
      </div>
      <div class="stats3 card">
        <div><b>${stats.found}</b><span>von ${stats.total} Treppen</span></div>
        <div><b>${fmt(stats.steps)}</b><span>Stufen</span></div>
        <div><b>${fmt(stats.height)}</b><span>Höhenmeter</span></div>
      </div>
      <div class="card week">
        <svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true">
          <circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--line)" stroke-width="8"/>
          <circle cx="40" cy="40" r="${r}" fill="none" stroke="var(--green)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${f * circ} ${circ}" transform="rotate(-90 40 40)"/>
          <text x="40" y="47" text-anchor="middle" class="b-num" font-size="22" fill="currentColor">${wk}/${goal}</text>
        </svg>
        <div>
          <h2>Diese Woche</h2>
          <p>${wk >= goal ? 'Wochenziel geschafft. Alles Weitere ist Kür.' : wk === 0 ? `Dein Ziel: ${goal} Treppen. Die erste ist die wichtigste.` : `Noch ${goal - wk} bis zu deinem Wochenziel.`}</p>
          ${stats.streak > 1 ? `<p class="fine">${stats.streak} Wochen in Folge unterwegs</p>` : ''}
        </div>
      </div>
      <h2 class="section">Vorschläge für dich</h2>
      ${qs.length ? qs.map((q) => `<button class="card quest" ${q.stair ? `data-stair="${q.stair.id}"` : q.area ? `data-area="${q.area}"` : 'data-go="badges"'}>
          <span class="q-kind">${esc(q.title)}</span><span class="q-text">${esc(q.text)}</span><span class="chev">›</span></button>`).join('') : '<p class="card">Du hast alles gesammelt. Wuppertal gehört dir.</p>'}
      ${pos ? '' : '<button class="link" id="q-locate">Standort freigeben, um die nächste Treppe zu sehen</button>'}
      <h2 class="section">Stadtbezirke und Quartiere</h2>
      <p class="fine">${stats.areasDone} von ${stats.areasTotal} Quartieren komplett. Tipp auf einen Bezirk, um seine Quartiere zu sehen.</p>
      <div class="card districts">${dists.map(([n, d]) => `<details class="district"${openDistricts.has(n) ? ' open' : ''} data-d="${esc(n)}"><summary><span>${esc(n)}</span><span class="num">${d.done}/${d.total}</span>${bar(d.total ? d.done / d.total : 0)}</summary>
        ${AREAS.filter((a) => a.b === n).map((a) => ({ a, st: areaStat(a.id) })).sort((x, y) => y.st.total - x.st.total).map(({ a, st }) => `<button class="area-row${st.total && st.done === st.total ? ' done' : ''}" data-area="${a.id}"><span>${esc(a.n)}</span><span class="num">${st.total ? `${st.done}/${st.total}` : '–'}</span>${bar(st.total ? st.done / st.total : 0)}</button>`).join('')}
      </details>`).join('')}</div>
      ${stats.bonus ? `<p class="fine">Dazu ${stats.bonus} kleine Bonus-Treppen.</p>` : ''}
      <h2 class="section">Rangliste</h2>
      <div class="card ranks">${rankRows().map((r, i) => `<${r.friend != null ? `button data-friend="${r.friend}"` : 'div'} class="rank${r.me ? ' me' : ''}">
          <span class="rank-n">${i + 1}</span>${levelEmblem(r.level, 34)}
          <span class="rank-name"><b>${esc(r.name)}</b><small>${r.me ? 'du' : r.local ? 'Profil auf diesem Gerät' : 'Stand ' + new Date(r.at).toLocaleDateString('de-DE')} · ${r.found} Treppen</small></span>
          <span class="rank-xp">${fmt(r.xp)}<small>Punkte</small></span></${r.friend != null ? 'button' : 'div'}>`).join('')}</div>
      <button class="btn primary wide" id="btn-share" type="button">Meinen Stand teilen</button>
      <p class="fine">Die Rangliste kommt ohne Server aus: Schick anderen deinen Link, sie schicken dir ihren. Jeder Eintrag zeigt den Stand vom Tag des Teilens – für ein Update einfach neu teilen.</p>`;
  }

  // ---------- Rangliste (ohne Server, über geteilte Links) ------------------
  const summary = (p) => {
    const st = p === state ? stats : computeStats(p.log, byId, DATA.meta, today());
    return { id: p.id, name: p.name, xp: st.xp, found: st.found, steps: st.steps, areas: st.areasDone, level: st.level.level };
  };
  function rankRows() {
    const rows = Object.values(store.profiles).map((p) => ({ ...summary(p), me: p === state, local: p !== state }));
    store.friends.forEach((f, i) => rows.push({ ...f, level: window.TJGame.levelFor(f.xp).level, friend: i }));
    return rows.sort((a, b) => b.xp - a.xp || b.found - a.found);
  }
  const b64e = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (str) => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
  async function shareStand() {
    const m = summary(state);
    const url = location.origin + location.pathname + '#r=' + b64e(JSON.stringify({ i: m.id, n: m.name, x: m.xp, f: m.found, s: m.steps, a: m.areas, t: Date.now() }));
    const text = `${m.name} bei der Treppenjagd Wuppertal: ${m.found} Treppen, ${fmt(m.xp)} Punkte. Nimm mich in deine Rangliste auf:`;
    try { if (navigator.share) { await navigator.share({ title: 'Treppenjagd Wuppertal', text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Link kopiert – schick ihn an deine Freunde.', true); }
    catch (e) { modal(`<h2>Dein Link</h2><p>Kopiere ihn und schick ihn an deine Freunde.</p><textarea class="input" rows="5" readonly>${esc(url)}</textarea><button class="btn primary" data-close>Fertig</button>`); }
  }
  /** Geteilten Link (#r=…) entgegennehmen. */
  function readSharedLink() {
    const m = /^#r=([A-Za-z0-9_-]{8,2000})$/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    let f;
    try {
      const o = JSON.parse(b64d(m[1]));
      const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v)) || 0));
      f = { id: String(o.i || '').slice(0, 40), name: cleanName(o.n), xp: num(o.x, 5e6), found: num(o.f, 5000), steps: num(o.s, 5e6), areas: num(o.a, 100), at: num(o.t, 4e12) || Date.now() };
      if (!f.id || !f.name) throw new Error('unvollständig');
    } catch (e) { return toast('Dieser Ranglisten-Link ist beschädigt.'); }
    if (store.profiles[f.id]) return toast('Das ist dein eigener Link – schick ihn an andere.');
    const known = store.friends.findIndex((x) => x.id === f.id);
    modal(`<div class="celebrate">${levelEmblem(window.TJGame.levelFor(f.xp).level, 96)}
      <p class="eyebrow">Rangliste</p><h2>${esc(f.name)}</h2>
      <p>${f.found} Treppen · ${fmt(f.xp)} Punkte · ${f.areas} Quartiere komplett</p>
      <button class="btn primary" id="friend-add">${known >= 0 ? 'Stand aktualisieren' : 'In meine Rangliste aufnehmen'}</button>
      <button class="btn" data-close>Nicht jetzt</button></div>`);
    $('#friend-add').addEventListener('click', () => {
      if (known >= 0) store.friends[known] = f; else store.friends.push(f);
      save(); closeModal(); switchView('progress'); toast(`${f.name} steht jetzt in deiner Rangliste.`, true);
    });
  }
  window.addEventListener('hashchange', readSharedLink);
  const openDistricts = new Set();
  $('#progress-body').addEventListener('toggle', (e) => {
    const d = e.target.closest && e.target.closest('details[data-d]');
    if (d) d.open ? openDistricts.add(d.dataset.d) : openDistricts.delete(d.dataset.d);
  }, true);
  $('#progress-body').addEventListener('click', (e) => {
    const ar = e.target.closest('[data-area]');
    if (ar) return focusArea(ar.dataset.area);
    const q = e.target.closest('[data-stair]');
    if (q) return focusStair(Number(q.dataset.stair));
    if (e.target.closest('[data-go]')) return switchView('badges');
    if (e.target.closest('#q-locate')) return locateOnce();
    if (e.target.closest('#btn-share')) return shareStand();
    const fr = e.target.closest('[data-friend]');
    if (fr) {
      const i = Number(fr.dataset.friend), f = store.friends[i];
      modal(`<h2>${esc(f.name)}</h2><p>${f.found} Treppen · ${fmt(f.xp)} Punkte · ${f.areas} Quartiere komplett<br>Stand vom ${new Date(f.at).toLocaleDateString('de-DE')}</p>
        <div class="row"><button class="btn" data-close>Schließen</button><button class="btn danger" id="friend-del">Aus Rangliste entfernen</button></div>`);
      $('#friend-del').addEventListener('click', () => { store.friends.splice(i, 1); save(); closeModal(); renderProgress(); });
    }
  });

  let badgeList = [];
  function renderBadges() {
    badgeList = milestones(stats);
    const done = badgeList.filter((m) => m.done).length;
    const groups = [...new Set(badgeList.map((m) => m.group))];
    $('#badges-body').innerHTML = `<h1>Meilensteine</h1><p class="lead">${done} von ${badgeList.length} erreicht</p>` +
      groups.map((g) => `<h2 class="section">${esc(g)}</h2><div class="badge-grid">${badgeList.map((m, i) => (m.group !== g ? '' :
        `<button class="badge-cell${m.done ? ' done' : ''}" data-i="${i}">${badgeSVG(m, 76)}<span>${esc(m.title)}</span></button>`)).join('')}</div>`).join('') +
      `<h2 class="section">Level</h2><div class="card levels">${window.TJGame.LEVELS.map((l, i) => `<div class="lvl${i + 1 <= stats.level.level ? ' done' : ''}">${i + 1 <= stats.level.level ? levelEmblem(i + 1, 40) : badgeSVG({ done: false, progress: 0, glyph: 'num', mark: String(i + 1) }, 40)}<span>${esc(l[1])}</span><span class="num">${fmt(l[0])}</span></div>`).join('')}</div>`;
    $('#badge-dot').hidden = true;
  }
  $('#badges-body').addEventListener('click', (e) => {
    const c = e.target.closest('[data-i]');
    if (!c) return;
    const m = badgeList[Number(c.dataset.i)];
    modal(`<div class="celebrate">${badgeSVG(m, 120)}<p class="eyebrow">${esc(m.group)}</p><h2>${esc(m.title)}</h2><p>${esc(m.text)}</p>
      ${m.done ? `<p class="status done">Erreicht${state.seen[m.id] ? ' am ' + new Date(state.seen[m.id] + 'T12:00').toLocaleDateString('de-DE') : ''}</p>` : `${bar(m.progress, 'big')}<p class="fine">${fmt(m.now)} von ${fmt(m.goal)}</p>`}
      <button class="btn" data-close>Schließen</button></div>`);
  });

  function switchView(name) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    closeSheet();
    if (name === 'progress') renderProgress();
    if (name === 'badges') renderBadges();
    if (name === 'map') setTimeout(() => map.invalidateSize(), 0);
  }
  document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) switchView(b.dataset.view); });
  $('#hud').addEventListener('click', () => switchView('progress'));
  $('#btn-locate').addEventListener('click', locateOnce);
  $('#btn-tour').addEventListener('click', () => (tour ? stopTour() : startTour()));
  $('#btn-filter').addEventListener('click', (e) => {
    onlyOpen = !onlyOpen; e.currentTarget.setAttribute('aria-pressed', onlyOpen); paintAll(); map.syncLayers();
  });
  $('#map').addEventListener('pointerdown', () => { if (tour) tour.follow = false; });

  // ---------- Wochenziel ----------------------------------------------------
  function renderGoal() {
    $('#goal-seg').innerHTML = [2, 4, 7, 12].map((n) => `<button type="button" data-goal="${n}" aria-pressed="${state.goal === n}">${n}<small>pro Woche</small></button>`).join('');
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goal]');
    if (!g) return;
    state.goal = Number(g.dataset.goal); save(); renderGoal();
    document.querySelectorAll('#modal [data-goal]').forEach((b) => b.setAttribute('aria-pressed', b === g));
  });

  // ---------- Import --------------------------------------------------------
  let pendingImport = [];
  $('#file-import').addEventListener('change', async (e) => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length) return;
    toast('Werte Wege aus …');
    const hits = new Map(); let points = 0, failed = 0, coarse = false;
    for (const f of files) {
      try {
        const { kind, tracks } = parseFile(f.name, await f.text());
        if (kind === 'timeline') coarse = true;
        points += tracks.reduce((n, t) => n + t.length, 0);
        for (const h of matchTracks(index, tracks, kind)) {
          const d = h.t ? dayKey(h.t) : today();
          hits.set(h.id + '|' + d, { id: h.id, t: h.t, d, src: kind });
        }
      } catch (err) { failed++; }
    }
    const have = new Set(state.log.map((x) => x.id + '|' + x.d));
    pendingImport = [...hits.values()].filter((h) => !have.has(h.id + '|' + h.d)).sort((a, b) => (a.d < b.d ? 1 : -1));
    $('#toast').hidden = true;
    if (!pendingImport.length) {
      return modal(`<h2>Keine neuen Treppen gefunden</h2><p>${failed ? `${failed} Datei(en) konnte ich nicht lesen. ` : ''}${points ? `In ${fmt(points)} Wegpunkten rund um Wuppertal war keine Treppe, die du nicht schon hast.` : 'Die Datei enthält keine Wegpunkte im Raum Wuppertal.'}</p><button class="btn primary" data-close>Okay</button>`);
    }
    const newOnes = new Set(pendingImport.filter((h) => !stats.per.has(h.id) && byId.get(h.id).k).map((h) => h.id)).size;
    sheet(`<h2>${pendingImport.length === 1 ? '1 Besteigung' : pendingImport.length + ' Besteigungen'} erkannt</h2>
      <p>${newOnes === 1 ? '1 neue Treppe' : newOnes + ' neue Treppen'} für deine Sammlung.${coarse ? ' Die Zeitachse ist ungenau – nimm den Haken raus, wo du nicht langgelaufen bist.' : ''}</p>
      <div class="import-list">${pendingImport.map((h, i) => { const s = byId.get(h.id); return `<label><input type="checkbox" data-imp="${i}" checked><span><b>${esc(s.n)}</b><small>${h.t ? new Date(h.t).toLocaleDateString('de-DE') : 'ohne Datum'} · ${stepsLabel(s)}${s.k ? '' : ' · Bonus'}</small></span></label>`; }).join('')}</div>
      <button class="btn primary" data-import-ok>Auswahl verbuchen</button>`);
    $('#sheet').classList.add('tall');
  });
  function confirmImport() {
    const picked = [...document.querySelectorAll('[data-imp]:checked')].map((c) => pendingImport[Number(c.dataset.imp)]);
    $('#sheet').classList.remove('tall'); closeSheet(); pendingImport = [];
    if (picked.length) { addAscents(picked); switchView('progress'); }
  }

  // ---------- Profile: wechseln, anlegen, exportieren, importieren ---------
  function activate(id) {
    if (tour) stopTour();
    store.active = id; state = store.profiles[id];
    queue.length = 0; closeSheet();
    stats = computeStats(state.log, byId, DATA.meta, today());
    state.level = Math.max(state.level, stats.level.level);
    refresh(); renderGoal(); renderProfiles();
  }
  function renderProfiles() {
    $('#profile-list').innerHTML = Object.values(store.profiles).map((p) => {
      const m = summary(p);
      return `<button class="profile-row${p === state ? ' active' : ''}" data-profile="${esc(p.id)}" aria-pressed="${p === state}">${levelEmblem(m.level, 38)}
        <span><b>${esc(p.name)}</b><small>${m.found} Treppen · ${fmt(m.xp)} Punkte</small></span><span class="pill">${p === state ? 'aktiv' : 'wechseln'}</span></button>`;
    }).join('');
  }
  function askName(title, value, done) {
    modal(`<h2>${esc(title)}</h2><label class="fine" for="name-input">Name (höchstens 24 Zeichen)</label>
      <input class="input" id="name-input" maxlength="24" value="${esc(value)}" autocomplete="off">
      <div class="row"><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="name-ok">Speichern</button></div>`);
    const inp = $('#name-input'); inp.focus(); inp.select();
    const ok = () => { const n = cleanName(inp.value); if (!n) return inp.focus(); closeModal(); done(n); };
    $('#name-ok').addEventListener('click', ok);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
  }
  $('#profile-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-profile]');
    if (b && b.dataset.profile !== store.active) { activate(b.dataset.profile); toast(`Profil gewechselt: ${state.name}`, true); }
  });
  $('#btn-profile-new').addEventListener('click', () => askName('Neues Profil', '', (n) => {
    const p = blank(n); p.onboarded = true; store.profiles[p.id] = p; activate(p.id); toast(`Profil „${n}“ angelegt.`, true);
  }));
  $('#btn-profile-rename').addEventListener('click', () => askName('Profil umbenennen', state.name, (n) => { state.name = n; save(); renderProfiles(); }));

  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'treppenjagd', v: 2, profile: state })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `treppenjagd-${state.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-') || 'profil'}-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#file-restore').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const raw = JSON.parse(await f.text());
      const src = raw && raw.profile ? raw.profile : raw;
      if (!src || !Array.isArray(src.log)) throw new Error('kein Spielstand');
      const log = src.log.filter((x) => x && Number.isFinite(x.id) && /^\d{4}-\d{2}-\d{2}$/.test(x.d))
        .map((x) => ({ id: x.id, d: x.d, t: Number.isFinite(x.t) ? x.t : null, src: String(x.src || 'import').slice(0, 12) }));
      const seen = src.seen && typeof src.seen === 'object' ? src.seen : {};
      // Gleiches Profil (oder alte Sicherung ohne Profil-Kennung): zusammenführen. Sonst als neues Profil anlegen.
      const target = store.profiles[src.id] || (src.id ? null : state);
      if (target) {
        const have = new Set(target.log.map((x) => x.id + '|' + x.d));
        let added = 0;
        for (const x of log) if (!have.has(x.id + '|' + x.d)) { have.add(x.id + '|' + x.d); target.log.push(x); added++; }
        for (const k of Object.keys(seen)) if (/^\d{4}-\d{2}-\d{2}$/.test(seen[k]) && (!target.seen[k] || seen[k] < target.seen[k])) target.seen[k] = seen[k];
        activate(target.id);
        toast(added ? `„${target.name}“ zusammengeführt: ${added === 1 ? '1 neuer Eintrag' : added + ' neue Einträge'}.` : `„${target.name}“ war schon auf dem neuesten Stand.`, true);
      } else {
        const p = blank(src.name); p.id = String(src.id).slice(0, 40); p.log = log; p.onboarded = true;
        p.goal = [2, 4, 7, 12].includes(src.goal) ? src.goal : 4;
        for (const k of Object.keys(seen)) if (/^\d{4}-\d{2}-\d{2}$/.test(seen[k])) p.seen[k] = seen[k];
        store.profiles[p.id] = p; activate(p.id);
        toast(`Profil „${p.name}“ importiert: ${stats.found} Treppen.`, true);
      }
    } catch (err) { toast('Das ist keine Treppenjagd-Datei.'); }
  });
  $('#btn-reset').addEventListener('click', () => {
    const only = Object.keys(store.profiles).length === 1;
    modal(`<h2>Profil „${esc(state.name)}“ löschen?</h2><p>${stats.found} Treppen und ${fmt(stats.xp)} Punkte gehen verloren. Das lässt sich nicht rückgängig machen – exportiere das Profil vorher, wenn du es behalten willst.</p>
      <div class="row"><button class="btn" data-close>Abbrechen</button><button class="btn danger" id="reset-yes">Löschen</button></div>`);
    $('#reset-yes').addEventListener('click', () => {
      const name = state.name;
      delete store.profiles[state.id];
      if (only) { const p = blank(name); p.onboarded = true; store.profiles[p.id] = p; }
      closeModal(); activate(Object.keys(store.profiles)[0]);
    });
  });

  // ---------- Start ---------------------------------------------------------
  function onboarding() {
    modal(`<div class="celebrate">${levelEmblem(1, 96)}
      <p class="eyebrow">Treppenjagd Wuppertal</p>
      <h2>${DATA.meta.collectible} Treppen warten auf dich</h2>
      <p>Lauf eine Treppe, und sie gehört dir. Die App erkennt sie per GPS – oder nachträglich aus deinen aufgezeichneten Wegen.</p>
      <label for="onb-name"><b>Wie heißt du?</b></label>
      <input class="input" id="onb-name" maxlength="24" placeholder="Name für dein Profil" autocomplete="off">
      <p><b>Wie viele Treppen pro Woche passen zu dir?</b></p>
      <div class="seg">${[2, 4, 7, 12].map((n) => `<button type="button" data-goal="${n}" aria-pressed="${state.goal === n}">${n}<small>pro Woche</small></button>`).join('')}</div>
      <button class="btn primary" data-close>Los geht’s</button>
      <p class="fine">Dein Standort bleibt auf deinem Gerät.</p></div>`, () => { state.onboarded = true; save(); renderProfiles(); readSharedLink(); });
    $('#onb-name').addEventListener('input', (e) => { state.name = cleanName(e.target.value) || 'Ich'; });
  }

  async function start() {
    [DATA, AREAS] = await Promise.all([fetch('data/stairs.json').then((r) => r.json()), fetch('data/areas.json').then((r) => r.json())]);
    areaById = new Map(AREAS.map((a) => [a.id, a]));
    areaNames = new Map(AREAS.map((a) => [a.id, a.n]));
    byId = new Map(DATA.stairs.map((s) => [s.id, s]));
    index = buildIndex(DATA.stairs);
    stats = computeStats(state.log, byId, DATA.meta, today());
    state.level = Math.max(state.level, stats.level.level);
    initMap(); paintAll(); renderHud(); renderGoal(); renderProfiles();
    if (!state.onboarded) onboarding(); else readSharedLink();
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  start().catch((err) => { console.error(err); document.body.insertAdjacentHTML('beforeend', '<p class="fatal">Die Treppendaten konnten nicht geladen werden. Bitte Seite neu laden.</p>'); });

  window.TJApp = { addAscents, openArea, focusArea, get store() { return store; }, get stats() { return stats; }, get index() { return index; } };
})();
