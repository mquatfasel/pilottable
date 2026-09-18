# PilotTable — Login & Abo-Modelle

Eine eigenständige, lauffähige App (kein Mockup): echte Konten mit gehashten
Passwörtern, echte Sessions, echte Speicherung der gewählten Abo-Pakete
(Basic / Professional / Enterprise). Läuft mit reinem Node.js — **keine
externen Pakete, kein `npm install` nötig.**

Hintergrund: Diese App wurde als Fundament für die SO[U]L Gastrozentrale
entwickelt (siehe die separate Analyse zum bestehenden Stand) und tritt
unter dem Namen **PilotTable** an. Sie ersetzt das bisherige Zugangsmodell
per E-Mail-Einladungslink durch ein echtes Login-/Registrierungssystem und
ein einfaches Abo-Modell.

## Schnellstart

```bash
node src/server.js
# oder: npm start
```

Dann im Browser öffnen: **http://localhost:3000**

Voraussetzung ist lediglich Node.js 18 oder neuer (`node -v` zum Prüfen).
Es gibt keine weiteren Abhängigkeiten zu installieren.

Optional: Port ändern über eine Umgebungsvariable:

```bash
PORT=8080 node src/server.js
```

## Was hier wirklich passiert

- **Registrierung** (`POST /api/auth/register`): Name, Betrieb, Rolle,
  E-Mail, Passwort. Das Passwort wird mit `crypto.scrypt` gehasht und
  gesalzen gespeichert — nie im Klartext. Bei bereits vergebener E-Mail
  kommt ein echter Fehler (409) zurück.
- **Login** (`POST /api/auth/login`): prüft die Zugangsdaten gegen den
  gespeicherten Hash und startet eine echte Session.
- **Sessions**: Ein zufälliges Token landet als `HttpOnly`-Cookie im
  Browser und wird serverseitig in `data/sessions.json` einem Benutzer
  zugeordnet. Kein clientseitig fälschbares JWT-Geheimnis nötig.
- **Abo-Wahl** (`POST /api/plan`): speichert den gewählten Plan
  (`basic` / `professional` / `enterprise`) dauerhaft am Benutzerkonto.
  Bei Enterprise wird zusätzlich `planRequested: true` gesetzt (Anfrage an
  den Vertrieb).
- **Datenhaltung**: `data/users.json` und `data/sessions.json` — einfache,
  lesbare JSON-Dateien. Bewusst einfach gehalten, siehe „Nächste Schritte“
  unten für den Weg zu einer echten Datenbank.

Alle Endpunkte:

| Methode | Pfad                 | Zweck                                  |
|---------|----------------------|-----------------------------------------|
| POST    | `/api/auth/register` | Konto anlegen, Session starten          |
| POST    | `/api/auth/login`    | Anmelden, Session starten               |
| POST    | `/api/auth/logout`   | Session beenden                         |
| GET     | `/api/auth/me`       | Aktuell angemeldeten Benutzer abfragen  |
| POST    | `/api/plan`          | Abo-Plan setzen/wechseln                |

## Projektstruktur

```
pilottable/
├── src/
│   ├── server.js   # HTTP-Server, Routing, statische Auslieferung
│   ├── auth.js     # Passwort-Hashing, Sessions, Cookies
│   └── store.js    # Dateibasierte Datenhaltung (JSON)
├── public/
│   ├── index.html  # Login/Registrierung + Preisseite
│   ├── app.js      # Echtes Frontend, spricht per fetch() mit der API
│   └── style.css
└── data/           # wird beim ersten Start automatisch angelegt
    ├── users.json
    └── sessions.json
```

## Warum kein Express, kein bcrypt, kein npm install?

In der Entwicklungsumgebung, in der diese App entstanden ist, war der
Zugriff auf die npm-Registry gesperrt. Damit die App garantiert bei dir
läuft — unabhängig davon, ob ihr eine Firewall, ein internes Netzwerk oder
Offline-Rechner im Betrieb einsetzt — verwendet sie ausschließlich in
Node.js eingebaute Module (`http`, `crypto`, `fs`). Das ist production-tauglich
für den Start, langfristig aber nicht das Ziel — siehe unten.

## Nächste Schritte

PilotTable ist das **Fundament** — kein Ersatz für die vollständige
SO[U]L Gastrozentrale-Vision. Konkret empfohlen:

1. **Echte Datenbank statt JSON-Dateien**, sobald mehrere Standorte oder
   viele gleichzeitige Nutzer dazukommen (z. B. Postgres). JSON-Dateien
   vertragen sich nicht gut mit hoher Parallelität.
2. **Zahlungsanbindung** für die Abo-Pakete (z. B. Stripe): aktuell wird
   nur gespeichert, *welcher* Plan gewählt wurde — es fließt noch kein
   Geld.
3. **Rollenrechte durchsetzen**: Die Rolle wird gespeichert, aber noch
   nicht serverseitig genutzt, um Zugriff auf bestimmte Module
   einzuschränken (z. B. Finanzkennzahlen nur für Geschäftsleitung).
4. **Multi-Tenant-Trennung**: Aktuell teilen sich alle Konten eine
   Betriebs-Instanz. Für mehrere Betriebe (SaaS) braucht jede
   Datenbank-Tabelle eine `tenant_id` bzw. eine strikte Trennung pro
   Betrieb.
5. **Deployment**: läuft bereits produktiv auf Render, DNS bei Strato
   (`pilot-table.de`). Für Produktivbetrieb das Cookie in `src/auth.js`
   (`setSessionCookie`) um `Secure` ergänzen, sobald die App über HTTPS
   läuft.
6. Ab hier weiter entlang der Roadmap: Artikelstamm, Rezepturen, HACCP,
   Bankett usw. als weitere Module auf derselben Datenbasis aufbauen.
