import { expect, test } from "bun:test";
import { fontData, glyphName } from "../src/fontdata";
import { GLYPHS } from "../src/glyphs";
import { TAIL_STEP } from "../src/rules";

const data = fontData("test");
const byName = new Map(data.glyphs.map((g) => [g.name, g]));

test("jedes Zeichen hat eine Grundglyphe mit genau seinem Codepunkt, HAF liegt auf U+E000", () => {
  for (const c of Object.keys(GLYPHS)) expect(byName.get(glyphName(c))?.unicodes).toEqual([c.codePointAt(0)!]);
  expect(byName.get("A")!.unicodes).toEqual([0x41]);
  expect(byName.get("Adieresis")!.unicodes).toEqual([0xc4]);
  expect(byName.get("uni1E9E")!.unicodes).toEqual([0x1e9e]);
  expect(byName.get("H_A_F")!.unicodes).toEqual([0xe000]);
  expect(byName.get("space")!.advance).toBe(150); // 206 zwischen den Wortkästen (Seitenabstände + 150) – so eng setzt auch die App mindestens; nach der Tinte darf sie weiter setzen
  expect(data.glyphs.map((g) => g.name).filter((n) => !/^[A-Za-z0-9._]+$/.test(n))).toEqual([]); // gültige Glyphennamen (Adobe Glyph List)
}, 20000);

test("Feature-Datei nennt nur vorhandene Glyphen und enthält liga, dlig und calt", () => {
  const names = new Set(byName.keys()), body = data.fea.replace(/^languagesystem.*$/gm, "").replace(/@\w+/g, ""); // Klassennamen zählen nicht
  const used = body.match(/[A-Za-z_][A-Za-z0-9_.]*(?=['\s;\]])/g)!.filter((w) => !["sub", "by", "ignore", "lookup", "feature", "calt", "liga", "dlig", "case"].includes(w));
  const unknown = used.filter((w) => !names.has(w) && !/^[A-Z_]+_LIG$|^(NEST|UNDERRUN|TERM|CROSS|TAIL|TRIM|LOWER)_|^CASE$/.test(w));
  expect([...new Set(unknown)]).toEqual([]);
  for (const f of ["feature liga", "feature dlig", "feature calt"]) expect(data.fea).toContain(f);
  expect(data.fea).toContain("lookup CROSS_LEFT");
  expect(data.fea).toContain("lookup TAIL_RIGHT");
  expect(data.fea).toContain("lookup TRIM_LEFT");
  const calt = /feature calt \{([^}]*)\}/.exec(data.fea)![1].match(/lookup \w+/g);
  expect(calt).toEqual(["LOWER_DASH", "LOWER_PAREN_OPEN", "LOWER_PAREN_CLOSE", "NEST_LEFT", "NEST_RIGHT", "UNDERRUN_LEFT", "UNDERRUN_RIGHT", "TERM_LEFT", "CROSS_LEFT", "TAIL_RIGHT", "TRIM_LEFT"].map((l) => `lookup ${l}`));
});

test("Kleinbuchstaben verschränkt: Querstrich teilen, Unterlänge nach links, f-Haken kürzen", () => {
  const words = (t: string) => data.expect.find((e) => e.text === t)!.words.map((w) => w.map((g) => g.name).join(" "));
  expect(words("Stift")[0]).toMatch(/^S t i f\.cross t$/);
  expect(words("Kaffee")[0]).toMatch(/^K a f\.cross f e e$/);
  expect(words("Hagen")[0]).toMatch(/^H a g\.tail(\.\d+)? e n$/);
  expect(words("Pflicht")[0]).toBe("P f l i c.term h t"); // das l steht im Buchstabenabstand zum Querstrich: der Haken passt davor
  expect(words("fT")[0]).toMatch(/^f\.trim(\.\d+)? T$/); // der T-Arm reicht bis an den Haken: gekürzt
  expect(data.fea).toMatch(/sub f' \[t[^\]]*\] by f\.cross;/);
  expect(data.fea).toMatch(/sub a g' by g\.tail(\.\d+)?;/);
  expect(data.fea).toMatch(/sub f' \[T[^\]]*\] by f\.trim(\.\d+)?;/);
  // Schwanzlängen in Stufen: höchstens eine Variante je Stufe im Spielraum (g: 11), statt einer je linkem Nachbarn (bis 65)
  for (const c of "gjy") {
    const { min, def } = GLYPHS[c].params.tail, n = data.glyphs.filter((g) => g.name.startsWith(c + ".tail")).length;
    expect([c, n >= 1 && n <= Math.floor((def - min) / TAIL_STEP)]).toEqual([c, true]);
  }
  expect(data.info.xHeight).toBe(300);
  // Ketten: jedes Zeichen vor einem Paar, dessen linke Glyphe sich ändert, ist Sollwert; hinter P setzt die Engine kein c.term, der Font auch nicht
  expect(words("PcB")[0]).toBe("P c B");
  expect(data.fea).toMatch(/ignore sub \[P [^\]]*\] c' \[/);
  // … vor i m n p r u ü aber schon: gesperrt wird je Partner, nicht für alle
  expect(words("Pci")[0]).toBe("P c.term i");
  expect(data.fea).not.toMatch(/ignore sub \[P [^\]]*\] c' \[(?:[^\]]* )?i[ \]]/);
  for (const t of ["Wetter", "Acht", "Echo", "Schrift", "bett", "schiff", "Mannschaft"]) expect(words(t).length).toBe(1);
});

test("Sollwerte: FLÄCHE mit gekürztem F-Arm, Namens-Ligatur, Monogramm nur als eigenes Wort", () => {
  const words = (t: string, f = {}) => data.expect.find((e) => e.text === t && JSON.stringify(e.features) === JSON.stringify(f))!.words.map((w) => w.map((g) => g.name).join(" "));
  expect(words("FLÄCHE")).toEqual(["F.nest.t40 L.short.foot Adieresis.lift C.term H E"]);
  expect(words("HAGEN AAD FOCK")).toEqual(["H_A_G_E_N_space_A_A_D_space_F_O_C_K"]);
  expect(words("HAF", { dlig: true })).toEqual(["H_A_F"]);
  expect(words("HAFEN", { dlig: true })).toEqual(["H A F.nest E.short N"]);
  for (const e of data.expect) for (const w of e.words) for (const g of w) expect(byName.has(g.name)).toBe(true);
});

test("Kleinbuchstaben haben eigene Glyphen; Namenszug und Monogramm nur in Versalien", () => {
  expect(byName.get("a")!.unicodes).toEqual([0x61]);
  expect(byName.get("A")!.unicodes).toEqual([0x41]);
  expect(byName.get("germandbls")!.unicodes).toEqual([0xdf]);
  expect(byName.get("uni1E9E")!.unicodes).toEqual([0x1e9e]);
  expect(data.fea).toMatch(/@WORD = \[[^\]]*\ba\b[^\]]*\]/); // Kleinbuchstaben blockieren die Ligaturen am Wortrand
  const words = (t: string, f = {}) => data.expect.find((e) => e.text === t && JSON.stringify(e.features) === JSON.stringify(f))?.words.map((w) => w.map((g) => g.name).join(" "));
  expect(words("Hagen Aad Fock")?.[0]).not.toContain("H_A_G_E_N");
  expect(words("haf", { dlig: true })).toEqual(["h a f"]);
  expect(words("Fd")).toEqual(["F.nest.t50 d"]); // schon die Oberlänge des d kürzt den F-Arm
  expect(data.fea).toContain("sub F' d by F.nest.t50;");
});

test("Abgleich verliert nur Folgen, die der Font nicht nachbilden kann", () => {
  // FF…: ein verschachteltes F verschachtelt nicht noch einmal; FJ?: das ? kürzt den F-Arm nur um 0,12 (unter der Rundungsgrenze 0,5), der Font setzt F.nest
  expect(data.dropped.filter((t) => !t.startsWith("FF"))).toEqual(["FJ?"]);
});

test("Sollwerte für Ketten mit Varianten: GLAS, TEAM, OFFEN, AUFTAKT", () => {
  const words = (t: string) => data.expect.find((e) => e.text === t)!.words.map((w) => w.map((g) => g.name).join(" "));
  expect(words("GLAS")).toEqual(["G.term L.foot A.lift S"]); // Endstrich vor einer Fuß-Variante
  expect(words("TEAM")).toEqual(["T E.foot A.lift M"]); // Arm mündet in eine Fuß-Variante
  expect(words("OFFEN")).toEqual(["O F.nest F.short E N"]); // ein verschachteltes F verschachtelt nicht noch einmal
  expect(words("AUFTAKT")).toEqual(["A U F.nest T.short A K T"]); // gekürzter T-Arm, rechts frei
});

test("Unterschneidung: verbundene Paare stehen wie in der Engine, freie Paare mit der Lichtweite der App", () => {
  const k = new Map(data.kerning.map(([l, r, v]) => [`${l} ${r}`, v]));
  const step = (l: string, r: string) => byName.get(l)!.advance + (k.get(`${l} ${r}`) ?? 0);
  const off = data.expect.flatMap((e) => e.words.flatMap((w) => w.slice(1).map((g, i) => [e.text, w[i].name, g.name, step(w[i].name, g.name) - (g.x - w[i].x)] as const)));
  expect(off.filter(([, , , d]) => Math.abs(d) > 1)).toEqual([]); // in jedem Sollwort, auch hinter Varianten (T E.foot, T.short A)
  expect(k.get("H I")).toBeUndefined(); // zwei Stämme: Seitenabstände reichen, keine Unterschneidung nötig
});

test("Export hält keine Layouts fest: Spitze unter 1 GB", () => {
  const r = Bun.spawnSync(["/usr/bin/time", "-l", "bun", "tools/export-font.ts"], { stderr: "pipe", stdout: "pipe" });
  expect(r.success).toBe(true);
  const rss = Number(/(\d+)\s+maximum resident set size/.exec(r.stderr.toString())?.[1]);
  expect(rss).toBeLessThan(1e9);
}, 60000);

test("Strich mit eigener Oberkante: eigener Teil mit eigenem Band (k-Arm bis zur x-Höhe)", () => {
  const k = byName.get("k")!;
  expect(k.parts.map((q) => q.top)).toEqual([700, 300]);
  expect(k.parts[1].strokes.length).toBe(1);
});

test("Feinschliff: Satzzeichen auf x-Höhen-Mitte neben Kleinbuchstaben, case nimmt es zurück", () => {
  const words = (t: string) => data.expect.find((e) => e.text === t)!.words.map((w) => w.map((g) => g.name).join(" "));
  expect(words("e-mail")).toEqual(["e hyphen.lc m a i l"]);
  expect(words("T-Shirt")).toEqual(["T hyphen S h i r t"]); // Versal gewinnt
  expect(words("Ost-West")).toEqual(["O s t hyphen W e s t"]);
  expect(words("A-Z")).toEqual(["A hyphen Z"]);
  expect(words("10-20")).toEqual(["one zero hyphen two zero"]);
  expect(words("und – so")).toEqual(["u n d", "endash.lc", "s o"]); // über ein Leerzeichen hinweg
  expect(words("(neu)")).toEqual(["parenleft.lc n e u parenright.lc"]);
  expect(words("(NEU)")).toEqual(["parenleft N E U parenright"]);
  expect(words("(Hagen)")).toEqual([expect.stringMatching(/^parenleft H .* parenright$/)]); // „)“ folgt seiner „(“
  expect(words("(neu und alt)")[2]).toBe("a l t parenright.lc");
  expect(words("F-a")[0]).toMatch(/^F hyphen/); // kein Verschachteln unter den F-Arm
  for (const n of ["hyphen.lc", "endash.lc", "parenleft.lc", "parenright.lc"]) expect(byName.get(n)!.unicodes).toEqual([]);
  expect(data.fea).toMatch(/lookup CASE \{\n  sub hyphen\.lc by hyphen;/);
  expect(data.fea).toContain("feature case {\n  lookup CASE;\n} case;");
  expect(data.fea.indexOf("lookup CASE {")).toBeGreaterThan(data.fea.indexOf("lookup TRIM_LEFT {")); // nach calt in der Lookup-Liste
});
