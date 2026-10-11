// Teilbild (1200×630) und Favicons aus der Engine → public/ (PNG über Inkscape). Aufruf: bun tools/icons.ts
import { existsSync } from "node:fs";
import { layoutLine } from "../src/engine";
import { svgString } from "../src/render";
import { FLAECHE_1902 } from "../src/style";

const INKSCAPE = "/Applications/Inkscape.app/Contents/MacOS/inkscape";
const INK = "#1d1a17", PAPER = "#f3ecdf";
const pins = { letters: {}, joins: {} };

// Schriftzug als inneres <svg> ohne Papier, in den Kasten (x, y, w, h) eingepasst
function word(text: string, stroke: number, box: [number, number, number, number]): string {
  const style = { ...FLAECHE_1902, stroke };
  const v = layoutLine(text, { style, interlock: 0.5, targetWidth: null, pins }).variants[0];
  if (!v) throw new Error(`kein Satz für ${text}`);
  const [x, y, w, h] = box;
  return svgString(v, style, { ink: INK, paper: null, margin: stroke }).replace("<svg ", `<svg x="${x}" y="${y}" width="${w}" height="${h}" `).replace(/ width="[\d.]+" height="[\d.]+">/, ">").replace(' id="ink"', "");
}

const page = (w: number, h: number, body: string, r = 0) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="${PAPER}"/>${body}</svg>\n`;

const files: Record<string, string> = {
  "og.svg": page(1200, 630, word("DIE FLÄCHE", 30, [80, 90, 1040, 340]) + `<rect x="80" y="470" width="1040" height="3" fill="${INK}"/>` + word("Neustift", 40, [80, 500, 1040, 70])),
  "favicon.svg": page(64, 64, word("N", 90, [4, 4, 56, 56]), 10),
};
for (const [name, svg] of Object.entries(files)) await Bun.write(`public/${name}`, svg);

const pngs: [string, string, number][] = [["og.svg", "og.png", 1200], ["favicon.svg", "favicon.png", 32], ["favicon.svg", "apple-touch-icon.png", 180]];
if (!existsSync(INKSCAPE)) console.error("Inkscape fehlt – nur SVG geschrieben");
else for (const [src, dst, w] of pngs) {
  const r = Bun.spawnSync([INKSCAPE, `public/${src}`, "-o", `public/${dst}`, "-w", String(w)]);
  console.log(`public/${dst}`, r.success ? "" : r.stderr.toString().trim());
}
