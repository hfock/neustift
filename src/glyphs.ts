import { C, L, closed, stroke, type Pt, type Seg, type Stroke } from "./geom";
import type { Style } from "./style";

export type Params = Record<string, number>;
export type Range = { min: number; def: number; max: number };
export type Dock =
  | { kind: "zone"; armY: number } // freie Zone unter einem Arm (rechts), z. B. F
  | { kind: "foot"; end: number } // verlängerbarer Fuß, endet bei x = end
  | { kind: "terminal"; topEnd: number; y: number } // offenes Strichende auf Höhe y (C/G-Bogen unten, T-Arm); der Nachbarstamm kommt auf topEnd + armGap + Strich/2
  | { kind: "stem"; side: "left" | "right"; x: number; solo?: boolean } // senkrechter Stamm
  | { kind: "leg"; side: "left" | "right"; footX: number } // schräges Bein, Fuß bei footX
  | { kind: "bar"; y: number; x0: number; x1: number; left: boolean; right: boolean } // Querbalken
  | { kind: "cross"; y: number; x0: number; x1: number } // Querstrich (f, t) auf Höhe y, verlängerbar nach rechts
  | { kind: "tail"; end: number }; // Unterlänge (g, j, y), endet bei x = end, verlängerbar nach links

export interface GlyphDef {
  char: string;
  params: Record<string, Range>;
  draw(p: Params, s: Style): Stroke[];
  docks(p: Params, s: Style): Dock[];
  adjust?: { left?: number; right?: number }; // Abstandskorrektur je Seite (Einheiten)
  desc?: number; // Unterlänge: Tinte reicht bis −desc unter die Grundlinie (Komma, tiefe Anführungszeichen)
  descFor?(p: Params): number; // Unterlänge je nach Reglern (Klammern: nur die Kleinbuchstaben-Form hängt unter die Grundlinie)
  cover?(p: Params, end: number): Params; // Mittelarm bis end, oberer Arm entsprechend (Verschachteln)
  reach?(p: Params, end: number): Params; // Fuß bis end (Unterfahren)
  close?(p: Params, x: number): Params; // Bogenende bis x (Strich teilen)
  lift?(p: Params, y: number, s: Style): Params; // linkes Bein: tiefste Tinte bei y (Unterfahren)
  trimTop?(p: Params, end: number): Params; // oberen Arm höchstens bis end
  loose?: boolean; // der kürzbare obere Strich (f-Haken) zählt beim Abstand nur in seiner kürzesten Form; trimTop kürzt ihn vor dem Nachbarn – setzt trimTop voraus
  extend?(p: Params, x: number): Params; // Querstrich bis x (f, t)
  tailTo?(p: Params, x: number): Params; // Schwanz der Unterlänge bis x nach links (g, j, y)
  top?(s: Style): number; // eigene Beschnitt-Oberkante (v, w, x, y: x-Höhe)
}

/** Unterlänge eines Buchstabens mit diesen Reglern (0 = keine). */
export const descOf = (i: { def: GlyphDef; p: Params }) => i.def.descFor?.(i.p) ?? i.def.desc ?? 0;

/** Oberkante, an der Renderer und Font die Tinte abschneiden: eigene Oberkante, sonst Versalhöhe × Höhenregler. */
export const cutTop = (def: GlyphDef, p: Params, s: Style) => def.top?.(s) ?? s.capHeight * (p.h ?? 1);

const R = (min: number, def: number, max: number): Range => ({ min, def, max });
const KAPPA = 0.5523; // Viertelkreis als kubischer Bogen
const h = R(0.6, 1, 1); // Höhe als Anteil der Versalhöhe
const inkTop = (p: Params, s: Style) => s.capHeight * p.h;
const cTop = (p: Params, s: Style) => inkTop(p, s) - s.stroke / 2; // Mittellinie oben
const cBot = (s: Style) => s.stroke / 2; // Mittellinie unten
const barY = (p: Params, s: Style) => (p.bar ? s.barLow : s.barHigh) * p.h;
/** So weit ragt die tiefste Ecke eines stumpfen Schrägstrichs (Lauf dx, Höhe dy) unter seinen Endpunkt. */
const capDrop = (dx: number, dy: number, s: Style) => (s.stroke / 2) * (dx / Math.hypot(dx, dy));

const glyphA: GlyphDef = {
  char: "A",
  params: { h, w: R(300, 377, 420), bar: R(0, 1, 1), legL: R(0, 0, 200) },
  draw(p, s) {
    const t = cTop(p, s), run = (p.w - s.apexW) / 2, by = barY(p, s);
    const xl = (y: number) => (y / t) * run, xr = (y: number) => p.w - (y / t) * run;
    const foot = -capDrop(run, t, s); // Füße knapp unter die Grundlinie; der Renderer schneidet dort waagrecht ab
    const y0 = p.legL > 0 ? p.legL : foot;
    return [stroke(xl(y0), y0, L(run, t), L(p.w - run, t), L(xr(foot), foot)), stroke(xl(by), by, L(xr(by), by))];
  },
  docks(p, s) {
    const t = cTop(p, s), run = (p.w - s.apexW) / 2, by = barY(p, s);
    return [
      { kind: "leg", side: "left", footX: 0 },
      { kind: "leg", side: "right", footX: p.w },
      { kind: "bar", y: by, x0: (by / t) * run, x1: p.w - (by / t) * run, left: true, right: true },
    ];
  },
  lift(p, y, s) {
    const t = cTop(p, s), run = (p.w - s.apexW) / 2;
    return { ...p, legL: y + capDrop(run, t, s) }; // Schnittkante des Beins liegt schräg
  },
};

/** Umlautpunkte: zwei Quadrate (Kantenlänge = Strich) auf Höhe y. */
const dots = (y: number, x0: number, x1: number, s: Style) => [x0, x1].map((x) => stroke(x - s.stroke / 2, y, L(x + s.stroke / 2, y)));

const glyphAE: GlyphDef = {
  ...glyphA,
  char: "Ä",
  draw: (p, s) => [...glyphA.draw(p, s), ...dots(cTop(p, s), p.w / 2 - s.dotOffset, p.w / 2 + s.dotOffset, s)],
};

function bowlC(p: Params, s: Style): Stroke {
  const t = cTop(p, s), b = cBot(s), r = 0.143 * inkTop(p, s), y0 = t - r;
  return stroke(p.w, t, L(r, t), C(r * (1 - KAPPA), t, 0, t - r * (1 - KAPPA), 0, y0), C(0, y0 - 0.66 * (y0 - b), 0.5 * p.wb, b, p.wb, b));
}

const glyphC: GlyphDef = {
  char: "C",
  params: { h, w: R(180, 226, 280), wb: R(150, 200, 330) },
  draw: (p, s) => [bowlC(p, s)],
  docks: (p, s) => [{ kind: "terminal", topEnd: p.w, y: cBot(s) }],
  close: (p, x) => ({ ...p, wb: x }),
};

/** Segel wie beim D: oben schmal (bis a), unten bauchig bis w mit Ecke rb; geschlossen über den Stamm bei x = 0. */
function sail(top: number, bot: number, a: number, w: number, rb: number): Stroke {
  const span = top - bot;
  return closed(
    stroke(a, top, L(0, top), L(0, bot), L(w - rb, bot),
      C(w - rb * (1 - KAPPA), bot, w, bot + rb * (1 - KAPPA), w, bot + rb),
      C(w, bot + rb + 0.4 * span, a + 0.45 * (w - a), top - 0.22 * span, a, top)),
  );
}

const glyphD: GlyphDef = {
  char: "D",
  params: { h, w: R(190, 236, 300), a: R(40, 80, 120) },
  draw: (p, s) => [sail(cTop(p, s), cBot(s), p.a, p.w, 47 * p.h)],
  docks: () => [{ kind: "stem", side: "left", x: 0 }],
  adjust: { right: -17 },
};

const glyphE: GlyphDef = {
  char: "E",
  params: { h, w: R(200, 276, 330), bar: R(0, 0, 1), foot: R(0, 0, 300) },
  draw(p, s) {
    const t = cTop(p, s), b = cBot(s), by = barY(p, s);
    return [stroke(p.w, t, L(0, t), L(0, b), L(p.w + p.foot, b)), stroke(0, by, L(0.8 * p.w, by))];
  },
  docks: (p, s) => [
    { kind: "stem", side: "left", x: 0 },
    { kind: "foot", end: p.w + p.foot },
    { kind: "bar", y: barY(p, s), x0: 0, x1: 0.8 * p.w, left: true, right: true },
  ],
  reach: (p, end) => ({ ...p, foot: Math.max(0, end - p.w) }),
};

const glyphF: GlyphDef = {
  char: "F",
  params: { h, w: R(200, 265, 330), bar: R(0, 0, 1), arm: R(0, 0, 200), top: R(-100, 0, 200) },
  draw(p, s) {
    const t = cTop(p, s), by = barY(p, s);
    return [stroke(p.w + p.top, t, L(0, t), L(0, 0)), stroke(0, by, L(0.8 * p.w + p.arm, by))];
  },
  docks: (p, s) => [
    { kind: "stem", side: "left", x: 0 },
    { kind: "zone", armY: barY(p, s) },
    { kind: "bar", y: barY(p, s), x0: 0, x1: 0.8 * p.w + p.arm, left: true, right: true },
  ],
  cover: (p, end) => ({ ...p, arm: Math.max(0, end - 0.8 * p.w), top: Math.max(0, 1.26 * end - p.w) }),
  trimTop: (p, end) => ({ ...p, top: Math.max(-100, Math.min(p.top, end - p.w)) }),
};

const glyphG: GlyphDef = {
  char: "G",
  params: { h, w: R(180, 226, 280), wb: R(150, 200, 330), bar: R(0, 1, 1) },
  draw(p, s) {
    const c = bowlC(p, s), by = barY(p, s);
    return [{ ...c, segs: [...c.segs, L(p.wb, by), L(0.55 * p.wb, by)] }];
  },
  docks: (p, s) => [
    { kind: "terminal", topEnd: p.w, y: cBot(s) },
    { kind: "bar", y: barY(p, s), x0: 0.55 * p.wb, x1: p.wb, left: false, right: true },
  ],
  close: (p, x) => ({ ...p, wb: x }),
};

const glyphH: GlyphDef = {
  char: "H",
  params: { h, w: R(190, 243, 300), bar: R(0, 0, 1) },
  draw(p, s) {
    const top = inkTop(p, s), by = barY(p, s);
    return [stroke(0, 0, L(0, top)), stroke(p.w, 0, L(p.w, top)), stroke(0, by, L(p.w, by))];
  },
  docks: (p, s) => [
    { kind: "stem", side: "left", x: 0 },
    { kind: "stem", side: "right", x: p.w },
    { kind: "bar", y: barY(p, s), x0: 0, x1: p.w, left: true, right: true },
  ],
};

const glyphI: GlyphDef = {
  char: "I",
  params: { h },
  draw: (p, s) => [stroke(0, 0, L(0, inkTop(p, s)))],
  docks: () => [{ kind: "stem", side: "left", x: 0, solo: true }],
};

const glyphK: GlyphDef = {
  char: "K",
  params: { h, w: R(180, 230, 280) },
  draw(p, s) {
    const j = s.barHigh * p.h; // Arme treffen sich auf der oberen Balkenlinie
    const drop = capDrop(p.w, j, s); // Fuß knapp unter die Grundlinie; der Renderer schneidet waagrecht ab
    // Arm und Bein als eigene Striche: ihre stumpfen Enden verschwinden im Stamm, nichts ragt links heraus
    return [stroke(0, 0, L(0, inkTop(p, s))), stroke(0.9 * p.w, cTop(p, s), L(0, j)), stroke(0, j, L(p.w * (1 + drop / j), -drop))];
  },
  docks: (p) => [{ kind: "stem", side: "left", x: 0 }, { kind: "leg", side: "right", footX: p.w }], // Fuß wie beim R: KA teilt die Füße
};

const glyphL: GlyphDef = {
  char: "L",
  params: { h, foot: R(0, 0, 320) },
  draw: (p, s) => [stroke(0, inkTop(p, s), L(0, cBot(s)), L(200 + p.foot, cBot(s)))],
  docks: (p) => [{ kind: "stem", side: "left", x: 0 }, { kind: "foot", end: 200 + p.foot }],
  reach: (p, end) => ({ ...p, foot: Math.max(0, end - 200) }),
};

const glyphN: GlyphDef = {
  char: "N",
  params: { h, w: R(190, 243, 300) },
  draw: (p, s) => [stroke(0, 0, L(0, inkTop(p, s)), L(p.w, 0), L(p.w, inkTop(p, s)))],
  docks: (p) => [{ kind: "stem", side: "left", x: 0 }, { kind: "stem", side: "right", x: p.w }],
};

const glyphO: GlyphDef = {
  char: "O",
  params: { h, w: R(180, 240, 300) },
  draw(p, s) {
    const t = cTop(p, s), b = cBot(s), r = p.w / 2, k = KAPPA * r;
    return [
      closed(
        stroke(0, b + r, L(0, t - r), C(0, t - r + k, r - k, t, r, t), C(r + k, t, p.w, t - r + k, p.w, t - r),
          L(p.w, b + r), C(p.w, b + r - k, r + k, b, r, b), C(r - k, b, 0, b + r - k, 0, b + r)),
      ),
    ];
  },
  docks: () => [],
  adjust: { left: -10, right: -10 },
};

/** Knoten auf einer Balkenlinie (Griff „Balken“), verbindet nicht mit Nachbarn. */
const knot = (y: number, x0: number, x1: number): Dock => ({ kind: "bar", y, x0, x1, left: false, right: false });

/** Bauch vom Punkt (a, top) hinab bis zur unteren Ecke (w − rb, bot): rechte Seite des Segels, andersherum gezogen. */
function belly(a: number, top: number, w: number, bot: number, rb: number): Seg[] {
  const span = top - bot;
  return [
    C(a + 0.45 * (w - a), top - 0.22 * span, w, bot + rb + 0.4 * span, w, bot + rb),
    C(w, bot + rb * (1 - KAPPA), w - rb * (1 - KAPPA), bot, w - rb, bot),
  ];
}

/** Runder Bauch am Stamm: oben und unten waagrecht, rechts Rundung mit Radius ≤ halbe Höhe und ≤ halbe Breite. */
function bowl(top: number, bot: number, w: number): Stroke {
  const r = Math.min((top - bot) / 2, w / 2), k = KAPPA * r;
  return closed(
    stroke(0, top, L(w - r, top), C(w - r + k, top, w, top - r + k, w, top - r), L(w, bot + r), C(w, bot + r - k, w - r + k, bot, w - r, bot), L(0, bot)),
  );
}

const glyphB: GlyphDef = {
  char: "B",
  params: { h, w: R(190, 240, 300), bar: R(0, 0, 1) },
  draw(p, s) {
    const t = cTop(p, s), by = barY(p, s), w1 = 0.8 * p.w;
    return [bowl(t, by, w1), sail(by, cBot(s), w1 - Math.min((t - by) / 2, w1 / 2), p.w, 47 * p.h)];
  },
  docks: (p, s) => [{ kind: "stem", side: "left", x: 0 }, knot(barY(p, s), 0, 0.8 * p.w)],
  adjust: { right: -17 },
};

function cup(p: Params, s: Style, left: number): Stroke {
  const b = cBot(s), r = p.w / 2, k = KAPPA * r;
  return stroke(0, left, L(0, b + r), C(0, b + r - k, r - k, b, r, b), C(r + k, b, p.w, b + r - k, p.w, b + r), L(p.w, inkTop(p, s)));
}

const glyphJ: GlyphDef = {
  char: "J",
  params: { h, w: R(150, 190, 260) },
  draw: (p, s) => [cup(p, s, Math.max(s.barLow * p.h, cBot(s) + p.w / 2))], // Haken endet auf der unteren Balkenlinie, nie unter dem Bogenanfang
  docks: () => [], // kein Stamm-Andocken: J + U würde zu „ɯ“
};

/** Zwei Stämme mit flacher Spitze (apexW) auf Höhe vy dazwischen; from = Kante, an der die Diagonalen ansetzen. */
function zigzag(p: Params, s: Style, from: number, vy: number): Stroke {
  const c = p.w / 2, a = s.apexW / 2, to = inkTop(p, s) - from;
  return stroke(0, to, L(0, from), L(c - a, vy), L(c + a, vy), L(p.w, from), L(p.w, to));
}

const glyphM: GlyphDef = {
  char: "M",
  params: { h, w: R(260, 320, 400), bar: R(0, 1, 1) },
  draw: (p, s) => [zigzag(p, s, inkTop(p, s), barY(p, s))],
  docks: (p, s) => [{ kind: "stem", side: "left", x: 0 }, { kind: "stem", side: "right", x: p.w }, knot(barY(p, s), p.w / 2 - s.apexW / 2, p.w / 2 + s.apexW / 2)],
};

const glyphP: GlyphDef = {
  char: "P",
  params: { h, w: R(180, 230, 290), bar: R(0, 0, 1) },
  draw(p, s) {
    return [stroke(0, 0, L(0, inkTop(p, s))), bowl(cTop(p, s), barY(p, s), p.w)];
  },
  docks: (p, s) => [{ kind: "stem", side: "left", x: 0 }, knot(barY(p, s), 0, p.w)],
};

const glyphQ: GlyphDef = {
  char: "Q",
  params: { h, w: R(180, 240, 300), foot: R(0, 0, 300) },
  draw: (p, s) => [...glyphO.draw(p, s), stroke(p.w / 2, cBot(s), L(p.w + 80 + p.foot, cBot(s)))],
  docks: (p) => [{ kind: "foot", end: p.w + 80 + p.foot }],
  reach: (p, end) => ({ ...p, foot: Math.max(0, end - p.w - 80) }),
  adjust: { left: -10 },
};

const glyphR: GlyphDef = {
  char: "R",
  params: { h, w: R(190, 240, 300), bar: R(0, 0, 1) },
  draw(p, s) {
    const by = barY(p, s), drop = capDrop(p.w, by, s);
    return [
      stroke(0, 0, L(0, inkTop(p, s))),
      bowl(cTop(p, s), by, 0.9 * p.w),
      stroke(0, by, L(p.w * (1 + drop / by), -drop)), // Bein wie beim K; Fuß knapp unter die Grundlinie
    ];
  },
  docks: (p, s) => [
    { kind: "stem", side: "left", x: 0 },
    ...(p.bar ? [] : [{ kind: "leg", side: "right", footX: p.w } as Dock]), // Knoten unten: Bein zu flach zum Füße-Teilen
    knot(barY(p, s), 0, 0.9 * p.w),
  ],
};

/** S-Linie: Kopf wie beim C (Ecke oben links, Radius r), Fuß wie beim D (Ecke unten rechts, Radius rb), dazwischen ein Schwung, unten bauchiger. */
function swash(w: number, t: number, b: number, r: number, rb: number): Stroke {
  const k = KAPPA * r, y0 = t - r, y1 = b + rb, span = y0 - y1;
  return stroke(0.85 * w, t, L(r, t), C(r - k, t, 0, t - r + k, 0, y0), C(0, y0 - 0.35 * span, w, y1 + 0.7 * span, w, y1),
    C(w, b + rb * (1 - KAPPA), w - rb * (1 - KAPPA), b, w - rb, b), L(0, b));
}

const glyphS: GlyphDef = {
  char: "S",
  params: { h, w: R(180, 230, 290) },
  draw: (p, s) => [swash(p.w, cTop(p, s), cBot(s), 0.143 * inkTop(p, s), 47 * p.h)],
  docks: () => [],
};

const glyphSZ: GlyphDef = {
  char: "ẞ",
  params: { h, w: R(200, 250, 300) },
  draw(p, s) {
    const t = cTop(p, s), b = cBot(s), wy = s.barHigh * p.h;
    return [stroke(0, 0, L(0, t), L(0.8 * p.w, t), L(0.35 * p.w, wy), ...belly(0.35 * p.w, wy, p.w, b, 47 * p.h), L(0.35 * p.w, b))];
  },
  docks: () => [{ kind: "stem", side: "left", x: 0 }],
};

const glyphT: GlyphDef = {
  char: "T",
  params: { h, w: R(200, 260, 340), top: R(-50, 0, 300) }, // kürzer: der Stamm käme dem Nachbarstamm beim Teilen zu nah
  draw(p, s) {
    const t = cTop(p, s);
    return [stroke(0, t, L(p.w + p.top, t)), stroke(p.w / 2, 0, L(p.w / 2, t))];
  },
  // Strich teilen: der rechte Arm mündet oben in den Stamm des Nachbarn (TH, TE); der Arm endet schon dort
  docks: (p, s) => [{ kind: "terminal", topEnd: p.w + p.top - s.armGap - s.stroke / 2, y: cTop(p, s) }],
  close: (p) => p,
};

const glyphU: GlyphDef = {
  char: "U",
  params: { h, w: R(180, 240, 300) },
  draw: (p, s) => [cup(p, s, inkTop(p, s))],
  docks: (p) => [{ kind: "stem", side: "left", x: 0 }, { kind: "stem", side: "right", x: p.w }],
};

const glyphUE: GlyphDef = {
  ...glyphU,
  char: "Ü",
  draw: (p, s) => [...glyphU.draw(p, s), ...dots(cTop(p, s), p.w / 4, (3 * p.w) / 4, s)], // Punkte in der Öffnung
};

const glyphV: GlyphDef = {
  char: "V",
  params: { h, w: R(240, 300, 380) },
  draw(p, s) {
    const top = inkTop(p, s), b = cBot(s), run = (p.w - s.apexW) / 2, d = capDrop(run, top - b, s), x = (-run * d) / (top - b);
    return [stroke(x, top + d, L(run, b), L(p.w - run, b), L(p.w - x, top + d))]; // Enden knapp über die Oberlinie, der Renderer schneidet waagrecht ab
  },
  docks: () => [],
};

const glyphW: GlyphDef = {
  char: "W",
  params: { h, w: R(260, 330, 420), bar: R(0, 0, 1) },
  draw: (p, s) => [zigzag(p, s, 0, barY(p, s))],
  docks: (p, s) => [{ kind: "stem", side: "left", x: 0 }, { kind: "stem", side: "right", x: p.w }, knot(barY(p, s), p.w / 2 - s.apexW / 2, p.w / 2 + s.apexW / 2)],
};

const glyphX: GlyphDef = {
  char: "X",
  params: { h, w: R(200, 260, 340), bar: R(0, 0, 1) },
  draw(p, s) {
    const top = inkTop(p, s), y = barY(p, s), c = p.w / 2, dt = capDrop(c, top - y, s), db = capDrop(c, y, s);
    const xt = (-c * dt) / (top - y), xb = (c * db) / y; // Enden knapp über Ober- und unter Grundlinie
    return [stroke(xt, top + dt, L(c, y), L(p.w + xb, -db)), stroke(p.w - xt, top + dt, L(c, y), L(-xb, -db))];
  },
  docks: (p, s) => [knot(barY(p, s), p.w / 2, p.w / 2)],
};

const glyphY: GlyphDef = {
  char: "Y",
  params: { h, w: R(200, 260, 340), bar: R(0, 0, 1) },
  draw(p, s) {
    const top = inkTop(p, s), y = barY(p, s), c = p.w / 2, d = capDrop(c, top - y, s), x = (-c * d) / (top - y);
    return [stroke(x, top + d, L(c, y), L(p.w - x, top + d)), stroke(c, 0, L(c, y))];
  },
  docks: (p, s) => [knot(barY(p, s), p.w / 2, p.w / 2)],
};

const glyphZ: GlyphDef = {
  char: "Z",
  params: { h, w: R(200, 250, 320), foot: R(0, 0, 300) },
  draw(p, s) {
    const t = cTop(p, s), b = cBot(s);
    return [stroke(0, t, L(p.w, t), L(0, b), L(p.w + p.foot, b))];
  },
  docks: (p) => [{ kind: "foot", end: p.w + p.foot }],
  reach: (p, end) => ({ ...p, foot: Math.max(0, end - p.w) }),
};

const glyphOE: GlyphDef = {
  ...glyphO,
  char: "Ö",
  params: { h, w: R(210, 240, 300) }, // schmaler ragen die Punkte zu weit über die Flanken
  draw(p, s) {
    // Punkte in den freien oberen Ecken, armGap Luft zum Bogen (halbe Diagonale eines Punkts = Strich/2 · √2)
    const r = p.w / 2, off = Math.sqrt((r + (s.stroke / 2) * (1 + Math.SQRT2) + s.armGap) ** 2 - r ** 2);
    return [...glyphO.draw(p, s), ...dots(cTop(p, s), r - off, r + off, s)];
  },
};

// ── Ziffern (M2) ──

/** Strich Punkt für Punkt abbilden (verschieben, um 180° drehen). */
const mapPts = (st: Stroke, f: (q: Pt) => Pt): Stroke => ({
  ...st,
  start: f(st.start),
  segs: st.segs.map((g): Seg => (g.k === "L" ? { k: "L", p: f(g.p) } : { k: "C", c1: f(g.c1), c2: f(g.c2), p: f(g.p) })),
});

const glyph0: GlyphDef = { ...glyphO, char: "0", params: { h, w: R(160, 200, 240) } };

const glyph1: GlyphDef = {
  char: "1",
  params: { h, w: R(60, 90, 140) },
  draw: (p, s) => [stroke(p.w, 0, L(p.w, inkTop(p, s))), stroke(0, s.barHigh * p.h, L(p.w, inkTop(p, s)))], // Fahne von der oberen Balkenlinie bis zur Oberkante: keine Stufe am Stamm
  docks: () => [],
};

/** Kopf mit Ecke oben rechts (gespiegelter S-Kopf), rechts hinab bis y. */
function head2(p: Params, s: Style, y: number): Seg[] {
  const t = cTop(p, s), r = 0.143 * inkTop(p, s), k = KAPPA * r;
  return [L(p.w - r, t), C(p.w - r + k, t, p.w, t - r + k, p.w, t - r), L(p.w, y)];
}

const glyph2: GlyphDef = {
  char: "2",
  params: { h, w: R(180, 230, 290) },
  draw: (p, s) => [stroke(0, cTop(p, s), ...head2(p, s, s.barHigh * p.h), L(0, cBot(s)), L(p.w, cBot(s)))],
  docks: () => [],
};

const glyph3: GlyphDef = {
  char: "3",
  params: { h, w: R(180, 230, 290) },
  draw(p, s) {
    const t = cTop(p, s), y = s.barHigh * p.h, w1 = 0.82 * p.w, r = (t - y) / 2, k = KAPPA * r, a = 0.35 * p.w;
    // ein Strich: Bauch oben, Taille nach links, spitz umkehren in den Segel-Bauch unten
    return [
      stroke(0, t, L(w1 - r, t), C(w1 - r + k, t, w1, t - r + k, w1, t - r), C(w1, y + r - k, w1 - r + k, y, w1 - r, y), L(a, y),
        ...belly(a, y, p.w, cBot(s), 47 * p.h), L(0, cBot(s))),
    ];
  },
  docks: () => [],
};

const glyph4: GlyphDef = {
  char: "4",
  params: { h, w: R(200, 250, 300) },
  draw(p, s) {
    const xs = 0.72 * p.w, y = s.barLow * p.h;
    return [stroke(xs, 0, L(xs, inkTop(p, s))), stroke(xs, inkTop(p, s), L(0, y), L(p.w, y))]; // Diagonale ab der Oberkante (keine Stufe am Stamm), Querbalken auf der unteren Linie
  },
  docks: () => [],
};

const glyph5: GlyphDef = {
  char: "5",
  params: { h, w: R(180, 230, 290) },
  draw(p, s) {
    // Arm, Stamm bis zur oberen Linie, darunter runder Bauch (Rundung wie bei O und U) zurück zur Grundlinie
    const t = cTop(p, s), b = cBot(s), y = s.barHigh * p.h, r = Math.min((y - b) / 2, p.w / 2), k = KAPPA * r;
    return [
      stroke(0.85 * p.w, t, L(0, t), L(0, y), L(p.w - r, y), C(p.w - r + k, y, p.w, y - r + k, p.w, y - r), L(p.w, b + r),
        C(p.w, b + r - k, p.w - r + k, b, p.w - r, b), L(0, b)),
    ];
  },
  docks: () => [],
};

/** 6: Kopf wie beim C, Schleife unten bis zur oberen Balkenlinie. */
function six(p: Params, s: Style): Stroke {
  const t = cTop(p, s), b = cBot(s), rc = 0.143 * inkTop(p, s), kc = KAPPA * rc, r = p.w / 2, k = KAPPA * r, yk = s.barHigh * p.h;
  return stroke(0.85 * p.w, t, L(rc, t), C(rc - kc, t, 0, t - rc + kc, 0, t - rc), L(0, b + r),
    C(0, b + r - k, r - k, b, r, b), C(r + k, b, p.w, b + r - k, p.w, b + r), L(p.w, yk - r),
    C(p.w, yk - r + k, r + k, yk, r, yk), C(r - k, yk, 0, yk - r + k, 0, yk - r));
}

const glyph6: GlyphDef = { char: "6", params: { h, w: R(180, 230, 280) }, draw: (p, s) => [six(p, s)], docks: () => [] };

const glyph9: GlyphDef = {
  char: "9",
  params: { h, w: R(180, 230, 280) },
  draw: (p, s) => [mapPts(six(p, s), (q) => ({ x: p.w - q.x, y: inkTop(p, s) - q.y }))], // 6 um 180° gedreht: Schleife oben bis zur unteren Linie
  docks: () => [],
};

const glyph7: GlyphDef = {
  char: "7",
  params: { h, w: R(180, 230, 290) },
  draw(p, s) {
    const t = cTop(p, s), x0 = 0.3 * p.w, d = capDrop(p.w - x0, t, s);
    return [stroke(0, t, L(p.w, t), L(x0 - ((p.w - x0) * d) / t, -d))];
  },
  docks: () => [],
};

const glyph8: GlyphDef = {
  char: "8",
  params: { h, w: R(180, 230, 290) },
  draw(p, s) {
    const t = cTop(p, s), b = cBot(s), y = s.barHigh * p.h, w1 = 0.8 * p.w, x1 = (p.w - w1) / 2, r1 = (t - y) / 2, k1 = KAPPA * r1;
    const r = p.w / 2, k = KAPPA * r;
    return [
      closed(stroke(x1 + r1, t, L(x1 + w1 - r1, t), C(x1 + w1 - r1 + k1, t, x1 + w1, t - r1 + k1, x1 + w1, t - r1),
        C(x1 + w1, y + r1 - k1, x1 + w1 - r1 + k1, y, x1 + w1 - r1, y), L(x1 + r1, y),
        C(x1 + r1 - k1, y, x1, y + r1 - k1, x1, y + r1), C(x1, t - r1 + k1, x1 + r1 - k1, t, x1 + r1, t))),
      closed(stroke(0, b + r, L(0, y - r), C(0, y - r + k, r - k, y, r, y), C(r + k, y, p.w, y - r + k, p.w, y - r),
        L(p.w, b + r), C(p.w, b + r - k, r + k, b, r, b), C(r - k, b, 0, b + r - k, 0, b + r))),
    ];
  },
  docks: () => [],
};

// ── Satz- und Plakatzeichen (M2) ──

const moveBy = (dx: number, dy: number) => (q: Pt): Pt => ({ x: q.x + dx, y: q.y + dy });

const square = (x: number, y: number, s: Style) => stroke(x - s.stroke / 2, y, L(x + s.stroke / 2, y)); // Punkt: Quadrat um (x, y)

const mid = (s: Style) => s.capHeight / 2; // halbe Versalhöhe, für Striche und Zeichen in der Mitte

const fixed: Record<string, Range> = {}; // Satzzeichen: keine Regler, die Form bleibt auch verschachtelt

const glyphPeriod: GlyphDef = { char: ".", params: fixed, draw: (_p, s) => [square(s.stroke / 2, s.stroke / 2, s)], docks: () => [] };

/** Komma: Punkt auf der Grundlinie, Schwanz schräg nach links unten (Unterlänge). */
const comma = (x: number, s: Style) => [square(x, s.stroke / 2, s), stroke(x, s.stroke / 2, L(x - 26, -117))]; // Schwanz beginnt in der Punktmitte, sein Ende verschwindet im Quadrat

const glyphComma: GlyphDef = { char: ",", params: fixed, desc: 130, draw: (_p, s) => comma(s.stroke / 2 + 19, s), docks: () => [] };

const glyphColon: GlyphDef = {
  char: ":",
  params: fixed,
  draw: (_p, s) => [square(s.stroke / 2, s.stroke / 2, s), square(s.stroke / 2, s.barLow, s)],
  docks: () => [],
};

const glyphSemicolon: GlyphDef = {
  char: ";",
  params: fixed,
  desc: 130,
  draw: (_p, s) => [...comma(s.stroke / 2 + 19, s), square(s.stroke / 2 + 19, s.barLow, s)],
  docks: () => [],
};

const glyphExclam: GlyphDef = {
  char: "!",
  params: fixed,
  draw: (_p, s) => [stroke(s.stroke / 2, s.barLow, L(s.stroke / 2, s.capHeight)), square(s.stroke / 2, s.stroke / 2, s)], // Stamm endet auf der unteren Linie
  docks: () => [],
};

const glyphQuestion: GlyphDef = {
  char: "?",
  params: { h, w: R(160, 200, 260) },
  draw(p, s) {
    const c = p.w / 2;
    return [stroke(0, cTop(p, s), ...head2(p, s, s.barHigh * p.h), L(c, mid(s) * p.h), L(c, s.barLow * p.h)), square(c, s.stroke / 2, s)];
  },
  docks: () => [],
};

/** Form für Kleinbuchstaben (Feinschliff): 0 = auf Versalhöhen-Mitte wie bisher, 1 = auf x-Höhen-Mitte. Die Engine wählt sie aus den Nachbarn (lowerForms), nie stufenlos. */
const lc = R(0, 0, 1);
const lowMid = (p: Params, s: Style) => (p.lc > 0.5 ? s.xHeight / 2 : mid(s));

const glyphHyphen: GlyphDef = { char: "-", params: { lc }, draw: (p, s) => [stroke(0, lowMid(p, s), L(140, lowMid(p, s)))], docks: () => [] };

const glyphEndash: GlyphDef = { char: "–", params: { lc }, draw: (p, s) => [stroke(0, lowMid(p, s), L(280, lowMid(p, s)))], docks: () => [] };

/** Klammer: flacher Bogen über die ganze Höhe; die Enden laufen waagrecht in Ober- und Grundlinie aus, der stumpfe Schnitt steht senkrecht.
 *  Kleinbuchstaben-Form: um die x-Höhen-Mitte, je eine Unterlänge (130) über und unter die x-Höhe; Breite im gleichen Verhältnis. */
function paren(p: Params, s: Style): Stroke {
  const [y0, y1] = p.lc > 0.5 ? [-PAREN_DESC, s.xHeight + PAREN_DESC] : [0, s.capHeight], H = y1 - y0, w = PAREN_W * (H / s.capHeight);
  const m = (y0 + y1) / 2, t = y1 - s.stroke / 2, b = y0 + s.stroke / 2;
  return stroke(w, t, C(0.35 * w, t, 0, m + 0.3 * H, 0, m), C(0, m - 0.3 * H, 0.35 * w, b, w, b));
}
const PAREN_W = 110, PAREN_DESC = 130; // Unterlänge wie g, j, y

const parenDesc = (p: Params) => (p.lc > 0.5 ? PAREN_DESC : 0);
const glyphParenLeft: GlyphDef = { char: "(", params: { lc }, descFor: parenDesc, draw: (p, s) => [paren(p, s)], docks: () => [] };

const glyphParenRight: GlyphDef = {
  char: ")",
  params: { lc },
  descFor: parenDesc,
  draw: (p, s) => {
    const st = paren(p, s), w = st.start.x;
    return [mapPts(st, (q) => ({ x: w - q.x, y: q.y }))];
  },
  docks: () => [],
};

const glyphSlash: GlyphDef = {
  char: "/",
  params: fixed,
  draw(_p, s) {
    const w = 220, H = s.capHeight, d = capDrop(w, H, s), x = (w * d) / H;
    return [stroke(-x, -d, L(w + x, H + d))];
  },
  docks: () => [],
};

/** Hohes Häkchen (gerade) für ' und ". */
const tick = (x: number, s: Style) => stroke(x, s.barHigh, L(x, s.capHeight));

/** Komma-förmiges Anführungszeichen oben („9“); gedreht ergibt es die „6“. */
const quote9 = (x: number, s: Style) => [square(x, s.capHeight - s.stroke / 2, s), stroke(x, s.capHeight - s.stroke / 2, L(x - 26, s.barHigh))]; // wie das Komma: Schwanz aus der Punktmitte

const quote6 = (x: number, s: Style) => quote9(x, s).map((st) => mapPts(st, (q) => ({ x: 2 * x - q.x, y: s.capHeight + s.barHigh - q.y })));

const glyphQuoteSingle: GlyphDef = { char: "'", params: fixed, draw: (_p, s) => [tick(s.stroke / 2, s)], docks: () => [] };

const glyphQuoteDbl: GlyphDef = { char: '"', params: fixed, draw: (_p, s) => [tick(s.stroke / 2, s), tick(s.stroke / 2 + 56, s)], docks: () => [] };

const glyphQuoteRight: GlyphDef = { char: "’", params: fixed, draw: (_p, s) => quote9(32, s), docks: () => [] };

const glyphQuoteLeft: GlyphDef = { char: "‘", params: fixed, draw: (_p, s) => quote6(13, s), docks: () => [] };

const glyphQuoteDblLeft: GlyphDef = { char: "“", params: fixed, draw: (_p, s) => [...quote6(13, s), ...quote6(13 + 66, s)], docks: () => [] };

const glyphQuoteSingleBase: GlyphDef = { char: "‚", params: fixed, desc: 130, draw: (_p, s) => comma(32, s), docks: () => [] };

const glyphQuoteDblBase: GlyphDef = { char: "„", params: fixed, desc: 130, draw: (_p, s) => [...comma(32, s), ...comma(32 + 66, s)], docks: () => [] };

/** Winkel für Guillemets: Spitze links auf halber Höhe. */
const chevron = (x: number, s: Style) => stroke(x + 90, mid(s) + 100, L(x, mid(s)), L(x + 90, mid(s) - 100));

const glyphGuillemetLeft: GlyphDef = { char: "«", params: fixed, draw: (_p, s) => [chevron(0, s), chevron(90, s)], docks: () => [] };

const glyphGuillemetRight: GlyphDef = {
  char: "»",
  params: fixed,
  draw: (_p, s) => [chevron(0, s), chevron(90, s)].map((st) => mapPts(st, (q) => ({ x: 180 - q.x, y: q.y }))),
  docks: () => [],
};

const glyphEllipsis: GlyphDef = {
  char: "…",
  params: fixed,
  draw: (_p, s) => [0, 1, 2].map((i) => square(s.stroke / 2 + i * 70, s.stroke / 2, s)),
  docks: () => [],
};

/** Liegendes Oval zwischen y und t (Halbkreise links und rechts), linke Kante bei x. */
function loop(x: number, w: number, y: number, t: number): Stroke {
  const r = (t - y) / 2, k = KAPPA * r;
  return closed(stroke(x + r, t, L(x + w - r, t), C(x + w - r + k, t, x + w, t - r + k, x + w, t - r), C(x + w, y + r - k, x + w - r + k, y, x + w - r, y),
    L(x + r, y), C(x + r - k, y, x, y + r - k, x, y + r), C(x, t - r + k, x + r - k, t, x + r, t)));
}

const glyphAmpersand: GlyphDef = {
  char: "&",
  params: { h, w: R(240, 300, 360) },
  draw(p, s) {
    // Schleife oben bis zur oberen Linie, Bein nach rechts unten, Bauch links mit Schwanz bis zur unteren Linie
    const t = cTop(p, s), y = s.barHigh * p.h, yl = s.barLow * p.h, b = cBot(s), w = p.w, x1 = 30, w1 = 160, r = (t - y) / 2;
    const lx = x1 + 30, ly = y + r - Math.sqrt(r * r - (lx - x1 - r) ** 2); // Bein beginnt auf der Schleife
    const run = w - lx, d = capDrop(run, ly, s);
    return [
      loop(x1, w1, y, t),
      stroke(lx, ly, L(w + (run * d) / ly, -d)),
      stroke(x1 + w1 - 0.6 * r, y + 6, C(x1 + w1 - 120, y - 110, 0, 0.6 * y + 90, 0, 0.48 * y), C(0, 0.2 * y, 50, b, 140, b), C(220, b, w - 20, yl - 90, w - 10, yl)),
    ];
  },
  docks: () => [],
};

const glyphEuro: GlyphDef = {
  char: "€",
  params: { h, w: R(200, 240, 290) },
  draw(p, s) {
    const y1 = 0.42 * inkTop(p, s), y2 = 0.58 * inkTop(p, s), x = 40; // Querstriche ragen links 40 über den Bogen
    return [mapPts(bowlC({ ...p, wb: p.w }, s), moveBy(x, 0)), stroke(0, y1, L(x + 0.6 * p.w, y1)), stroke(0, y2, L(x + 0.6 * p.w, y2))];
  },
  docks: () => [],
};

/** Kleines stehendes Oval (Prozent). */
function oval(x: number, y0: number, y1: number, w: number): Stroke {
  const r = w / 2, k = KAPPA * r;
  return closed(stroke(x, y0 + r, L(x, y1 - r), C(x, y1 - r + k, x + r - k, y1, x + r, y1), C(x + r + k, y1, x + w, y1 - r + k, x + w, y1 - r),
    L(x + w, y0 + r), C(x + w, y0 + r - k, x + r + k, y0, x + r, y0), C(x + r - k, y0, x, y0 + r - k, x, y0 + r)));
}

const glyphPercent: GlyphDef = {
  char: "%",
  params: fixed,
  draw(_p, s) {
    const H = s.capHeight, w = 300, d = capDrop(w, H, s), x = (w * d) / H, b = s.stroke / 2;
    return [oval(0, s.barHigh - 100, H - b, 90), oval(w - 90, b, s.barLow + 100, 90), stroke(-x, -d, L(w + x, H + d))];
  },
  docks: () => [],
};

const glyphAt: GlyphDef = {
  char: "@",
  params: fixed,
  draw(_p, s) {
    // kleines A mittig im O-Oval; die Beine laufen unten 8 Einheiten lotrecht aus, so endet der Fuß waagrecht ohne Beschnitt
    const y0 = 0.29 * s.capHeight, t = y0 + 0.42 * s.capHeight - s.stroke / 2, xl = 75, xr = 225, a = s.apexW / 2, yb = y0 + 0.42 * s.barLow;
    const xAt = (y: number) => xl + ((y - y0 - 8) / (t - y0 - 8)) * (150 - a - xl); // linkes Bein auf Höhe y
    return [
      ...glyphO.draw({ h: 1, w: 300 }, s),
      stroke(xl, y0, L(xl, y0 + 8), L(150 - a, t), L(150 + a, t), L(xr, y0 + 8), L(xr, y0)),
      stroke(xAt(yb), yb, L(300 - xAt(yb), yb)),
    ];
  },
  docks: () => [],
};

const glyphNumber: GlyphDef = {
  char: "#",
  params: fixed,
  draw(_p, s) {
    const H = s.capHeight, w = 260;
    return [stroke(70, 0, L(70, H)), stroke(w - 70, 0, L(w - 70, H)), stroke(0, s.barLow, L(w, s.barLow)), stroke(0, s.barHigh, L(w, s.barHigh))];
  },
  docks: () => [],
};

const glyphPlus: GlyphDef = {
  char: "+",
  params: fixed,
  draw: (_p, s) => [stroke(110, mid(s) - 110, L(110, mid(s) + 110)), stroke(0, mid(s), L(220, mid(s)))],
  docks: () => [],
};

const glyphEqual: GlyphDef = {
  char: "=",
  params: fixed,
  draw: (_p, s) => [stroke(0, mid(s) - 55, L(220, mid(s) - 55)), stroke(0, mid(s) + 55, L(220, mid(s) + 55))],
  docks: () => [],
};

const glyphAsterisk: GlyphDef = {
  char: "*",
  params: fixed,
  draw(_p, s) {
    const c = 100, r = 100;
    return [0, 60, 120].map((deg) => {
      const a = (deg * Math.PI) / 180, dx = r * Math.sin(a), dy = r * Math.cos(a);
      return stroke(c - dx, mid(s) - dy, L(c + dx, mid(s) + dy));
    });
  },
  docks: () => [],
};

const glyphSection: GlyphDef = {
  char: "§",
  params: fixed,
  draw(_p, s) {
    // Kopf wie beim C links hinab in einen Ring auf halber Höhe, aus dem Ring rechts hinab in den Fuß wie beim D
    const H = s.capHeight, t = H - s.stroke / 2, b = s.stroke / 2, w = 200, c = mid(s), R0 = w / 2, k = KAPPA * R0, r = 0.143 * H, kr = KAPPA * r, rb = 47;
    return [
      stroke(0.85 * w, t, L(r, t), C(r - kr, t, 0, t - r + kr, 0, t - r), L(0, c)),
      closed(stroke(0, c, C(0, c + k, R0 - k, c + R0, R0, c + R0), C(R0 + k, c + R0, w, c + k, w, c), C(w, c - k, R0 + k, c - R0, R0, c - R0), C(R0 - k, c - R0, 0, c - k, 0, c))),
      stroke(w, c, L(w, b + rb), C(w, b + rb * (1 - KAPPA), w - rb * (1 - KAPPA), b, w - rb, b), L(0, b)),
    ];
  },
  docks: () => [],
};

// ── Monogramm (M2) ──

/** Monogramm HAF: A frei zwischen den H-Stämmen, gemeinsamer Balken auf der unteren Linie (H-Balken = A-Querbalken), F-Arme am rechten H-Stamm. */
const glyphHAF: GlyphDef = {
  char: "\uE000",
  params: { h, w: R(260, 320, 400) },
  draw(p, s) {
    const top = inkTop(p, s), t = cTop(p, s), y = s.barLow * p.h, yh = s.barHigh * p.h, x0 = 50, x1 = p.w - 50; // A-Füße 50 vom Stamm
    const run = (x1 - x0 - s.apexW) / 2, d = capDrop(run, t, s), fw = glyphF.params.w.def; // F-Arme wie beim F: oben fw, Mitte 0,8 · fw
    return [
      stroke(0, 0, L(0, top)),
      stroke(p.w, 0, L(p.w, top)),
      stroke(x0 - (run * d) / t, -d, L(x0 + run, t), L(x1 - run, t), L(x1 + (run * d) / t, -d)),
      stroke(0, y, L(p.w, y)),
      stroke(p.w, t, L(p.w + fw, t)),
      stroke(p.w, yh, L(p.w + 0.8 * fw, yh)),
    ];
  },
  docks: () => [],
};

// ── Kleinbuchstaben (M4) ──

const DESC = 130; // Unterlänge (Tinte), so tief wie das Komma
const xMid = (s: Style) => s.xHeight - s.stroke / 2; // Mittellinie oben auf der x-Höhe
const aMid = (s: Style) => s.capHeight - s.stroke / 2; // Mittellinie oben auf der Oberlänge (= Versalhöhe)
const dMid = (s: Style) => -DESC + s.stroke / 2; // Mittellinie unten auf der Unterlänge
const stem = (x: number, y0: number, y1: number) => stroke(x, y0, L(x, y1));
const TAIL = 60; // Radius des Schwanzes von g und j
const STEM_X = 50; // Stamm von f und t; der Querstrich beginnt bei x = 0
const CROSS = 150; // Querstrich von f und t endet ohne Verlängerung hier (links 50, rechts 100 vom Stamm)

/** Runder Bauch zwischen Grundlinie und x-Höhe: Halbkreise oben und unten wie beim O. */
const ring = (w: number, s: Style) => oval(0, cBot(s), xMid(s), w);

/** Bogen wie beim n: aus dem Stamm bei x0 als Halbkreis über die x-Höhe, rechts senkrecht hinab zur Grundlinie. */
function arch(x0: number, w: number, s: Style): Stroke {
  const t = xMid(s), r = w / 2, k = KAPPA * r;
  return stroke(x0, t - r, C(x0, t - r + k, x0 + r - k, t, x0 + r, t), C(x0 + r + k, t, x0 + w, t - r + k, x0 + w, t - r), L(x0 + w, 0));
}

/** Unterlänge: von (x, y0) senkrecht hinab, Viertelkreis nach links auf die Unterlänge, waagrecht bis end. */
function tail(x: number, y0: number, end: number, s: Style): Stroke {
  const y = dMid(s), k = KAPPA * TAIL;
  return stroke(x, y0, L(x, y + TAIL), C(x, y + TAIL - k, x - TAIL + k, y, x - TAIL, y), L(end, y));
}

/** Endpunkt eines schrägen Strichs von (x0, y0) über (x1, y1) hinaus: der Beschnitt bei y1 schneidet dann waagrecht (wie beim V und X). */
function past(x0: number, y0: number, x1: number, y1: number, s: Style): Pt {
  const dx = x1 - x0, dy = y1 - y0, f = capDrop(Math.abs(dx), Math.abs(dy), s) / Math.abs(dy);
  return { x: x1 + dx * f, y: y1 + dy * f };
}

/** Umlautpunkte der Kleinbuchstaben: Mitte 90 über der x-Höhe, bei einem Viertel und drei Vierteln der Breite. */
const lowDots = (w: number, s: Style) => dots(s.xHeight + 90, w / 4, (3 * w) / 4, s);

const glyph_a: GlyphDef = {
  char: "a",
  params: { w: R(140, 170, 210) },
  draw: (p, s) => [ring(p.w, s), stem(p.w, 0, s.xHeight)], // einstöckig: runder Bauch, Stamm rechts
  docks: (p) => [{ kind: "stem", side: "right", x: p.w }],
};

const glyph_ae: GlyphDef = { ...glyph_a, char: "ä", draw: (p, s) => [...glyph_a.draw(p, s), ...lowDots(p.w, s)] };

const glyph_b: GlyphDef = {
  char: "b",
  params: { w: R(140, 170, 210) },
  draw: (p, s) => [stem(0, 0, s.capHeight), ring(p.w, s)],
  docks: () => [{ kind: "stem", side: "left", x: 0 }],
};

const glyph_c: GlyphDef = {
  char: "c",
  params: { w: R(130, 160, 200), term: R(0, 0, 250) },
  draw(p, s) {
    // linke Hälfte des o, beide Enden waagrecht; das obere läuft beim Strich-Teilen bis in den Nachbarstamm („ch“)
    const t = xMid(s), b = cBot(s), r = p.w / 2, k = KAPPA * r;
    return [stroke(p.w + p.term, t, L(r, t), C(r - k, t, 0, t - r + k, 0, t - r), L(0, b + r), C(0, b + r - k, r - k, b, r, b), L(p.w, b))];
  },
  docks: (p, s) => [{ kind: "terminal", topEnd: p.w + p.term, y: xMid(s) }],
  close: (p, x) => ({ ...p, term: Math.max(0, x - p.w) }),
  adjust: { left: -10 },
};

const glyph_d: GlyphDef = {
  char: "d",
  params: { w: R(140, 170, 210) },
  draw: (p, s) => [ring(p.w, s), stem(p.w, 0, s.capHeight)],
  docks: (p) => [{ kind: "stem", side: "right", x: p.w }],
};

const glyph_e: GlyphDef = {
  char: "e",
  params: { w: R(140, 170, 210) },
  draw(p, s) {
    // vom unteren Ende (rechts, waagrecht) links herum über die x-Höhe, rechts hinab bis zum Querstrich, der in die linke Flanke läuft
    const t = xMid(s), b = cBot(s), r = p.w / 2, k = KAPPA * r, y = 0.53 * s.xHeight; // Querstrich knapp über der halben x-Höhe
    return [
      stroke(p.w, b, L(r, b), C(r - k, b, 0, b + r - k, 0, b + r), L(0, t - r), C(0, t - r + k, r - k, t, r, t), C(r + k, t, p.w, t - r + k, p.w, t - r),
        L(p.w, y), L(0, y)),
    ];
  },
  docks: () => [],
  adjust: { left: -10 },
};

const glyph_f: GlyphDef = {
  char: "f",
  params: { hook: R(45, 110, 160), cross: R(0, 0, 250) },
  draw(p, s) {
    // Stamm bis unter die Oberlänge, Viertelkreis in den Haken nach rechts; Querstrich auf der x-Höhe
    const t = aMid(s), r = Math.min(p.hook, 60), k = KAPPA * r, y = xMid(s);
    const hook = [L(STEM_X, t - r), C(STEM_X, t - r + k, STEM_X + r - k, t, STEM_X + r, t), ...(p.hook > r ? [L(STEM_X + p.hook, t)] : [])];
    return [stroke(STEM_X, 0, ...hook), stroke(0, y, L(CROSS + p.cross, y))];
  },
  docks: (p, s) => [{ kind: "cross", y: xMid(s), x0: 0, x1: CROSS + p.cross }],
  extend: (p, x) => ({ ...p, cross: Math.max(0, x - CROSS) }),
  trimTop: (p, end) => ({ ...p, hook: Math.max(45, Math.min(end - STEM_X, p.hook)) }),
  loose: true,
};

const glyph_g: GlyphDef = {
  char: "g",
  params: { w: R(140, 170, 210), tail: R(-400, 40, 40) },
  desc: DESC,
  draw: (p, s) => [ring(p.w, s), tail(p.w, s.xHeight, p.tail, s)], // wie a, der Stamm läuft in den Schwanz nach links
  docks: (p) => [{ kind: "tail", end: p.tail }],
  tailTo: (p, x) => ({ ...p, tail: Math.min(40, x) }),
};

const glyph_h: GlyphDef = {
  char: "h",
  params: { w: R(140, 170, 210) },
  draw: (p, s) => [stem(0, 0, s.capHeight), arch(0, p.w, s)],
  docks: (p) => [{ kind: "stem", side: "left", x: 0 }, { kind: "stem", side: "right", x: p.w }],
};

const glyph_i: GlyphDef = {
  char: "i",
  params: fixed,
  draw: (_p, s) => [stem(0, 0, s.xHeight), square(0, s.xHeight + 90, s)],
  docks: () => [{ kind: "stem", side: "left", x: 0, solo: true }],
};

const glyph_j: GlyphDef = {
  char: "j",
  params: { tail: R(-400, 20, 20) },
  desc: DESC,
  draw: (p, s) => [tail(100, s.xHeight, p.tail, s), square(100, s.xHeight + 90, s)],
  docks: (p) => [{ kind: "tail", end: p.tail }],
  tailTo: (p, x) => ({ ...p, tail: Math.min(20, x) }),
};

const glyph_k: GlyphDef = {
  char: "k",
  params: { w: R(130, 160, 200) },
  draw(p, s) {
    // Arm und Bein treffen sich auf halber x-Höhe am Stamm; der Arm ragt schräg knapp über die x-Höhe und wird dort waagrecht beschnitten (wie der K-Arm oben)
    const j = s.xHeight / 2, drop = capDrop(p.w, j, s), e = past(0, j, 0.9 * p.w, s.xHeight, s);
    return [stem(0, 0, s.capHeight), { ...stroke(0, j, L(e.x, e.y)), top: s.xHeight }, stroke(0, j, L(p.w * (1 + drop / j), -drop))];
  },
  docks: () => [{ kind: "stem", side: "left", x: 0 }],
};

const glyph_l: GlyphDef = {
  char: "l",
  params: fixed,
  draw: (_p, s) => [stem(0, 0, s.capHeight)],
  docks: () => [{ kind: "stem", side: "left", x: 0, solo: true }],
};

const glyph_m: GlyphDef = {
  char: "m",
  params: { w: R(240, 300, 360) },
  draw: (p, s) => [stem(0, 0, s.xHeight), arch(0, p.w / 2, s), arch(p.w / 2, p.w / 2, s)],
  docks: (p) => [{ kind: "stem", side: "left", x: 0 }, { kind: "stem", side: "right", x: p.w }],
};

const glyph_n: GlyphDef = {
  char: "n",
  params: { w: R(140, 170, 210) },
  draw: (p, s) => [stem(0, 0, s.xHeight), arch(0, p.w, s)],
  docks: (p) => [{ kind: "stem", side: "left", x: 0 }, { kind: "stem", side: "right", x: p.w }],
};

const glyph_o: GlyphDef = {
  char: "o",
  params: { w: R(150, 180, 220) },
  draw: (p, s) => [ring(p.w, s)],
  docks: () => [],
  adjust: { left: -10, right: -10 },
};

const glyph_oe: GlyphDef = { ...glyph_o, char: "ö", draw: (p, s) => [ring(p.w, s), ...lowDots(p.w, s)] };

const glyph_p: GlyphDef = {
  char: "p",
  params: { w: R(140, 170, 210) },
  desc: DESC,
  draw: (p, s) => [stem(0, -DESC, s.xHeight), ring(p.w, s)],
  docks: () => [{ kind: "stem", side: "left", x: 0 }],
};

const glyph_q: GlyphDef = {
  char: "q",
  params: { w: R(140, 170, 210) },
  desc: DESC,
  draw: (p, s) => [ring(p.w, s), stem(p.w, -DESC, s.xHeight)],
  docks: () => [],
};

const glyph_r: GlyphDef = {
  char: "r",
  params: { w: R(90, 120, 160) },
  draw(p, s) {
    const t = xMid(s), r = 85, k = KAPPA * r; // Bogenansatz wie beim n in Startbreite (170 / 2), Ende waagrecht
    return [stem(0, 0, s.xHeight), stroke(0, t - r, C(0, t - r + k, r - k, t, r, t), L(p.w, t))];
  },
  docks: () => [{ kind: "stem", side: "left", x: 0 }],
};

const glyph_s: GlyphDef = {
  char: "s",
  params: { w: R(130, 150, 190) },
  draw: (p, s) => [swash(p.w, xMid(s), cBot(s), 60, 45)], // S-Linie auf x-Höhe; Ecken runder als beim verkleinerten S, sonst wird der Fuß spitz
  docks: () => [],
};

const glyph_t: GlyphDef = {
  char: "t",
  params: { cross: R(0, 0, 250) },
  draw: (p, s) => [stem(STEM_X, 0, 470), stroke(0, xMid(s), L(CROSS + p.cross, xMid(s)))],
  docks: (p, s) => [{ kind: "cross", y: xMid(s), x0: 0, x1: CROSS + p.cross }],
  extend: (p, x) => ({ ...p, cross: Math.max(0, x - CROSS) }),
};

const glyph_u: GlyphDef = {
  char: "u",
  params: { w: R(140, 170, 210) },
  draw: (p, s) => glyph_n.draw(p, s).map((st) => mapPts(st, (q) => ({ x: p.w - q.x, y: s.xHeight - q.y }))), // n um 180° gedreht
  docks: (p) => [{ kind: "stem", side: "left", x: 0 }, { kind: "stem", side: "right", x: p.w }],
};

const glyph_ue: GlyphDef = { ...glyph_u, char: "ü", draw: (p, s) => [...glyph_u.draw(p, s), ...lowDots(p.w, s)] };

const glyph_v: GlyphDef = {
  char: "v",
  params: { w: R(150, 190, 240) },
  top: (s) => s.xHeight,
  draw(p, s) {
    const b = cBot(s), run = (p.w - s.apexW) / 2, l = past(run, b, 0, s.xHeight, s), r = past(p.w - run, b, p.w, s.xHeight, s);
    return [stroke(l.x, l.y, L(run, b), L(p.w - run, b), L(r.x, r.y))]; // wie V mit flacher Spitze
  },
  docks: () => [],
};

const glyph_w: GlyphDef = {
  char: "w",
  params: { w: R(240, 290, 350) },
  top: (s) => s.xHeight,
  draw(p, s) {
    // wie W: zwei Stämme, dazwischen die flache Spitze auf der oberen Balkenlinie (verhältnisgleich zur x-Höhe)
    const c = p.w / 2, a = s.apexW / 2, vy = (s.barHigh / s.capHeight) * s.xHeight;
    return [stroke(0, s.xHeight, L(0, 0), L(c - a, vy), L(c + a, vy), L(p.w, 0), L(p.w, s.xHeight))];
  },
  docks: () => [],
};

const glyph_x: GlyphDef = {
  char: "x",
  params: { w: R(150, 180, 230) },
  top: (s) => s.xHeight,
  draw(p, s) {
    // zwei Geraden, Kreuzung auf halber x-Höhe; Enden knapp über x-Höhe und unter die Grundlinie, dort waagrecht beschnitten
    const a = past(p.w, 0, 0, s.xHeight, s), b = past(0, s.xHeight, p.w, 0, s);
    return [stroke(a.x, a.y, L(b.x, b.y)), stroke(p.w - a.x, a.y, L(p.w - b.x, b.y))];
  },
  docks: () => [],
};

const glyph_y: GlyphDef = {
  char: "y",
  params: { w: R(150, 190, 240), tail: R(-400, 0, 0) },
  top: (s) => s.xHeight,
  desc: DESC,
  draw(p, s) {
    // v ohne flache Spitze: der rechte Arm läuft gerade weiter bis zur Unterlänge und endet waagrecht nach links
    const b = cBot(s), y = dMid(s), c = p.w / 2, xb = c - ((p.w - c) * (b - y)) / (s.xHeight - b);
    const l = past(c, b, 0, s.xHeight, s), r = past(xb, y, p.w, s.xHeight, s);
    return [stroke(r.x, r.y, L(xb, y), L(p.tail, y)), stroke(l.x, l.y, L(c, b))];
  },
  docks: (p) => [{ kind: "tail", end: p.tail }],
  tailTo: (p, x) => ({ ...p, tail: Math.min(0, x) }),
};

const glyph_z: GlyphDef = {
  char: "z",
  params: { w: R(140, 170, 210), foot: R(0, 0, 300) },
  draw(p, s) {
    const t = xMid(s), b = cBot(s);
    return [stroke(0, t, L(p.w, t), L(0, b), L(p.w + p.foot, b))];
  },
  docks: (p) => [{ kind: "foot", end: p.w + p.foot }],
  reach: (p, end) => ({ ...p, foot: Math.max(0, end - p.w) }),
};

const glyph_sz: GlyphDef = {
  char: "ß",
  params: { w: R(160, 200, 240) },
  draw: (p, s) => glyphSZ.draw({ h: 1, w: p.w }, s), // das ẞ in der schmaleren Breite: eckiges Dach auf der Oberlänge (= Versalhöhe), Segel darunter
  docks: () => [{ kind: "stem", side: "left", x: 0 }],
};

/** Ersatz für noch nicht entworfene Zeichen. */
export const PLACEHOLDER: GlyphDef = {
  char: "?",
  params: { h },
  draw: (p, s) => [closed(stroke(0, cBot(s), L(200, cBot(s)), L(200, cTop(p, s)), L(0, cTop(p, s))))],
  docks: () => [],
};

export const GLYPHS: Record<string, GlyphDef> = Object.fromEntries(
  [
    glyphA, glyphAE, glyphB, glyphC, glyphD, glyphE, glyphF, glyphG, glyphH, glyphI, glyphJ, glyphK, glyphL, glyphM, glyphN, glyphO, glyphOE,
    glyphP, glyphQ, glyphR, glyphS, glyphSZ, glyphT, glyphU, glyphUE, glyphV, glyphW, glyphX, glyphY, glyphZ,
    glyph0, glyph1, glyph2, glyph3, glyph4, glyph5, glyph6, glyph7, glyph8, glyph9,
    glyphPeriod, glyphComma, glyphColon, glyphSemicolon, glyphExclam, glyphQuestion, glyphHyphen, glyphEndash,
    glyphParenLeft, glyphParenRight, glyphSlash, glyphAmpersand, glyphQuoteSingle, glyphQuoteRight, glyphQuoteDbl,
    glyphQuoteDblBase, glyphQuoteDblLeft, glyphQuoteSingleBase, glyphQuoteLeft, glyphGuillemetLeft, glyphGuillemetRight,
    glyphEuro, glyphPercent, glyphAt, glyphNumber, glyphPlus, glyphEqual, glyphAsterisk, glyphSection, glyphEllipsis, glyphHAF,
    glyph_a, glyph_ae, glyph_b, glyph_c, glyph_d, glyph_e, glyph_f, glyph_g, glyph_h, glyph_i, glyph_j, glyph_k, glyph_l, glyph_m, glyph_n,
    glyph_o, glyph_oe, glyph_p, glyph_q, glyph_r, glyph_s, glyph_sz, glyph_t, glyph_u, glyph_ue, glyph_v, glyph_w, glyph_x, glyph_y, glyph_z,
  ].map((g) => [g.char, g]),
);

export const defaults = (g: GlyphDef): Params => Object.fromEntries(Object.entries(g.params).map(([k, r]) => [k, r.def]));
export const inRange = (g: GlyphDef, p: Params) =>
  Object.entries(g.params).every(([k, r]) => {
    const eps = (r.max - r.min) * 1e-3 + 1e-9;
    return p[k] >= r.min - eps && p[k] <= r.max + eps;
  });
