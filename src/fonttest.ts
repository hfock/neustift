// Testseite: Text in der Webfont neben dem Engine-Ergebnis (Spec M2 §5.5)
import { layoutLine } from "./engine";
import { GLYPHS } from "./glyphs";
import { svgString } from "./render";
import { FLAECHE_1902 } from "./style";
import "./site";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const PX = 120 / 1000; // Schriftgrad 120 px bei 1000 Einheiten je Geviert: Engine-SVG im selben Maßstab

function update() {
  const text = $<HTMLInputElement>("text").value;
  $("font").textContent = text;
  $("font").classList.toggle("dlig", $<HTMLInputElement>("dlig").checked);
  const v = layoutLine(text, { style: FLAECHE_1902, interlock: 0.5, targetWidth: null, pins: { letters: {}, joins: {} } }).variants[0];
  $("engine").innerHTML = v ? svgString(v, FLAECHE_1902, { ink: "#1d1a17", paper: null }) : "";
  const svg = $("engine").querySelector("svg");
  if (svg) for (const k of ["width", "height"]) svg.setAttribute(k, String(Number(svg.getAttribute(k)) * PX));
}

// die Webfont kommt aus src/site.css (@font-face); leer geladen heißt: Datei fehlt oder ist kaputt
const missing = () => ($("status").textContent = "Webfont nicht geladen – erst „bun run font“ ausführen");
document.fonts.load('120px "Neustift"').then((f) => (f.length ? ($("status").textContent = "") : missing()), missing);
// Zeichensatz: jedes Zeichen aus GLYPHS in der Webfont, nach Art gruppiert
const GROUPS: [string, RegExp][] = [["Versalien", /\p{Lu}/u], ["Kleinbuchstaben", /\p{Ll}/u], ["Ziffern", /\p{Nd}/u], ["Zeichen", /./u]];
const sets = GROUPS.map((): string[] => []);
for (const c of Object.keys(GLYPHS)) sets[GROUPS.findIndex(([, re]) => re.test(c))].push(c); // erste passende Gruppe
$("charset").replaceChildren(
  ...GROUPS.map(([name], k) => {
    const own = sets[k];
    const sec = document.createElement("section"), h = document.createElement("h3"), grid = document.createElement("ul");
    h.className = "eyebrow";
    h.textContent = `${name} · ${own.length}`;
    grid.className = "grid";
    for (const c of own) {
      const li = document.createElement("li"), g = document.createElement("span"), code = document.createElement("small");
      const hex = "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
      g.className = "glyph";
      g.textContent = c;
      code.textContent = c === "\uE000" ? "HAF" : hex;
      li.title = c === "\uE000" ? `Monogramm HAF (${hex})` : `${c} ${hex}`;
      li.append(g, code);
      grid.append(li);
    }
    sec.append(h, grid);
    return sec;
  }),
);

$("text").addEventListener("input", update);
$("dlig").addEventListener("change", update);
update();
