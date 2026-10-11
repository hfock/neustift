import { BIN, L, gapOffset, inkPoints, minDist, profile, stroke, type Profile, type Pt, type Stroke } from "./geom";
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
 *  Satzzeichen (Feinschliff): nie näher als der Buchstabenabstand an irgendeine Nachbartinte (schräg gemessen), nie überlappend; unter
 *  den T-Arm oder in die Schräge von A, Z, L, V dürfen sie rücken („T-Shirt“, „A-Z“, „L-T“ wie im klassischen Satz).
 *  Ein loser oberer Strich (f-Haken) zählt nur so kurz, wie trimTop ihn kürzen darf – gepinnte Regler (lock) bleiben; die Engine kürzt ihn danach
 *  vor dem Nachbarn. Reicht das Kürzen nicht (Bogen des S unter dem Hakenband), zählt der ganze Haken.
 *  Was das Profil nicht sieht (Unterlängen unter 0, Punkte neben Querstrichen), schiebt den Nachbarn nach rechts, bis armGap Luft bleibt. */
export function spacing(l: Inst, r: Inst, s: Style, minY = 0, lock?: Params): number {
  const gap = s.gap + (l.def.adjust?.right ?? 0) + (r.def.adjust?.left ?? 0);
  let dx = gapOffset(l.prof, r.prof, gap, minY);
  if (isPunct(l.def) || isPunct(r.def)) {
    // reiner Abstand: unter Arme und in Schrägen darf es rücken (T-Arm, A, Z, L, V), aber schräg gemessen nirgends näher als gap
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
