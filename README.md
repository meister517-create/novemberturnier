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
