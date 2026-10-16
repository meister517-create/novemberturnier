// Firebase-Konfiguration – aus der Firebase-Konsole kopieren:
// Projekteinstellungen → Allgemein → „Meine Apps“ → Web-App → SDK-Einrichtung → „Konfiguration“.
// Diese Werte sind nicht geheim; geschützt wird über die Firestore-Regeln (firestore.rules).
export const firebaseConfig = {
  apiKey: "AIzaSyC8ntEPKXliXMByXiEeZox1LU6DZ7zyr2I",
  authDomain: "novemberturnier-dortmund.firebaseapp.com",
  projectId: "novemberturnier-dortmund",
  storageBucket: "novemberturnier-dortmund.firebasestorage.app",
  messagingSenderId: "342069978906",
  appId: "1:342069978906:web:d18da5d74a994e8765eea3"
};

// Firestore-Dokument, in dem Spielplan, Ergebnisse, Teams, Karte und Infos liegen.
// Für das nächste Turnier einfach einen neuen Namen vergeben (z. B. "novemberturnier-2027").
export const DATA_DOC = ["turnier", "novemberturnier-2026"];
