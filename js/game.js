/* Spielsystem: Punkte, Level, Meilensteine, Aufträge.
   Alles wird aus dem Besteigungs-Protokoll abgeleitet – kein versteckter Zustand. */
(function (root) {
  'use strict';

  // ---- Punkte --------------------------------------------------------------
  // 1 Stufe = 1 Punkt. Erstentdeckung zählt doppelt + 25 (Neugier belohnen),
  // Wiederholungen einfach (Training zählt, aber Entdecken lohnt sich mehr).
  const DISCOVERY_BONUS = 25;

  // ---- Level ---------------------------------------------------------------
  // Früh schnelle Erfolge, später längere Bögen. Punkte = Schwelle zum Erreichen.
  const LEVELS = [
    [0, 'Talkind', 'Du stehst unten an der Wupper. Von hier geht es nur bergauf.'],
    [100, 'Stufenzähler', 'Die ersten Treppen sind geschafft – du zählst schon mit.'],
    [300, 'Treppenläufer', 'Treppen sind für dich kein Umweg mehr, sondern der Weg.'],
    [700, 'Hangkenner', 'Du weißt, wo es steil wird – und gehst trotzdem hin.'],
    [1400, 'Wupperwanderer', 'Tal und Höhen gehören zusammen. Du verbindest sie.'],
    [2500, 'Bergischer Kraxler', 'Schiefer, Grün und Stufen: das Bergische liegt dir.'],
    [4200, 'Höhensammler', 'Höhenmeter stapeln sich. Deine Waden merken es.'],
    [6500, 'Ölbergsteiger', 'Wer den Ölberg kennt, kennt die Treppen der Nordstadt.'],
    [9500, 'Nordstadtgämse', 'Trittsicher und unaufgeregt, auch auf der hundertsten Stufe.'],
    [13500, 'Treppenfuchs', 'Du kennst Abkürzungen, die keine Karten-App vorschlägt.'],
    [19000, 'Schwebebahn-Überholer', 'Zu Fuß schneller oben als die Bahn im nächsten Bahnhof.'],
    [27000, 'Tal-Legende', 'Man erkennt dich an den Schritten im Treppenhaus der Stadt.'],
    [38000, 'Tuffis Erbe', 'Ein Elefant sprang einst in die Wupper. Du steigst lieber hinauf.'],
    [55000, 'Treppenmeister', 'Kaum eine Stufe in Wuppertal, die du nicht kennst.'],
    [80000, 'Treppenhoheit von Wuppertal', 'Die Stadt der Treppen hat ihre Hoheit gefunden.'],
  ];

  function levelFor(xp) {
    let i = 0;
    while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++;
    const cur = LEVELS[i], next = LEVELS[i + 1] || null;
    return {
      level: i + 1, title: cur[1], text: cur[2], floor: cur[0],
      next: next ? next[0] : null, nextTitle: next ? next[1] : null,
      progress: next ? (xp - cur[0]) / (next[0] - cur[0]) : 1,
      toGo: next ? next[0] - xp : 0,
    };
  }

  // ---- Auswertung ----------------------------------------------------------
  const isoWeek = (dayStr) => {
    const d = new Date(dayStr + 'T12:00:00');
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day + 3);
    const first = new Date(d.getFullYear(), 0, 4);
    const wk = 1 + Math.round(((d - first) / 864e5 - 3 + ((first.getDay() + 6) % 7)) / 7);
    return d.getFullYear() + '-W' + String(wk).padStart(2, '0');
  };
  const prevWeek = (wk) => {
    const [y, w] = wk.split('-W').map(Number);
    const d = new Date(y, 0, 4 + (w - 1) * 7 - 7, 12);
    return isoWeek(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  };

  /** log = [{id, d:'YYYY-MM-DD', t, src}] ; byId = Map(id -> Treppe) */
  function computeStats(log, byId, meta, today) {
    const per = new Map(); // id -> {n, first, last}
    const days = new Map(); // Tag -> Anzahl
    const weeks = new Map();
    let xp = 0, steps = 0, height = 0, early = false, late = false;
    const sorted = [...log].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    for (const e of sorted) {
      const s = byId.get(e.id);
      if (!s) continue;
      let p = per.get(e.id);
      if (!p) { p = { n: 0, first: e.d, last: e.d }; per.set(e.id, p); xp += s.k ? s.s + DISCOVERY_BONUS : 0; }
      p.n++; p.last = e.d;
      xp += s.s; steps += s.s; height += s.h;
      days.set(e.d, (days.get(e.d) || 0) + 1);
      const wk = isoWeek(e.d);
      weeks.set(wk, (weeks.get(wk) || 0) + 1);
      if (e.t) { const h = new Date(e.t).getHours(); if (h < 7 && h >= 4) early = true; if (h >= 22 || h < 4) late = true; }
    }
    const districts = {};
    for (const d of meta.districts) districts[d] = { total: 0, done: 0 };
    let found = 0, named = 0, maxSteps = 0, maxRepeat = 0, bonus = 0;
    const areas = {}; // Quartier-ID -> {total, done, steps, doneSteps, bonus}
    for (const s of byId.values()) {
      const p = per.get(s.id);
      const a = areas[s.q] || (areas[s.q] = { total: 0, done: 0, steps: 0, doneSteps: 0, bonus: 0 });
      if (s.k) {
        districts[s.d].total++; a.total++; a.steps += s.s;
        if (p) { districts[s.d].done++; a.done++; a.doneSteps += s.s; found++; if (s.o) named++; if (s.s > maxSteps) maxSteps = s.s; }
      } else { a.bonus++; if (p) bonus++; }
      if (p && p.n > maxRepeat) maxRepeat = p.n;
    }
    const thisWeek = isoWeek(today);
    // Serie: aufeinanderfolgende Wochen mit mindestens einer Treppe (laufende Woche darf noch offen sein)
    let streak = 0, wk = weeks.has(thisWeek) ? thisWeek : prevWeek(thisWeek);
    while (weeks.has(wk)) { streak++; wk = prevWeek(wk); }
    const districtsTouched = Object.values(districts).filter((d) => d.done > 0).length;
    const districtsDone = Object.values(districts).filter((d) => d.total && d.done === d.total).length;
    const withStairs = Object.values(areas).filter((a) => a.total);
    const areasTotal = withStairs.length;
    const areasTouched = withStairs.filter((a) => a.done > 0).length;
    const areasDone = withStairs.filter((a) => a.done === a.total).length;
    return {
      per, xp, steps, height: Math.round(height), found, named, bonus, total: meta.collectible,
      districts, districtsTouched, districtsDone, areas, areasTotal, areasTouched, areasDone, maxSteps, maxRepeat,
      bestDay: Math.max(0, ...days.values()), week: weeks.get(thisWeek) || 0, streak, early, late,
      ascents: sorted.length, level: levelFor(xp),
    };
  }

  // ---- Meilensteine --------------------------------------------------------
  // tier: b(ronze) s(ilber) g(old) w(uppertal-grün = Sonderklasse)
  const M = [];
  const add = (id, group, tier, glyph, title, text, value, goal, mark) => M.push({ id, group, tier, glyph, title, text, value, goal, mark });

  [[1, 'b', 'Erste Stufe', 'Deine erste Treppe. Jede Sammlung fängt mit einer an.'],
   [5, 'b', 'Warmgelaufen', 'Fünf Treppen – jetzt kennst du das Gefühl.'],
   [10, 'b', 'Zweistellig', 'Zehn Treppen entdeckt.'],
   [25, 's', 'Treppenviertel', '25 Treppen. Dein Stadtplan sieht schon anders aus.'],
   [50, 's', 'Halbes Hundert', '50 Treppen entdeckt.'],
   [100, 's', 'Hunderter', '100 Treppen – das schaffen nur wenige Wuppertaler.'],
   [200, 'g', 'Zweihundert', '200 Treppen. Du bist tief drin.'],
   [300, 'g', 'Dreihundert', '300 Treppen entdeckt.'],
   [450, 'g', 'Die legendären 450', 'So viele Treppen soll Wuppertal haben. Du hast sie voll.'],
   [600, 'w', 'Über den Mythos hinaus', '600 Treppen – mehr als die Legende kennt.'],
  ].forEach(([n, tier, title, text]) => add('found' + n, 'Sammlung', tier, 'num', title, text, (s) => s.found, n, String(n)));
  add('foundAll', 'Sammlung', 'w', 'crown', 'Ganz Wuppertal', 'Jede sammelbare Treppe der Stadt. Wirklich jede.', (s) => s.found, null, '∞');

  [[12, 'b', 'Schwebebahn-Höhe', '12 m – so hoch hängt die Schwebebahn über der Wupper.'],
   [157, 'b', 'Kölner Dom', '157 m: einmal auf die Domspitze.'],
   [330, 's', 'Eiffelturm', '330 m in Wuppertaler Stufen.'],
   [828, 's', 'Burj Khalifa', '828 m – das höchste Gebäude der Welt, zu Fuß.'],
   [2962, 'g', 'Zugspitze', '2.962 m: Deutschlands höchster Gipfel.'],
   [4806, 'g', 'Mont Blanc', '4.806 m über dem Tal.'],
   [8849, 'w', 'Mount Everest', '8.849 m. Das Dach der Welt, erstiegen in Wuppertal.'],
  ].forEach(([n, tier, title, text]) => add('height' + n, 'Höhenmeter', tier, 'peak', title, text, (s) => s.height, n, n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + 'k' : String(n)));

  [[1000, 'b', '1.000 Stufen'], [5000, 's', '5.000 Stufen'], [10000, 's', '10.000 Stufen'], [25000, 'g', '25.000 Stufen'], [50000, 'w', '50.000 Stufen']]
    .forEach(([n, tier, title]) => add('steps' + n, 'Stufen', tier, 'steps', title, 'So viele Stufen bist du insgesamt gestiegen.', (s) => s.steps, n, n / 1000 + 'k'));

  add('dist3', 'Stadtbezirke', 'b', 'pin', 'Über den Tellerrand', 'Treppen in 3 verschiedenen Stadtbezirken.', (s) => s.districtsTouched, 3, '3');
  add('dist10', 'Stadtbezirke', 's', 'pin', 'Von Vohwinkel bis Beyenburg', 'Mindestens eine Treppe in allen 10 Stadtbezirken.', (s) => s.districtsTouched, 10, '10');
  add('distDone1', 'Stadtbezirke', 'g', 'flag', 'Bezirk komplett', 'Alle Treppen eines Stadtbezirks gesammelt.', (s) => s.districtsDone, 1, '1');
  add('distDone5', 'Stadtbezirke', 'w', 'flag', 'Halbe Stadt', 'Fünf Stadtbezirke vollständig.', (s) => s.districtsDone, 5, '5');

  add('quart5t', 'Quartiere', 'b', 'pin', 'Quartiershopper', 'Treppen in 5 verschiedenen Quartieren.', (s) => s.areasTouched, 5, '5');
  add('quart25t', 'Quartiere', 's', 'pin', 'Stadtstreicher', 'Treppen in 25 verschiedenen Quartieren.', (s) => s.areasTouched, 25, '25');
  add('quart1', 'Quartiere', 's', 'flag', 'Mein Viertel', 'Alle Treppen eines Quartiers gesammelt.', (s) => s.areasDone, 1, '1');
  add('quart5', 'Quartiere', 'g', 'flag', 'Viertelsammler', 'Fünf Quartiere vollständig.', (s) => s.areasDone, 5, '5');
  add('quart20', 'Quartiere', 'g', 'flag', 'Quartiersmeister', '20 Quartiere vollständig.', (s) => s.areasDone, 20, '20');
  add('quartAll', 'Quartiere', 'w', 'crown', 'Alle Viertel', 'Jedes Quartier mit Treppen ist komplett.', (s) => s.areasDone, (s) => s.areasTotal, '∞');

  add('named10', 'Besondere', 'b', 'star', 'Namenskenner', '10 Treppen mit eigenem Namen.', (s) => s.named, 10, '10');
  add('named50', 'Besondere', 'g', 'star', 'Treppen-Lexikon', '50 Treppen mit eigenem Namen.', (s) => s.named, 50, '50');
  const landmark = (id, osmId, title, text) => { add(id, 'Besondere', 'w', 'star', title, text, (s) => (s.per.has(osmId) ? 1 : 0), 1, '★'); M[M.length - 1].stair = osmId; };
  landmark('ttt', 153827652, 'Tippen-Tappen-Tönchen', 'Wuppertals berühmteste Treppe – benannt nach dem Klang der Holzschuhe.');
  landmark('holsteiner', 26743278, 'Holsteiner Treppe', 'Die bunte Treppe der Nordstadt – Horst Gläskers Kunstwerk „Scala“.');
  landmark('jakob', 93211072, 'Jakobstreppe', '155 Stufen schnurgerade den Nützenberg hinauf.');
  landmark('vogelsauer', 38610020, 'Vogelsauer Treppe', '240 Stufen den Hang hinauf – hier braucht es Puste.');
  add('big150', 'Besondere', 's', 'peak', 'Langer Atem', 'Eine Treppe mit mindestens 150 Stufen.', (s) => s.maxSteps, 150, '150');

  add('day5', 'Gewohnheit', 'b', 'bolt', 'Treppentour', '5 Treppen an einem Tag.', (s) => s.bestDay, 5, '5');
  add('day12', 'Gewohnheit', 'g', 'bolt', 'Großer Treppentag', '12 Treppen an einem Tag.', (s) => s.bestDay, 12, '12');
  add('streak4', 'Gewohnheit', 's', 'flame', 'Dranbleiber', '4 Wochen in Folge mindestens eine Treppe.', (s) => s.streak, 4, '4');
  add('streak12', 'Gewohnheit', 'g', 'flame', 'Jahreszeit', '12 Wochen in Folge unterwegs.', (s) => s.streak, 12, '12');
  add('repeat10', 'Gewohnheit', 's', 'loop', 'Haustreppe', 'Dieselbe Treppe 10-mal gestiegen.', (s) => s.maxRepeat, 10, '10×');
  add('early', 'Gewohnheit', 'b', 'sun', 'Frühaufsteher', 'Eine Treppe vor 7 Uhr morgens.', (s) => (s.early ? 1 : 0), 1, '');
  add('late', 'Gewohnheit', 'b', 'moon', 'Nachtschwärmer', 'Eine Treppe nach 22 Uhr.', (s) => (s.late ? 1 : 0), 1, '');

  function milestones(stats) {
    return M.map((m) => {
      const goal = typeof m.goal === 'function' ? m.goal(stats) : m.goal == null ? stats.total : m.goal;
      const value = m.value(stats);
      return { ...m, goal, now: Math.min(value, goal), done: value >= goal, progress: Math.min(1, value / goal) };
    });
  }

  // ---- Aufträge: Vorschläge statt Pflichten --------------------------------
  function quests(stats, stairs, pos, distM, areaNames) {
    const open = stairs.filter((s) => s.k && !stats.per.has(s.id));
    const out = [];
    if (!open.length) return out;
    if (pos) {
      let best = null, bd = Infinity;
      for (const s of open) { const d = distM(pos, s.c); if (d < bd) { bd = d; best = s; } }
      out.push({ kind: 'near', title: 'Die Nächste', text: `${best.n} – ${bd < 950 ? Math.round(bd / 10) * 10 + ' m' : (bd / 1000).toFixed(1).replace('.', ',') + ' km'} entfernt`, stair: best });
    }
    // Fast geschafft: Quartier, dem am wenigsten bis „komplett“ fehlt (nur wenn es wirklich nah ist)
    let bestA = null;
    for (const [id, a] of Object.entries(stats.areas)) {
      const missing = a.total - a.done;
      if (!a.total || !missing || !a.done || missing > 3) continue;
      if (!bestA || missing < bestA.missing) bestA = { id, missing };
    }
    if (bestA && areaNames) {
      out.push({ kind: 'area', title: 'Fast geschafft', text: `Noch ${bestA.missing} ${bestA.missing === 1 ? 'Treppe' : 'Treppen'}, dann ist ${areaNames.get(bestA.id)} komplett`, area: bestA.id });
    }
    const ms = milestones(stats).filter((m) => !m.done && m.progress > 0).sort((a, b) => b.progress - a.progress)[0];
    if (ms) out.push({ kind: 'milestone', title: 'In Reichweite', text: `„${ms.title}“ – ${fmt(ms.now)} von ${fmt(ms.goal)}`, milestone: ms });
    const big = open.filter((s) => !s.e).sort((a, b) => b.s - a.s)[0];
    if (big) out.push({ kind: 'big', title: 'Der Brocken', text: `${big.n}: ${big.s} Stufen in ${big.d}`, stair: big });
    return out;
  }

  /** Die drei Etappen jedes Quartiers. */
  function areaBadges(a) {
    const half = Math.ceil(a.total / 2);
    const mk = (tier, glyph, mark, title, text, goal) => ({ tier, glyph, mark, title, text, goal, now: Math.min(a.done, goal), done: a.done >= goal, progress: Math.min(1, a.done / goal) });
    return [
      mk('b', 'steps', '', 'Fuß gefasst', 'Die erste Treppe hier.', 1),
      mk('s', 'num', '½', 'Halbzeit', `Die Hälfte der Treppen (${half}).`, half),
      mk('g', 'flag', '', 'Komplett', `Alle ${a.total} Treppen.`, a.total),
    ];
  }

  const fmt = (n) => Math.round(n).toLocaleString('de-DE');
  root.TJGame = { LEVELS, levelFor, computeStats, milestones, quests, areaBadges, isoWeek, fmt, DISCOVERY_BONUS };
})(typeof window !== 'undefined' ? window : globalThis);
