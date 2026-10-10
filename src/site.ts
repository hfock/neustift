// Kopf beider Seiten: Schriftzug „Neustift“, von der Engine verschränkt gesetzt (f und t teilen den Querstrich)
import { layoutLine } from "./engine";
import { svgString } from "./render";
import { FLAECHE_1902 } from "./style";

const style = { ...FLAECHE_1902, stroke: 40 }; // kräftiger als die Schrift: der Schriftzug steht nur ~44 px hoch
const v = layoutLine("Neustift", { style, interlock: 0.5, targetWidth: null, pins: { letters: {}, joins: {} } }).variants[0];
const el = document.getElementById("wordmark");
// ohne id="ink": die gehört in der Werkstatt der Vorschau
if (el && v) el.innerHTML = svgString(v, style, { ink: "currentColor", paper: null, margin: 0 }).replace("<svg ", '<svg aria-hidden="true" ').replace(' id="ink"', "");
