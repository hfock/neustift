import { expect, test } from "bun:test";
import hagen from "../presets/hagen-aad-fock.json";
import { joinOptions, layoutLine, layoutText, type Options, type Pins } from "../src/engine";
import { minDist } from "../src/geom";
import { GLYPHS } from "../src/glyphs";
import { lightGap } from "../src/rules";
import { FLAECHE_1902 } from "../src/style";

const opts = (o: Partial<Options> = {}): Options => ({ style: FLAECHE_1902, interlock: 0.5, targetWidth: null, pins: { letters: {}, joins: {} }, ...o });
/** Verbindungen einer Variante als Kurzschrift je Grenze, z. B. { 4: "nest" }. */
const kinds = (v: { joins: Record<number, { type: string; sub?: string; bar?: boolean }> }) =>
  Object.fromEntries(Object.entries(v.joins).map(([i, j]) => [i, (j.sub ?? j.type) + (j.bar ? "+bar" : "")]));

test("Referenztest DIE FLÄCHE: FL verschachtelt, LÄ unterfahren, CH geteilt, Rest ohne", () => {
  const best = layoutLine("DIE FLÄCHE", opts()).variants[0];
  // D0 I1 E2 _3 F4 L5 Ä6 C7 H8 E9
  expect(kinds(best)).toEqual({ 0: "none", 1: "none", 4: "nest", 5: "underrun", 6: "none", 7: "term", 8: "none" });
  const bar = (i: number) => best.glyphs.find((g) => g.index === i)!.inst.p.bar;
  expect([2, 4, 8, 9].map(bar)).toEqual([0, 0, 0, 0]);
  expect(bar(6)).toBe(1);
});

test("HAGEN AAD FOCK: eine Variante mit FO verschachtelt und CK geteilt", () => {
  const { variants } = layoutLine("HAGEN AAD FOCK", opts());
  expect(variants.length).toBe(6);
  // H0 A1 G2 E3 N4 _5 A6 A7 D8 _9 F10 O11 C12 K13
  expect(variants.some((v) => kinds(v)[10] === "nest" && kinds(v)[12] === "term")).toBe(true);
});

test("Verschränkung: 0 = keine Verbindungen, 1 = AA mit Füßen und Balken", () => {
  expect(Object.values(kinds(layoutLine("DIE FLÄCHE", opts({ interlock: 0 })).variants[0]))).toEqual(Array(7).fill("none"));
  expect(kinds(layoutLine("HAGEN AAD FOCK", opts({ interlock: 1 })).variants[0])[6]).toBe("leg+bar");
});

test("gleiche Eingabe → identische Rangliste", () => {
  const a = layoutLine("HAGEN AAD FOCK", opts()), b = layoutLine("HAGEN AAD FOCK", opts());
  expect(a.variants.map(kinds)).toEqual(b.variants.map(kinds));
  expect(a.variants.map((v) => v.score)).toEqual(b.variants.map((v) => v.score));
});

test("Pins: erzwungene Verbindung und fester Reglerwert", () => {
  const forced = layoutLine("DIE FLÄCHE", opts({ pins: { letters: {}, joins: { 4: { type: "none" } } } })).variants[0];
  expect(kinds(forced)[4]).toBe("none");
  const tall = layoutLine("DIE FLÄCHE", opts({ pins: { letters: { 5: { h: 1 } }, joins: {} } })).variants[0];
  expect(kinds(tall)[4]).toBe("none"); // volles L passt nicht unter den F-Arm
});

test("unerfüllbarer Pin → Hinweis, Satz trotzdem da", () => {
  const r = layoutLine("DIE FLÄCHE", opts({ pins: { letters: {}, joins: { 0: { type: "nest" } } } }));
  expect(r.warnings.some((w) => w.includes("nicht erfüllbar"))).toBe(true);
  expect(r.variants.length).toBeGreaterThan(0);
});

test("ohne Pins: Hinweis auf fehlenden kollisionsfreien Platz, nicht auf einen Pin", () => {
  expect(layoutLine("y.y", opts()).warnings).toEqual(["Kein kollisionsfreier Platz für „.y“"]);
});

test("Pins außerhalb des Spielraums: Hinweis statt Absturz oder stiller Übernahme", () => {
  const wide = layoutLine("FL", opts({ pins: { letters: { 0: { w: 1000 } }, joins: {} }, targetWidth: 800 }));
  expect(wide.variants.length).toBeGreaterThan(0);
  expect(wide.warnings).toContain("Pin bei „F“ nicht erfüllbar");
  const arm = layoutLine("AFL", opts({ pins: { letters: { 1: { top: 300 } }, joins: {} } }));
  expect(arm.variants[0].glyphs.find((g) => g.index === 1)!.inst.p.top).toBeLessThanOrEqual(200);
  expect(arm.warnings.some((w) => w.includes("nicht erfüllbar"))).toBe(true);
});

test("Pin außerhalb des Spielraums mitten im Wort: Hinweis statt Hängen", () => {
  const t0 = performance.now();
  const r = layoutLine("DIE", opts({ pins: { letters: { 1: { h: 1e5 } }, joins: {} } }));
  expect(performance.now() - t0).toBeLessThan(500);
  expect(r.warnings).toEqual(["Pin bei „DI“ nicht erfüllbar"]); // kein Folgehinweis für „IE“: das I trägt seinen Pin nicht
  expect(r.variants[0].glyphs.find((g) => g.index === 1)!.inst.p.h).toBe(1);
});

test("Buchstaben-Pin widerspricht Verbindungs-Pin: der Buchstabe gewinnt, ein Hinweis nur für dieses Paar", () => {
  // H0 A1 G2 E3 N4 _5 A6 A7 D8 _9 F10 O11 C12 K13; Vorlage pinnt FO verschachtelt, das hohe O passt nicht unter den F-Arm
  const r = layoutLine("HAGEN AAD FOCK", opts({ pins: { ...(hagen.pins as unknown as Pins), letters: { 11: { h: 0.85 } } } }));
  expect(r.warnings).toEqual(["Pin bei „FO“ nicht erfüllbar"]);
  expect(r.variants[0].glyphs.find((g) => g.index === 11)!.inst.p.h).toBe(0.85);
});

test("verworfener Arm-Pin des vorletzten Buchstabens: kein Folgehinweis, Verbindungs-Pin danach gilt", () => {
  // F4 trägt top 300 (außerhalb des Spielraums) nicht; die Armkürzung vor dem Ä muss trotzdem greifen
  const r = layoutLine("DIE FLÄCHE", opts({ pins: { letters: { 4: { top: 300 } }, joins: { 4: { type: "nest" }, 5: { type: "underrun" } } } }));
  expect(r.warnings).toEqual(["Pin bei „F“ nicht erfüllbar"]);
  expect(r.variants[0].joins[5].type).toBe("underrun");
});

test("Buchstaben-Pin widerspricht Verbindungs-Pin: der Verbindungs-Pin rechts daneben gilt weiter", () => {
  const r = layoutLine("DIE FLÄCHE", opts({ pins: { letters: { 5: { h: 0.8 } }, joins: { 4: { type: "nest" }, 5: { type: "none" } } } }));
  expect(r.warnings).toEqual(["Pin bei „FL“ nicht erfüllbar"]);
  expect(r.variants[0].joins[5].type).toBe("none");
  expect(r.variants[0].glyphs.find((g) => g.index === 5)!.inst.p.h).toBe(0.8);
});

test("Kleinbuchstaben bleiben klein, ß bleibt ß, ẞ bleibt ẞ", () => {
  const chars = (t: string) => layoutLine(t, opts()).variants[0].glyphs.map((g) => g.char).join("");
  expect(chars("Neustift")).toBe("Neustift");
  expect(chars("Straße")).toBe("Straße");
  expect(chars("STRAẞE")).toBe("STRAẞE");
  expect(layoutLine("Hagen", opts()).warnings).toEqual([]);
});

test("alter Pin auf einem Regler, den der Buchstabe nicht hat (h auf Kleinbuchstaben), ändert nichts", () => {
  // i0 c1 h2 _3 P4 f5 l6 i7 c8 h9 t10: Wortanfang, Buchstabe mitten im Wort, Nachbar mit Arm-Pin
  const pins = { letters: { 0: { h: 0.8 }, 5: { h: 0.8 }, 6: { top: 300 } }, joins: {} };
  const free = layoutLine("ich Pflicht", opts()), pinned = layoutLine("ich Pflicht", opts({ pins }));
  expect(pinned.warnings).toEqual([]);
  expect(pinned.variants[0].glyphs.map((g) => g.inst.p)).toEqual(free.variants[0].glyphs.map((g) => g.inst.p));
});

test("Verschränkung klein: Stift, ich, Hagen, Tafel, Pflicht", () => {
  const v = (t: string) => layoutLine(t, opts()).variants[0];
  const at = (l: ReturnType<typeof v>, i: number) => l.glyphs.find((g) => g.index === i)!;
  expect(kinds(v("Stift"))[3]).toBe("cross"); // f t
  expect(kinds(v("ich"))[1]).toBe("term"); // c h
  const hagen = v("Hagen");
  expect(kinds(hagen)[1]).toBe("tail"); // a g
  expect(at(hagen, 2).inst.p.tail).toBeLessThan(0); // Schwanz reicht unter das a
  const tafel = v("Tafel"), T = at(tafel, 0), a = at(tafel, 1);
  expect(a.x + a.inst.prof.minX).toBeLessThan(T.x + T.inst.prof.maxX); // a steht unter dem T-Arm
  // Haken zählt beim Abstand nicht: das l steht im Buchstabenabstand zum Querstrich (bei 150), der Haken (bis 160) endet mindestens armGap davor
  const pf = v("Pflicht"), f = at(pf, 1), l = at(pf, 2), lx = l.x + l.inst.prof.minX - f.x;
  expect(lx).toBeCloseTo(150 + FLAECHE_1902.gap, 0);
  expect(lx - (50 + f.inst.p.hook)).toBeGreaterThanOrEqual(FLAECHE_1902.armGap);
  // kommt das l näher (enger Satz), kürzt die Engine den Haken: endet armGap vor dem l
  const tight = layoutLine("Pflicht", opts({ style: { ...FLAECHE_1902, gap: 20 } })).variants[0], tf = at(tight, 1), tl = at(tight, 2);
  expect(tf.inst.p.hook).toBeLessThan(110);
  expect(tf.x + 50 + tf.inst.p.hook).toBeCloseTo(tl.x + tl.inst.prof.minX - FLAECHE_1902.armGap, 0);
});

test("Pins: ein gepinnter f-Haken bleibt, wie er ist", () => {
  // P0 f1 l2 i3 c4 h5 t6
  for (const hook of [110, 160]) {
    const r = layoutLine("Pflicht", opts({ pins: { letters: { 1: { hook } }, joins: {} } }));
    expect(r.warnings).toEqual([]);
    expect(r.variants[0].glyphs.find((g) => g.index === 1)!.inst.p.hook).toBe(hook);
  }
});

test("f vor jedem Zeichen: ohne Hinweis und ohne Kollision (Haken gekürzt oder voller Abstand)", () => {
  const bad = Object.keys(GLYPHS).flatMap((c) => {
    const r = layoutLine("f" + c, opts({ variants: 1 })), [f, o] = r.variants[0].glyphs;
    const touch = r.variants[0].joins[0].type !== "share" && lightGap(f.inst, f.x, o.inst, o.x, 100) < FLAECHE_1902.armGap - 3; // ff, ft teilen den Querstrich
    return r.warnings.length || touch ? ["f" + c] : [];
  });
  expect(bad).toEqual([]);
});

test("Kleinbuchstaben untereinander und mit Satzzeichen: ohne Hinweis (keine Kollision, auch nicht mit Unterlängen)", () => {
  const low = Object.keys(GLYPHS).filter((c) => /\p{Ll}/u.test(c)), marks = [...".,:;!?-–()/&'’\"„“‚‘«»€%@#+=*§…"];
  const texts = [...low.flatMap((a) => low.map((b) => a + b)), ...low.flatMap((a) => marks.flatMap((m) => [a + m, m + a]))];
  expect(texts.filter((t) => layoutLine(t, opts({ variants: 1 })).warnings.length)).toEqual([]);
}, 60000);

test("Unterlänge nach links nie hinter einer Unterlänge (p, q, g, j, y)", () => {
  for (const a of "pqgjy") for (const b of "gjy") expect([a + b, layoutLine(a + b, opts()).variants[0].joins[0].type]).not.toEqual([a + b, "tail"]);
});

test("fi, ti, fä: der Querstrich hält armGap Abstand zu den Punkten", () => {
  for (const t of ["fi", "ti", "fä"]) {
    const [a, b] = layoutLine(t, opts()).variants[0].glyphs;
    expect([t, lightGap(a.inst, a.x, b.inst, b.x, 100) >= FLAECHE_1902.armGap]).toEqual([t, true]);
  }
});

test("unbekannte Zeichen werden zu Platzhaltern", () => {
  const r = layoutLine("~ÜBER", opts());
  expect(r.warnings).toEqual(["Zeichen „~“ noch nicht entworfen"]);
  expect(r.variants[0].glyphs[0].inst.def.char).toBe("?");
});

test("ganzes Versal-Alphabet ohne Platzhalter", () => {
  const r = layoutLine("VICTOR JAGT ZWÖLF BOXKÄMPFER QUER ÜBER DEN GROẞEN SYLTER DEICH", opts());
  expect(r.warnings).toEqual([]);
  expect(r.variants[0].glyphs.map((g) => g.char).join("")).toBe("VICTORJAGTZWÖLFBOXKÄMPFERQUERÜBERDENGROẞENSYLTERDEICH");
});

test("e Zielbreite: erreichbar → passt auf ±2, unerreichbar → Hinweis", () => {
  const natural = layoutLine("DIE FLÄCHE", opts()).variants[0].width;
  const fit = layoutLine("DIE FLÄCHE", opts({ targetWidth: natural + 120 }));
  expect(Math.abs(fit.variants[0].width - (natural + 120))).toBeLessThanOrEqual(2);
  expect(fit.warnings).toEqual([]);
  const far = layoutLine("DIE FLÄCHE", opts({ targetWidth: natural * 3 }));
  expect(far.warnings).toContain("Zielbreite nicht erreichbar – nächstbeste Breite gezeigt");
});

test("e Zielbreite hält eine gepinnte Verbindung und kommt trotzdem voran", () => {
  const pins = { letters: {}, joins: { 6: { type: "share" as const, sub: "leg" as const, bar: true } } };
  const natural = layoutLine("HAGEN AAD FOCK", opts({ pins })).variants[0].width;
  const r = layoutLine("HAGEN AAD FOCK", opts({ pins, targetWidth: natural * 1.3 }));
  for (const v of r.variants) expect(kinds(v)[6]).toBe("leg+bar");
  expect(r.variants[0].width).toBeGreaterThan(natural + 100);
  expect(r.warnings).toContain("Zielbreite nicht erreichbar – nächstbeste Breite gezeigt");
});

test("e Zielbreite: Varianten behalten ihre Verbindungen, auch Balken neben einem Pin ohne Balkenangabe", () => {
  const pins = { letters: {}, joins: { 6: { type: "share" as const, sub: "leg" as const } } };
  const free = layoutLine("HAGEN AAD FOCK", opts({ pins }));
  const fit = layoutLine("HAGEN AAD FOCK", opts({ pins, targetWidth: free.variants[0].width * 1.01 }));
  const before = free.variants.map(kinds);
  for (const v of fit.variants) expect(before).toContainEqual(kinds(v));
  expect(fit.variants.some((v) => kinds(v)[6] === "leg+bar")).toBe(true);
});

test("e Zielbreite: ein unerfüllbarer Pin schaltet die Breitenanpassung nicht ab", () => {
  const natural = layoutLine("DIE FLÄCHE", opts()).variants[0].width;
  const r = layoutLine("DIE FLÄCHE", opts({ pins: { letters: {}, joins: { 0: { type: "nest" } } }, targetWidth: natural + 120 }));
  expect(Math.abs(r.variants[0].width - (natural + 120))).toBeLessThanOrEqual(2);
  expect(r.warnings).toEqual(["Pin bei „DI“ nicht erfüllbar"]);
});

test("e Zielbreite: kein Hinweis, wenn die beste Variante die Breite trifft", () => {
  const natural = layoutLine("HAGEN AAD FOCK", opts()).variants[0].width;
  const r = layoutLine("HAGEN AAD FOCK", opts({ targetWidth: natural * 1.1 }));
  expect(Math.abs(r.variants[0].width - natural * 1.1)).toBeLessThanOrEqual(2);
  expect(r.warnings).toEqual([]);
});

test("Pins: ein gepinnter oberer F-Arm bleibt, wie er ist", () => {
  const pinned = (top: number) => layoutLine("DIE FLÄCHE", opts({ pins: { letters: { 4: { top } }, joins: {} } }));
  const short = pinned(40);
  expect(short.variants[0].glyphs.find((g) => g.index === 4)!.inst.p.top).toBe(40);
  expect(kinds(short.variants[0])).toMatchObject({ 4: "nest", 5: "underrun" });
  const long = pinned(65.12); // zu lang für FL und LÄ zugleich: lieber eine Verbindung weniger als den Arm kürzen
  for (const v of long.variants) expect(v.glyphs.find((g) => g.index === 4)!.inst.p.top).toBe(65.12);
  expect(long.warnings).toEqual([]);
});

test("joinOptions: Wortgrenze hat keine Optionen", () => {
  const v = layoutLine("DIE FLÄCHE", opts()).variants[0];
  expect(joinOptions(v, 2)).toEqual([]); // E | Leerzeichen
  expect(joinOptions(v, 4).map((j) => j.type)).toEqual(["none", "nest"]);
});

test("Wortabstand nach der Tinte, aber nie enger als zwischen den Wortkästen (wie im Font)", () => {
  const step = (t: string) => {
    const v = layoutLine(t, opts()).variants[0], i = v.glyphs.findIndex((g, k) => k && g.index !== v.glyphs[k - 1].index + 1);
    const ext = (gs: typeof v.glyphs) => [Math.min(...gs.map((g) => g.x + g.inst.prof.minX)), Math.max(...gs.map((g) => g.x + g.inst.prof.maxX))];
    return ext(v.glyphs.slice(i))[0] - ext(v.glyphs.slice(0, i))[1]; // Lücke zwischen den Wortkästen
  };
  expect(step("DA VOR")).toBeGreaterThanOrEqual(FLAECHE_1902.wordGap - 1); // sonst liest es sich als „DAVOR“
  expect(step("AUF ALLE")).toBeGreaterThanOrEqual(FLAECHE_1902.wordGap - 1);
  expect(Math.round(step("DIE FLÄCHE"))).toBe(FLAECHE_1902.wordGap); // senkrechte Seiten: Tinte und Kasten gleich
});

const block = (t: string, aspect: number | null) => layoutText(t, { ...opts(), aspect }).variants[0];
const rows = (v: ReturnType<typeof block>) => {
  const ys = [...new Set(v.glyphs.map((g) => g.y ?? 0))].sort((a, b) => b - a);
  return ys.map((y) => v.glyphs.filter((g) => (g.y ?? 0) === y));
};
const ext = (gs: { x: number; inst: { prof: { minX: number; maxX: number } } }[]) =>
  Math.max(...gs.map((g) => g.x + g.inst.prof.maxX)) - Math.min(...gs.map((g) => g.x + g.inst.prof.minX));

test("Block: HAGEN AAD FOCK bei 2:1 → HAGEN / AAD FOCK, gleich breit", () => {
  const r = rows(block("HAGEN AAD FOCK", 2));
  expect(r.map((g) => g.map((x) => x.char).join(""))).toEqual(["HAGEN", "AADFOCK"]);
  expect(Math.abs(ext(r[0]) - ext(r[1]))).toBeLessThanOrEqual(1);
});

test("Block: Enter erzwingt den Umbruch", () => {
  expect(rows(block("DIE\nFLÄCHE", 1)).map((g) => g.map((x) => x.char).join(""))).toEqual(["DIE", "FLÄCHE"]);
});

test("Block: Zeilen eng, kleinste Lichtweite = Buchstabenabstand", () => {
  const r = rows(block("HAGEN AAD FOCK", 2));
  const ink = (gs: typeof r[0]) => gs.flatMap((g) => g.inst.ink.map((q) => ({ x: q.x + g.x, y: q.y + (g.y ?? 0) })));
  const d = minDist(ink(r[0]), 0, ink(r[1]), 0, 1000);
  expect(Math.abs(d - FLAECHE_1902.gap)).toBeLessThanOrEqual(1);
});

test("Block: frei ohne Enter ist eine Zeile wie layoutLine", () => {
  for (const t of ["DIE FLÄCHE", "Hagen Spiegel", "WIENER WERKSTÄTTE"]) {
    const a = layoutText(t, { ...opts(), aspect: null }).variants[0], b = layoutLine(t, opts()).variants[0];
    expect(a.glyphs.map((g) => [g.char, g.x])).toEqual(b.glyphs.map((g) => [g.char, g.x]));
  }
});

test("Block: Pins hinter dem Umbruch treffen den richtigen Buchstaben", () => {
  const v = layoutText("AB\nCF", { ...opts(), aspect: 1, pins: { letters: { 4: { w: 330 } }, joins: {} } }).variants[0];
  expect(v.glyphs.find((g) => g.index === 4)!.char).toBe("F");
  expect(v.glyphs.find((g) => g.index === 4)!.inst.p.w).toBe(330);
});
