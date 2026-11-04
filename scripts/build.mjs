// Buduje stronę: pobiera wyniki, liczy statystyki, szyfruje je kluczem DATA_KEY i zapisuje do _site/.
// Zamknięte sezony są trzymane w zaszyfrowanym archiwum scripts/archive.enc.json, a pobierany jest
// tylko bieżący (ostatni na liście w seasons.json). FULL=1 wymusza pobranie wszystkiego od nowa.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { gather, compute } = require('./stats.js');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, '_site');
const ARCH = path.join(ROOT, 'scripts/archive.enc.json');
const BASE = process.env.OLS_BASE || 'https://tournament.tools';
const subtle = crypto.webcrypto.subtle;
const b64 = b => Buffer.from(b).toString('base64');
const unb64 = s => Uint8Array.from(Buffer.from(s, 'base64'));

const keyB64 = (process.env.DATA_KEY || '').trim();
if (!keyB64) { console.error('Brak sekretu DATA_KEY.'); process.exit(1); }
const K = unb64(keyB64);
if (K.length !== 32) { console.error('DATA_KEY ma złą długość.'); process.exit(1); }
const dk = await subtle.importKey('raw', K, 'AES-GCM', false, ['encrypt', 'decrypt']);
const enc = async obj => { const iv = crypto.webcrypto.getRandomValues(new Uint8Array(12));
  return { iv: b64(iv), data: b64(await subtle.encrypt({ name: 'AES-GCM', iv }, dk, new TextEncoder().encode(JSON.stringify(obj)))) }; };
const dec = async e => JSON.parse(new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv) }, dk, unb64(e.data))));

async function getJson(p) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(BASE + p, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (OLS-stats)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (attempt === 4) throw new Error('Nie udało się pobrać ' + p + ': ' + e.message);
      await new Promise(res => setTimeout(res, 1500 * attempt));
    }
  }
}

const { seasons: sids } = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/seasons.json'), 'utf8'));
let cache = null;
if (fs.existsSync(ARCH)) {
  try { cache = await dec(JSON.parse(fs.readFileSync(ARCH, 'utf8'))); }
  catch (e) { console.log('Archiwum nieczytelne, pobieram wszystko od nowa.'); cache = null; }
}
const full = process.env.FULL === '1' || !cache;
console.log(full ? 'Pełne pobranie wszystkich sezonów.' : 'Pobieram tylko bieżący sezon, reszta z archiwum.');
const { raw, newCache, changed, fetched } = await gather(getJson, sids, cache, full,
  (d, n) => { if (d % 50 === 0 || d === n) console.log(`Pobrano ${d}/${n} kolejek`); });
console.log(`Pobrane sezony: ${fetched}.`);

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
const data = compute(raw, today);
const nMatches = data.OLS.seasons.reduce((a, s) => a + s.ms, 0);
const minMatches = +process.env.OLS_MIN_MATCHES || 30000;
if (nMatches < minMatches) { console.error('Podejrzanie mało meczów (' + nMatches + '), przerywam bez publikacji.'); process.exit(1); }

if (changed) { fs.writeFileSync(ARCH, JSON.stringify(await enc(newCache))); console.log('Zapisano nowe archiwum.'); }

// mapowanie login -> zawodnik (zaszyfrowane w repozytorium)
const ME = await dec(JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/logins.enc.json'), 'utf8')));
const vault = await enc({ OLS: data.OLS, OLS_S: data.OLS_S, ME });
const keys = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/keys.json'), 'utf8'));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'vault.json'), JSON.stringify({ v: 1, iter: keys.iter, iv: vault.iv, data: vault.data, keys: keys.keys }));
for (const f of ['index.html', 'robots.txt']) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`Gotowe: ${data.OLS.SN.length} sezonów, ${nMatches} meczów, stan na ${today}.`);
