import { pathData } from "./geom";
import type { Layout, Placed } from "./engine";
import { cutTop } from "./glyphs";
import type { Style } from "./style";

export type Overlay = { href: string; x: number; y: number; w: number; h: number; opacity: number };
export type RenderOpts = {
  ink: string;
  paper: string | null; // null = transparent
  margin?: number;
  interactive?: boolean; // Klickflächen + Auswahl (nur Vorschau, nie Export)
  selected?: number | null;
  pinned?: number[];
  pinnedJoins?: number[]; // Grenzen mit Verbindungs-Pin, Index des linken Buchstabens
  overlay?: Overlay | null;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Layout → SVG-Text. Schriftkoordinaten (y nach oben) liegen gespiegelt in Gruppen; die Tinte in #ink. Zeilen eines Blocks: y je Glyphe (0 = erste, darunter negativ). */
export function svgString(l: Layout, s: Style, o: RenderOpts): string {
  const m = o.margin ?? 60, H = s.capHeight, desc = Math.max(0, ...l.glyphs.map((g) => (g.inst.def.desc ?? 0) - (g.y ?? 0))); // Unterlängen und tiefere Zeilen im Rahmen
  const at = (g: Placed) => `translate(${r1(g.x)} ${r1(g.y ?? 0)})`;
  const [x, y, w, h] = [l.minX - m, -m, l.width + 2 * m, H + 2 * m + desc].map(r1);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">`];
  if (o.paper) out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${o.paper}"/>`);
  const ov = o.overlay;
  if (ov) out.push(`<image href="${ov.href}" x="${ov.x}" y="${ov.y}" width="${ov.w}" height="${ov.h}" opacity="${ov.opacity}" preserveAspectRatio="none"/>`);
  const flip = `transform="matrix(1 0 0 -1 0 ${H})"`;
  if (o.interactive) {
    // Klickflächen liegen unter aller Tinte: ein Klick auf einen Strich trifft immer dessen eigenen Buchstaben
    out.push(`<g class="hits" ${flip}>`);
    for (const g of l.glyphs) {
      const { minX, maxX } = g.inst.prof, top = r1(cutTop(g.inst.def, g.inst.p, s)), sel = g.index === o.selected;
      out.push(`<g data-i="${g.index}" transform="${at(g)}">`);
      out.push(`<rect class="${sel ? "sel" : "hit"}" x="${r1(minX)}" y="0" width="${r1(maxX - minX)}" height="${top}" fill="${sel ? "#c9a227" : "transparent"}" fill-opacity="${sel ? 0.18 : 0}" stroke="none" pointer-events="all"/>`);
      if (o.pinned?.includes(g.index)) out.push(`<circle class="pin" cx="${r1((minX + maxX) / 2)}" cy="${-m / 2}" r="8" fill="#b03a2e" stroke="none"/>`);
      out.push(`</g>`);
    }
    // Verbindungs-Pins: Raute unter der Grenze zwischen zwei Buchstaben
    for (const i of o.pinnedJoins ?? []) {
      const a = l.glyphs.find((g) => g.index === i), b = l.glyphs.find((g) => g.index === i + 1);
      if (!a || !b || a.y !== b.y) continue;
      const cx = r1((a.x + a.inst.prof.maxX + b.x + b.inst.prof.minX) / 2), cy = r1((a.y ?? 0) - m / 2);
      out.push(`<path class="pinj" d="M${cx} ${cy - 9}L${cx + 9} ${cy}L${cx} ${cy + 9}L${cx - 9} ${cy}Z" fill="#b03a2e" stroke="none"/>`);
    }
    out.push(`</g>`);
  }
  out.push(`<g id="ink" ${flip} fill="none" stroke="${o.ink}" stroke-width="${s.stroke}" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="4">`);
  // Zeilenband in Schriftkoordinaten: schräge Füße und Spitzen enden waagrecht an Grund- und Oberlinie
  // je Zeile ein Band; die Kennung hängt an den Grundlinien (die Wortmarke im Seitenkopf trägt ihr eigenes einzeiliges Band)
  const ys = [...new Set(l.glyphs.map((g) => r1(g.y ?? 0)))], band = ["kairos-zeile", ...ys.filter((y) => y).map((y) => Math.round(-y * 10))].join("-");
  out.push(`<clipPath id="${band}">${ys.map((y) => `<rect x="-10000000" y="${y}" width="20000000" height="${H}"/>`).join("")}</clipPath><g clip-path="url(#${band})">`);
  const clips = new Set<string>();
  /** Beschnitt-Rechteck von −d bis top; die Kennung hängt nur an den Höhen, so stören sich auch mehrere eingebettete SVGs nicht. */
  const clipId = (d: number, top: number) => {
    const id = d ? `kairos-d${Math.round(d * 10)}-${Math.round(top * 10)}` : `kairos-h${Math.round(top * 10)}`;
    if (!clips.has(id)) {
      clips.add(id);
      out.push(`<clipPath id="${id}"><rect x="-1000" y="${-d}" width="3000" height="${r1(top + d)}"/></clipPath>`);
    }
    return id;
  };
  const glyph = (g: Layout["glyphs"][number]) => {
    // an der eigenen Oberkante abschneiden (schräge Enden V X Y v w x y, Gehrungsspitzen M N), Zeichen mit Unterlänge
    // zwischen −desc und Oberkante; Striche mit eigener Oberkante (k-Arm) zusätzlich dort
    const top = r1(cutTop(g.inst.def, g.inst.p, s)), d = g.inst.def.desc ?? 0; // Satzzeichen ohne Höhenregler: volle Höhe
    const clip = (d || top < H) && g.inst.ink.some((q) => q.y > top + 0.5) ? clipId(d, top) : null;
    const paths = g.inst.strokes.map((st) => {
      const path = `<path d="${pathData(st)}"/>`;
      return st.top === undefined ? path : `<g clip-path="url(#${clipId(d, r1(st.top))})">${path}</g>`;
    });
    out.push(`<g data-i="${g.index}" transform="${at(g)}"${clip ? ` clip-path="url(#${clip})"` : ""}>${paths.join("")}</g>`);
  };
  for (const g of l.glyphs) if (!g.inst.def.desc) glyph(g); // Zeichen mit Unterlänge liegen außerhalb des Bands (unten)
  for (const e of l.extras) out.push(`<path d="${pathData(e)}"/>`);
  out.push(`</g>`);
  for (const g of l.glyphs) if (g.inst.def.desc) glyph(g); // Komma, tiefe Anführungszeichen ohne Beschnitt; y bis zur x-Höhe
  out.push(`</g></svg>`);
  return out.join("");
}
