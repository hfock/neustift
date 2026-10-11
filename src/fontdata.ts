// Font-Daten aus der Engine (Spec M2 §5): Glyphen samt calt-Varianten, Vorschübe, Unterschneidung, Feature-Datei und Sollwerte.
import hagen from "../presets/hagen-aad-fock.json";
import { PAREN_REACH, layoutLine, type Layout, type Pins } from "./engine";
import { shift, type Stroke } from "./geom";
import { GLYPHS, PLACEHOLDER, cutTop, defaults, descOf, type Params } from "./glyphs";
import { instance, joinsFor, spacing, type Inst } from "./rules";
import { FLAECHE_1902 as S } from "./style";

export const FORMAT = 1;
export type FontPart = { strokes: Stroke[]; bottom: number; top: number }; // Mittellinien in Font-Koordinaten, Beschnitt-Band
export type FontGlyph = { name: string; unicodes: number[]; advance: number; parts: FontPart[] };
export type ExpectGlyph = { name: string; x: number }; // x: Ursprung relativ zum Wortanfang
export type Expect = { text: string; features: Record<string, boolean>; words: ExpectGlyph[][]; parts: FontPart[] | null };
export type FontData = {
  format: number;
  info: { family: string; style: string; version: string; unitsPerEm: number; capHeight: number; xHeight: number; ascender: number; descender: number; stroke: number };
  glyphs: FontGlyph[];
  kerning: [string, string, number][];
  fea: string;
  expect: Expect[];
  dropped: string[]; // Abgleich-Folgen, die der Font nicht nachbilden kann (Glyphe ohne Gegenstück)
};

const NAMES: Record<string, string> = {
  Ä: "Adieresis", Ö: "Odieresis", Ü: "Udieresis", ẞ: "uni1E9E", ä: "adieresis", ö: "odieresis", ü: "udieresis", ß: "germandbls",
  "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine",
  ".": "period", ",": "comma", ":": "colon", ";": "semicolon", "!": "exclam", "?": "question", "-": "hyphen", "–": "endash",
  "(": "parenleft", ")": "parenright", "/": "slash", "&": "ampersand", "'": "quotesingle", "’": "quoteright", '"': "quotedbl",
  "„": "quotedblbase", "“": "quotedblleft", "‚": "quotesinglbase", "‘": "quoteleft", "«": "guillemotleft", "»": "guillemotright",
  "€": "Euro", "%": "percent", "@": "at", "#": "numbersign", "+": "plus", "=": "equal", "*": "asterisk", "§": "section", "…": "ellipsis",
  "\uE000": "H_A_F",
};
/** Glyphenname nach Adobe Glyph List; A–Z und a–z heißen wie ihr Zeichen. */
export const glyphName = (c: string) => NAMES[c] ?? c;

const NAME_LIG = "H_A_G_E_N_space_A_A_D_space_F_O_C_K";
const SB = S.gap / 2; // Seitenabstand je Seite: halber Buchstabenabstand
const lsb = (i: Inst) => SB + (i.def.adjust?.left ?? 0);
const rsb = (i: Inst) => SB + (i.def.adjust?.right ?? 0);
const ox = (i: Inst) => lsb(i) - i.prof.minX; // Verschiebung Engine → Font: die Tinte beginnt beim linken Seitenabstand
const advance = (i: Inst) => Math.round(i.prof.maxX - i.prof.minX + lsb(i) + rsb(i));
/** Unterschneidung, damit r im Font dort steht, wo die Engine es um dx neben l setzt (mit gerundetem Vorschub gerechnet). */
const kernFor = (l: Inst, r: Inst, dx: number) => Math.round(dx - ox(r) + ox(l) - advance(l));
/** Teile einer Glyphe: alle Striche im Band der Glyphe, dazu je Strich mit eigener Oberkante (k-Arm) ein Teil mit eigenem Band. */
const parts = (i: Inst, dx: number): FontPart[] => {
  const bottom = -descOf(i), top = descOf(i) && !i.def.top ? S.capHeight : cutTop(i.def, i.p, S);
  const own = i.strokes.filter((st) => st.top !== undefined);
  return [
    { strokes: i.strokes.filter((st) => st.top === undefined).map((st) => shift(st, dx)), bottom, top },
    ...own.map((st) => ({ strokes: [shift(st, dx)], bottom, top: Math.min(top, st.top!) })),
  ];
};

type Glyph = { name: string; char: string; inst: Inst; role: { left: boolean; right: boolean } }; // left: steht links in einer Verbindung (rechte Seite verbunden); right: steht rechts (linke Seite verbunden)
const opts = { style: S, interlock: 0.5, targetWidth: null, pins: { letters: {}, joins: {} } };
/** Gesetzte Folge, schlank: nur Regler statt Instanzen (Tinte, Profil) – sonst hält der Export Gigabytes fest. */
type Laid = Pick<Layout, "joins"> & { glyphs: { index: number; char: string; x: number; p: Params }[] };
const laid = new Map<string, Laid>(); // jede Folge nur einmal setzen: die Sollwerte brauchen die Paare und Dreierfolgen noch einmal
const best = (text: string) => {
  if (!laid.has(text)) {
    const { joins, glyphs } = layoutLine(text, opts).variants[0];
    laid.set(text, { joins, glyphs: glyphs.map(({ index, char, x, inst }) => ({ index, char, x, p: inst.p })) });
  }
  return laid.get(text)!;
};
const floor5 = (v: number) => Math.floor(v / 5) * 5;
/** Regler, die erst die eigene rechte Verbindung ändert (Arm, Fuß, Bogenende, Querstrich, f-Haken): beim Setzen neben den linken Nachbarn galten noch die Startwerte. */
const OWN_RIGHT = ["arm", "top", "foot", "wb", "term", "cross", "hook"];
const placed = (g: { char: string; inst: Inst }) => {
  const d = defaults(GLYPHS[g.char]), p = { ...g.inst.p };
  for (const k of OWN_RIGHT) if (k in d) p[k] = d[k];
  return instance(GLYPHS[g.char], p, S);
};

/** Alle Font-Daten aus der Engine. */
export function fontData(version: string): FontData {
  const chars = Object.keys(GLYPHS);
  const reg = new Map<string, Glyph>();
  const keyOf = (c: string, p: Params) => c + JSON.stringify(Object.keys(GLYPHS[c].params).map((k) => Math.round(p[k] * 100) / 100));
  /** Glyphe für Zeichen c mit Reglern p; Varianten heißen nach den geänderten Reglern. */
  function glyph(c: string, p: Params, name?: string): Glyph {
    const k = keyOf(c, p);
    const known = reg.get(k);
    if (known) return known;
    const d = defaults(GLYPHS[c]), changed = (q: string) => q in d && Math.abs(p[q] - d[q]) > 1e-6;
    const n0 = name ?? [glyphName(c), changed("h") && "short", (changed("arm") || changed("top")) && "nest", changed("foot") && "foot", changed("legL") && "lift",
      (changed("wb") || changed("term")) && "term", changed("cross") && "cross", changed("tail") && "tail", changed("hook") && "trim", changed("lc") && "lc"]
      .filter(Boolean).join(".");
    // gleiche Rolle, andere Werte (E-Fuß vor A kürzer als vor Ä): durchnummerieren
    const taken = (x: string) => [...reg.values()].some((g) => g.name === x);
    let n = n0;
    for (let i = 1; taken(n); i++) n = `${n0}.${i}`;
    const g: Glyph = { name: n, char: c, inst: instance(GLYPHS[c], p, S), role: { left: false, right: false } };
    reg.set(k, g);
    return g;
  }
  const base = (c: string) => glyph(c, defaults(GLYPHS[c]));
  chars.forEach(base);
  const lower = chars.filter((c) => "lc" in GLYPHS[c].params).map((c) => glyph(c, { ...defaults(GLYPHS[c]), lc: 1 })); // - – ( ) auf x-Höhen-Mitte

  // Paare: was die Engine bei Verschränkung 0,5 aus zwei Zeichen macht
  type Join = { l: Glyph; r: Glyph; dx: number };
  const joins: Join[] = [];
  const rules: Rules = { nestX: new Map(), trimX: new Map(), under: [], term: [], cross: [], tail: [], hook: [], skip: [], trim: [], block: new Map(), untail: new Map() };
  const nests: { x: string; p: Params; r: Glyph; dx: number }[] = [];
  /** F mit gekürztem oberem Arm, auf 5 abgerundet; Glyphennamen ohne Minus. */
  const trimF = (p: Params) => {
    const t = floor5(p.top);
    return glyph("F", { ...p, top: t }, `F.nest.t${t < 0 ? "m" + -t : t}`);
  };
  const sweep: string[] = []; // Abgleich (Spec §7.1): alle Paare und F-Dreierfolgen werden Sollwerte
  /** type: Verbindung (term, cross … statt share) oder „hook“ – keine Verbindung, aber der f-Haken ist vor dem Nachbarn gekürzt. */
  const record = (type: string, l: Glyph, r: Glyph, dx: number) => {
    const j = { l, r, dx };
    joins.push(j);
    const dl = defaults(GLYPHS[l.char]); // links verbunden heißt: die eigene rechte Seite wurde verlängert (T bleibt frei)
    if (OWN_RIGHT.some((k) => k in dl && Math.abs(l.inst.p[k] - dl[k]) > 1e-6)) l.role.left = true;
    // rechts verbunden heißt: die eigene linke Seite wurde geändert – nicht nur die rechte (c.term im F-Dreier: links frei wie in „ch“)
    const dr = defaults(GLYPHS[r.char]);
    if (Object.keys(dr).some((k) => !OWN_RIGHT.includes(k) && Math.abs(r.inst.p[k] - dr[k]) > 1e-6)) r.role.right = true;
    if (type === "underrun") rules.under.push(j);
    if (type === "term" || type === "cross" || type === "tail" || type === "hook") rules[type].push(j);
    return j;
  };
  const chained = new Map<string, string>(); // je Variante der linken Glyphe (c.term, f.cross, f.trim …) ein Paar: jedes Zeichen davor wird Sollwert
  for (const a of chars)
    for (const b of chars) {
      sweep.push(a + b); // auch ohne mögliche Verbindung: prüft die Unterschneidung der freien Seiten
      if (joinsFor(base(a).inst, base(b).inst).length < 2 && !GLYPHS[a].trimTop) continue; // nur „keine“ möglich, und kein Haken zu kürzen
      const v = best(a + b), j = v.joins[0], [ga, gb] = v.glyphs;
      if (j.type === "none") {
        const l = glyph(a, ga.p);
        if (l !== base(a)) record("hook", l, glyph(b, gb.p), gb.x - ga.x), chained.has(l.name) || chained.set(l.name, a + b); // f-Haken vor der Oberlänge gekürzt
        continue;
      }
      const r = glyph(b, gb.p);
      if (j.type === "nest") nests.push({ x: b, p: ga.p, r, dx: gb.x - ga.x }); // erst wenn das Regel-F feststeht
      else {
        const l = record(j.sub ?? j.type, glyph(a, ga.p), r, gb.x - ga.x).l;
        if (l !== base(a) && !chained.has(l.name)) chained.set(l.name, a + b);
      }
    }
  // Verschachteln: das Regel-F hat den längsten oberen Arm; kürzt ihn schon der verschachtelte Buchstabe selbst (d), eigene Variante
  const top = Math.max(...nests.map((n) => n.p.top));
  const fNest = glyph("F", nests.find((n) => n.p.top === top)!.p);
  for (const n of nests) {
    const trimmed = n.p.top < top - 0.5;
    const f = trimmed ? trimF(n.p) : glyph("F", n.p); // andere Regler als das Regel-F: eigene Glyphe, der Abgleich meldet es laut
    if (trimmed) rules.trimX.set(n.x, f);
    record("nest", f, n.r, n.dx);
    rules.nestX.set(n.x, n.r);
  }

  // Dreierfolgen F + X + Z: verschachtelt die Engine trotzdem, kürzt sie den oberen F-Arm, verbindet X weiter?
  for (const x of rules.nestX.keys())
    for (const z of chars) {
      sweep.push("F" + x + z);
      const v = best("F" + x + z), [gF, gX, gZ] = v.glyphs, [jFX, jXZ] = [v.joins[0], v.joins[1]];
      const fn = glyphName("F"), xn = glyphName(x), zn = glyphName(z);
      if (jFX.type !== "nest") {
        rules.skip.push([fn, xn, zn]);
        continue;
      }
      let f = rules.trimX.get(x) ?? fNest;
      if (gF.p.top < f.inst.p.top - 0.5) {
        f = trimF(gF.p);
        rules.trim.push([xn, zn, f]);
      }
      // X.short, oder X.short.foot / X.short.term, wenn X rechts weiter verbindet (Z mit Unterlänge darunter); ein zweites Verschachteln kann der Font nicht
      const further = jXZ.type === "underrun" || jXZ.type === "share" || jXZ.type === "tail";
      const gx = further ? glyph(x, gX.p) : rules.nestX.get(x)!;
      record("nest", f, gx, gX.x - gF.x);
      if (further) record(jXZ.sub ?? jXZ.type, gx, glyph(z, gZ.p), gZ.x - gX.x);
    }

  // Ketten Z + A + B: setzt die Engine die Verbindung A–B auch hinter Z, und stehen Z und A wie im Font?
  const plain = (t: string, i: number) => {
    const g = best(t).glyphs[i];
    return keyOf(g.char, g.p) === keyOf(g.char, defaults(GLYPHS[g.char]));
  };
  for (const [name, ab] of chained)
    for (const z of chars) {
      sweep.push(z + ab);
      if (!plain(z + ab, 1)) continue;
      // verbindet die Engine hinter Z gar nicht (P vor ch), darf der Font es auch nicht – je Partner geprüft: hinter P bleibt c.term vor i
      const a = [...ab][0], bs = [...new Set(joins.filter((j) => j.l.name === name).map((j) => j.r.char))];
      bs.forEach((b) => sweep.push(z + a + b));
      rules.block.set(name, [...(rules.block.get(name) ?? []), [z, bs.filter((b) => plain(z + a + b, 1))]]);
    }

  // Unterlänge davor (Komma, „, g …): setzt die Engine hinter Z keinen Schwanz unter L, darf der Font es auch nicht („Gymnasium“, „Typ“)
  const descs = chars.filter((c) => GLYPHS[c].desc);
  for (const j of rules.tail)
    for (const z of descs) {
      const t = z + j.l.char + j.r.char, k = `${j.l.name} ${glyphName(j.r.char)}`;
      sweep.push(t);
      if (plain(t, 2) && !rules.untail.get(k)?.includes(z)) rules.untail.set(k, [...(rules.untail.get(k) ?? []), z]);
    }

  // Unterschneidung: freie Seiten gegeneinander mit dem Abstand „keine Verbindung“, verbundene Paare mit dem Engine-Abstand
  const all = [...reg.values()];
  const leftFree = all.filter((g) => !g.role.left), rightFree = all.filter((g) => !g.role.right);
  const kern = new Map<string, [string, string, number]>();
  for (const l of leftFree)
    for (const r of rightFree) kern.set(`${l.name} ${r.name}`, [l.name, r.name, kernFor(l.inst, r.inst, spacing(l.inst, placed(r), S))]);
  for (const j of joins) {
    // bleibt der rechte Partner unverändert (TH, CH), gilt der Abstand auch für seine links freien Varianten (E.foot, F.nest …)
    const rs = j.r === base(j.r.char) ? all.filter((g) => g.char === j.r.char && !g.role.right) : [j.r];
    for (const r of rs) kern.set(`${j.l.name} ${r.name}`, [j.l.name, r.name, kernFor(j.l.inst, r.inst, j.dx)]);
  }

  // Glyphen: Grundzeichen, Varianten, Leerzeichen, Namens-Ligatur, .notdef
  const notdef = instance(PLACEHOLDER, defaults(PLACEHOLDER), S);
  const glyphs: FontGlyph[] = [
    { name: ".notdef", unicodes: [], advance: advance(notdef), parts: parts(notdef, ox(notdef)) },
    ...all.map((g) => ({ name: g.name, unicodes: g === base(g.char) ? [g.char.codePointAt(0)!] : [], advance: advance(g.inst), parts: parts(g.inst, ox(g.inst)) })),
    { name: "space", unicodes: [0x20], advance: S.wordGap - S.gap, parts: [] },
    { name: "uni00A0", unicodes: [0xa0], advance: S.wordGap - S.gap, parts: [] },
    nameLigature(),
  ];
  const fea = features(reg, fNest, rules, lower);
  return {
    format: FORMAT,
    info: { family: "Neustift", style: "Regular", version, unitsPerEm: 1000, capHeight: S.capHeight, xHeight: S.xHeight, ascender: 760, descender: -240, stroke: S.stroke },
    glyphs,
    kerning: [...kern.values()].filter(([, , v]) => v !== 0),
    fea,
    ...expectations(reg, fNest, [...new Set(sweep)]), // F + X + Z kommt auch als Kette vor
  };
}

/** Namens-Ligatur: Engine-Layout der Vorlage HAGEN AAD FOCK als eine Glyphe. */
function nameLigature(): FontGlyph {
  const v = layoutLine(hagen.text, { style: S, interlock: hagen.controls.interlock, targetWidth: null, pins: hagen.pins as unknown as Pins }).variants[hagen.variant];
  const x0 = SB - v.minX;
  return {
    name: NAME_LIG,
    unicodes: [],
    advance: Math.round(v.width + 2 * SB),
    parts: [...v.glyphs.flatMap((g) => parts(g.inst, g.x + x0)), { strokes: v.extras.map((e) => shift(e, x0)), bottom: 0, top: S.capHeight }],
  };
}

type Pair = { l: Glyph; r: Glyph };
/** block: linke Variante → [Zeichen, Partner], hinter dem Zeichen setzt die Engine sie vor diesen Partnern nicht; under: unterfahren, term: Bogenende, cross: Querstrich teilen, tail: Unterlänge nach links, hook: f-Haken gekürzt; skip/trim: F-Dreierfolgen; untail: „L R“ → Zeichen mit Unterlänge, hinter denen R keinen Schwanz bekommt. */
type Rules = { nestX: Map<string, Glyph>; trimX: Map<string, Glyph>; under: Pair[]; term: Pair[]; cross: Pair[]; tail: Pair[]; hook: Pair[]; skip: string[][]; trim: [string, string, Glyph][]; block: Map<string, [string, string[]][]>; untail: Map<string, string[]> };

/** Feature-Datei: liga (Name), dlig (HAF), calt (verschachteln, unterfahren, Bogenende, Querstrich, Unterlänge, f-Haken) in dieser Reihenfolge. */
function features(reg: Map<string, Glyph>, fNest: Glyph, r: Rules, lower: Glyph[]): string {
  const word = [...reg.values()].filter((g) => /^[A-Za-zÄÖÜäöüẞß0-9]$/.test(g.char)).map((g) => g.name);
  const seq = (t: string) => [...t].map((c) => (c === " " ? "space" : glyphName(c)));
  const marked = (t: string) => seq(t).map((n) => n + "'").join(" ");
  const out = ["languagesystem DFLT dflt;", "languagesystem latn dflt;", "", `@WORD = [${word.join(" ")}];`, ""];
  out.push(`lookup NAME_LIG {\n  sub ${seq(hagen.text).join(" ")} by ${NAME_LIG};\n} NAME_LIG;`);
  out.push(`lookup HAF_LIG {\n  sub H A F by H_A_F;\n} HAF_LIG;`);
  for (const [feat, text, lig] of [["liga", hagen.text, "NAME_LIG"], ["dlig", "HAF", "HAF_LIG"]]) {
    const m = marked(text).split(" ");
    out.push(`feature ${feat} {\n  ignore sub @WORD ${m.join(" ")};\n  ignore sub ${m.join(" ")} @WORD;\n  sub ${m[0]} lookup ${lig} ${m.slice(1).join(" ")};\n} ${feat};`);
  }
  // calt-Lookups. Zuerst die Kleinbuchstaben-Formen der Satzzeichen (wie lowerForms in der Engine): der rechte Nachbar entscheidet, ohne Buchstaben rechts der linke
  const all = [...reg.values()], cls = (re: RegExp) => all.filter((g) => re.test(g.char)).map((g) => g.name);
  out.push(`@LC = [${cls(/\p{Ll}/u).join(" ")}];`, `@UC = [${[...cls(/[\p{Lu}\p{N}\uE000]/u), NAME_LIG].join(" ")}];`);
  const parens = lower.filter((g) => "()".includes(g.char)).flatMap((g) => [glyphName(g.char), g.name]);
  out.push(`@NOPAREN = [${[...all.map((g) => g.name).filter((n) => !parens.includes(n)), "space", "uni00A0", NAME_LIG].join(" ")}];`);
  const dash = lower.filter((g) => "-–".includes(g.char)).flatMap((g) => {
    const n = glyphName(g.char);
    return [
      `  sub ${n}' @LC by ${g.name};`,
      `  ignore sub ${n}' @UC;`,
      ...[`@UC ${n}'`, `@UC space ${n}'`].map((c) => `  ignore sub ${c};`),
      ...[`@LC ${n}'`, `@LC space ${n}'`].map((c) => `  sub ${c} by ${g.name};`),
    ];
  });
  out.push(`lookup LOWER_DASH {\n${dash.join("\n")}\n} LOWER_DASH;`);
  out.push(`lookup LOWER_PAREN_OPEN {\n  sub parenleft' @LC by parenleft.lc;\n} LOWER_PAREN_OPEN;`);
  const reach = Array.from({ length: PAREN_REACH + 1 }, (_, k) => Array(k).fill("@NOPAREN").join(" "));
  out.push(`lookup LOWER_PAREN_CLOSE {\n${[
    ...reach.map((m) => `  ignore sub parenleft ${m}${m && " "}parenright';`), // „)“ folgt seiner „(“
    ...reach.map((m) => `  sub parenleft.lc ${m}${m && " "}parenright' by parenright.lc;`),
    "  sub @LC parenright' by parenright.lc;", // keine „(“ in Reichweite: das Zeichen davor entscheidet
  ].join("\n")}\n} LOWER_PAREN_CLOSE;`);
  const nestX = [...r.nestX.keys()].map(glyphName);
  const fnests = [...new Set([fNest, ...r.trimX.values(), ...r.trim.map(([, , f]) => f)])].map((g) => g.name);
  out.push(`@FNEST = [${fnests.join(" ")}];`);
  out.push(`lookup NEST_LEFT {\n${[
    "  ignore sub @FNEST F';", // ein verschachteltes F verschachtelt nicht noch einmal
    ...r.skip.map(([f, x, z]) => `  ignore sub ${f}' ${x} ${z};`),
    ...r.trim.map(([x, z, f]) => `  sub F' ${x} ${z} by ${f.name};`),
    ...[...r.trimX].map(([x, f]) => `  sub F' ${glyphName(x)} by ${f.name};`),
    `  sub F' [${nestX.join(" ")}] by ${fNest.name};`,
  ].join("\n")}\n} NEST_LEFT;`);
  const changed = [...r.nestX].filter(([c, g]) => g.name !== glyphName(c));
  out.push(`lookup NEST_RIGHT {\n${changed.map(([c, g]) => `  sub @FNEST ${glyphName(c)}' by ${g.name};`).join("\n")}\n} NEST_RIGHT;`);
  const uniq = (xs: string[]) => [...new Set(xs)];
  const input = (g: Glyph) => glyphName(g.char) + (g.inst.p.h < 1 ? ".short" : ""); // so heißt die Glyphe, wenn der Lookup sie sieht
  const variants = (c: string) => [...reg.values()].filter((g) => g.char === c);
  const partner = (c: string) => `[${variants(c).filter((g) => !g.role.right).map((g) => g.name).join(" ")}]`; // Grundglyphe samt links freier Varianten
  /** Ausnahmen zuerst: hinter den gesperrten Zeichen (samt ihren Varianten) bleibt die linke Glyphe, wie sie ist. */
  const ignores = (js: Pair[]) =>
    uniq(js.filter((j) => r.block.has(j.l.name)).map((j) => j.l.name)).flatMap((n) => {
      const ls = js.filter((j) => j.l.name === n), byPartners = new Map<string, string[]>(); // gleiche gesperrte Partner: eine Regel
      for (const [z, bs] of r.block.get(n)!) {
        const ps = uniq(ls.filter((j) => bs.includes(j.r.char)).flatMap((j) => partner(j.r.char).slice(1, -1).split(" "))).join(" ");
        if (ps) byPartners.set(ps, [...(byPartners.get(ps) ?? []), ...variants(z).map((g) => g.name)]);
      }
      return [...byPartners].map(([ps, zs]) => `  ignore sub [${zs.join(" ")}] ${input(ls[0].l)}' [${ps}];`);
    });
  out.push(`lookup UNDERRUN_LEFT {\n${[...ignores(r.under), ...uniq(r.under.map((j) => `  sub ${input(j.l)}' ${glyphName(j.r.char)} by ${j.l.name};`))].join("\n")}\n} UNDERRUN_LEFT;`);
  out.push(`lookup UNDERRUN_RIGHT {\n${uniq(r.under.map((j) => `  sub ${j.l.name} ${glyphName(j.r.char)}' by ${j.r.name};`)).join("\n")}\n} UNDERRUN_RIGHT;`);
  /** Linke Glyphe wird zur Variante vor dem Partner; bleibt sie, wie sie ist (T bleibt T), genügt die Unterschneidung. */
  const left = (name: string, js: Pair[]) => {
    const subs = js.filter((j) => j.l.name !== input(j.l)).map((j) => `  sub ${input(j.l)}' ${partner(j.r.char)} by ${j.l.name};`);
    out.push(`lookup ${name} {\n${[...ignores(js), ...uniq(subs)].join("\n")}\n} ${name};`);
  };
  left("TERM_LEFT", r.term);
  left("CROSS_LEFT", r.cross);
  const untail = [...r.untail].map(([lr, zs]) => `  ignore sub [${zs.flatMap((z) => variants(z).map((g) => g.name)).join(" ")}] ${lr}';`);
  out.push(`lookup TAIL_RIGHT {\n${[...untail, ...uniq(r.tail.map((j) => `  sub ${j.l.name} ${glyphName(j.r.char)}' by ${j.r.name};`))].join("\n")}\n} TAIL_RIGHT;`);
  left("TRIM_LEFT", r.hook);
  const calt = ["LOWER_DASH", "LOWER_PAREN_OPEN", "LOWER_PAREN_CLOSE", "NEST_LEFT", "NEST_RIGHT", "UNDERRUN_LEFT", "UNDERRUN_RIGHT", "TERM_LEFT", "CROSS_LEFT", "TAIL_RIGHT", "TRIM_LEFT"];
  out.push(`feature calt {\n${calt.map((l) => `  lookup ${l};`).join("\n")}\n} calt;`);
  // case: Versalform überall (nach calt in der Lookup-Liste, nimmt die Kleinbuchstaben-Formen zurück)
  out.push(`lookup CASE {\n${lower.map((g) => `  sub ${g.name} by ${glyphName(g.char)};`).join("\n")}\n} CASE;`);
  out.push(`feature case {\n  lookup CASE;\n} case;`);
  return out.join("\n") + "\n";
}

const TESTS: [string, Record<string, boolean>][] = [
  ["FLÄCHE", {}], ["fläche", {}], ["DIE FLÄCHE", {}], ["HAGEN AAD FOCK", {}], ["HAF", { dlig: true }], ["HAF", {}], ["HAFEN", { dlig: true }],
  ["WIENER WERKSTÄTTE", {}], ["THEATER", {}], ["ZAUBER", {}], ["GLAS", {}], ["TEAM", {}], ["OFFEN", {}], ["AUFTAKT", {}],
  ["Hagen Aad Fock", {}], ["haf", { dlig: true }], ["Hagen", {}], ["Tafel", {}], ["Stift", {}], ["ich", {}], ["Die Fläche", {}], ["Pflicht", {}], ["Kaffee", {}],
  ["Wetter", {}], ["Acht", {}], ["Echo", {}], ["Schrift", {}], ["bett", {}], ["schiff", {}], ["Mannschaft", {}],
  ["„Gymnasium“", {}], ["„Typ“", {}], // Unterlänge hinter einer Unterlänge: kein Schwanz unter das T
  ["Pci", {}], ["\uE000cu", {}], // hinter P und dem Monogramm: c.term vor i und u
  // Feinschliff: Satzzeichen mit Mindestabstand und Höhe je Umgebung
  ["E-g", {}], ["E-G", {}], ["F-a", {}], ["L-T", {}], ["H-H", {}], ["T-Shirt", {}], ["Ost-West", {}], ["e-mail", {}], ["E-mail", {}], ["x-Achse", {}],
  ["A-Z", {}], ["10-20", {}], ["10–20 Uhr", {}], ["Wien – Berlin", {}], ["und – so", {}], ["(neu)", {}], ["(NEU)", {}], ["(Hagen)", {}], ["(neu und alt)", {}],
  ["FF.", {}], ["T.", {}], ["r.", {}], ["fT-", {}], ["e- und", {}], ["A-", {}],
];

/** Sollwerte: Glyphenfolge und Ursprünge je Wort wie die Engine; bei einem Wort zusätzlich die Striche für den Flächenvergleich.
 *  Dazu der Abgleich (Spec §7.1) über alle Paare und F-Dreierfolgen, ohne Striche; Folgen mit einer Glyphe, die der Font nicht haben kann (?), entfallen. */
function expectations(reg: Map<string, Glyph>, fNest: Glyph, sweep: string[]): Pick<FontData, "expect" | "dropped"> {
  const find = (c: string, p: Params) => {
    const q = c === "F" && p.top < fNest.inst.p.top - 0.5 ? { ...p, top: floor5(p.top) } : p; // gekürzter Arm: abgerundete Variante
    const k = c + JSON.stringify(Object.keys(GLYPHS[c].params).map((x) => Math.round(q[x] * 100) / 100));
    return reg.get(k)?.name ?? `?${c}`;
  };
  const insts = new Map<string, Inst>(); // je Glyphe nur einmal vermessen: die Sollwerte wiederholen dieselben Glyphen tausendfach
  const inst = (c: string, p: Params) => {
    const k = c + JSON.stringify(Object.keys(GLYPHS[c].params).map((x) => p[x]));
    if (!insts.has(k)) insts.set(k, instance(GLYPHS[c], p, S));
    return insts.get(k)!;
  };
  const entry = (text: string, features: Record<string, boolean>): Expect => {
    if (text === hagen.text) return { text, features, words: [[{ name: NAME_LIG, x: 0 }]], parts: null };
    if (text === "HAF" && features.dlig) return { text, features, words: [[{ name: "H_A_F", x: 0 }]], parts: null };
    const gs = best(text).glyphs.map((g) => ({ ...g, inst: inst(g.char, g.p) })), words: ExpectGlyph[][] = [];
    let start = 0;
    gs.forEach((g, i) => {
      const o = g.x - ox(g.inst);
      if (i === 0 || g.index !== gs[i - 1].index + 1) words.push([]), (start = o);
      words[words.length - 1].push({ name: find(g.char, g.p), x: o - start });
    });
    const o0 = gs[0].x - ox(gs[0].inst);
    return { text, features, words, parts: words.length === 1 ? gs.flatMap((g) => parts(g.inst, g.x - o0)) : null };
  };
  const swept = sweep.map((text) => ({ ...entry(text, {}), parts: null })), lost = (e: Expect) => e.words.flat().some((g) => g.name.startsWith("?"));
  return { expect: [...TESTS.map(([text, features]) => entry(text, features)), ...swept.filter((e) => !lost(e))], dropped: swept.filter(lost).map((e) => e.text) };
}
