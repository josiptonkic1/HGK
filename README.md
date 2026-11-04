# 31. Zlatna kuna – pozivnice i prijava gostiju

Web aplikacija za HGK: uzvanici kroz link pozivnice potvrđuju dolazak (s pratnjom) i dobivaju QR kod, a osoblje na ulazu skenira QR kod i predaje ulaznice.

## Što aplikacija radi

**Uzvanik (link pozivnice)**
- Otvara pozivnicu (tekst i dizajn 31. Zlatne kune), upisuje ime i prezime i po želji dodaje pratnju (jednu ili više osoba, do dopuštenog broja).
- Nakon potvrde dobiva ekran uspješne prijave s **QR kodom** i uputom da ga pokaže **pri preuzimanju ulaznica i pri ulasku u dvoranu**. QR kod može preuzeti kao PNG.
- Na osobnom linku može se i ispričati („Nažalost, ne mogu doći”) ili kasnije izmijeniti podatke, sve dok mu dolazak nije evidentiran.
- Dvije vrste linkova:
  - **osobni link** `/p/<token>` – admin unaprijed doda uzvanika i pošalje mu link (ime je već upisano, prati se tko nije odgovorio),
  - **opći link** `/pozivnica` – isti link za sve; prijava se odmah potvrđuje. Admin ga može isključiti.

**Moderator** (`/prijava` → `/staff`)
- Popis svih uzvanika s pretragom (radi i bez kvačica: „sari” pronalazi „Šarić”) i filtrima.
- Skeniranje QR koda kamerom mobitela (ili iz slike, ili ručnim unosom koda).
- Nakon skeniranja vidi je li uzvanik potvrdio dolazak, tko je u pratnji i je li već ušao. Odabire osobe koje su došle i potvrđuje predaju ulaznica.
- Ako QR ne radi, pretraži osobu po imenu i potvrdi dolazak. Uzvanika koji nije potvrdio dolazak može evidentirati tek nakon dodatne potvrde.

**Administrator** – sve što i moderator, plus:
- dodavanje uzvanika (pojedinačno ili skupno zalijepljenim popisom iz Excela), s automatskom potvrdom dolaska ili slanjem osobnog linka,
- uređivanje i brisanje uzvanika i pratnje, pregled statusa (potvrdili, ne dolaze, nisu odgovorili, došli),
- **izvoz u PDF i Excel** – svi ili samo dolaze, ne dolaze, nisu odgovorili ili došli. Popis je grupiran po statusu i grupi uzvanika, a pratnja je ispisana kao „Ime Prezime – pratnja” odmah ispod osobe koju prati. U Excelu su statusi na zasebnim listovima, a redovi su grupirani (mogu se sklapati),
- upravljanje korisnicima (admini i moderatori) i postavkama (opći link, zadani broj pratnje).

## Pokretanje

Potreban je Node.js 22.13 ili noviji (koristi ugrađeni SQLite, bez dodatne baze).

**Windows (najjednostavnije):** dvoklik na `start.bat`. Skripta instalira pakete ako nedostaju, pokreće aplikaciju i otvara prijavu u pregledniku.

**Ručno:**

```bash
npm install
cp .env.example .env    # pa upišite SESSION_SECRET te lozinke za admina i moderatora
npm start               # http://localhost:3000
```

Početni administrator (`ADMIN_USERNAME` / `ADMIN_PASSWORD`) i moderator (`MODERATOR_USERNAME` / `MODERATOR_PASSWORD`) kreiraju se pri pokretanju, ako u bazi još nema korisnika te uloge. Ostale korisnike dodajete u aplikaciji, pod „Postavke i korisnici”.

**Paket za preuzimanje:** `dist/zlatna-kuna-31.zip` sadrži sve, uključujući instalirane pakete. Raspakirajte ga i pokrenite `start.bat`.

## Skeniranje na ulazu

1. Moderator skenira QR kod. Prikazuje se „QR kod uspješno skeniran” s imenom i prezimenom uzvanika i njegovom pratnjom.
2. **Preuzeo pozivnicu:** dolazak se sprema i vidi se u tablici „Preuzete pozivnice” (vrijeme, osoba, pratnja od, moderator).
3. **Odustani:** prebacuje na ručni pregled popisa uzvanika, s kursorom u polju za pretragu.

## Web aplikacija (instalacija na mobitel)

Aplikacija je PWA i može se instalirati kao obična aplikacija:
- **Android / Chrome / Edge:** u panelu se pojavi gumb „Instaliraj aplikaciju”, ili u izborniku preglednika odaberite „Instaliraj aplikaciju”.
- **iPhone (Safari):** Dijeli → „Dodaj na početni zaslon”.

Instalirana aplikacija otvara se izravno na panel za skeniranje. Instalacija i kamera rade samo preko HTTPS-a (ili na `localhost`). Podaci o uzvanicima se ne spremaju na uređaj, nego se uvijek čitaju s poslužitelja.

Testovi: `npm test`

## Android aplikacija

Mapa `mobile/` sadrži Android aplikaciju (Capacitor) za moderatore i administratore.
- **Preuzimanje:** https://github.com/josiptonkic1/HGK/releases/latest/download/zlatna-kuna.apk
- APK se automatski gradi na GitHub Actions (`.github/workflows/android.yml`) pri svakoj promjeni u `mobile/`. Ručno se pokreće pod Actions → Android APK → Run workflow.
- Pri prvom pokretanju aplikacija traži adresu poslužitelja (npr. `https://zlatnakuna.hgk.hr`), provjeri je i otvori panel za skeniranje s pristupom kameri. Adresa se mijenja gumbom „Poslužitelj” u panelu.
- Aplikacija ne radi bez poslužitelja: on mora biti dostupan s interneta preko HTTPS-a.
- Ovo je testna (debug) verzija. Za Google Play treba potpisani release build.

## Produkcija

- Aplikacija mora biti dostupna preko **HTTPS-a**, jer preglednici bez njega ne dopuštaju pristup kameri za skeniranje. Postavite `COOKIE_SECURE=true`.
- Iza reverse proxyja (nginx, IIS) postavite `TRUST_PROXY=1` i ostavite `HOST=127.0.0.1`. Bez proxyja postavite `HOST=0.0.0.0`.
- Baza je jedna datoteka (`DB_FILE`, zadano `./data/zlatna-kuna.db`) i treba je redovito sigurnosno kopirati.
- Tekst pozivnice (datum, vrijeme, mjesto, napomene) nalazi se u `src/event.js`.
- Docker: `docker build -t zlatna-kuna .`, zatim `docker run -d -p 3000:3000 -v zk-data:/app/data --env-file .env zlatna-kuna`.

## Struktura

```
index.js            pokretanje poslužitelja
src/app.js          rute i ovlasti (javno / moderator / admin)
src/store.js        rad s bazom: pozivnice, pratnja, dolasci, korisnici
src/export.js       PDF i Excel izvoz
src/event.js        tekst pozivnice
public/             stranice: pozivnica, prijava osoblja, panel
test/               automatski testovi (node:test + supertest)
```
