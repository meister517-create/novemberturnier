# 43. Novemberturnier – Web-App

Aufgebaut wie der Börde-Cup: gehostet über **GitHub Pages**, Daten und Login über **Firebase**.

Dateien: `index.html`, `app.js`, `styles.css`, `firebase-config.js`, `default-state.json`, `manifest.webmanifest`, Logos (`logo-*.png`, `icon-*.png`), `firestore.rules`.

Adresse: `https://meister517-create.github.io/novemberturnier/`

## Firebase (schon erledigt)

- Projekt `novemberturnier-dortmund`, Werte stehen in `firebase-config.js`
- Firestore (Frankfurt) mit den Regeln aus `firestore.rules`
- Authentication: E-Mail/Passwort, Orga-Konto angelegt

## Auf GitHub veröffentlichen

1. Neues Repository `novemberturnier`, Sichtbarkeit **Public**.
2. **Add file → Upload files**, alle Dateien hineinziehen → **Commit changes**.
3. **Settings → Pages**: Source **Deploy from a branch**, Branch **main**, Ordner **/ (root)** → **Save**.
4. Nach 1–2 Minuten ist die Seite online.

## Orga-Bereich

Ganz unten auf der Seite **Orga-Bereich**, mit der E-Mail und dem Passwort des Orga-Kontos aus Firebase anmelden. Änderungen mit **Veröffentlichen** speichern, sie erscheinen bei allen sofort.

Weitere Helfer: In Firebase unter Authentication ein Konto anlegen und dessen UID in den Firestore-Regeln ergänzen.

## Flexibel für jedes Turnier (Stand November 2026)

Im Orga-Bereich:

- **Allgemein**: Name des Turniers, Auflage (leer = ohne Nummer), Verein, Datum, Ort und **Farben** (Hauptfarbe + Zweitfarbe für Schrift, mit Vorlagen). Hintergrund- und Randtöne werden automatisch passend berechnet, auch im Dunkelmodus.
- **Turnierkonzept**: Turniertage (Start/Ende), Hallen und Wettbewerbe (z. B. Damen, Herren, U14). Je Wettbewerb Teamzahl, eine oder zwei Gruppen, Hin- und Rückspiel, Spielzeit und Finalrunde (Halbfinale, Platz gegen Platz oder nur Tabelle). „Spielplan und Teams erzeugen“ baut daraus alles neu; Teamnamen und Logos bleiben in ihrer Reihenfolge erhalten.
- **Essen & Getränke**: erst „Bereich freischalten“, dann pflegen (Theken, Kategorien, Angebote mit + und −), erst mit „Auf der Turnierseite anzeigen“ erscheint der Bereich im Frontend.

Alles wird erst mit **Veröffentlichen** online.
