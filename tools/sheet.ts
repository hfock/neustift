// Prüfblatt: alle Glyphen einzeln plus beste Varianten der Testwörter → out/*.svg (+ PNG, falls Inkscape da ist)
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { layoutText } from "../src/engine";
import { svgString } from "../src/render";
import { FLAECHE_1902 } from "../src/style";

const INKSCAPE = "/Applications/Inkscape.app/Contents/MacOS/inkscape";
// [Datei, Text, Verschränkung, Seitenverhältnis Breite : Höhe (fehlend = frei, eine Zeile)]
const jobs: [string, string, number, number?][] = [
  ["glyphen", "A B C D E F G H I J K L M N O", 0],
  ["glyphen-2", "P Q R S T U V W X Y Z Ä Ö Ü ẞ", 0],
  ["glyphen-klein", "a b c d e f g h i j k l m n o", 0],
  ["glyphen-klein-2", "p q r s t u v w x y z ä ö ü ß", 0],
  ["woerter-klein", "Hagen Spiegel Tafel Stift", 0],
  ["wiener-werkstaette", "WIENER WERKSTÄTTE", 0.5],
  ["verschraenkung-klein", "Tafel Stift Hagen ich Pflicht Kaffee", 0.5],
  ["ziffern", "0 1 2 3 4 5 6 7 8 9", 0],
  ["zeichen", ". , : ; ! ? - – ( ) / & ' ’ \" „ “ ‚ ‘ « » € % @ # + = * § … \uE000", 0],
  ["die-flaeche", "DIE FLÄCHE", 0.5],
  ["hagen-aad-fock", "HAGEN AAD FOCK", 0.5],
  ["hagen-aad-fock-wild", "HAGEN AAD FOCK", 1],
  ["block-hagen-2-1", "HAGEN AAD FOCK", 0.5, 2],
  ["block-hagen-1-1", "HAGEN AAD FOCK", 0.5, 1],
  ["block-flaeche-1-1", "DIE FLÄCHE", 0.5, 1],
  ["block-wiener-2-1", "Wiener Werkstätte", 0.5, 2],
  ["block-wiener-2-3", "Wiener Werkstätte", 0.5, 2 / 3],
  ["feinschliff-app-strich", "E-g E-G F-a L-T H-H e-mail T-Shirt Ost-West", 0.5],
  ["feinschliff-app-hoehe", "A-Z 10-20 10–20 Uhr (neu) (NEU) (Hagen) und – so", 0.5],
  ["feinschliff-app-wort", "Hagen Aad Fock DIE FLÄCHE DA VOR", 0.5],
];
mkdirSync("out", { recursive: true });
for (const [name, text, interlock, aspect = null] of jobs) {
  const { variants, warnings } = layoutText(text, { style: FLAECHE_1902, interlock, targetWidth: null, pins: { letters: {}, joins: {} }, aspect });
  const file = `out/${name}.svg`;
  await Bun.write(file, svgString(variants[0], FLAECHE_1902, { ink: "#1d1a17", paper: "#ece2cf" }));
  const png = `out/${name}.png`;
  rmSync(png, { force: true }); // kein altes Bild darf als neues durchgehen
  if (!existsSync(INKSCAPE)) console.error(`${png}: Inkscape fehlt – nur SVG geschrieben`);
  else {
    const r = Bun.spawnSync([INKSCAPE, file, "-o", png, "-w", "1600"]);
    if (!r.success || !existsSync(png)) console.error(`${png} fehlgeschlagen:`, r.stderr.toString().trim());
  }
  console.log(file, warnings.join(" · "));
}
