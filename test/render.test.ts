import { expect, test } from "bun:test";
import { layoutLine, layoutText, type Layout } from "../src/engine";
import { L, stroke } from "../src/geom";
import type { GlyphDef } from "../src/glyphs";
import { svgString } from "../src/render";
import { instance } from "../src/rules";
import { FLAECHE_1902 as S } from "../src/style";

const v = layoutLine("DIE FLÄCHE", { style: S, interlock: 0.5, targetWidth: null, pins: { letters: {}, joins: {} } }).variants[0];

test("SVG: ein Gruppe je Buchstabe, ein Pfad je Strich, keine NaN", () => {
  const svg = svgString(v, S, { ink: "#000", paper: "#fff" });
  expect(svg.startsWith("<svg")).toBe(true);
  expect(svg.match(/data-i=/g)!.length).toBe(9);
  const strokes = v.glyphs.reduce((n, g) => n + g.inst.strokes.length, 0) + v.extras.length;
  expect(svg.match(/<path /g)!.length).toBe(strokes);
  expect(svg).not.toContain("NaN");
  expect(svg).toContain(`viewBox="${Math.round((v.minX - 60) * 10) / 10} -60 `);
  expect(svg).toContain('<g id="ink" transform="matrix(1 0 0 -1 0 700)"'); // y-Achse gespiegelt
  expect(svg).toMatch(/<clipPath id="kairos-zeile"><rect x="-10000000" y="0" width="20000000" height="700"\/><\/clipPath><g clip-path="url\(#kairos-zeile\)">/);
});

test("kürzere Buchstaben mit Ink über der eigenen Oberkante werden dort abgeschnitten, die übrigen nicht", () => {
  // FV: V verschachtelt auf 497 Einheiten, seine schrägen Enden ragen darüber
  const fv = layoutLine("FV", { style: S, interlock: 0.5, targetWidth: null, pins: { letters: {}, joins: {} } }).variants[0];
  expect(fv.joins[0].type).toBe("nest");
  const svg = svgString(fv, S, { ink: "#000", paper: null });
  expect(svg).toContain('<clipPath id="kairos-h4970"><rect x="-1000" y="0" width="3000" height="497"/></clipPath>');
  expect(svg).toMatch(/<g data-i="1" transform="translate\([^)]+\)" clip-path="url\(#kairos-h4970\)">/);
  expect(svgString(v, S, { ink: "#000", paper: null })).not.toContain("kairos-h"); // verschachteltes L in DIE FLÄCHE: nichts ragt über
});

test("Komma mit Unterlänge: liegt außerhalb des Zeilenbands, der Rahmen reicht 130 tiefer", () => {
  const c = layoutLine("WIEN, 12.", { style: S, interlock: 0.5, targetWidth: null, pins: { letters: {}, joins: {} } }).variants[0];
  const svg = svgString(c, S, { ink: "#000", paper: null });
  expect(svg).toContain(`viewBox="${Math.round((c.minX - 60) * 10) / 10} -60 `);
  expect(svg).toMatch(/viewBox="[^"]+ 950"/); // 700 + 2 × 60 + 130
  const band = svg.indexOf('clip-path="url(#kairos-zeile)"'), comma = svg.indexOf('data-i="4"'), close = svg.indexOf("</g>", svg.lastIndexOf('data-i="8"'));
  expect(comma).toBeGreaterThan(close); // Komma (Index 4) erst nach dem Band
  expect(band).toBeGreaterThan(0);
});

test("Satzzeichen unter dem F-Arm behalten ihre Form: „F/“ ohne eigenen Beschnitt", () => {
  const fs = layoutLine("F/", { style: S, interlock: 0.5, targetWidth: null, pins: { letters: {}, joins: {} } }).variants[0];
  expect(fs.joins[0].type).toBe("nest");
  expect(fs.glyphs[1].inst.p.h).toBeUndefined();
  expect(svgString(fs, S, { ink: "#000", paper: null })).not.toContain("kairos-h");
});

test("Export ohne Bedienelemente; transparent ohne Papier", () => {
  const svg = svgString(v, S, { ink: "#000", paper: null });
  expect(svg).not.toMatch(/<rect [^>]*fill=/); // kein Papier, keine Klickflächen (das Zeilenband hat keine Füllung)
  expect(svg).not.toContain('class="hit"');
});

test("Vorschau: Klickflächen, Auswahl, Pin-Marke, Overlay", () => {
  const svg = svgString(v, S, {
    ink: "#000", paper: "#fff", interactive: true, selected: 4, pinned: [5],
    overlay: { href: "x.jpg", x: -73, y: -66, w: 2400, h: 830, opacity: 0.5 },
  });
  expect(svg).toContain('class="sel"');
  expect(svg.match(/class="hit"/g)!.length).toBe(8);
  expect(svg).toContain('class="pin"');
  expect(svg).toContain('<image href="x.jpg"');
  expect(svg).not.toContain("NaN");
  expect(svg).toMatch(/<g data-i="4"[^>]*><rect class="sel"/); // Auswahl sitzt beim richtigen Buchstaben
  expect(svg).toMatch(/<g data-i="5"[^>]*><rect class="hit"[^>]*\/><circle class="pin"/);
  expect(svg).toMatch(/class="hits"[\s\S]*id="ink"/); // Klickflächen liegen unter der Tinte
});

test("Vorschau: Verbindungs-Pins bekommen eine Raute unter der Grenze, Export nicht", () => {
  const svg = svgString(v, S, { ink: "#000", paper: "#fff", interactive: true, pinnedJoins: [4, 7, 3] }); // 3 = Wortgrenze: keine Marke
  expect(svg.match(/class="pinj"/g)!.length).toBe(2);
  const f = v.glyphs.find((g) => g.index === 4)!, l = v.glyphs.find((g) => g.index === 5)!;
  const cx = Math.round(((f.x + f.inst.prof.maxX + l.x + l.inst.prof.minX) / 2) * 10) / 10;
  expect(svg).toContain(`<path class="pinj" d="M${cx} -39L`);
  expect(svgString(v, S, { ink: "#000", paper: null, pinnedJoins: [4] })).not.toContain("pinj");
});

test("Zeilenband reicht auch für sehr lange Zeilen", () => {
  const long = layoutLine("HAGEN AAD FOCK ".repeat(40), { style: S, interlock: 0.5, targetWidth: null, pins: { letters: {}, joins: {} } }).variants[0];
  expect(long.maxX).toBeGreaterThan(100000); // ~560 Zeichen
  const [, bx, bw] = svgString(long, S, { ink: "#000", paper: null }).match(/id="kairos-zeile"><rect x="([-\d.]+)" y="0" width="([\d.]+)"/)!.map(Number);
  expect(bx).toBeLessThanOrEqual(long.minX);
  expect(bx + bw).toBeGreaterThanOrEqual(long.maxX);
});

/** Layout von Hand: eine Glyphe bei x = 0. */
function one(def: GlyphDef): Layout {
  const inst = instance(def, {}, S);
  return { glyphs: [{ index: 0, char: def.char, inst, x: 0 }], extras: [], joins: {}, minX: inst.prof.minX, maxX: inst.prof.maxX, width: inst.prof.maxX - inst.prof.minX, score: 0 };
}

test("eigene Oberkante (top): Tinte darüber wird dort abgeschnitten, auch bei Unterlänge zwischen −desc und top", () => {
  const v: GlyphDef = { char: "v", params: {}, top: (s) => s.xHeight, draw: () => [stroke(0, 0, L(0, 400))], docks: () => [] };
  const svg = svgString(one(v), S, { ink: "#000", paper: null });
  expect(svg).toContain('<clipPath id="kairos-h3000"><rect x="-1000" y="0" width="3000" height="300"/></clipPath>');
  expect(svg).toMatch(/<g data-i="0" transform="translate\(0 0\)" clip-path="url\(#kairos-h3000\)">/);

  const y: GlyphDef = { ...v, char: "y", desc: 130, draw: () => [stroke(0, -117, L(0, 400))] };
  const sy = svgString(one(y), S, { ink: "#000", paper: null });
  expect(sy).toContain('<clipPath id="kairos-d1300-3000"><rect x="-1000" y="-130" width="3000" height="430"/></clipPath>');
  expect(sy).toMatch(/<g data-i="0" transform="translate\(0 0\)" clip-path="url\(#kairos-d1300-3000\)">/);
  expect(sy.indexOf('data-i="0"')).toBeGreaterThan(sy.indexOf("</g>", sy.indexOf("kairos-zeile"))); // außerhalb des Zeilenbands
  expect(svgString(one({ ...y, draw: () => [stroke(0, -117, L(0, 287))] }), S, { ink: "#000", paper: null })).not.toContain("kairos-d"); // nichts ragt über
});

test("Strich mit eigener Oberkante (k-Arm): eigener Beschnitt nur für diesen Strich", () => {
  const k = layoutLine("k", { style: S, interlock: 0.5, targetWidth: null, pins: { letters: {}, joins: {} } }).variants[0];
  const svg = svgString(k, S, { ink: "#000", paper: null });
  expect(svg).toContain('<clipPath id="kairos-h3000"><rect x="-1000" y="0" width="3000" height="300"/></clipPath>');
  expect(svg).toMatch(/<g data-i="0" transform="translate\([^)]+\)"><path [^>]+\/><g clip-path="url\(#kairos-h3000\)"><path [^>]+\/><\/g><path /);
});

test("Block: viewBox umfasst beide Zeilen, zweite Zeile mit translate(x y)", () => {
  const b = layoutText("DIE\nFLÄCHE", { style: S, interlock: 0.5, targetWidth: null, pins: { letters: {}, joins: {} }, aspect: null }).variants[0];
  expect(b.lines).toBe(2);
  const svg = svgString(b, S, { ink: "#000", paper: "#fff", interactive: true, selected: 4, pinned: [5] });
  const h = Number(svg.match(/viewBox="[^"]+ ([\d.]+)"/)![1]);
  expect(h).toBe(Math.round((b.height + 120) * 10) / 10);
  const f = b.glyphs.find((g) => g.index === 4)!; // F in Zeile 2
  expect(f.y!).toBeLessThan(0);
  const tr = `translate(${Math.round(f.x * 10) / 10} ${Math.round(f.y! * 10) / 10})`;
  expect(svg).toContain(`<g data-i="4" transform="${tr}"><rect class="sel"`);
  expect(svg).toContain(`<g data-i="4" transform="${tr}"`);
  expect(svg.match(/<rect x="-10000000" y="[-\d.]+" width="20000000" height="700"\/>/g)!.length).toBe(2); // Zeilenband je Zeile
  expect(svg).toMatch(/<clipPath id="kairos-zeile-\d+">/); // eigene Kennung: die einzeilige Wortmarke im Seitenkopf hat schon „kairos-zeile“
  expect(svg).not.toContain("NaN");
});

test("Block: frei ohne Enter ergibt dasselbe SVG wie layoutLine", () => {
  const o = { style: S, interlock: 0.5, targetWidth: null, pins: { letters: {}, joins: {} } };
  for (const t of ["DIE FLÄCHE", "WIEN, 12."]) {
    const a = layoutText(t, { ...o, aspect: null }).variants[0], b = layoutLine(t, o).variants[0];
    expect(svgString(a, S, { ink: "#000", paper: "#fff", interactive: true, selected: 1 })).toBe(svgString(b, S, { ink: "#000", paper: "#fff", interactive: true, selected: 1 }));
  }
});
