# Neustift (Projekt HabUndGutFont)

Display-Schrift im Duktus der Wiener Moderne um 1902 (Vorlage: Schriftzug „DIE FLÄCHE“, *Die Fläche* Bd. I S. 97) und eine Werkstatt, die Text zu ineinandergreifenden Schriftzügen setzt.

Der Name kommt von der Neustiftgasse 32–34 in Wien, ab 1903 Sitz der Wiener Werkstätte. Bis 2026-10-09 hieß die Schrift „KAIROS Font“; die Dokumente unter `docs/` verwenden noch den alten Namen.

Live: https://font.fock.rocks (Werkstatt) und https://font.fock.rocks/font (Font-Probe, Download).

- Spec: `docs/superpowers/specs/2026-10-06-kairos-font-design.md`
- Plan M1: `docs/superpowers/plans/2026-10-06-kairos-font-m1.md`
- Übrige Versalien (M2, Teil 1): `docs/superpowers/specs/2026-10-07-kairos-versalien.md`
- Spec M2 (Font-Datei, Ziffern, Zeichen, Ligaturen): `docs/superpowers/specs/2026-10-07-kairos-font-m2-design.md`
- Spec M4 (Kleinbuchstaben): `docs/superpowers/specs/2026-10-09-neustift-m4-kleinbuchstaben-design.md`
- Spec M3 (Blöcke): `docs/superpowers/specs/2026-10-11-neustift-m3-mehrzeilig-design.md` – Enter bricht um, Regler „Seitenverhältnis“ verteilt die Wörter auf bündige, eng verschränkte Zeilen (`layoutText`); Vorlage „HAGEN AAD FOCK (Block)“. Der Font bleibt einzeilig.

## Befehle

| Befehl | Wirkung |
|---|---|
| `bun run dev` | App auf http://localhost:3457, Font-Probe auf http://localhost:3457/font (nach `bun run font`) |
| `bun test` | alle Prüfungen |
| `bun run typecheck` | TypeScript prüfen |
| `bun run sheet` | Prüfblätter nach `out/` (PNG, wenn Inkscape installiert ist) |
| `bun run font` | Font bauen und prüfen: `dist/Neustift-Regular.otf` und `.woff2` (braucht uv; beim ersten Mal Netz für die Python-Pakete) |
| `bun run web` | statische Seite nach `web/`: Werkstatt, Font-Probe, OTF, WOFF2 und OFL zum Herunterladen (Ausrollen: `stacks/neustift/README.md` im cf-ventures-Repo) |
| `uv run tools/overlay.py` | Referenz-Overlay neu erzeugen, Werte für `presets/die-flaeche.json` ausgeben |

## Aufbau

| Datei | Aufgabe |
|---|---|
| `src/geom.ts` | Striche, Abtastung, Tintenprofile, Abstände |
| `src/style.ts` | Stil „Fläche 1902“ (alle Maße) |
| `src/glyphs.ts` | Buchstaben als Skelette mit Reglern und Andockstellen |
| `src/rules.ts` | Verbindungen a–e, Kollision, Armkürzung |
| `src/engine.ts` | Strahlsuche, Bewertung (`WEIGHTS`), Pins, Zielbreite |
| `src/presets.ts` | Prüfung von Vorlagen und Browser-Speicher |
| `src/render.ts` | Layout → SVG |
| `src/fontdata.ts` | Font-Daten aus der Engine: Glyphen, calt-Varianten, Unterschneidung, Feature-Datei, Sollwerte |
| `src/ui.ts` + `index.html` | Oberfläche |
| `src/fonttest.ts` + `font.html` | Font-Probe: Webfont neben dem Engine-Ergebnis |
| `presets/` | mitgelieferte Vorlagen |
| `tools/` | Prüfblatt (`sheet.ts`), Referenz-Overlay (`overlay.py`), Font-Export (`export-font.ts`), Font-Build (`build_font.py`), Font-Prüfung (`test_font.py`) |

## Font benutzen

- Installieren: `dist/Neustift-Regular.otf` per Doppelklick in die Schriftsammlung. Für eine neue Fassung die alte Fassung dort vorher entfernen (auch unter dem früheren Namen „KAIROS Font“), sonst zeigt macOS weiter die alte aus dem Zwischenspeicher.
- Verbindungen (`calt`) und der Schriftzug „HAGEN AAD FOCK“ (`liga`) sind immer an. Zeigt ein Programm keine Verbindungen, die kontextbedingten Varianten in seinen Typografie-Einstellungen einschalten.
- Kleinbuchstaben a–z, ä, ö, ü, ß (x-Höhe 300, Oberlängen auf Versalhöhe 700) verschränken sich wie die Versalien: f und t teilen den Querstrich („Stift“), c greift in das h („ich“), g, j und y reichen unter den vorigen Buchstaben („Hagen“), das a rückt unter den T-Arm („Tafel“). Vor hohen Nachbarn wie T, V oder ? endet der f-Haken kürzer; vor l, h, k bleibt er mit normalem Abstand („Pflicht“).
- Monogramm HAF: „HAF“ als eigenes Wort mit bedingten Ligaturen (`dlig`, in macOS „Seltene Ligaturen“) oder das Zeichen U+E000.

## Bekannte Grenzen

- Wortabstand: der Font setzt Wörter nach den Glyphenkästen (Leerzeichen fest), die App nach der Tinte, aber nie enger als der Font. Wo die Tinte mehr Luft verlangt (etwa „DI“ über eine Wortgrenze), steht der Font bis zu ~20 Einheiten enger.
- Verbindungen: der Font entscheidet von links nach rechts, die Engine sucht die beste Lösung; selten weicht das ab (etwa „VARIATIONSKOEFFIZIENT“). Zweimal verschachteln (FF vor manchen Satzzeichen) kann der Font nicht.
- Kleinbuchstaben: auch hier nur eine Verschachtelung (FF vor einem Buchstaben), und einige seltene Ketten setzt der Font anders als die App (etwa eine Unterlänge hinter Apostroph oder Strich wie in „h’g“ oder „E-g“).

## Lizenz

- Font (Neustift und die Glyphen-Daten in `src/glyphs.ts`): SIL Open Font License 1.1, siehe `OFL.txt`
- Code: MIT, siehe `LICENSE`
- `reference/`: Aufnahmen des Blatts „DIE FLÄCHE“ (um 1902, Gestalter unbekannt, gemeinfrei), nicht Teil dieser Lizenzen
