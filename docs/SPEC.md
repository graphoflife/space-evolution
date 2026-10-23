# Space Evolution v1.31: ausgelesene Spezifikation für den Browser-Port

Quelle: Unity 2017.4.0f1 (Mono). C#-Code mit ILSpy dekompiliert, Werte aus den Szenen/Assets (Rohbytes) dekodiert.
Der Roh-Export (dekompilierter Code, Original-PNGs/WAVs) liegt lokal in `extracted/` und ist nicht Teil des Repos.
Musik: `music_menu.mp3` = "25_BlueWater Warning", `music_game.mp3` = "4 - Through The Mist".

Hinweis: Diese Datei beschreibt das Original. Die Browser-Version weicht bewusst ab (3er-Vorschau statt 5, zusätzliche Level, Bloom); siehe `README.md`.

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
