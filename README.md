# OLS w liczbach

Statystyki Olsztyńskiej Ligi Squasha dla uczestników ligi, z logowaniem.

## Jak to działa

- `index.html` – strona z ekranem logowania.
- `scripts/stats.js` – pobieranie wyników z tournament.tools i liczenie statystyk.
- `scripts/build.mjs` – buduje stronę w `_site/`: liczy statystyki i szyfruje je kluczem z sekretu `DATA_KEY`.
- `scripts/keys.json` – klucz danych zaszyfrowany osobno hasłem każdego uczestnika.
- `scripts/logins.enc.json` – zaszyfrowane przypisanie loginów do zawodników.
- `scripts/seasons.json` – numery sezonów z tournament.tools. Ostatni na liście to sezon bieżący. Na nowy sezon dopisz jego numer na końcu.
- `scripts/archive.enc.json` – zaszyfrowane wyniki zamkniętych sezonów. Tworzy go i odświeża sam automat.
- `.github/workflows/aktualizacja.yml` – automatyczna aktualizacja w poniedziałki o 22:30 oraz we wtorki i środy o 21:30 czasu polskiego, z przerwą w lipcu i sierpniu. Pobiera tylko bieżący sezon; w pierwszy poniedziałek miesiąca odświeża też archiwum. Można ją uruchomić ręcznie (Actions → Aktualizacja statystyk → Run workflow), także z opcją pełnego pobrania.

Dane w repozytorium są wyłącznie zaszyfrowane. Bez sekretu `DATA_KEY` i haseł nie da się ich odczytać.
Listy haseł nie ma w repozytorium i nie powinna się w nim znaleźć.
