import { BIN, L, gapOffset, inkPoints, minDist, profile, sample, stroke, type Profile, type Pt, type Stroke } from "./geom";
import { inRange, type Dock, type GlyphDef, type Params } from "./glyphs";
import type { Style } from "./style";

export type JoinType = "none" | "nest" | "underrun" | "share" | "tail";
export type Join = { type: JoinType; sub?: "term" | "stem" | "leg" | "cross"; bar?: boolean };
/** Ein Buchstabe mit festen Reglerwerten, fertig vermessen (Koordinaten lokal, x = 0 am linken Bezug). */
export type Inst = { def: GlyphDef; p: Params; strokes: Stroke[]; ink: Pt[]; prof: Profile; docks: Dock[] };

export function instance(def: GlyphDef, p: Params, s: Style): Inst {
  const strokes = def.draw(p, s);
  const ink = strokes.flatMap((st) => inkPoints(st, s.stroke / 2));
  return { def, p, strokes, ink, prof: profile(ink, s.capHeight), docks: def.docks(p, s) };
}

export function dock<K extends Dock["kind"]>(i: Inst, kind: K, side?: "left" | "right") {
  return i.docks.find((d) => d.kind === kind && (side === undefined || ("side" in d && d.side === side))) as
    | Extract<Dock, { kind: K }>
    | undefined;
}

/** Abstand für „keine Verbindung“: kleinste waagrechte Lichtweite = Buchstabenabstand (+ Seitenkorrektur).
 *  Satzzeichen (Feinschliff): nie näher als der Buchstabenabstand an irgendeine Nachbartinte (schräg gemessen), nie überlappend.
 *  Flache Zeichen rücken nur in Schrägen ein (A, V, W, Z, 2: „A-Z“, „10-20“); neben Stamm, Arm oder Bogen bleiben sie aus der Tinte
 *  heraus, die der Nachbar in einer halben Versalhöhe um das Zeichen zeichnet (E-, F-, L-, T-Arme). Der Punkt bleibt unter dem T-Arm (zu fern).
 *  Ein loser oberer Strich (f-Haken) zählt nur so kurz, wie trimTop ihn kürzen darf – gepinnte Regler (lock) bleiben; die Engine kürzt ihn danach
 *  vor dem Nachbarn. Reicht das Kürzen nicht (Bogen des S unter dem Hakenband), zählt der ganze Haken.
 *  Was das Profil nicht sieht (Unterlängen unter 0, Punkte neben Querstrichen), schiebt den Nachbarn nach rechts, bis armGap Luft bleibt. */
export function spacing(l: Inst, r: Inst, s: Style, minY = 0, lock?: Params): number {
  const gap = s.gap + (l.def.adjust?.right ?? 0) + (r.def.adjust?.left ?? 0);
  let dx = gapOffset(l.prof, r.prof, gap, minY);
  if (isPunct(l.def) || isPunct(r.def)) {
    // flaches Zeichen neben Stamm, Arm oder Bogen: nie unter oder über dessen Tinte (eine halbe Versalhöhe um das Zeichen) – „E-g“, „L-T“, „T-Shirt“;
    // neben einer Schräge (A, V, W, Z, 2 …) darf es einrücken („A-Z“, „10-20“). Überall: schräg gemessen nie näher als gap
    const ALL: [number, number] = [-Infinity, Infinity];
    const band = (p: Inst, n: Inst, side: "left" | "right") => { const b = inkBand(p, s); return b && !tuckable(p, n, side, b) ? b : null; };
    const bl = band(l, r, "left"), br = band(r, l, "right"); // Band des Zeichens gegen die Tinte des Nachbarn
    if (bl) dx = Math.max(dx, s.gap - (inkMin(r, bl) - inkMax(l, ALL)));
    if (br) dx = Math.max(dx, s.gap - (inkMin(r, ALL) - inkMax(l, br)));
    for (let i = 0, g; i < 20 && (g = lightGap(l, 0, r, dx, s.gap)) < s.gap - 1; i++) dx += s.gap - g;
    return dx;
  }
  if (l.def.loose) {
    const d = gapOffset(instance(l.def, { ...l.def.trimTop!(l.p, -Infinity), ...lock }, s).prof, r.prof, gap, minY), t = trimTop(l, 0, r, d, s, lock);
    if (!collides(t, 0, r, d, s)) return d;
  }
  for (let i = 0, g; i < 20 && (g = lightGap(l, 0, r, dx, s.armGap)) < s.armGap - 3; i++) dx += s.armGap - g;
  return dx;
}

/** Satz- und Sonderzeichen (alles außer Buchstaben und Ziffern; das Monogramm U+E000 zählt als Buchstabe). */
export const isPunct = (def: GlyphDef) => /[\p{P}\p{S}]/u.test(def.char);

/** So weit (Anteil der Versalhöhe) über und unter einem flachen Satzzeichen zählt die Tinte des Nachbarn als seine Kante. */
export const PUNCT_REACH = 0.6; // reicht vom tiefen Strich (150) bis über den F-Mittelarm (546), bleibt unter dem T-Arm für den Punkt
/** Höhenband eines flachen Satzzeichens (Tinte niedriger als PUNCT_REACH × Versalhöhe: - – . , : ' " « » + = …), um PUNCT_REACH erweitert;
 *  sonst null. Hohe Zeichen (Klammern, /, !) haben keinen Bauch, in den ein Nachbar ragt: für sie reicht das Profil. */
const inkBand = (i: Inst, s: Style): [number, number] | null => {
  const [lo, hi] = yRange(i), k = PUNCT_REACH * s.capHeight;
  return isPunct(i.def) && hi - lo < k ? [lo - k, hi + k] : null;
};
const yRange = (i: Inst): [number, number] => i.ink.reduce(([lo, hi], q) => [Math.min(lo, q.y), Math.max(hi, q.y)], [Infinity, -Infinity]);
const inkMax = (i: Inst, [lo, hi]: [number, number]) => i.ink.reduce((m, q) => (q.y >= lo && q.y <= hi && q.x > m ? q.x : m), -Infinity);
const inkMin = (i: Inst, [lo, hi]: [number, number]) => i.ink.reduce((m, q) => (q.y >= lo && q.y <= hi && q.x < m ? q.x : m), Infinity);

/**
 * Darf das flache Satzzeichen p in die Tinte des Nachbarn n einrücken (side: die p zugewandte Seite von n)? Ja, wenn
 * - die zugewandte Seite auf Höhe von p eine gerade Schräge ist (Mittellinie 7°–75° gegen die Senkrechte; A-Beine stehen nur 14° schräg): „A-Z“, „10-20“;
 * - oder über/unter p (im Band) kein gerader, waagrechter Strich (Arm, Balken, Fuß, Querstrich) über diese Seite hinausragt: Y, K mit schrägen Armen.
 * Nein bei Stamm/Bogen mit waagrechtem Arm darüber oder darunter (E, F, L, T, t, f, r): dort bleibt das Zeichen aus der Tinte des Arms.
 */
function tuckable(p: Inst, n: Inst, side: "left" | "right", band: [number, number]): boolean {
  if (isPunct(n.def)) return false;
  const [lo, hi] = yRange(p), out = side === "right" ? 1 : -1; // Richtung zum Satzzeichen
  let best: { x: number; sin: number; line: boolean } | null = null;
  for (const st of n.strokes) {
    let cur = st.start;
    for (const g of st.segs) {
      const c = sample({ start: cur, segs: [g] }); // je Abschnitt: gerade Schräge (L) oder Bogen (C)
      for (let i = 0; i < c.length; i++) {
        if (c[i].y < lo || c[i].y > hi) continue;
        const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)], len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len && (!best || out * (c[i].x - best.x) > 0)) best = { x: c[i].x, sin: Math.abs(b.x - a.x) / len, line: g.k === "L" };
      }
      cur = g.p;
    }
  }
  if (best && best.line && best.sin > 0.12 && best.sin < 0.97) return true; // gerade Schräge; ein S-Bogen zählt nicht
  const edge = best ? best.x : -out * Infinity;
  for (const st of n.strokes) {
    const c = sample(st);
    for (let i = 1; i < c.length; i++) {
      const dx = c[i].x - c[i - 1].x, dy = c[i].y - c[i - 1].y, y = c[i].y;
      // waagrechter Arm oder Bogenende (S-Bogen) ragt über die Seite hinaus
      if (Math.abs(dy) < 0.25 * Math.abs(dx) && y >= band[0] && y <= band[1] && (y < lo || y > hi) && out * (c[i].x - edge) > 1) return false;
    }
  }
  return true;
}

/** Alle an dieser Grenze möglichen Verbindungen (Balken-Variante kommt in der Engine dazu). Satzzeichen verbinden nie: kein Verschachteln unter den F-Arm, kein Schwanz darunter. */
export function joinsFor(l: Inst, r: Inst): Join[] {
  const out: Join[] = [{ type: "none" }];
  if (isPunct(l.def) || isPunct(r.def)) return out;
  if (dock(l, "zone") && l.def.cover) out.push({ type: "nest" });
  if (dock(l, "foot") && l.def.reach && dock(r, "leg", "left") && r.def.lift) out.push({ type: "underrun" });
  const stemL = dock(r, "stem", "left"), term = dock(l, "terminal");
  // Strichende muss auf Höhe eines echten Stamms treffen: nicht am U-Bogen, nicht über einem kürzeren Nachbarn
  if (term && l.def.close && stemL && r.prof.left[Math.floor(term.y / BIN)] <= stemL.x) out.push({ type: "share", sub: "term" });
  if (dock(l, "stem", "right") && stemL && !stemL.solo) out.push({ type: "share", sub: "stem" });
  if (dock(l, "leg", "right") && dock(r, "leg", "left")) out.push({ type: "share", sub: "leg" });
  if (dock(l, "cross") && l.def.extend && dock(r, "cross")) out.push({ type: "share", sub: "cross" });
  if (dock(r, "tail") && r.def.tailTo && !l.def.desc) out.push({ type: "tail" }); // nie unter eine Unterlänge (p, j, Komma)
  return out;
}

export type Applied = { lp: Params; rp: Params; dx: number };
/** Schwanzlängen in Stufen: der Font braucht je Stufe eine Glyphe, nicht je linkem Nachbarn. */
export const TAIL_STEP = 40;

/** Regel anwenden: neue Regler für links und rechts plus Verschiebung dx des rechten Buchstabens; lock = gepinnte Regler links. */
export function apply(j: Join, l: Inst, rDef: GlyphDef, rp0: Params, s: Style, lock?: Params): Applied | null {
  let lp = l.p, rp = rp0, dx: number;
  if (j.type === "nest") {
    if (rDef.params.h) rp = { ...rp, h: (dock(l, "zone")!.armY - s.stroke / 2 - s.clearance) / s.capHeight }; // Satzzeichen ohne Höhenregler bleiben, wie sie sind
    const inkLeft = s.stroke / 2 + s.nestGap;
    dx = inkLeft - instance(rDef, rp, s).prof.minX;
    lp = l.def.cover!(lp, inkLeft + s.nestOverhang);
  } else if (j.type === "underrun") {
    const minY = s.stroke + s.clearance;
    rp = rDef.lift!(rp, minY, s);
    const r = instance(rDef, rp, s);
    dx = spacing(l, r, s, minY, lock);
    const end = dx + dock(r, "leg", "right")!.footX - s.footGap;
    if (end < dx + r.prof.minX + 2 * s.stroke) return null;
    lp = l.def.reach!(lp, end);
  } else {
    const r = instance(rDef, rp, s);
    if (j.type === "none") dx = spacing(l, r, s, 0, lock);
    else if (j.type === "tail") {
      dx = spacing(l, r, s, 0, lock);
      // Schwanz endet höchstens eine Strichstärke rechts der linken Tinte des Nachbarn, verlängert in Stufen von TAIL_STEP
      const end = dock(r, "tail")!.end, x = end - Math.floor((end - (l.prof.minX + s.stroke - dx)) / TAIL_STEP) * TAIL_STEP;
      if (x >= end) return null;
      rp = rDef.tailTo!(rp, x);
    } else if (j.sub === "cross") {
      dx = spacing(l, r, s, 0, lock);
      lp = l.def.extend!(lp, dx + dock(r, "cross")!.x0); // linker Querstrich läuft bis an den Anfang des rechten
    } else if (j.sub === "term") {
      const stem = dock(r, "stem", "left")!.x;
      dx = dock(l, "terminal")!.topEnd + s.armGap + s.stroke / 2 - stem;
      lp = l.def.close!(lp, dx + stem);
    } else if (j.sub === "stem") dx = dock(l, "stem", "right")!.x - dock(r, "stem", "left")!.x;
    else dx = dock(l, "leg", "right")!.footX - dock(r, "leg", "left")!.footX;
  }
  return inRange(l.def, lp) && inRange(rDef, rp) ? { lp, rp, dx } : null;
}

/** Kleinste Lichtweite zwischen zwei platzierten Buchstaben (Infinity, wenn > limit). */
export const lightGap = (a: Inst, ax: number, b: Inst, bx: number, limit: number) => minDist(a.ink, ax, b.ink, bx, limit);

/** Harte Regel: Tinte verschiedener Buchstaben bleibt mindestens armGap auseinander (3 Einheiten Messtoleranz). */
export const collides = (a: Inst, ax: number, b: Inst, bx: number, s: Style) => lightGap(a, ax, b, bx, s.armGap) < s.armGap - 3;

/** Oberen Arm (F) oder Haken (f) vor dem Buchstaben o kürzen, sodass armGap Luft bleibt; gepinnte Regler (lock) bleiben. */
export function trimTop(f: Inst, fx: number, o: Inst, ox: number, s: Style, lock?: Params): Inst {
  if (!f.def.trimTop) return f;
  const top = s.capHeight * (f.p.h ?? 1); // Kleinbuchstaben haben keinen Höhenregler
  let obstacle = Infinity;
  for (let i = Math.floor((top - s.stroke) / BIN); i <= Math.floor(top / BIN) && i < o.prof.left.length; i++)
    if (o.prof.left[i] + ox < obstacle) obstacle = o.prof.left[i] + ox;
  if (obstacle === Infinity) return f;
  const p = { ...f.def.trimTop(f.p, obstacle - s.armGap - fx), ...lock };
  return Object.entries(p).every(([k, v]) => v === f.p[k]) ? f : instance(f.def, p, s); // Regler je Buchstabe verschieden (F: top, f: hook)
}

/** Verbindungsstück zwischen zwei Querbalken auf gleicher Linie (globale Koordinaten), wenn die Lücke zwischen den Tinten höchstens den Buchstabenabstand misst (Spec 5.4); sonst null. */
export function barLink(l: Inst, lx: number, r: Inst, rx: number, s: Style): Stroke | null {
  const a = dock(l, "bar"), b = dock(r, "bar");
  if (!a || !b || !a.right || !b.left || Math.abs(a.y - b.y) > 0.5) return null;
  const x0 = lx + a.x1, x1 = rx + b.x0;
  return x1 > x0 && x1 - x0 - s.stroke <= s.gap + 1 ? stroke(x0, a.y, L(x1, a.y)) : null;
}
