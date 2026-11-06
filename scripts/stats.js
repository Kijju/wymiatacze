// OLS w liczbach: pobieranie wyników z tournament.tools i liczenie statystyk.
// Działa w Node 20+ i w przeglądarce (bez importów).

async function fetchRaw(getJson, sids, onProgress) {
  const names = {};
  const seasons = [];
  for (const sid of sids) {
    const s = await getJson('/json/sezon,portal/' + sid);
    seasons.push({ name: s.nazwa, kolejki: (s.kolejki || []).map(k => ({ id: k.id, name: k.nazwa, date: k.data, groups: [] })) });
  }
  const jobs = [];
  seasons.forEach(s => s.kolejki.forEach(k => jobs.push(k)));
  let i = 0, done = 0;
  async function worker() {
    while (i < jobs.length) {
      const k = jobs[i++];
      const d = await getJson('/json/kolejka,portal/' + k.id);
      for (const g of (d.grupy || [])) {
        let ms = null;
        try { ms = JSON.parse(decodeURIComponent(escape(atob(g.data || '')))); } catch (e) { ms = null; }
        ms = ms || [];
        (g.zawodnicy || []).forEach(z => { names[z.id] = ((z.imie || '') + ' ' + (z.nazwisko || '')).replace(/\s+/g, ' ').trim(); });
        let win = '';
        try { const h = (JSON.parse(g.extra_json || 'null') || {}).harmonogram || []; if (h.length) win = h[0].day + ' ' + h[0].start + '-' + h[0].end; } catch (e) {}
        k.groups.push({
          lvl: +g.poziom, pl: (g.zawodnicy || []).map(z => String(z.id)), win,
          m: ms.filter(m => m.status && (+m.wynikA + +m.wynikB) > 0)
               .map(m => [String(m.zawodnikA), String(m.zawodnikB), +m.wynikA, +m.wynikB, m.punkty || '', m._last_update || ''])
        });
      }
      done++; if (onProgress) onProgress(done, jobs.length);
    }
  }
  await Promise.all([1, 2, 3, 4].map(worker));
  return { seasons, names };
}


// Łączy archiwum (zamknięte sezony) z bieżącym sezonem. Pobiera tylko to, czego brakuje,
// albo wszystko przy pełnym odświeżeniu. Zwraca też nowe archiwum i informację, czy się zmieniło.
async function gather(getJson, sids, cache, full, onProgress) {
  cache = cache || { seasons: {}, names: {} };
  const current = sids[sids.length - 1];
  const need = sids.filter(sid => sid === current || full || !cache.seasons[sid]);
  const fresh = await fetchRaw(getJson, need, onProgress);
  const bySid = {}; need.forEach((sid, i) => bySid[sid] = fresh.seasons[i]);
  const names = Object.assign({}, cache.names, fresh.names);
  const seasons = sids.map(sid => bySid[sid] || cache.seasons[sid]);
  const archived = need.filter(sid => sid !== current);
  const newCache = { seasons: {}, names };
  sids.filter(sid => sid !== current).forEach(sid => newCache.seasons[sid] = bySid[sid] || cache.seasons[sid]);
  const changed = archived.length > 0 || Object.keys(cache.seasons).some(sid => !sids.slice(0, -1).includes(+sid));
  return { raw: { seasons, names }, newCache, changed, fetched: need.length };
}

function compute(raw, today) {
  const NM = id => raw.names[id] || String(id);
  const r1 = x => Math.round(x * 10) / 10;
  const pct = (a, b) => b ? r1(100 * a / b) : 0;
  const parseSets = p => String(p || '').split(' ').map(x => x.split(':').map(Number)).filter(x => x.length === 2 && x[0] + x[1] > 0);
  const SN = raw.seasons.map(s => s.name);

  // kolejki z wynikami, chronologicznie
  const K = [];
  raw.seasons.forEach((s, si) => s.kolejki.forEach(k => { if (k.groups.some(g => g.m.length)) K.push({ si, season: s.name, date: k.date, groups: k.groups }); }));
  K.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  // limit seta dla grupy w kolejce: najczęstszy wynik zwycięzcy w setach wygranych różnicą >=3
  K.forEach(k => k.groups.forEach(g => {
    const sets = g.m.flatMap(m => parseSets(m[4]).map(([a, b]) => [Math.max(a, b), Math.min(a, b)]));
    const c = {}; sets.filter(([a, b]) => a - b >= 3).forEach(([a]) => c[a] = (c[a] || 0) + 1);
    let T = +(Object.entries(c).sort((x, y) => y[1] - x[1])[0] || [])[0];
    if (!T) { const c2 = {}; sets.forEach(([a]) => c2[a] = (c2[a] || 0) + 1); T = +(Object.entries(c2).sort((x, y) => y[1] - x[1])[0] || [0])[0]; }
    g.T = T || 0;
  }));

  const P = {};
  const gp = id => P[id] || (P[id] = { id, n: NM(id), enr: 0, pres: 0, mw: 0, ml: 0, sw: 0, sl: 0, path: [], s1: [0, 0], dec: [0, 0], cb: [0, 0], st: [0, 0], elo: null, em: 0, cw: 0, cl: 0, bw: 0, bl: 0, ps: 0, pbest: 0, ever: false, se: {} });
  const SA = SN.map(() => ({ kol: 0, enr: 0, pres: 0, players: new Set(), pl: {}, riv: {}, lv: {}, ga: {}, lvx: {}, k: [] }));
  const matches = [];

  K.forEach((k, gi) => {
    const sa = SA[k.si]; sa.kol++;
    const presentIds = new Set(); let ke = 0, kp = 0;
    k.groups.forEach(g => {
      const pres = new Set(); g.m.forEach(m => { pres.add(m[0]); pres.add(m[1]); });
      let gpres = 0;
      g.pl.forEach(id => {
        const p = gp(id); p.enr++; sa.enr++; ke++;
        const ss = (p.se[k.si] ||= [0, 0]); ss[0]++;
        const r = (sa.pl[id] ||= { enr: 0, pres: 0, mw: 0, ml: 0, sw: 0, sl: 0, bw: 0, bl: 0, cw: 0, cl: 0, cbw: 0, cbn: 0, stw: 0, stn: 0, L: [], elo: 0 });
        r.enr++;
        if (pres.has(id)) { p.pres++; ss[1]++; p.path.push([gi, g.lvl]); presentIds.add(id); r.pres++; r.L.push(g.lvl); gpres++; kp++; }
      });
      if (gpres) { const o = (sa.ga[g.lvl] ||= [0, 0, 0]); o[0]++; o[1] += gpres; o[2] += g.pl.length; }
      g.m.slice().sort((a, b) => (a[5] || '') < (b[5] || '') ? -1 : 1).forEach(m =>
        matches.push({ gi, k, si: k.si, lvl: g.lvl, T: g.T, a: m[0], b: m[1], sa: m[2], sb: m[3], sets: parseSets(m[4]) }));
    });
    sa.pres += presentIds.size; presentIds.forEach(id => sa.players.add(id));
    sa.k.push(k.date.slice(5).replace('-', '') + ':' + (ke ? r1(100 * kp / ke) : ''));
    Object.values(P).forEach(p => { if (presentIds.has(p.id)) { p.ps++; p.pbest = Math.max(p.pbest, p.ps); } else if (p.ever) p.ps = 0; });
    presentIds.forEach(id => P[id].ever = true);
  });

  // mecze: Elo, bilanse, sety
  const H = {}, ups = [], close = [], lvAll = {};
  matches.forEach(m => {
    const a = gp(m.a), b = gp(m.b), sa = SA[m.si];
    if (a.elo === null) a.elo = 1700 - 40 * m.lvl;
    if (b.elo === null) b.elo = 1700 - 40 * m.lvl;
    const ea = 1 / (1 + 10 ** ((b.elo - a.elo) / 400)), aw = m.sa > m.sb ? 1 : 0, pw = aw ? ea : 1 - ea;
    if (pw < 0.2) ups.push({ p: pw, w: aw ? m.a : m.b, l: aw ? m.b : m.a, we: Math.round(aw ? a.elo : b.elo), le: Math.round(aw ? b.elo : a.elo), d: m.k.date, si: m.si, s: Math.max(m.sa, m.sb) + ':' + Math.min(m.sa, m.sb), lvl: m.lvl });
    const KF = m.gi < 30 ? 32 : 24; a.elo += KF * (aw - ea); b.elo -= KF * (aw - ea);
    a.em = Math.max(a.em, a.elo); b.em = Math.max(b.em, b.elo);
    const A = sa.pl[m.a], B = sa.pl[m.b];
    if (A) A.elo = a.elo; if (B) B.elo = b.elo;
    [[a, A, aw, m.sa, m.sb], [b, B, 1 - aw, m.sb, m.sa]].forEach(([p, r, w, x, y]) => {
      for (const o of [p, r]) { if (!o) continue;
        if (w) { o.mw++; o.cw++; o.cl = 0; o.bw = Math.max(o.bw, o.cw); } else { o.ml++; o.cl++; o.cw = 0; o.bl = Math.max(o.bl, o.cl); }
        o.sw += x; o.sl += y; }
    });
    const key = m.a < m.b ? m.a + '|' + m.b : m.b + '|' + m.a;
    const h = (H[key] ||= [0, 0]); if ((m.a < m.b) === !!aw) h[0]++; else h[1]++;
    const hs = (sa.riv[key] ||= [0, 0]); if ((m.a < m.b) === !!aw) hs[0]++; else hs[1]++;
    if (!m.sets.length) return;
    const X = (sa.lvx[m.lvl] ||= [0, 0, 0, 0]); X[0]++; if (Math.abs(m.sa - m.sb) === 1) X[1]++;
    const f = m.sets[0], aF = f[0] > f[1];
    a.s1[1]++; b.s1[1]++; if (aF) a.s1[0]++; else b.s1[0]++;
    if (m.sets.length >= 3) { const d = m.sets[m.sets.length - 1]; a.dec[1]++; b.dec[1]++; if (d[0] > d[1]) a.dec[0]++; else b.dec[0]++; }
    if (aF) { b.cb[1]++; if (!aw) b.cb[0]++; if (B) { B.cbn++; if (!aw) B.cbw++; } }
    else { a.cb[1]++; if (aw) a.cb[0]++; if (A) { A.cbn++; if (aw) A.cbw++; } }
    const L = (lvAll[m.lvl] ||= { n: 0, two: 0, diff: 0, sets: 0 }); L.n++; if (m.sets.length === 2) L.two++;
    let nd = 0, tot = 0;
    m.sets.forEach(([x, y]) => {
      L.sets++; L.diff += Math.abs(x - y); tot += x + y; X[2]++;
      if (m.T && Math.min(x, y) >= m.T - 1) {
        nd++; X[3]++;
        a.st[1]++; b.st[1]++; if (A) A.stn++; if (B) B.stn++;
        if (x > y) { a.st[0]++; if (A) A.stw++; } else { b.st[0]++; if (B) B.stw++; }
      }
    });
    if (m.sets.length >= 3) close.push({ a: m.a, b: m.b, d: m.k.date, si: m.si, lvl: m.lvl, sc: m.sets.map(s => s.join(':')).join(' '), res: m.sa + ':' + m.sb, nd, tot });
  });

  // indeksy zawodników
  const plist = Object.values(P).filter(p => p.pres >= 10);
  const idx = {}; plist.forEach((p, i) => idx[p.id] = i);
  const ex = [];
  const IX = id => { if (idx[id] === undefined) { idx[id] = plist.length + ex.length; ex.push(NM(id)); } return idx[id]; };

  const pl = plist.map(p => {
    const bySeason = {}; p.path.forEach(([g, l]) => (bySeason[K[g].si] ||= []).push(l));
    const se = SN.map((s, si) => { const e = p.se[si]; if (!e || !e[1]) return null; const L = bySeason[si] || [];
      return [si, e[0], e[1], L[0], Math.min(...L), L[L.length - 1], r1(L.reduce((x, y) => x + y, 0) / L.length)].join(':'); }).filter(Boolean).join(';');
    return [p.n, p.enr, p.pres, p.mw, p.ml, p.sw, p.sl, Math.round(p.elo), Math.round(p.em), p.bw, p.bl, p.pbest, p.s1[0], p.s1[1], p.dec[0], p.dec[1], p.cb[0], p.cb[1], p.st[0], p.st[1], p.st[1] - p.st[0], se];
  });
  const h2h = Object.entries(H).filter(([k, v]) => v[0] + v[1] >= 5).map(([k, v]) => { const [a, b] = k.split('|'); return [a, b, v]; })
    .filter(([a, b]) => idx[a] !== undefined && idx[b] !== undefined && idx[a] < plist.length && idx[b] < plist.length)
    .map(([a, b, v]) => [idx[a], idx[b], v[0], v[1]]);

  // ruch między grupami
  const byP = {}; Object.values(P).forEach(p => byP[p.id] = new Map(p.path.map(([g, l]) => [g, l])));
  let prom = 0, bounce = 0, stayUp = 0;
  for (const id in byP) { const m = byP[id]; for (const [g, l] of m) {
    if (m.has(g - 1) && m.get(g - 1) > l && K[g].si === K[g - 1].si) { prom++;
      if (m.has(g + 1) && K[g + 1].si === K[g].si) { if (m.get(g + 1) > l) bounce++; else stayUp++; } } } }
  const climbs = [];
  Object.values(P).forEach(p => { if (!p.path.length) return; const deb = p.path[0]; const i1 = p.path.findIndex(x => x[1] === 1);
    if (i1 > 0 && deb[1] >= 4) climbs.push({ n: p.n, from: deb[1], k: i1, d: K[p.path[i1][0]].date }); });
  climbs.sort((a, b) => b.from - a.from || a.k - b.k);
  const winda = Object.values(P).filter(p => p.path.length >= 30).map(p => { let ch = 0; for (let i = 1; i < p.path.length; i++) if (p.path[i][1] !== p.path[i - 1][1]) ch++;
    const lv = p.path.map(x => x[1]); return { n: p.n, ch, k: p.path.length, rate: r1(100 * ch / (p.path.length - 1)), min: Math.min(...lv), max: Math.max(...lv) }; })
    .sort((a, b) => b.rate - a.rate);

  // sezony
  const firstSeason = {}; Object.values(P).forEach(p => { if (p.path.length) firstSeason[p.id] = K[p.path[0][0]].si; });
  const seasons = SN.map((s, si) => { const a = SA[si]; const next = si < SN.length - 1 ? SA[si + 1].players : null;
    return { s, kol: a.kol, players: a.players.size, avgPres: a.kol ? r1(a.pres / a.kol) : 0, att: pct(a.pres, a.enr),
      newP: [...a.players].filter(id => firstSeason[id] === si).length, left: next ? [...a.players].filter(id => !next.has(id)).length : null,
      ms: matches.filter(m => m.si === si).length }; });
  const mon = {}; K.forEach(k => { const mo = +k.date.slice(5, 7); let e = 0, p = 0;
    k.groups.forEach(g => { e += g.pl.length; const s = new Set(); g.m.forEach(m => { s.add(m[0]); s.add(m[1]); }); p += g.pl.filter(id => s.has(id)).length; });
    const o = (mon[mo] ||= [0, 0]); o[0] += p; o[1] += e; });
  const levels = Object.entries(lvAll).map(([l, o]) => ({ l: +l, n: o.n, two: pct(o.two, o.n), diff: r1(o.diff / o.sets) }));

  // godziny zakończenia (od sezonu 2024/2025)
  const DN = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'ndz'];
  const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const tAll = {}, tPer = {};
  K.forEach(k => { if (k.date < '2024-09-01') return;
    k.groups.forEach(g => { if (!g.win || !g.m.length) return;
      const [day, span] = g.win.split(' '); const dd = addDays(k.date, +day);
      const [sh, sm] = span.split('-')[0].split(':').map(Number), [eh, em] = span.split('-')[1].split(':').map(Number);
      const ts = g.m.map(m => m[5]).filter(t => t && t.slice(0, 10) === dd).map(t => { const [h, mi] = t.slice(11, 16).split(':').map(Number); return h * 60 + mi; })
        .filter(x => x >= sh * 60 + sm - 30).sort((a, b) => a - b);
      if (ts.length < Math.max(2, Math.ceil(g.m.length * 0.6))) return;
      let last = ts.length - 1;
      for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > 30 && ts.length - i <= 2) { last = i - 1; break; }
      const end = ts[last], over = end - (eh * 60 + em), w = DN[+day] + ' ' + span;
      // pierwszy wynik: minuty od początku okienka (rozgrzewka + pierwszy mecz)
      // czas meczu: grupa gra na dwóch kortach, więc odstęp między kolejnymi wynikami razy 2
      const first = ts[0] - (sh * 60 + sm), dur = last > 0 ? 2 * (end - ts[0]) / last : null;
      for (const o of [(tAll[g.lvl] ||= { w, o: [], f: [], d: [], m: 0 }), (((tPer[k.si] ||= {})[g.lvl]) ||= { w, o: [], f: [], d: [], m: 0 })]) {
        o.o.push(over); o.f.push(first); o.m += g.m.length; if (dur != null) o.d.push(dur); } }); });
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const trow = (l, o) => { const s = o.o.slice().sort((a, b) => a - b); const d = med(o.d);
    return [+l, o.w, s.length, s[Math.floor(s.length / 2)], r1(100 * s.filter(x => x > 0).length / s.length), s[Math.floor(s.length * 0.9)], med(o.f), d == null ? null : Math.round(d), o.m]; };

  const ymd6 = d => d.slice(2).replace(/-/g, '');
  const closeSort = (a, b) => b.nd - a.nd || b.tot - a.tot;
  const rivals = Object.entries(H).sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1])).slice(0, 50)
    .map(([k, v]) => { const [a, b] = k.split('|'); return { a: NM(a), b: NM(b), x: v[0], y: v[1] }; });
  const upsAll = ups.slice().sort((a, b) => a.p - b.p).slice(0, 50)
    .map(u => ({ w: NM(u.w), l: NM(u.l), p: Math.max(1, Math.round(100 * u.p)), we: u.we, le: u.le, d: u.d, s: u.s, lvl: u.lvl }));
  const clAll = close.slice().sort(closeSort).slice(0, 50).map(c => ({ a: NM(c.a), b: NM(c.b), d: c.d, lvl: c.lvl, sc: c.sc, res: c.res }));

  const S = SN.map((s, si) => { const a = SA[si];
    const rows = Object.entries(a.pl).filter(([id, r]) => r.pres > 0).map(([id, r]) => { const L = r.L; let ch = 0; for (let i = 1; i < L.length; i++) if (L[i] !== L[i - 1]) ch++;
      return [IX(id), r.enr, r.pres, r.mw, r.ml, r.sw, r.sl, Math.round(r.elo || 0), r.bw, r.bl, r.cbw, r.cbn, r.stw, r.stn, L[0], Math.min(...L), L[L.length - 1], Math.round(10 * L.reduce((x, y) => x + y, 0) / L.length), ch].join(','); }).join(';');
    const riv = Object.entries(a.riv).sort((x, y) => (y[1][0] + y[1][1]) - (x[1][0] + x[1][1])).slice(0, 30).map(([k, v]) => { const [p, q] = k.split('|'); return [IX(p), IX(q), v[0], v[1]]; });
    const cl = close.filter(c => c.si === si).sort(closeSort).slice(0, 30).map(c => [ymd6(c.d), c.lvl, IX(c.a), IX(c.b), c.res, c.sc]);
    const up = ups.filter(u => u.si === si).sort((x, y) => x.p - y.p).slice(0, 30).map(u => [ymd6(u.d), u.lvl, IX(u.w), IX(u.l), u.s, Math.max(1, Math.round(100 * u.p))]);
    const lv = Object.entries(a.lvx).map(([l, v]) => [+l, v[0], pct(v[0] - v[1], v[0]), pct(v[3], v[2])]);
    const o = { k: a.k.join(','), pl: rows, riv, cl, up, lv };
    if (tPer[si]) o.tm = Object.entries(tPer[si]).map(([l, x]) => trow(l, x));
    return o; });

  const D = { gen: today, SN, pl, h2h, mv: {}, bounce: { prom, bounce, stayUp }, climbs, winda, seasons, mon, levels,
    times: Object.entries(tAll).map(([l, o]) => { const t = trow(l, o); return { l: t[0], w: t[1], n: t[2], med: t[3], late: t[4], p90: t[5], first: t[6], dur: t[7], ms: t[8] }; }),
    rivals, ups: upsAll, cl: clAll,
    ga: Object.fromEntries(SA.map((a, si) => [si, Object.entries(a.ga).map(([l, r]) => [+l, ...r])])),
    lvx: Object.fromEntries(SA.map((a, si) => [si, a.lvx])) };
  return { OLS: D, OLS_S: { ex, S } };
}

if (typeof module !== 'undefined') module.exports = { fetchRaw, gather, compute };
