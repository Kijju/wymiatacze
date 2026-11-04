# OLS w liczbach

Statystyki Olsztyńskiej Ligi Squasha (sezony 2015/2016–2026/2027) dla uczestników ligi.

Strona jest statyczna i działa na GitHub Pages. Dane zawodników w pliku `vault.json` są zaszyfrowane (AES-GCM).
Każdy uczestnik ma własny login i hasło; hasło odszyfrowuje klucz danych w przeglądarce, więc bez niego
danych nie da się odczytać ani ze strony, ani z repozytorium.

- `index.html` – strona z ekranem logowania
- `vault.json` – zaszyfrowane dane i zaszyfrowane klucze dla każdego loginu
- `robots.txt` – prośba do wyszukiwarek o nieindeksowanie

Listy haseł nie ma w repozytorium i nie powinna się w nim znaleźć.
