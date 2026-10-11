# Neustift – M3: mehrzeilig, Zielform, Name als Block

| | |
|---|---|
| Datum | 2026-10-11 |
| Projekt | HabUndGutFont (`~/Projekte/HabUndGutFont`), Schrift „Neustift“ |
| Grundlage | Spec M1 `2026-10-06-kairos-font-design.md` (§3 Zielform, §4 M3) |
| Umfang | App und Engine; der Font bleibt einzeilig |
| Status | freigegeben (Hagen, 2026-10-11) |

## 1. Ziel

Text lässt sich als Block setzen: mehrere Zeilen, alle gleich breit, eng übereinander, in einem gewählten Seitenverhältnis. „HAGEN AAD FOCK“ bei 2:1 wird HAGEN über AAD FOCK.

## 2. Ausgangslage

- main `57bf0b1` (M4 und neue Webseite live): eine Zeile je Layout (`layoutLine`), Zielbreite über `fitWidth` (Breitenregler, Wortabstand, Verbindungen), Varianten 1–6, Pins je Buchstabe (Index im Text) und je Grenze.
- Das Textfeld ist einzeilig (`<input id="text">`).

## 3. Entscheidungen (Hagen, 2026-10-11)

| Thema | Entscheidung |
|---|---|
| Umbruch | beides: Enter erzwingt einen Umbruch; ohne Enter verteilt die Engine die Wörter selbst |
| Zielform | Seitenverhältnis (Breite : Höhe, z. B. 2:1, 1:1, 2:3); „frei“ = eine Zeile wie heute |
| Zeilenbreite | jede Zeile auf die Blockbreite, wie heute die Zielbreite (Breitenregler, Wortabstand, Verbindungen); alle Zeilen gleich hoch |
| Zeilen übereinander | eng (Variante B, `m3/zeilen.png`): jede Zeile rückt hoch, bis ihre Tinte zur Zeile darüber den Buchstabenabstand hat |
| Name als Block | mitgelieferte Vorlage „HAGEN AAD FOCK (Block)“ bei 2:1, über Pins verfeinerbar |
| Font | bleibt einzeilig; Zeilen setzt das Programm (Pages, Browser) |

## 4. Verhalten

### 4.1 Eingabe

- Das Textfeld wird mehrzeilig (Textbereich); Enter fügt einen Zeilenumbruch ein.
- Neuer Regler „Seitenverhältnis“ mit den Stufen frei, 3:1, 2:1, 3:2, 1:1, 2:3, 1:2. Bei „frei“ und ohne Enter bleibt alles wie heute (eine Zeile).
- Pins behalten ihren Index im Text; ein Zeilenumbruch zählt wie ein Leerzeichen als Zeichen ohne Glyphe.

### 4.2 Umbruch

- Mit Enter: Zeilen wie getippt; das Seitenverhältnis wirkt dann nur noch auf die Breite (keine weiteren Umbrüche).
- Ohne Enter und mit Seitenverhältnis: die Engine probiert alle Umbrüche an Wortgrenzen (höchstens 6 Zeilen) und wählt den mit der besten Bewertung:
  - Abweichung des Blocks vom Seitenverhältnis (stark gewichtet: „HAGEN AAD FOCK“ 1:1 → HAGEN / AAD / FOCK, 2:1 → HAGEN / AAD FOCK),
  - Ungleichheit der natürlichen Zeilenbreiten (wie stark eine Zeile gedehnt werden müsste),
  - Kosten der Verbindungen wie bisher.
- Wörter werden nie getrennt.

### 4.3 Breite

- Blockbreite = breiteste Zeile in ihrer natürlichen Breite. Das Seitenverhältnis wirkt über die Wahl des Umbruchs, nicht über zusätzliche Breite.
- Jede kürzere Zeile wird mit `fitWidth` auf die Blockbreite gebracht (Breitenregler, Wortabstand, Verbindungen), der Rest durch Sperren ohne Obergrenze: der Block ist immer bündig (Hagen, Sichtprüfung 2026-10-11, „DIE“ über „FLÄCHE“).
- Bräuchte eine Zeile mit Verbindungen mehr als den doppelten Buchstabenabstand Sperrung je freier Lücke, werden ihre automatischen Verbindungen gelöst und die Sperrung gleichmäßig verteilt (FOCK → F – O – C – K statt „Fo   CK“). Gepinnte Verbindungen bleiben.
- Nur eine Zeile, die gar nicht gesperrt werden kann (z. B. ein einzelner Buchstabe), zeigt den bestehenden Hinweis zur Zielbreite.

### 4.4 Zeilenabstand

- Die erste Zeile steht wie heute. Jede weitere rückt so weit hoch, bis die kleinste senkrechte Lichtweite zwischen ihrer Tinte und der Tinte der Zeile darüber dem Buchstabenabstand (`gap`, 56) entspricht (kein Überlappen; gemessen an der sichtbaren, beschnittenen Tinte).
- Unterlängen der oberen Zeile und Oberlängen der unteren greifen so ineinander, ohne sich zu berühren.

### 4.5 Varianten, Pins, Export

- Varianten 1–6 sind ganze Blöcke (Umbruch und Verbindungen).
- Pins und Verbindungs-Menü wirken wie bisher je Buchstabe und Grenze.
- SVG- und PNG-Export zeigen den ganzen Block mit Rand.

### 4.6 Vorlage

- Neue mitgelieferte Vorlage `presets/hagen-aad-fock-block.json`: Text „HAGEN AAD FOCK“, Seitenverhältnis 2:1, Verschränkung 0,5; Pin: G steckt im E (Verbindung `share term` an Grenze 2), Rest automatisch.

## 5. Tests und Abnahme

**Automatisch:**

- „HAGEN AAD FOCK“ bei 2:1 → zwei Zeilen „HAGEN“ / „AAD FOCK“, gleiche Breite (±1).
- Mit Enter „DIE\nFLÄCHE“ → genau zwei Zeilen wie getippt.
- Zeilenabstand: kleinste Lichtweite zwischen Zeile 1 und 2 = Buchstabenabstand (±1), nirgends kleiner.
- „frei“ ohne Enter → Ergebnis byte-gleich zu heute (SVG für einige Texte).
- Pins mit Index hinter einem Zeilenumbruch greifen am richtigen Buchstaben.
- Vorlage gültig (`cleanPreset`), alte gespeicherte Stände bleiben gültig.

**Sichtprüfung durch Hagen:** Prüfblatt mit „HAGEN AAD FOCK“ (2:1, 1:1), „DIE FLÄCHE“ (1:1), „Wiener Werkstätte“ (2:1, 2:3) und der Block-Vorlage; dann die App.

## 6. Nicht in M3

- Silbentrennung, Ausrichtung links/rechts/zentriert (Block ist immer volle Breite)
- Zeilen mit unterschiedlicher Größe (Variante „Zeile größer“ verworfen)
- Mehrzeiligkeit im Font
