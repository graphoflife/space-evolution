# Space Evolution v1.31: ausgelesene Spezifikation für den Browser-Port

Quelle: Unity 2017.4.0f1 (Mono). C#-Code mit ILSpy dekompiliert, Werte aus den Szenen/Assets (Rohbytes) dekodiert.
Der Roh-Export (dekompilierter Code, Original-PNGs/WAVs) liegt lokal in `extracted/` und ist nicht Teil des Repos.
Musik: `music_menu.mp3` = "25_BlueWater Warning", `music_game.mp3` = "4 - Through The Mist".

Hinweis: Diese Datei beschreibt das Original. Die Browser-Version weicht bewusst ab (zusätzliche Level, Bloom, Original-Partikel); siehe `README.md`.

## Spielprinzip
Hex-Merge-Puzzle. Ein Tipp auf ein freies Feld legt das nächste Objekt aus der Warteschlange ab.
- **Normales Kombinieren** (`Maptile.tryToCombineObjects`): Flood-Fill über gleichartige Nachbarn (6er-Hex-Nachbarschaft, Felder mit `connectedToCenter` ausgenommen). Bei Gruppengröße >= 3 werden alle zum gesetzten Feld gezogen und dort entsteht `nextType` (Kettenreaktion möglich).
- **Zentrum** (`CenterMapTile`): runder Kreis in der Mitte, hält das aktuelle Level-Objekt (Start: Sternenstaub). Hat 3 "Speichen"-Nachbarn. Wenn alle 3 denselben Typ wie das Zentrum haben, werden alle 4 kombiniert und es entsteht im Zentrum der nächste Typ ("Level Up!"). Leuchtende Verbindung (ConnectionEffect) zwischen Zentrum und Speiche bei gleichem Typ; Speichen mit gleichem Typ wie das Zentrum kombinieren nicht normal.
- **Sieg**: Schwarzes Loch im Zentrum → Meldung "YOU WIN!", danach weiterspielen möglich (Galaxie danach).
- **Game Over**: alle Felder belegt (geprüft nach jedem Zug ohne Kombination).
- Startbelegung: alle Felder außer den 3 Speichen mit Sternenstaub, in zufälliger Reihenfolge eingeblendet.

## Objekte (SpaceObjectData)
| # | Typ | next | Spawn-Gewicht | Score-Partikel | Punkte/Partikel (×10) | Sound-Pitch |
|---|---|---|---|---|---|---|
| 0 | stardust | astroid | 125 | 1 | 1 | 0.70 |
| 1 | astroid | moon | 40 | 3 | 2 | 0.85 |
| 2 | moon | planet | 6 | 9 | 4 | 1.00 |
| 3 | planet | gasplanet | 1 | 20 | 8 | 1.15 |
| 4 | gasplanet | sun | 0 | 40 | 25 | 1.30 |
| 5 | sun | blackhole | 0 | 80 | 62 | 1.45 |
| 6 | blackhole | galaxy | 0 | 150 | 130 | 1.60 |
| 7 | galaxy | galaxy | 0 | 300 | 500 | 1.75 |
amountToCombine = 3 für alle. Gewichte gesamt 172.
Punkte: Setzen eines Objekts → 1× (Partikel × Punkte × 10). Kombinieren → pro beteiligtem Feld 1× die Punkte des *alten* Typs. Score-Partikel fliegen zur Score-Anzeige (velocity 8..14, veloRatio 0.9, 30 Spawns/s).

## Karte
- Hex-Gitter, Abstand 1: für i,j ∈ [-3..3]: `x = i*√3/2`, `y = j + i/2`; behalten wenn 1.1 < |p| < 3.1 → Ringe 2 und 3.
- Entfernt: (0, 3), (-2.598, -1.5), (2.598, -1.5) → 27 Felder.
- Zentrum-Nachbarn (Speichen): (0, 2), (-1.732, -1), (1.732, -1).
- Feld: flache Oberseite, TileFilling-Sprite 1.08 × 0.937 Einheiten, Farbe (0.620, 0.635, 0.655); Rand TileBorder 1.17 × 1.01, Farbe 0.547 grau. Speichen-Farbe grün (0.364, 0.713, 0.336). Feld blinkt beim Tippen weiß (0.5 s).
- Zentrum: CircleFilling, Durchmesser 1.3, grün (0.325, 0.635, 0.300).
- Karte pendelt: Rotation z = sin(t·0.15)·10°.
- Kamera orthografisch, halbe Höhe = max(3.4/aspect, 5.6); Hintergrund (0.212, 0.243, 0.243), Ambient (0.212, 0.227, 0.259), weißes Richtungslicht.

## Warteschlange (SelectionManager)
5 Plätze bei y = 4.5. Nächstes Objekt groß (Kreis Ø 1.7, grün, bei x = 2.0), die 4 folgenden klein (Ø 0.9) bei x = -2.35, -1.35, -0.35, 0.65 (ganz links = am weitesten hinten). Platzhalter: CircleFilling grün + Ring dunkel.

## Animation
combiningTime 0.3 s (beim Aufbau 0.05 s). Ease-out-Kurve mit Keys (0,0) (0.599,0.957) (1,1). Objekte erscheinen per Scale-up an ihrem Feld.

## Darstellung der Objekte (3D, Outline-Shader = vergrößerte Rückseite in Outline-Farbe)
- Sternenstaub: Partikelwolke (hell additiv + dunkel), Icon `Stardust.png`.
- Asteroid: Icosphere r 0.25, Textur AstroidTexture, Tint (0.828,0.702,0.566), Outline gleiche Farbe, 0.2.
- Mond: Kugel 0.30, MoonTexture, Emission 0.14, Outline (0.81,0.81,0.81) 0.2.
- Planet: Kugel 0.35, PlanetTexture, Outline (0.38,0.506,0.875) 0.15, 15° geneigt.
- Gasplanet: Kugel 0.375, GasPlanetTexture, Tint (0.831,0.723,0.562), Torus-Ring, Outline (0.905,0.926,0.538) 0.15.
- Sonne: Kugel 0.45, Emission SunTexture × (1,0.833,0.287), Glüh-Partikel (SunParticle).
- Schwarzes Loch: schwarze Kugel 0.2, Outline weiß 0.2, Partikelring + Jets oben/unten.
- Galaxie: schwarzer Kern 0.075, Outline (1,0.941,0.61) 0.5, großer Partikelring.
Alle Objekte rotieren (Rotate-Skripte, ca. 10–65 °/s).

## UI (englische Originaltexte)
- Spiel: schwarzer Balken oben (14 % Höhe, Alpha 0.35): Pokal + Score (blau 0.389,0.536,0.735), Krone + Highscore (gelb 0.735,0.726,0.389), Uhr + Zeit, Icon des nächsten Levels + Differenz zur Bestzeit (schneller grün 0.24,0.816,0.24 / langsamer rot 0.846,0.28,0.28), Pause-Knopf rechts (→ Menü). Schrift: Roboto Bold.
- Menü: Titelbalken mit Logo `SpaceEvolutuon.png`, Text "Create a BLACK HOLE!" (BLACK HOLE gelb #FFED00); Highscore mit Krone; Bestzeiten pro Level-Icon; Play-Knopf (wackelt), Restart-Knopf nur bei gespeichertem Spiel; unten Musik/SFX-Schalter und "?" (Tutorial).
- Meldungen: Tutorial (`TutorialScreen Small RS.png`, "Combine!" / "Level Up!", "Create a BLACK HOLE in the center to WIN!"), "Game Over" + "Try Again!", "YOU WIN!" + "You created a BLACK HOLE! Now continue and improve your highscore."
- Spielstand-Speicherung: Score, Zeit, Level, Belegung, Warteschlange, Highscore, Bestzeiten je Level, Sound-Einstellungen → im Browser per localStorage.
- Monetarisierung (100 Züge, Werbung +40, Vollversion-Kauf) im Browser weglassen → wie Vollversion: unbegrenzte Züge mit Speedrun-Zeit.

## Version 1.4 (gegenüber 1.31)
- Spielwerte unverändert (Objekte, Karte, Wahrscheinlichkeiten, Zentrum, Animationen).
- Neues App-Icon (Schwarzes Loch); Logo nur enger zugeschnitten.
- Züge 120 statt 100, 50 statt 40 pro Werbevideo (nur Free-Version, im Browser nicht relevant).
- Eigene „Map Camera“ (orthografisch, Größe 4.7, Viewport y = -0.21) rendert Felder (Layer 8) und Objekte (Layer 9);
  `RotateMap` sitzt jetzt auf dieser Kamera. Effekt: Die Karte wird nach der Bildschirmhöhe skaliert und im unteren
  Bereich zentriert; auf sehr schmalen Bildschirmen würde sie seitlich abgeschnitten.

## Partikelsysteme (v1.4, aus den ParticleSystem-Komponenten)
Werte stehen in `web/js/particles.js` (`SYSTEMS`). Kurzfassung:
- Sternenstaub: „Bright Dust“ (additiv, 8/s, 2 s, Kugel r 0.75, Geschwindigkeit -0.45 → nach innen),
  „Dark Dust“ (alpha, 8/s, 1 s, Kugel r 0.2, nach außen). Farben zufällig aus Magenta/Schwarz/Blau/Navy-Verlauf.
- Sonne: „SphereEffect“ (50 Wolken, Größe 4 × 0.45, auf der Oberfläche), „Border“ (Wolkenring r 1.1 × 0.45).
- Schwarzes Loch: Scheibe (30/s, 3 s, nur Welt-Trails, Farbe weiß → orange → blaugrün), zwei Jets (2/s, 5 s, Trails).
- Galaxie: 15/s, 20 s, driftet nach außen, 70 % mit Welt-Trails (alpha), Farbverlauf rosa → blau → gelb → rot.
- Verbindung Zentrum ↔ Nachbar: 100/s Funken (dunkelrot bis gelb) entlang der Linie.
- Punkte: weißer bis cyanfarbener Fleck mit 0.2 s Trail.
- Hintergrund: 20/s Staubpunkte, 10 s Lebensdauer, flackernd.
- Rotationen (Rotate): Asteroid 80°/s um (0,1,-0.5), Mond 30°/s um (0.2,1,0), Planet 30 + 60°/s, Gasplanet 35 + 65°/s,
  Sonne 10°/s, Schwarzes Loch 25°/s (Ring 50°/s), Galaxie 10°/s (Ring 10°/s).
