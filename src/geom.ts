export type Pt = { x: number; y: number };
export type Seg = { k: "L"; p: Pt } | { k: "C"; c1: Pt; c2: Pt; p: Pt };
export type Stroke = { start: Pt; segs: Seg[]; closed?: boolean; top?: number; line?: number }; // top: eigene Beschnitt-Oberkante dieses Strichs (k-Arm auf x-Höhe); line: Grundlinie seiner Zeile im Block (Balken)
/** Je Höhenstreifen (BIN Einheiten) linkester und rechtester Tintenrand; NaN = keine Tinte. */
export type Profile = { left: Float64Array; right: Float64Array; minX: number; maxX: number };

export const BIN = 10;

export const L = (x: number, y: number): Seg => ({ k: "L", p: { x, y } });
export const C = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): Seg => ({
  k: "C",
  c1: { x: x1, y: y1 },
  c2: { x: x2, y: y2 },
  p: { x, y },
});
export const stroke = (x: number, y: number, ...segs: Seg[]): Stroke => ({ start: { x, y }, segs });
export const closed = (s: Stroke): Stroke => ({ ...s, closed: true });

const mv = (p: Pt, dx: number, dy: number): Pt => ({ x: p.x + dx, y: p.y + dy });
export const shift = (s: Stroke, dx: number, dy = 0): Stroke => ({
  ...s,
  start: mv(s.start, dx, dy),
  segs: s.segs.map((g): Seg => (g.k === "L" ? { k: "L", p: mv(g.p, dx, dy) } : { k: "C", c1: mv(g.c1, dx, dy), c2: mv(g.c2, dx, dy), p: mv(g.p, dx, dy) })),
});

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
function at(a: Pt, g: Seg, t: number): Pt {
  if (g.k === "L") return { x: a.x + (g.p.x - a.x) * t, y: a.y + (g.p.y - a.y) * t };
  const u = 1 - t, k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
  return { x: k0 * a.x + k1 * g.c1.x + k2 * g.c2.x + k3 * g.p.x, y: k0 * a.y + k1 * g.c1.y + k2 * g.c2.y + k3 * g.p.y };
}

/** Punkte entlang der Mittellinie im Abstand ≤ step. */
export function sample(s: Stroke, step = 5): Pt[] {
  const out: Pt[] = [s.start];
  const segs = s.closed ? [...s.segs, L(s.start.x, s.start.y)] : s.segs;
  let cur = s.start;
  for (const g of segs) {
    const len = g.k === "L" ? dist(cur, g.p) : dist(cur, g.c1) + dist(g.c1, g.c2) + dist(g.c2, g.p);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 1; i <= n; i++) out.push(at(cur, g, i / n));
    cur = g.p;
  }
  return out;
}

/** Tintenpunkte: Querschnitt (±half senkrecht zur Laufrichtung) an jedem Mittellinienpunkt. Stumpfe Enden ragen nicht über. */
export function inkPoints(s: Stroke, half: number, step = 5): Pt[] {
  const c = sample(s, step), out: Pt[] = [];
  for (let i = 0; i < c.length; i++) {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    for (const t of [-1, -0.5, 0, 0.5, 1]) out.push({ x: c[i].x + nx * half * t, y: c[i].y + ny * half * t });
  }
  return out;
}

const r1 = (n: number) => String(Math.round(n * 10) / 10);
/** SVG-Pfaddaten mit absoluten Befehlen M, L, C, Z. */
export function pathData(s: Stroke): string {
  let d = `M${r1(s.start.x)} ${r1(s.start.y)}`;
  for (const g of s.segs)
    d += g.k === "L" ? `L${r1(g.p.x)} ${r1(g.p.y)}` : `C${r1(g.c1.x)} ${r1(g.c1.y)} ${r1(g.c2.x)} ${r1(g.c2.y)} ${r1(g.p.x)} ${r1(g.p.y)}`;
  return s.closed ? d + "Z" : d;
}

export function profile(ink: Pt[], height: number): Profile {
  const n = Math.ceil(height / BIN) + 1;
  const left = new Float64Array(n).fill(NaN), right = new Float64Array(n).fill(NaN);
  let minX = Infinity, maxX = -Infinity;
  for (const p of ink) {
    const i = Math.floor(p.y / BIN);
    if (i < 0 || i >= n) continue;
    if (!(left[i] <= p.x)) left[i] = p.x;
    if (!(right[i] >= p.x)) right[i] = p.x;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  return { left, right, minX, maxX };
}

/** Profile mehrerer platzierter Teile zu einem Profil vereinen (globale x). */
export function mergeProfiles(parts: { prof: Profile; x: number }[]): Profile {
  const n = parts[0].prof.left.length;
  const left = new Float64Array(n).fill(NaN), right = new Float64Array(n).fill(NaN);
  let minX = Infinity, maxX = -Infinity;
  for (const { prof, x } of parts) {
    for (let i = 0; i < n; i++) {
      const a = prof.left[i] + x, b = prof.right[i] + x;
      if (a === a && !(left[i] <= a)) left[i] = a;
      if (b === b && !(right[i] >= b)) right[i] = b;
    }
    minX = Math.min(minX, prof.minX + x);
    maxX = Math.max(maxX, prof.maxX + x);
  }
  return { left, right, minX, maxX };
}

/** Verschiebung für das rechte Profil, sodass die kleinste waagrechte Lichtweite gap ist (nur Streifen ab minY). */
export function gapOffset(l: Profile, r: Profile, gap: number, minY = 0): number {
  let best = Infinity;
  for (let i = Math.max(0, Math.floor(minY / BIN)); i < l.right.length; i++) {
    const d = r.left[i] - l.right[i];
    if (d < best) best = d; // NaN-Vergleich ist false: leere Streifen zählen nicht
  }
  if (best === Infinity) best = r.minX - l.maxX;
  return gap - best;
}

type Ext = { lo: number; hi: number; ylo: number; yhi: number };
const exts = new WeakMap<Pt[], Ext>();
/** Ausdehnung einer Tintenpunktmenge, je Menge nur einmal gemessen. */
function ext(a: Pt[]): Ext {
  let e = exts.get(a);
  if (!e) {
    e = { lo: Infinity, hi: -Infinity, ylo: Infinity, yhi: -Infinity };
    for (const p of a) {
      if (p.x < e.lo) e.lo = p.x;
      if (p.x > e.hi) e.hi = p.x;
      if (p.y < e.ylo) e.ylo = p.y;
      if (p.y > e.yhi) e.yhi = p.y;
    }
    exts.set(a, e);
  }
  return e;
}
/** Punkte in Zeilen der Höhe limit, je Zeile nach x sortiert (lokale Koordinaten) – je Menge und limit nur einmal gebaut. */
type Rows = { r0: number; xs: Float64Array[]; ys: Float64Array[] };
const grids = new WeakMap<Pt[], Map<number, Rows>>();
function rows(a: Pt[], limit: number): Rows {
  let m = grids.get(a);
  if (!m) grids.set(a, (m = new Map()));
  let g = m.get(limit);
  if (!g) {
    const e = ext(a), r0 = Math.floor(e.ylo / limit), buckets: Pt[][] = Array.from({ length: Math.floor(e.yhi / limit) - r0 + 1 }, () => []);
    for (const p of a) buckets[Math.floor(p.y / limit) - r0].push(p);
    for (const b of buckets) b.sort((p, q) => p.x - q.x);
    g = { r0, xs: buckets.map((b) => Float64Array.from(b, (p) => p.x)), ys: buckets.map((b) => Float64Array.from(b, (p) => p.y)) };
    m.set(limit, g);
  }
  return g;
}

/** Kleinster Abstand zweier Tintenpunktmengen (a um ax, b um bx verschoben); Infinity, wenn > limit. */
export function minDist(a: Pt[], ax: number, b: Pt[], bx: number, limit: number): number {
  if (!a.length || !b.length) return Infinity;
  const ea = ext(a), eb = ext(b);
  if (ea.lo + ax - limit > eb.hi + bx || eb.lo + bx - limit > ea.hi + ax || ea.ylo - limit > eb.yhi || eb.ylo - limit > ea.yhi) return Infinity;
  const { r0, xs, ys } = rows(a, limit);
  let best = Infinity;
  for (const q of b) {
    const x = q.x + bx, from = x - ax - limit - 1, to = x - ax + limit + 1, cy = Math.floor(q.y / limit) - r0; // 1 Einheit Spiel gegen Rundung
    for (let r = Math.max(0, cy - 1); r <= Math.min(xs.length - 1, cy + 1); r++) {
      const rx = xs[r], ry = ys[r];
      let i = 0, j = rx.length;
      while (i < j) {
        const m = (i + j) >> 1;
        if (rx[m] < from) i = m + 1;
        else j = m;
      }
      for (; i < rx.length && rx[i] <= to; i++) {
        const d = Math.hypot(rx[i] + ax - x, ry[i] - q.y);
        if (d < best) best = d;
      }
    }
  }
  return best <= limit ? best : Infinity;
}
