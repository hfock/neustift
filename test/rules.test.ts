import { expect, test } from "bun:test";
import { L, stroke } from "../src/geom";
import { GLYPHS, defaults } from "../src/glyphs";
import { TAIL_STEP, apply, barLink, collides, dock, instance, joinsFor, lightGap, spacing, trimTop, type Inst, type Join } from "../src/rules";
import { FLAECHE_1902 as S } from "../src/style";

const inst = (c: string, p = {}) => instance(GLYPHS[c], { ...defaults(GLYPHS[c]), ...p }, S);
/** Regel anwenden und beide Buchstaben neu vermessen. */
function join(j: Join, a: string, b: string): { l: Inst; r: Inst; dx: number } {
  const res = apply(j, inst(a), GLYPHS[b], defaults(GLYPHS[b]), S)!;
  expect(res).not.toBeNull();
  return { l: instance(GLYPHS[a], res.lp, S), r: instance(GLYPHS[b], res.rp, S), dx: res.dx };
}

test("joinsFor: welche Verbindungen an welchem Paar möglich sind", () => {
  const types = (a: string, b: string) => joinsFor(inst(a), inst(b)).map((j) => j.sub ?? j.type);
  expect(types("F", "L")).toEqual(["none", "nest"]);
  expect(types("L", "Ä")).toEqual(["none", "underrun"]);
  expect(types("C", "H")).toEqual(["none", "term"]);
  expect(types("H", "E")).toEqual(["none", "stem"]);
  expect(types("A", "A")).toEqual(["none", "leg"]);
  expect(types("H", "I")).toEqual(["none"]); // I ist ein einzelner Stamm: würde verschwinden
  expect(types("D", "I")).toEqual(["none"]);
});

test("a Verschachteln: L ≈ 70 % hoch, Lichtweite ≥ Mindestabstand, Mittelarm ragt über", () => {
  const { l, r, dx } = join({ type: "nest" }, "F", "L");
  expect(r.p.h).toBeCloseTo((S.barHigh - S.stroke / 2 - S.clearance) / S.capHeight);
  expect(r.p.h).toBeCloseTo(0.71, 2);
  expect(dx + r.prof.minX).toBeCloseTo(S.stroke / 2 + S.nestGap);
  expect(lightGap(l, 0, r, dx, 100)).toBeGreaterThanOrEqual(S.clearance - 3);
  const armEnd = 0.8 * l.p.w + l.p.arm;
  expect(armEnd).toBeCloseTo(dx + r.prof.minX + S.nestOverhang);
});

test("b Unterfahren: A-Bein endet über dem Fuß, Fuß läuft unter A", () => {
  const { l, r, dx } = join({ type: "underrun" }, "L", "Ä");
  expect(r.p.legL).toBeGreaterThan(S.stroke + S.clearance); // schräge Schnittkante ausgeglichen
  expect(lightGap(l, 0, r, dx, 100)).toBeGreaterThanOrEqual(S.clearance - 1);
  const footEnd = 200 + l.p.foot;
  expect(footEnd).toBeCloseTo(dx + r.p.w - S.footGap);
  expect(footEnd).toBeGreaterThan(dx + r.prof.minX + 2 * S.stroke);
});

test("c Strich teilen: C-Bogen endet auf dem H-Stamm (< 0,5 Einheiten), oben bleibt armGap", () => {
  const { l, dx } = join({ type: "share", sub: "term" }, "C", "H");
  expect(Math.abs(l.p.wb - dx)).toBeLessThan(0.5); // H-Stamm liegt bei dx + 0
  expect(dx - S.stroke / 2 - l.p.w).toBeCloseTo(S.armGap);
  expect(join({ type: "share", sub: "stem" }, "H", "E").dx).toBe(GLYPHS.H.params.w.def);
  expect(join({ type: "share", sub: "leg" }, "A", "A").dx).toBe(GLYPHS.A.params.w.def);
});

test("d Balken verbinden: AA mit gemeinsamen Füßen bekommt ein Verbindungsstück auf der unteren Linie", () => {
  const a = inst("A"), dx = a.p.w;
  const link = barLink(a, 0, a, dx, S)!;
  expect(link.start.y).toBe(S.barLow);
  expect(link.start.x).toBeLessThan((link.segs[0] as { p: { x: number } }).p.x);
  expect(barLink(inst("H"), 0, a, 400, S)).toBeNull(); // H oben, A unten
});

test("d Balken verbinden: Grenze ist der Buchstabenabstand, nicht der Wortabstand", () => {
  const a = inst("A");
  expect(barLink(a, 0, a, a.p.w, { ...S, wordGap: 40 })).not.toBeNull(); // Füße treffen sich: Lücke 51,8 ≤ 56
  expect(barLink(a, 0, a, a.p.w + 100, S)).toBeNull(); // Lücke 151,8 > 56
});

test("Kollision: Berührung erkannt, normaler Abstand frei", () => {
  const i = inst("I");
  expect(collides(i, 0, i, 30, S)).toBe(true);
  expect(collides(i, 0, i, 26 + S.gap, S)).toBe(false);
});

test("trimTop: oberer F-Arm endet armGap vor dem Nachbarn", () => {
  const f = inst("F", { top: 200 }), i = inst("I");
  const t = trimTop(f, 0, i, 400, S);
  expect(t.p.w + t.p.top).toBeCloseTo(400 - S.stroke / 2 - S.armGap, 0);
  expect(trimTop(f, 0, i, 2000, S)).toBe(f);
});

test("trimTop auch ohne Höhenregler (Kleinbuchstaben): Arm auf Versalhöhe endet armGap vor dem Nachbarn", () => {
  const top = S.capHeight - S.stroke / 2;
  const f = instance({ char: "f", params: { arm: { min: 0, def: 200, max: 200 } }, draw: (p) => [stroke(p.arm, top, L(0, top), L(0, 0))], docks: () => [], trimTop: (p, end) => ({ ...p, arm: Math.min(p.arm, end) }) }, { arm: 200 }, S);
  expect(trimTop(f, 0, inst("I"), 200, S).p.arm).toBeCloseTo(200 - S.stroke / 2 - S.armGap, 0);
});

test("f-Haken zählt beim Abstand nur gekürzt; trimTop kürzt ihn armGap vor der Oberlänge, ein gepinnter Haken zählt ganz und bleibt", () => {
  const f = inst("f"), long = inst("f", { hook: 160 }), l = inst("l"), pin = { hook: 160 };
  const dx = spacing(long, l, S);
  expect(dx).toBeCloseTo(spacing(f, l, S)); // der Querstrich bestimmt den Abstand, nicht der Haken
  expect(dx + l.prof.minX).toBeCloseTo(150 + S.gap);
  expect(50 + trimTop(long, 0, l, dx, S).p.hook).toBeCloseTo(dx + l.prof.minX - S.armGap, 0);
  expect(trimTop(long, 0, l, dx, S, pin)).toBe(long);
  expect(spacing(long, l, S, 0, pin) + l.prof.minX).toBeCloseTo(50 + 160 + S.gap); // gepinnt: Abstand vom Hakenende
  expect(spacing(inst("F"), inst("H"), S)).toBeGreaterThan(spacing(inst("F", { top: -100 }), inst("H"), S)); // der obere F-Arm zählt ganz (nicht lose)
});

test("joinsFor bei den übrigen Versalien: TH teilt den Arm, RA die Füße, ZA unterfährt, UN den Stamm", () => {
  const types = (a: string, b: string) => joinsFor(inst(a), inst(b)).map((j) => j.sub ?? j.type);
  expect(types("T", "H")).toEqual(["none", "term"]);
  expect(types("T", "A")).toEqual(["none"]);
  expect(types("R", "A")).toEqual(["none", "leg"]);
  expect(types("K", "A")).toEqual(["none", "leg"]);
  expect(types("Z", "A")).toEqual(["none", "underrun"]);
  expect(types("U", "N")).toEqual(["none", "stem"]);
  expect(types("J", "U")).toEqual(["none"]); // J ohne Stamm-Andocken: J + U würde zu „ɯ“
});

test("c Strich teilen TH: der T-Arm endet auf dem H-Stamm (< 0,5 Einheiten), Pin auf dem Arm bleibt gültig", () => {
  const { l, dx } = join({ type: "share", sub: "term" }, "T", "H");
  expect(Math.abs(l.p.w + l.p.top - dx)).toBeLessThan(0.5); // H-Stamm liegt bei dx + 0
  const long = apply({ type: "share", sub: "term" }, inst("T", { top: 120 }), GLYPHS.H, defaults(GLYPHS.H), S)!;
  expect(Math.abs(GLYPHS.T.params.w.def + 120 - long.dx)).toBeLessThan(0.5);
});

test("joinsFor klein: Querstrich teilen (f, t), Unterlänge nach links (g, j, y), c-Ende in den Stamm", () => {
  const types = (a: string, b: string) => joinsFor(inst(a), inst(b)).map((j) => j.sub ?? j.type);
  for (const [a, b] of [["f", "t"], ["t", "t"], ["f", "f"], ["t", "f"]]) expect(types(a, b)).toEqual(["none", "cross"]);
  for (const [a, b] of [["a", "g"], ["i", "j"], ["e", "y"]]) expect(types(a, b)).toEqual(["none", "tail"]);
  expect(types("f", "l")).toEqual(["none"]); // f-Haken kürzen ist keine Verbindung
  expect(types("c", "h")).toEqual(["none", "term"]);
  for (const a of [",", ";", "„", "‚", "p", "j"]) expect([a, types(a, "g")]).toEqual([a, ["none"]]); // nie unter eine Unterlänge
});

test("Querstrich teilen: Abstand wie ohne Verbindung, der linke Querstrich läuft bis an den Anfang des rechten", () => {
  const { l, r, dx } = join({ type: "share", sub: "cross" }, "f", "t");
  expect(dx).toBeCloseTo(spacing(inst("f"), inst("t"), S));
  expect(dock(l, "cross")!.x1).toBeCloseTo(dx + dock(r, "cross")!.x0);
  expect(dock(l, "cross")!.y).toBe(dock(r, "cross")!.y);
});

test("Unterlänge nach links: der Schwanz verlängert sich in Stufen (TAIL_STEP) bis höchstens eine Strichstärke rechts der linken Tinte des Nachbarn", () => {
  const { r, dx } = join({ type: "tail" }, "a", "g");
  expect(dx).toBeCloseTo(spacing(inst("a"), inst("g"), S));
  const end = dx + dock(r, "tail")!.end, limit = inst("a").prof.minX + S.stroke;
  expect(end).toBeGreaterThanOrEqual(limit - 1e-9); // nie länger als bis dorthin
  expect(end - limit).toBeLessThan(TAIL_STEP);
  // Font: eine Glyphe je Stufe, nicht je Nachbar – Länge ein ganzes Vielfaches von TAIL_STEP (Gleitkomma-sicher)
  const steps = (c: string, tail: number) => (GLYPHS[c].params.tail.def - tail) / TAIL_STEP;
  for (const [a, b] of [["a", "g"], ["e", "j"], ["n", "y"], ["T", "g"]]) {
    const n = steps(b, join({ type: "tail" }, a, b).r.p.tail);
    expect([a + b, n >= 1, Math.abs(n - Math.round(n)) < 1e-9]).toEqual([a + b, true, true]);
  }
  expect(collides(inst("a"), 0, r, dx, S)).toBe(false); // unter dem a, nicht hinein
});

test("c Strich teilen nur, wo der Nachbar auf Höhe des Strichendes einen Stamm hat", () => {
  const types = (a: string, b: string, rp = {}) => joinsFor(inst(a), inst(b, rp)).map((j) => j.sub ?? j.type);
  for (const [a, b] of [["C", "U"], ["G", "U"], ["C", "Ü"]]) expect(types(a, b)).toEqual(["none"]); // U-Stamm endet über dem Bogen
  expect(types("T", "L", { h: 0.7 })).toEqual(["none"]); // T-Arm hinge über dem kürzeren L in der Luft
  expect(types("T", "U")).toEqual(["none", "term"]);
  expect(types("C", "H")).toEqual(["none", "term"]);
});

test("Feinschliff: Satzzeichen verbinden nie und halten überall den Buchstabenabstand", () => {
  const P = Object.keys(GLYPHS).filter((c) => /[\p{P}\p{S}]/u.test(c));
  const bad: string[] = [];
  for (const p of P)
    for (const c of Object.keys(GLYPHS))
      for (const [a, b, lc] of [[p, c, 0], [c, p, 0], [p, c, 1], [c, p, 1]] as const) {
        const form = (x: string) => ("lc" in GLYPHS[x].params ? { lc } : {}); // auch die Kleinbuchstaben-Formen von - – ( )
        const l = inst(a, form(a)), r = inst(b, form(b));
        if (joinsFor(l, r).length !== 1) bad.push(`${a}${b} verbindet`);
        const g = lightGap(l, 0, r, spacing(l, r, S), S.gap);
        if (g < S.gap - 1) bad.push(`${a}${b} ${g.toFixed(0)}`);
      }
  expect(bad).toEqual([]);
});
