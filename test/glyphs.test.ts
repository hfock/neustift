import { expect, test } from "bun:test";
import { inkPoints, minDist, type Stroke } from "../src/geom";
import { GLYPHS, PLACEHOLDER, cutTop, defaults, descOf, inRange, type GlyphDef, type Params } from "../src/glyphs";
import { barLink, instance } from "../src/rules";
import { FLAECHE_1902 as S } from "../src/style";

const ALL = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜẞ"];
const DIGITS = [..."0123456789"];
const MARKS = [...".,:;!?-–()/&'’\"„“‚‘«»€%@#+=*§…"]; // Spec M2 §3: Satz-Grundset und Plakat-Zeichen
const HAF = "\uE000";
const LOWER = [..."abcdefghijklmnopqrstuvwxyzäöüß"];
const ink = (st: Stroke[]) => st.flatMap((x) => inkPoints(x, S.stroke / 2));
const kinds = (c: string, p: Params = {}) =>
  GLYPHS[c].docks({ ...defaults(GLYPHS[c]), ...p }, S).map((d) => d.kind + ("side" in d ? ":" + d.side : ""));

/** Alle Kombinationen aus Minimal-, Start- und Maximalwert jedes Reglers. */
function variants(g: GlyphDef): Params[] {
  return Object.entries(g.params).reduce<Params[]>(
    (out, [k, r]) => out.flatMap((p) => [...new Set([r.min, r.def, r.max])].map((v) => ({ ...p, [k]: v }))),
    [{}],
  );
}

test("alle Versalien, Umlaute und ẞ sind entworfen", () => {
  expect(ALL.filter((c) => !GLYPHS[c])).toEqual([]);
});

test("Ziffern, Satz- und Plakat-Zeichen und das Monogramm sind entworfen", () => {
  expect([...DIGITS, ...MARKS, HAF].filter((c) => !GLYPHS[c])).toEqual([]);
});

test("cutTop: eigene Oberkante vor Höhenregler, sonst Versalhöhe × h, ohne h volle Höhe", () => {
  expect(cutTop(GLYPHS.V, { ...defaults(GLYPHS.V), h: 0.7 }, S)).toBeCloseTo(490);
  expect(cutTop(GLYPHS[","], {}, S)).toBe(S.capHeight);
  expect(cutTop({ ...GLYPHS.V, top: (s) => s.xHeight }, { ...defaults(GLYPHS.V), h: 0.7 }, S)).toBe(300);
});

test("Tinte bleibt endlich und im Buchstabenfeld (Höhe, x ≥ linker Bezug)", () => {
  const bad = new Set<string>();
  for (const g of [...[...ALL, ...LOWER, ...DIGITS, ...MARKS, HAF].map((c) => GLYPHS[c]), PLACEHOLDER])
    for (const p of variants(g)) {
      const top = S.capHeight * (p.h ?? 1), bottom = -descOf({ def: g, p }); // Satzzeichen ohne Höhenregler: volle Höhe; Komma und Kleinbuchstaben-Klammer mit Unterlänge
      const stretched = p.tail < (g.params.tail?.def ?? -Infinity); // nach links verlängerte Unterlänge (g, j, y): ragt gewollt über den linken Bezug
      for (const q of ink(g.draw(p, S))) {
        // Füße und Spitzen reichen bis eine Strichstärke über Grund- und Oberkante hinaus, der Renderer schneidet dort waagrecht ab;
        // die waagrechte Schnittkante flacher Beine (X, Y breit und kurz) ragt dabei bis Strich/2 ÷ sin θ ≈ 1,05 Striche vor x = 0
        const ok = Number.isFinite(q.x) && Number.isFinite(q.y) && q.y >= bottom - S.stroke && q.y <= top + S.stroke;
        if (!ok || !((stretched || q.x >= -1.1 * S.stroke) && q.x < 1000)) bad.add(`${g.char} ${JSON.stringify(p)}`);
      }
    }
  expect([...bad]).toEqual([]);
});

test("Andockstellen der Vorlage-Buchstaben", () => {
  expect(kinds("F")).toContain("zone");
  expect(kinds("L")).toContain("foot");
  expect(kinds("E")).toContain("foot");
  expect(kinds("C")).toContain("terminal");
  expect(kinds("G")).toContain("terminal");
  expect(kinds("Ä")).toContain("leg:left");
  expect(kinds("H")).toContain("stem:right");
  expect(kinds("N")).toContain("stem:right");
  expect(GLYPHS.I.docks(defaults(GLYPHS.I), S)).toEqual([{ kind: "stem", side: "left", x: 0, solo: true }]);
});

test("Balkenlinien: E/F/H oben, A unten", () => {
  const barY = (c: string) => (GLYPHS[c].docks(defaults(GLYPHS[c]), S).find((d) => d.kind === "bar") as { y: number }).y;
  expect(barY("E")).toBe(S.barHigh);
  expect(barY("F")).toBe(S.barHigh);
  expect(barY("H")).toBe(S.barHigh);
  expect(barY("A")).toBe(S.barLow);
});

test("Ä: zwei Punkt-Quadrate innerhalb der Versalhöhe", () => {
  const strokes = GLYPHS["Ä"].draw(defaults(GLYPHS["Ä"]), S);
  const dots = strokes.slice(-2);
  expect(strokes.length).toBe(4);
  for (const d of dots) {
    expect(d.start.y).toBe(S.capHeight - S.stroke / 2);
    expect((d.segs[0] as { p: { x: number } }).p.x - d.start.x).toBe(S.stroke);
  }
});

test("inRange: Toleranz relativ zum Spielraum", () => {
  expect(inRange(GLYPHS.L, { h: 0.6, foot: 0 })).toBe(true);
  expect(inRange(GLYPHS.L, { h: 0.59, foot: 0 })).toBe(false);
  expect(inRange(GLYPHS.L, { h: 1, foot: 321 })).toBe(false);
});

test("Füße von A, Ä und K reichen knapp unter die Grundlinie (waagrechter Schnitt im Renderer), K-Arm und -Bein sind eigene Striche", () => {
  for (const c of ["A", "Ä", "K"]) {
    const ys = GLYPHS[c].draw(defaults(GLYPHS[c]), S).flatMap((st) => [st.start.y, ...st.segs.map((g) => g.p.y)]);
    expect(Math.min(...ys)).toBeLessThan(0);
    expect(Math.min(...ys)).toBeGreaterThan(-S.stroke / 2);
  }
  expect(GLYPHS.K.draw(defaults(GLYPHS.K), S).length).toBe(3);
});

test("Andockstellen der übrigen Versalien", () => {
  expect(kinds("T")).toEqual(["terminal"]); // Arm mündet in den Nachbarstamm (TH, TE)
  expect(kinds("Z")).toEqual(["foot"]);
  expect(kinds("Q")).toEqual(["foot"]);
  expect(kinds("R")).toEqual(["stem:left", "leg:right", "bar"]);
  expect(kinds("R", { bar: 1 })).toEqual(["stem:left", "bar"]); // Knoten unten: Bein zu flach zum Füße-Teilen
  expect(kinds("U")).toEqual(["stem:left", "stem:right"]);
  expect(kinds("Ü")).toEqual(["stem:left", "stem:right"]);
  expect(kinds("M")).toEqual(["stem:left", "stem:right", "bar"]);
  expect(kinds("W")).toEqual(["stem:left", "stem:right", "bar"]);
  expect(kinds("B")).toEqual(["stem:left", "bar"]);
  expect(kinds("P")).toEqual(["stem:left", "bar"]);
  expect(kinds("ẞ")).toEqual(["stem:left"]);
  for (const c of ["J", "S", "V", "Ö"]) expect(kinds(c)).toEqual([]);
});

test("Knoten auf den Balkenlinien: B P R W X Y oben, M unten; sie verbinden nicht mit Nachbarn", () => {
  const knotY = (c: string) => (GLYPHS[c].docks(defaults(GLYPHS[c]), S).find((d) => d.kind === "bar") as { y: number }).y;
  for (const c of ["B", "P", "R", "W", "X", "Y"]) expect(knotY(c)).toBe(S.barHigh);
  expect(knotY("M")).toBe(S.barLow);
  const i = (c: string) => instance(GLYPHS[c], defaults(GLYPHS[c]), S);
  expect(barLink(i("P"), 0, i("E"), 290, S)).toBeNull();
  expect(barLink(i("H"), 0, i("B"), 300, S)).toBeNull();
});

test("Ö und Ü: Punkt-Quadrate auf der Oberlinie; Ö-Punkte halten armGap Abstand zum Bogen", () => {
  for (const c of ["Ö", "Ü"])
    for (const d of GLYPHS[c].draw(defaults(GLYPHS[c]), S).slice(-2)) {
      expect(d.start.y).toBe(S.capHeight - S.stroke / 2);
      expect((d.segs[0] as { p: { x: number } }).p.x - d.start.x).toBe(S.stroke);
    }
  for (const w of [210, 240, 300]) {
    const st = GLYPHS["Ö"].draw({ h: 1, w }, S);
    expect(minDist(ink(st.slice(0, 1)), 0, ink(st.slice(1)), 0, 100)).toBeGreaterThanOrEqual(S.armGap - 1);
  }
});

test("J: der Haken läuft nie zurück (Anfang nie unter dem Bogenanfang)", () => {
  for (const p of variants(GLYPHS.J)) {
    const [st] = GLYPHS.J.draw(p, S);
    expect(st.start.y).toBeGreaterThanOrEqual((st.segs[0] as { p: { y: number } }).p.y);
  }
});

test("Punkt: Quadrat in Strichstärke auf der Grundlinie; Komma und tiefe Anführungszeichen mit Unterlänge 130", () => {
  const ys = (c: string) => ink(GLYPHS[c].draw(defaults(GLYPHS[c]), S)).map((q) => q.y), xs = (c: string) => ink(GLYPHS[c].draw(defaults(GLYPHS[c]), S)).map((q) => q.x);
  expect([Math.min(...ys(".")), Math.max(...ys(".")), Math.min(...xs(".")), Math.max(...xs("."))]).toEqual([0, S.stroke, 0, S.stroke]);
  for (const c of [",", ";", "„", "‚"]) {
    expect(GLYPHS[c].desc).toBe(130);
    expect(Math.min(...ys(c))).toBeLessThan(-S.stroke); // reicht wirklich unter die Grundlinie
    expect(Math.min(...ys(c))).toBeGreaterThanOrEqual(-130);
  }
  for (const c of [...".:!?-–'\"’‘“«»…"]) expect(GLYPHS[c].desc).toBeUndefined();
});

test("Monogramm HAF: zwei H-Stämme über die volle Höhe, A frei dazwischen, gemeinsamer Balken auf der unteren Linie, F-Arme rechts", () => {
  const g = GLYPHS[HAF], p = defaults(g), st = g.draw(p, S), t = S.capHeight - S.stroke / 2;
  const vertical = (x: number) => st.some((q) => q.start.x === x && q.start.y === 0 && q.segs[0].p.x === x && q.segs[0].p.y === S.capHeight);
  expect(vertical(0)).toBe(true);
  expect(vertical(p.w)).toBe(true);
  const a = st.find((q) => q.segs.length === 3 && q.segs[0].p.y === t && q.segs[1].p.y === t)!; // A: Bein, flache Spitze, Bein
  expect(a.start.x).toBeGreaterThan(S.stroke); // Füße frei von den Stämmen
  expect(a.segs[2].p.x).toBeLessThan(p.w - S.stroke);
  expect(st.some((q) => q.start.x === 0 && q.start.y === S.barLow && q.segs[0].p.x === p.w)).toBe(true); // Balken von Stamm zu Stamm
  expect(Math.max(...ink(st).map((q) => q.x))).toBeGreaterThan(p.w + 200);
});

test("Stamm ohne Stufe: Fahne der 1 und Diagonale der 4 erreichen die Oberkante an der linken Stammkante", () => {
  for (const [c, stem] of [["1", (p: Params) => p.w], ["4", (p: Params) => 0.72 * p.w]] as const) {
    const g = GLYPHS[c], p = defaults(g), edge = stem(p) - S.stroke / 2;
    const near = inkPoints(g.draw(p, S)[1], S.stroke / 2, 1).filter((q) => Math.abs(q.x - edge) < 1.5);
    expect(Math.max(...near.map((q) => q.y))).toBeGreaterThanOrEqual(S.capHeight - 1);
  }
});

test("Komma und Anführungszeichen: der Schwanz beginnt im Punkt, keine Stufe neben dem Quadrat", () => {
  for (const c of [",", "’"]) {
    const [dot, tail] = GLYPHS[c].draw({}, S), cx = dot.start.x + S.stroke / 2, y0 = dot.start.y - S.stroke / 2;
    const beside = ink([tail]).filter((q) => q.y >= y0 && q.y <= y0 + S.stroke && q.x > cx + S.stroke / 2 + 0.5);
    expect(beside).toEqual([]);
  }
});

test("Klammern enden waagrecht in Ober- und Grundlinie, ohne Beschnitt", () => {
  for (const c of ["(", ")"]) {
    const ys = ink(GLYPHS[c].draw({}, S)).map((q) => q.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.5);
    expect(Math.max(...ys)).toBeLessThanOrEqual(S.capHeight + 0.5);
  }
});

test("@: die Beine des kleinen A laufen unten lotrecht aus (waagrechter Fuß ohne Beschnitt)", () => {
  const legs = GLYPHS["@"].draw({}, S).find((q) => q.segs.length === 5)!; // Fuß, Bein, Spitze, Bein, Fuß
  expect(legs.segs[0].p.x).toBe(legs.start.x);
  expect(legs.segs[4].p.x).toBe(legs.segs[3].p.x);
});

const ASC = new Set([..."bdfhklß"]), DESC = new Set([..."gjpqy"]);

test("Kleinbuchstaben a–z, äöü, ß sind entworfen, ohne Höhenregler", () => {
  expect(LOWER.filter((c) => !GLYPHS[c])).toEqual([]);
  expect(LOWER.filter((c) => GLYPHS[c]?.params.h)).toEqual([]);
});

test("Kleinbuchstaben: Tinte zwischen Unterlänge und Oberkante, x-Höhe 300", () => {
  for (const c of LOWER) {
    const g = GLYPHS[c];
    for (const p of variants(g)) {
      const pts = ink(g.draw(p, S)).filter((q) => q.y >= -(g.desc ?? 0) - 0.5 && q.y <= cutTop(g, p, S) + 0.5);
      const top = Math.max(...pts.map((q) => q.y)), bottom = Math.min(...pts.map((q) => q.y));
      const want = ASC.has(c) ? S.capHeight : c === "t" ? 470 : c === "i" || c === "j" || "äöü".includes(c) ? S.xHeight + 90 + S.stroke / 2 : S.xHeight;
      expect([c, Math.abs(top - want) <= (c === "t" ? 30 : 1.5)]).toEqual([c, true]);
      expect([c, Math.abs(bottom - (DESC.has(c) ? -130 : 0)) <= 1.5]).toEqual([c, true]);
      // Ausnahme: die nach links verlängerte Unterlänge (g, j, y unter dem Nachbarn, Stufe 2) ragt gewollt über den linken Bezug
      const stretched = p.tail < (g.params.tail?.def ?? -Infinity);
      if (!stretched) expect([c, Math.min(...pts.map((q) => q.x)) >= -1.1 * S.stroke]).toEqual([c, true]);
    }
  }
});

test("Punkte über der x-Höhe: Quadrat, Mitte 90 darüber, armGap Luft zur übrigen Tinte", () => {
  for (const c of [..."ijäöü"]) {
    const g = GLYPHS[c], st = g.draw(defaults(g), S);
    const dots = st.filter((x) => Math.abs(x.start.y - (S.xHeight + 90)) < 0.5 && x.segs.length === 1);
    expect([c, dots.length]).toEqual([c, c === "i" || c === "j" ? 1 : 2]);
    const rest = ink(st.filter((x) => !dots.includes(x))), dotInk = ink(dots);
    expect([c, minDist(rest, 0, dotInk, 0, 200) >= S.armGap]).toEqual([c, true]);
  }
});

test("Andockstellen der Kleinbuchstaben", () => {
  expect(kinds("a")).toEqual(["stem:right"]);
  expect(kinds("c")).toEqual(["terminal"]);
  expect(kinds("f")).toEqual(["cross"]);
  expect(kinds("t")).toEqual(["cross"]);
  expect(kinds("g")).toEqual(["tail"]);
  expect(kinds("j")).toEqual(["tail"]);
  expect(kinds("y")).toEqual(["tail"]);
  expect(kinds("h")).toEqual(["stem:left", "stem:right"]);
  expect(kinds("n")).toEqual(["stem:left", "stem:right"]);
  expect(kinds("i")).toEqual(["stem:left"]);
});

test("f und t: Querstrich ab x = 0, Stamm bei 50, Querstrich ohne Verlängerung bis 150 (links 50, rechts 100)", () => {
  for (const c of ["f", "t"]) {
    const g = GLYPHS[c], p = defaults(g), [d] = g.docks(p, S) as { x0: number; x1: number }[];
    expect([c, d.x0, d.x1]).toEqual([c, 0, 150]);
    expect(g.draw(p, S).some((st) => st.start.x === 50 && st.start.y === 0)).toBe(true); // Stamm von der Grundlinie
    expect((g.extend!(p, 200) as Params).cross).toBe(50);
  }
  expect(GLYPHS.f.trimTop!(defaults(GLYPHS.f), 130).hook).toBe(80); // Haken vom Stamm bei 50 gemessen
});

test("Regel-Haken der Kleinbuchstaben: Wert rein, Regler und Andockstelle raus", () => {
  const d = (c: string) => defaults(GLYPHS[c]);
  const dock = (c: string, p: Params) => GLYPHS[c].docks(p, S)[0] as unknown as Record<string, number>;
  // c: Bogenende bis x, nie kürzer als ohne Verbindung
  const c = GLYPHS.c.close!(d("c"), 200);
  expect(c).toEqual({ ...d("c"), term: 40 });
  expect(dock("c", c).topEnd).toBe(200);
  expect(GLYPHS.c.close!(d("c"), 100).term).toBe(0);
  // f, t: Querstrich bis x, nie kürzer als 150
  for (const ch of ["f", "t"]) {
    const p = GLYPHS[ch].extend!(d(ch), 300);
    expect(p).toEqual({ ...d(ch), cross: 150 });
    expect(dock(ch, p).x1).toBe(300);
    expect(GLYPHS[ch].extend!(d(ch), 100).cross).toBe(0);
  }
  // g, j, y: Schwanz bis x nach links, nie weiter nach rechts als ohne Verbindung
  for (const [ch, end] of [["g", 40], ["j", 20], ["y", 0]] as const) {
    const p = GLYPHS[ch].tailTo!(d(ch), -150);
    expect(p).toEqual({ ...d(ch), tail: -150 });
    expect(dock(ch, p).end).toBe(-150);
    expect(GLYPHS[ch].tailTo!(d(ch), 100).tail).toBe(end);
  }
  // f: Haken höchstens bis end (Stamm bei 50), nie kürzer als 45, nie länger als vorher
  expect(GLYPHS.f.trimTop!(d("f"), 130)).toEqual({ ...d("f"), hook: 80 });
  expect(GLYPHS.f.trimTop!(d("f"), 60).hook).toBe(45);
  expect(GLYPHS.f.trimTop!(d("f"), 500).hook).toBe(110);
});

test("k: Arm schräg, auf der x-Höhe waagrecht beschnitten; außer dem Stamm keine Tinte über der x-Höhe", () => {
  for (const p of variants(GLYPHS.k)) {
    const st = GLYPHS.k.draw(p, S), arm = st.find((x) => x.top !== undefined)!;
    expect(arm.top).toBe(S.xHeight);
    expect(arm.segs.length).toBe(1); // eine Gerade, keine waagrechte Fahne
    const cut = (x: Stroke) => inkPoints(x, S.stroke / 2, 1).filter((q) => q.y <= (x.top ?? Infinity) + 0.5);
    const rest = st.filter((x) => Math.max(x.start.y, ...x.segs.map((g) => g.p.y)) < S.capHeight); // ohne Stamm
    expect(Math.max(...rest.flatMap(cut).map((q) => q.y))).toBeLessThanOrEqual(S.xHeight + 0.5);
    const edge = cut(arm).filter((q) => q.y >= S.xHeight - 2).map((q) => q.x);
    expect(Math.max(...edge) - Math.min(...edge)).toBeGreaterThan(S.stroke / 2); // waagrechte Schnittkante, kein schräges Ende
  }
});

test("ß wie ẞ: eckiges Dach auf 700, kein Bogen im oberen Viertel", () => {
  for (const p of variants(GLYPHS["ß"])) {
    const st = GLYPHS["ß"].draw(p, S);
    expect(Math.max(...ink(st).map((q) => q.y))).toBeCloseTo(S.capHeight, 5);
    const curvesUp = st.flatMap((x) => x.segs).filter((g) => g.k === "C" && Math.max(g.c1.y, g.c2.y, g.p.y) > 0.75 * S.capHeight);
    expect(curvesUp).toEqual([]);
  }
});
