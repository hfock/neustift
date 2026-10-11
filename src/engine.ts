import { gapOffset, mergeProfiles, shift, type Profile, type Pt, type Stroke } from "./geom";
import { GLYPHS, PLACEHOLDER, cutTop, defaults, inRange, type GlyphDef, type Params } from "./glyphs";
import { apply, barLink, collides, instance, joinsFor, trimTop, type Inst, type Join } from "./rules";
import type { Style } from "./style";

export type Pins = { letters: Record<number, Params>; joins: Record<number, Join> };
export type Options = { style: Style; interlock: number; targetWidth: number | null; pins: Pins; variants?: number };
/** index = Position des Zeichens im Text (Leer- und Umbruchzeichen mitgezählt); y = Grundlinie der Zeile (0 = erste, darunter negativ). */
export type Placed = { index: number; char: string; inst: Inst; x: number; y?: number };
/** height: Tinte oben der ersten bis unten der letzten Zeile (mit Unterlängen). */
export type Layout = { glyphs: Placed[]; extras: Stroke[]; joins: Record<number, Join>; minX: number; maxX: number; width: number; score: number; height: number; lines: number };
export type Result = { variants: Layout[]; warnings: string[] };

/** Alle Gewichte an einer Stelle. Verbindungskosten bei Verschränkung 0; davon wird gain × Verschränkung abgezogen. */
export const WEIGHTS = { nest: 0.2, underrun: 0.2, term: 0.2, cross: 0.2, tail: 0.2, stem: 1.0, leg: 0.6, bar: 0.6, gain: 1.0, width: 0.2, flush: 0.3, rhythm: 0.2, deviation: 5, aspect: 1, uneven: 1 };
const BEAM = 32;
const CODE: Record<string, string> = { none: "-", nest: "N", underrun: "U", term: "T", stem: "S", leg: "L", cross: "Q", tail: "G" };

type Letter = { index: number; char: string; def: GlyphDef };
type Node = { placed: Placed[]; joins: Record<number, Join>; extras: Stroke[]; cost: number; key: string };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function joinCost(j: Join, interlock: number): number {
  const g = WEIGHTS.gain * interlock;
  const base = j.type === "none" ? null : j.type === "share" ? WEIGHTS[j.sub!] : WEIGHTS[j.type as "nest" | "underrun" | "tail"];
  return (base === null ? 0 : base - g) + (j.bar ? WEIGHTS.bar - g : 0);
}

/** Text in Wörter aus Buchstaben zerlegen; Zeichen wie getippt, unbekannte → Platzhalter. */
function words(text: string, warn: Set<string>): Letter[][] {
  const out: Letter[][] = [];
  let cur: Letter[] = [];
  [...text].forEach((char, index) => {
    if (char.trim() === "") {
      if (cur.length) out.push(cur);
      cur = [];
      return;
    }
    const def = GLYPHS[char];
    if (!def) warn.add(`Zeichen „${char}“ noch nicht entworfen`);
    cur.push({ index, char, def: def ?? PLACEHOLDER });
  });
  if (cur.length) out.push(cur);
  return out;
}

const conflicts = (p: Params, lock?: Params) => !!lock && Object.entries(lock).some(([k, v]) => Math.abs(p[k] - v) > 1e-6);

/** Alle Fortsetzungen eines Teil-Layouts um den Buchstaben cur. */
function expand(n: Node, cur: Letter, o: Options, usePins: boolean, force = false): Node[] {
  const s = o.style, out: Node[] = [];
  const last = n.placed[n.placed.length - 1], prev = n.placed[n.placed.length - 2];
  const pin = usePins ? o.pins.joins[last.index] : undefined;
  const pinL = usePins ? o.pins.letters[last.index] : undefined;
  const lockL = pinL && !conflicts(last.inst.p, pinL) ? pinL : undefined; // schon an der linken Grenze verworfen (Hinweis steht dort)
  const lockR = usePins ? o.pins.letters[cur.index] : undefined;
  const rp0 = { ...defaults(cur.def), ...lockR };
  if (!inRange(cur.def, rp0)) return []; // Pin außerhalb des Spielraums (Vorlage/Speicher): wie unerfüllbar behandeln – sonst riesige Striche
  const options = force ? [{ type: "none" } as Join] : joinsFor(last.inst, instance(cur.def, rp0, s));
  for (const j of options) {
    if (pin && (pin.type !== j.type || pin.sub !== j.sub)) continue;
    const res = apply(j, last.inst, cur.def, rp0, s, lockL);
    if (!res) continue;
    // Ein gepinnter oberer Arm gilt: Regeln verlängern ihn nicht, die Armkürzung lässt ihn stehen
    const lp = lockL?.top === undefined ? res.lp : { ...res.lp, top: lockL.top };
    if (conflicts(lp, lockL) || conflicts(res.rp, lockR) || !inRange(last.inst.def, lp)) continue;
    const rx = last.x + res.dx, r = instance(cur.def, res.rp, s);
    const l0 = lp === last.inst.p ? last.inst : instance(last.inst.def, lp, s);
    const l = trimTop(l0, last.x, r, rx, s, lockL); // gepinnter Arm oder Haken bleibt
    const pinP = usePins && prev ? o.pins.letters[prev.index] : undefined;
    const p = prev && trimTop(prev.inst, prev.x, r, rx, s, pinP && !conflicts(prev.inst.p, pinP) ? pinP : undefined); // wie lockL: nur ein Pin, den der Buchstabe wirklich trägt
    if (!force && j.type !== "share" && collides(l, last.x, r, rx, s)) continue;
    if (!force && prev && collides(p!, prev.x, r, rx, s)) continue;
    for (const bar of [false, true]) {
      if (pin?.bar !== undefined && pin.bar !== bar) continue;
      const link = bar && (j.type === "none" || j.type === "share") ? barLink(l, last.x, r, rx, s) : null;
      if (bar && !link) continue;
      const jb: Join = { ...j, bar };
      const placed = n.placed.slice(0, -2);
      if (prev) placed.push({ ...prev, inst: p! });
      placed.push({ ...last, inst: l }, { index: cur.index, char: cur.char, inst: r, x: rx });
      out.push({
        placed,
        joins: { ...n.joins, [last.index]: jb },
        extras: link ? [...n.extras, link] : n.extras,
        cost: n.cost + joinCost(jb, o.interlock),
        key: n.key + CODE[j.sub ?? j.type] + (bar ? "+" : ""),
      });
    }
  }
  return out;
}

function prune(nodes: Node[]): Node[] {
  const seen = new Set<string>();
  return nodes
    .sort((a, b) => a.cost - b.cost || cmp(a.key, b.key))
    .filter((n) => !seen.has(n.key) && !!seen.add(n.key))
    .slice(0, BEAM);
}

/** Strahlsuche über die Buchstabengrenzen eines Worts. */
function searchWord(word: Letter[], o: Options, warn: Set<string>): Node[] {
  const s = o.style, first = word[0];
  let p0 = { ...defaults(first.def), ...o.pins.letters[first.index] };
  if (!inRange(first.def, p0)) {
    warn.add(`Pin bei „${first.char}“ nicht erfüllbar`); // Wert außerhalb des Spielraums, z. B. aus einer bearbeiteten Vorlage
    p0 = defaults(first.def);
  }
  let beam: Node[] = [{ placed: [{ index: first.index, char: first.char, inst: instance(first.def, p0, s), x: 0 }], joins: {}, extras: [], cost: 0, key: "" }];
  for (let k = 1; k < word.length; k++) {
    let next = beam.flatMap((n) => expand(n, word[k], o, true));
    if (!next.length) {
      const pair = word[k - 1].char + word[k].char, pinned = Object.keys(o.pins.letters).length + Object.keys(o.pins.joins).length > 0;
      warn.add(pinned ? `Pin bei „${pair}“ nicht erfüllbar` : `Kein kollisionsfreier Platz für „${pair}“`);
      next = beam.flatMap((n) => expand(n, word[k], { ...o, pins: { letters: o.pins.letters, joins: {} } }, true));
      if (!next.length) next = beam.flatMap((n) => expand(n, word[k], o, false));
    }
    if (!next.length) next = beam.flatMap((n) => expand(n, word[k], o, false, true));
    beam = prune(next);
  }
  return beam;
}

function extent(placed: Placed[]) {
  let minX = Infinity, maxX = -Infinity;
  for (const g of placed) {
    minX = Math.min(minX, g.x + g.inst.prof.minX);
    maxX = Math.max(maxX, g.x + g.inst.prof.maxX);
  }
  return { minX, maxX, width: maxX - minX };
}

/** Anteil der Wortbreite mit Tinte an Ober- und Unterkante (0..1). */
function flush(n: Node, s: Style, minX: number, width: number): number {
  const res = 5, cells = Math.max(1, Math.ceil(width / res));
  const top = new Uint8Array(cells), bottom = new Uint8Array(cells);
  for (const g of n.placed)
    for (const p of g.inst.ink) {
      const row = p.y >= s.capHeight - s.stroke / 2 ? top : p.y <= s.stroke / 2 ? bottom : null;
      if (row) row[Math.min(cells - 1, Math.max(0, Math.floor((g.x + p.x - minX) / res)))] = 1;
    }
  const sum = (a: Uint8Array) => a.reduce((t, v) => t + v, 0);
  return (sum(top) + sum(bottom)) / (2 * cells);
}

/** Ungleichmäßigkeit der Abstände zwischen Senkrechten (Variationskoeffizient). */
function rhythm(n: Node): number {
  const xs = n.placed
    .flatMap((g) => g.inst.docks.flatMap((d) => (d.kind === "stem" ? [g.x + d.x] : [])))
    .sort((a, b) => a - b);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]).filter((d) => d > 5);
  if (gaps.length < 2) return 0;
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length) / mean;
}

function finalScore(n: Node, s: Style): number {
  const { minX, width } = extent(n.placed);
  return n.cost + WEIGHTS.width * (width / s.capHeight) + WEIGHTS.flush * (1 - flush(n, s, minX, width)) + WEIGHTS.rhythm * rhythm(n);
}

/** Wörter mit Wortabstand nebeneinandersetzen. */
function assemble(parts: Node[], score: number, s: Style): Layout {
  const glyphs: Placed[] = [], extras: Stroke[] = [], joins: Record<number, Join> = {};
  let prev: Profile | null = null, last: Placed | null = null;
  for (const n of parts) {
    const local = mergeProfiles(n.placed.map((g) => ({ prof: g.inst.prof, x: g.x })));
    // nach der Tinte, aber nie enger als zwischen den Wortkästen wie im Font – sonst liest sich „DA VOR“ als „DAVOR“
    const box = prev && last ? prev.maxX + s.wordGap + (last.inst.def.adjust?.right ?? 0) + (n.placed[0].inst.def.adjust?.left ?? 0) - local.minX : 0;
    const offset: number = prev ? Math.max(gapOffset(prev, local, s.wordGap), box) : 0;
    last = n.placed[n.placed.length - 1];
    glyphs.push(...n.placed.map((g) => ({ ...g, x: g.x + offset })));
    extras.push(...n.extras.map((e) => shift(e, offset)));
    Object.assign(joins, n.joins);
    prev = mergeProfiles(n.placed.map((g) => ({ prof: g.inst.prof, x: g.x + offset })));
  }
  return { glyphs, extras, joins, ...extent(glyphs), score, height: s.capHeight + Math.max(0, ...glyphs.map((g) => g.inst.def.desc ?? 0)), lines: 1 };
}

/** Regel e: Breiten im Spielraum anpassen, bis die Zeile die Zielbreite hat. Verbindungen und Pins bleiben so, wie die Variante sie hat. */
function fitWidth(v: Layout, ws: Letter[][], o: Options): Layout {
  const target = o.targetWidth!;
  let cur = v, step = 1;
  for (let it = 0; it < 8 && Math.abs(target - cur.width) > 1; it++) {
    const delta = target - cur.width;
    const flex = cur.glyphs.filter((g) => g.inst.def.params.w && o.pins.letters[g.index]?.w === undefined);
    const room = flex.map((g) => (delta > 0 ? g.inst.def.params.w.max - g.inst.p.w : g.inst.p.w - g.inst.def.params.w.min));
    const total = room.reduce((a, b) => a + b, 0);
    if (total < 1) break;
    const ratio = Math.min(1, Math.abs(delta) / total) * Math.sign(delta) * step;
    // gepinnte Regler so festhalten, wie die Variante sie tatsächlich hat – ein unerfüllbarer Pin blockiert sonst jede Runde
    const letters: Record<number, Params> = {};
    for (const g of cur.glyphs) {
      const lock = o.pins.letters[g.index];
      if (lock) letters[g.index] = Object.fromEntries(Object.keys(lock).map((k) => [k, g.inst.p[k]]));
    }
    flex.forEach((g, i) => (letters[g.index] = { ...letters[g.index], w: g.inst.p.w + ratio * room[i] }));
    const lost = new Set<string>();
    const next = assemble(ws.map((w) => searchWord(w, { ...o, pins: { letters, joins: cur.joins } }, lost)[0]), v.score, o.style);
    if (lost.size) {
      step /= 2; // Schritt zu groß: eine Verbindung würde reißen – kleiner weiter
      continue;
    }
    cur = next;
  }
  return cur;
}

/** Eine Zeile setzen: beste Varianten (Rangliste) plus Hinweise. */
export function layoutLine(text: string, o: Options): Result {
  const warn = new Set<string>(), s = o.style, count = o.variants ?? 6;
  const ws = words(text, warn);
  if (!ws.length) return { variants: [], warnings: [] };
  // Pins nur für Regler, die der Buchstabe hat: ein Stand von vor M4 kann h auf einem heute kleinen Buchstaben pinnen
  const letters: Pins["letters"] = {};
  for (const l of ws.flat()) {
    const pin = o.pins.letters[l.index];
    if (pin) letters[l.index] = Object.fromEntries(Object.entries(pin).filter(([k]) => k in l.def.params));
  }
  o = { ...o, pins: { ...o.pins, letters } };
  let combos: { parts: Node[]; score: number; key: string }[] = [{ parts: [], score: 0, key: "" }];
  for (const w of ws) {
    const cands = searchWord(w, o, warn)
      .map((n) => ({ n, score: finalScore(n, s) }))
      .sort((a, b) => a.score - b.score || cmp(a.n.key, b.n.key))
      .slice(0, count);
    combos = combos
      .flatMap((c) => cands.map((x) => ({ parts: [...c.parts, x.n], score: c.score + x.score, key: `${c.key}|${x.n.key}` })))
      .sort((a, b) => a.score - b.score || cmp(a.key, b.key))
      .slice(0, count);
  }
  let variants = combos.map((c) => assemble(c.parts, c.score, s));
  if (o.targetWidth && variants.length) {
    const t = o.targetWidth;
    variants = variants
      .map((v) => fitWidth(v, ws, o))
      .map((v) => ({ ...v, score: v.score + WEIGHTS.deviation * (Math.abs(t - v.width) / s.capHeight) }))
      .sort((a, b) => a.score - b.score); // stabil: Gleichstände behalten ihre Rangfolge
    if (Math.abs(t - variants[0].width) > 2) warn.add("Zielbreite nicht erreichbar – nächstbeste Breite gezeigt");
  }
  return { variants, warnings: [...warn] };
}

/** Mögliche Verbindungen an der Grenze nach Zeichen i (leer an Wortgrenzen). */
export function joinOptions(v: Layout, i: number): Join[] {
  const k = v.glyphs.findIndex((g) => g.index === i), a = v.glyphs[k], b = v.glyphs[k + 1];
  return a && b && b.index === i + 1 ? joinsFor(a.inst, b.inst) : [];
}

const MAX_LINES = 6;
/** Sperrung, wenn fitWidth eine Zeile nicht auf Blockbreite bringt: je offene Lücke höchstens TRACK × Buchstabenabstand. */
const TRACK = 1;
/** Varianten mit anderem Umbruch: bis zu SPLITS Teilungen, deren Bewertung höchstens SPLIT_MARGIN über der besten liegt. */
const SPLITS = 3, SPLIT_MARGIN = 0.5;
/** Bis zu so vielen Wörtern werden alle Umbrüche probiert, darüber je Zeilenzahl die ausgewogenste Teilung. */
const ENUM_WORDS = 16;

/** Senkung der Grundlinie, bei der die kleinste Lichtweite zwischen Tinte oben und Tinte unten genau gap ist (untere Zeile rückt von unten hoch). */
function lineDrop(up: Placed[], down: Placed[], s: Style): number {
  const gap = s.gap;
  // je Spalte (1 Einheit) der tiefste Punkt oben und der höchste unten; nur sie können den Abstand bestimmen.
  // Nur sichtbare Tinte wie im Renderer: zwischen Unterlänge und Oberkante (eigene Strich-Oberkanten wie der k-Arm nicht berücksichtigt)
  const col = (gs: Placed[], low: boolean) => {
    const m = new Map<number, Pt>();
    for (const g of gs) {
      const top = Math.min(s.capHeight, cutTop(g.inst.def, g.inst.p, s)), bot = -(g.inst.def.desc ?? 0);
      for (const q of g.inst.ink) {
        if (q.y < bot || q.y > top) continue;
        const x = g.x + q.x, c = Math.floor(x), e = m.get(c);
        if (!e || (low ? q.y < e.y : q.y > e.y)) m.set(c, { x, y: q.y });
      }
    }
    return m;
  };
  const lo = col(up, true), hi = col(down, false);
  let drop = -Infinity;
  for (const [c, p] of lo)
    for (let k = c - gap - 1; k <= c + gap + 1; k++) {
      const q = hi.get(k), dx = q ? Math.abs(q.x - p.x) : gap;
      if (dx < gap) drop = Math.max(drop, q!.y - p.y + Math.sqrt(gap * gap - dx * dx));
    }
  return drop === -Infinity ? s.capHeight + gap : drop; // keine Tinte übereinander: Versalzeile im Buchstabenabstand
}

/**
 * Rest bis zur Blockbreite gleichmäßig in die Lücken ohne Verbindung (Wortabstand, Buchstaben ohne Verbindung und Balken),
 * je Lücke höchstens max – sonst bleibt die Zeile kürzer und der Hinweis zur Zielbreite erscheint.
 */
function pad(v: Layout, w: number, max: number): Layout {
  const rest = w - v.width;
  const open = v.glyphs.slice(1).map((g, k) => {
    const j = v.joins[v.glyphs[k].index];
    return !j || (j.type === "none" && !j.bar);
  });
  const n = open.filter(Boolean).length;
  if (rest <= 1 || !n) return v;
  let dx = 0;
  const offs = v.glyphs.map((_, k) => (dx += k && open[k - 1] ? Math.min(max, rest / n) : 0));
  const glyphs = v.glyphs.map((g, k) => ({ ...g, x: g.x + offs[k] }));
  // Balken gehören zu einem verbundenen Paar: mit dem Buchstaben links davon verschieben
  const extras = v.extras.map((e) => {
    let k = 0;
    while (k + 1 < v.glyphs.length && v.glyphs[k + 1].x + v.glyphs[k + 1].inst.prof.minX <= e.start.x) k++;
    return shift(e, offs[k]);
  });
  return { ...v, glyphs, extras, ...extent(glyphs) };
}

/** Zeilen untereinanderstellen, jede so hoch wie möglich. */
function stack(rows: Layout[], score: number, s: Style): Layout {
  const glyphs: Placed[] = [], extras: Stroke[] = [], joins: Record<number, Join> = {};
  let y = 0, prev: Layout | null = null;
  for (const row of rows) {
    const r = { ...row, glyphs: row.glyphs.map((g) => ({ ...g, x: g.x - row.minX })) }; // linke Kanten bündig
    if (prev) y -= lineDrop(prev.glyphs, r.glyphs, s);
    glyphs.push(...r.glyphs.map((g) => ({ ...g, y })));
    extras.push(...r.extras.map((e) => shift(e, -row.minX, y)));
    Object.assign(joins, r.joins);
    prev = r;
  }
  const height = s.capHeight - Math.min(...glyphs.map((g) => g.y! - (g.inst.def.desc ?? 0)));
  return { glyphs, extras, joins, ...extent(glyphs), score, height, lines: rows.length };
}

/** Je Zeilenzahl 1..MAX_LINES die Teilung mit der kleinsten breitesten Zeile (lineare Partition, O(k·n²)). */
function balanced(n: number, width: (i: number, j: number) => number): number[][] {
  const out: number[][] = [];
  // best[k][j]: kleinste breiteste Zeile für die Wörter 0..j-1 in k Zeilen; from[k][j]: Anfang der letzten Zeile
  let best = Array.from({ length: n + 1 }, (_, j) => (j ? width(0, j - 1) : 0));
  const from: number[][] = [Array(n + 1).fill(0)];
  for (let k = 1; k <= Math.min(MAX_LINES, n); k++) {
    if (k > 1) {
      const next = Array(n + 1).fill(Infinity), arg = Array(n + 1).fill(0);
      for (let j = k; j <= n; j++)
        for (let i = k - 1; i < j; i++) {
          const v = Math.max(best[i], width(i, j - 1));
          if (v < next[j]) (next[j] = v), (arg[j] = i);
        }
      best = next;
      from.push(arg);
    }
    const starts: number[] = [];
    for (let kk = k - 1, j = n; kk >= 0; kk--) starts.unshift((j = from[kk][j]));
    out.push(starts);
  }
  return out;
}

/**
 * Text als Block setzen: Zeilen nach Enter oder (mit Seitenverhältnis Breite : Höhe) nach dem besten Umbruch an Wortgrenzen,
 * jede Zeile auf Blockbreite, eng gestapelt. Frei und ohne Enter: genau layoutLine.
 */
export function layoutText(text: string, o: Options & { aspect: number | null }): Result {
  const { aspect, ...lo } = o;
  if (!aspect && !text.includes("\n")) return layoutLine(text, lo);
  const s = o.style, count = o.variants ?? 6, warn = new Set<string>(), chars = [...text];
  // Wörter als Zeichenspannen [a, b); brk = Enter davor
  const spans: { a: number; b: number; brk: boolean }[] = [];
  let nl = false;
  chars.forEach((c, i) => {
    const w = spans[spans.length - 1];
    if (c.trim() === "") nl ||= c === "\n";
    else if (w && w.b === i) w.b++;
    else (spans.push({ a: i, b: i + 1, brk: nl }), (nl = false));
  });
  if (!spans.length) return { variants: [], warnings: [] };

  // Zeile = Wörter i..j; Text mit Leerzeichen statt der übrigen Zeichen, so bleiben die Indizes Textindizes
  const mask = (i: number, j: number) => chars.map((c, k) => (k >= spans[i].a && k < spans[j].b ? c : " ")).join("");
  // natürliche Zeile aus ihren Wörtern geschätzt: Breiten plus Wortabstand, Bewertung addiert sich je Wort wie in layoutLine
  const word = spans.map((_, i) => layoutLine(mask(i, i), { ...lo, targetWidth: null, variants: 1 }).variants[0]);
  const nat = (i: number, j: number) => {
    const ws = word.slice(i, j + 1);
    return { width: ws.reduce((t, v) => t + v.width, 0) + (j - i) * s.wordGap, score: ws.reduce((t, v) => t + v.score, 0) };
  };

  // Umbrüche als Zeilenanfänge. Enter fest (leere Zeilen fallen weg: eine Zeile ohne Wort hat keine Tinte);
  // sonst bis ENUM_WORDS Wörter alle an Wortgrenzen bis MAX_LINES Zeilen, darüber je Zeilenzahl die ausgewogenste
  let splits: number[][];
  if (text.includes("\n")) splits = [spans.flatMap((w, i) => (i === 0 || w.brk ? [i] : []))];
  else if (spans.length <= ENUM_WORDS) {
    splits = [];
    const walk = (starts: number[]) => {
      splits.push(starts);
      if (starts.length < MAX_LINES) for (let k = starts[starts.length - 1] + 1; k < spans.length; k++) walk([...starts, k]);
    };
    walk([0]);
  } else splits = balanced(spans.length, (i, j) => nat(i, j).width);
  const H = s.capHeight;
  // Bewertung: Abweichung vom Seitenverhältnis + größte Lücke einer Zeile zur breitesten (die Verbindungskosten sind für alle Teilungen gleich)
  const rated = splits.map((starts) => {
    const lines = starts.map((i, k) => [i, (starts[k + 1] ?? spans.length) - 1]);
    const ws = lines.map(([i, j]) => nat(i, j).width), wide = Math.max(...ws);
    const height = lines.length * H + (lines.length - 1) * s.gap; // Schätzung: Versalzeilen im Buchstabenabstand
    const shape = aspect ? WEIGHTS.aspect * Math.abs(Math.log(wide / height / aspect)) : 0;
    const uneven = WEIGHTS.uneven * (1 - Math.min(...ws) / wide);
    return { lines, block: o.targetWidth ?? Math.max(wide, aspect ? aspect * height : 0), uneven, score: shape + uneven };
  });
  rated.sort((x, y) => x.score - y.score);

  const ZIEL = "Zielbreite nicht erreichbar – nächstbeste Breite gezeigt";
  // ponytail: lange Texte nur mit der besten Teilung und 2 Varianten je Zeile (fitWidth auf langen Zeilen ist teuer);
  // mehr Auswahl kostet je Teilung etwa so viel noch einmal
  const long = spans.length > ENUM_WORDS;
  /** Eine Teilung setzen: jede Zeile auf die Blockbreite; ausgelotet mit der besten Variante je Zeile, dann alle Varianten auf die gefundene Breite. */
  const realize = (r: (typeof rated)[number]) => {
    const fit = (w: number, variants = count) => r.lines.map(([i, j]) => layoutLine(mask(i, j), { ...lo, targetWidth: w, variants }));
    let w = r.block;
    const got = () => fit(w, 1).map((x) => x.variants[0].width);
    let g = got();
    if (g.some((x) => x < w - 1)) (w = Math.min(...g)), (g = got()); // eine Zeile dehnt sich nicht so weit: Block schmaler
    if (g.some((x) => x > w + 1)) w = Math.max(...g); // eine Zeile wird nicht so schmal: Block breiter, den Rest füllt pad
    let combos: { rows: Layout[]; score: number }[] = [{ rows: [], score: r.uneven }];
    for (const x of fit(w, long ? 2 : count)) {
      x.warnings.forEach((m) => m !== ZIEL && warn.add(m));
      combos = combos
        // zu schmal kostet nichts extra (die Dehnung bewertet uneven, den Rest füllt pad); zu breit bleibt teuer
        .flatMap((c) => x.variants.map((v) => ({ rows: [...c.rows, v], score: c.score + v.score - WEIGHTS.deviation * (Math.max(0, w - v.width) / H) })))
        .sort((p, q) => p.score - q.score)
        .slice(0, count);
    }
    // gesetzt ist die Höhe bekannt: Seitenverhältnis am echten Block bewerten
    return combos.map((c) => {
      const b = stack(c.rows.map((v) => pad(v, w, TRACK * s.gap)), c.score, s);
      return aspect ? { ...b, score: b.score + WEIGHTS.aspect * Math.abs(Math.log(b.width / b.height / aspect)) } : b;
    });
  };
  // die besten Teilungen voll setzen: Varianten unterscheiden sich so in Umbruch und Verbindungen.
  const take = long ? 1 : SPLITS;
  const blocks = rated
    .filter((r, k) => k < take && r.score <= rated[0].score + SPLIT_MARGIN)
    .flatMap(realize)
    .sort((x, y) => x.score - y.score)
    .slice(0, count);
  const best = blocks[0], t = o.targetWidth;
  const rowWidths = [...new Set(best.glyphs.map((g) => g.y))].map((y) => extent(best.glyphs.filter((g) => g.y === y)).width);
  // nur mit gesetzter Zielbreite: ohne sie hat niemand eine Breite verlangt
  if (t && (Math.abs(best.width - t) > 2 || rowWidths.some((rw) => best.width - rw > 2))) warn.add(ZIEL);
  return { variants: blocks, warnings: [...warn] };
}
