# Space Evolution

Browser-Version des Android-Spiels *Space Evolution* (v1.31, Unity). Ein Hex-Merge-Puzzle:
Drei gleiche Objekte verschmelzen zum nächsten – Sternenstaub → Asteroid → Mond → Planet → Gasplanet → Sonne →
Schwarzes Loch → Galaxie. Liegt auf allen grünen Feldern dasselbe Objekt wie im Zentrum, steigt das Zentrum
eine Stufe auf. Ziel: ein **Schwarzes Loch** im Zentrum.

Läuft komplett im Browser, ohne Build-Schritt und ohne Server – auch offline.

## Spielen

- Lokal: `web/index.html` im Browser öffnen.
- Mit lokalem Server (z. B. zum Testen auf dem Handy im selben WLAN):

  ```bash
  python3 -m http.server 8642 --directory web
  ```

- Online: https://graphoflife.github.io/space-evolution/

Die Musik liegt nur verschlüsselt im Repository (siehe [Lizenzen](#lizenzen)). Nach einem frischen Clone fehlt sie
lokal; mit dem Schlüssel in `.music-key` (oder `MUSIC_KEY` als Umgebungsvariable) wird sie so entschlüsselt:

```bash
bash tools/music.sh decrypt
```

Ohne Schlüssel läuft das Spiel normal, nur ohne Musik.

## Level

| Level | Felder | Grüne Felder | Charakter |
|---|---|---|---|
| Classic | 27 | 3 | Original-Layout |
| Duo | 30 | 2 | leicht: nur zwei Nachbarn fürs Level-Up |
| Star | 48 | 3 | großes Feld mit sechs breiten Ecken |
| Hexa | 30 | 6 | alle sechs Nachbarn müssen passen |
| Free | 37 | – | Sandbox: volles rundes Feld ohne Zentrum, startet leer; ein Schwarzes Loch irgendwo gewinnt, gemessen wird die Zeit bis zum ersten Asteroiden, Mond usw. |

Highscore, Bestzeiten und der laufende Spielstand werden pro Level im `localStorage` gespeichert.

## Unterschiede zum Original

- Kein Zug-Limit, keine Werbung, kein In-App-Kauf: Gespielt wird wie mit der Vollversion (unbegrenzte Züge,
  Zeitmessung mit Bestzeiten pro Level).
- Zusätzliche Level, Bloom-Effekt und kräftigere Farben.
- Partikeleffekte (Sternenstaub, Sonne, Schwarzes Loch, Galaxie, Verbindungen, Punkte, Hintergrund) nutzen die
  Originalwerte aus den Unity-Prefabs; die Wolken der Sonne liegen vor der Sonne und sind etwas größer.
- Basis ist v1.4 (neues App-Icon); die eigene Karten-Kamera von v1.4 ersetzt hier eine adaptive Kamera,
  die Karte und Vorschau ohne Abschneiden in jedes Seitenverhältnis einpasst.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `web/` | das Spiel (wird 1:1 veröffentlicht) |
| `web/js/data.js` | Objektdaten, Level-Layouts, Bewegungskurve |
| `web/js/game.js` | Spiellogik (Port von GameManager, Maptile, CenterMapTile, SelectionManager, ScoreManager, SpeedRunManager) |
| `web/js/render.js` | Three.js-Szene, 3D-Objekte, Bloom- und Sättigungs-Pass |
| `web/js/particles.js` | Partikelsysteme mit den Originalwerten, Trails und gebündeltes Rendering |
| `web/js/ui.js` | HUD, Menü mit Level-Auswahl, Meldungen |
| `web/js/audio.js`, `save.js`, `main.js` | Sound, Speicherstand, Szenenwechsel und Frame-Loop |
| `web/js/assets.js` | eingebettete Texturen, Effekte und Asteroiden-Mesh (generiert) |
| `assets/` | Quellen für `assets.js` und `fonts.css` |
| `assets/music/` | verschlüsselte Musik (AES-256) |
| `tools/build_assets.py` | erzeugt `web/js/assets.js` und `web/fonts.css` aus `assets/` |
| `tools/music.sh` | ver- und entschlüsselt die Musik |
| `docs/SPEC.md` | aus der APK ausgelesene Regeln und Werte |

Texturen und Effekte stecken als Data-URIs in `assets.js`, weil Browser WebGL-Texturen von `file://` sonst
blockieren. Nach Änderungen in `assets/`:

```bash
python3 tools/build_assets.py
```

## Veröffentlichen mit GitHub Pages

Der Workflow `.github/workflows/pages.yml` veröffentlicht bei jedem Push auf `main` den Ordner `web/`.
Dabei entschlüsselt er die Musik mit dem Repository-Secret `MUSIC_KEY`, sodass sie nur im veröffentlichten
Spiel steckt, nicht im Quellcode. Pages ist auf *Settings → Pages → Source: GitHub Actions* eingestellt.

## Lizenzen

- [three.js](https://threejs.org) r149 – MIT
- Roboto – Apache License 2.0
- Grafiken, Spielidee und Texte: aus dem Originalspiel *Space Evolution*
- Musik: „Through The Mist“ und „BlueWater Warning“ aus dem *SciFi Music Pack* von Adam Bielecki,
  lizenziert über den Unity Asset Store (Standard Unity Asset Store EULA). Die Musik ist **nicht** Teil der
  Lizenz dieses Repositorys, liegt hier nur verschlüsselt und darf nicht separat weiterverwendet werden.
