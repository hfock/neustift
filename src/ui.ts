import dieFlaeche from "../presets/die-flaeche.json";
import hagen from "../presets/hagen-aad-fock.json";
import hagenBlock from "../presets/hagen-aad-fock-block.json";
import overlayUrl from "../reference/die-flaeche-overlay.jpg";
import { joinOptions, layoutText, type Layout, type Placed } from "./engine";
import { cutTop, type Params } from "./glyphs";
import { svgString, type Overlay } from "./render";
import { barLink, type Join } from "./rules";
import { cleanPreset, cleanState, type Preset, type State } from "./presets";
import { FLAECHE_1902 } from "./style";
import "./site";

type HandleKind = "h" | "w" | "bar" | "foot" | "top";

const OVERLAYS: Record<string, string> = { "die-flaeche": overlayUrl };
const OVERLAY_KEYS: ReadonlySet<string> = new Set(Object.keys(OVERLAYS));
const BUILTIN: Preset[] = [dieFlaeche, hagen, hagenBlock].map((p) => cleanPreset(p, OVERLAY_KEYS)).filter((p): p is Preset => p !== null);
const KEY = "kairos.state", PRESETS = "kairos.presets", SVGNS = "http://www.w3.org/2000/svg";
const LABEL: Record<string, string> = {
  none: "keine",
  nest: "verschachteln",
  underrun: "unterfahren",
  term: "Strich teilen (Bogen/Arm)",
  stem: "Strich teilen (Stamm)",
  leg: "Strich teilen (Füße)",
  cross: "Querstrich teilen",
  tail: "Unterlänge unter den Nachbarn",
};

/** Seitenverhältnis-Regler: Stufen Breite : Höhe, null = frei. */
const ASPECTS = [null, 3, 2, 1.5, 1, 2 / 3, 0.5], ASPECT_NAMES = ["frei", "3:1", "2:1", "3:2", "1:1", "2:3", "1:2"];
/** Stufe zum Wert; Werte aus bearbeiteten Vorlagen ohne eigene Stufe landen auf der nächsten. */
const aspectStop = (a: number | null) =>
  a === null ? 0 : ASPECTS.reduce<number>((best, v, k) => (v !== null && Math.abs(Math.log(v / a)) < Math.abs(Math.log((ASPECTS[best] ?? Infinity) / a)) ? k : best), 1);
const aspectName = (a: number | null) => (a === null || ASPECTS.includes(a) ? ASPECT_NAMES[aspectStop(a)] : `${Math.round(a * 100) / 100}:1`);

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const jkey = (j: Join) => j.sub ?? j.type;

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Browser-Speicher gesperrt: App läuft ohne Speichern */
  }
}

const fromPreset = (p: Preset, keep?: State): State => ({
  text: p.text,
  interlock: p.controls.interlock,
  target: p.controls.targetWidth,
  style: { ...FLAECHE_1902, ...p.styleValues },
  variant: p.variant,
  pins: structuredClone(p.pins),
  ink: keep?.ink ?? "#1d1a17",
  paper: keep?.paper ?? "#ece2cf",
  transparent: keep?.transparent ?? false,
  overlay: p.overlay ?? null,
  showOverlay: false,
  opacity: keep?.opacity ?? 0.5,
  selected: null,
  aspect: p.aspect ?? null,
});

// Browser-Speicher ist eine Vertrauensgrenze: Kaputtes führt zum Standard statt zum Absturz
let state: State = cleanState(load<unknown>(KEY, null), OVERLAY_KEYS) ?? fromPreset(BUILTIN[0]);
const storedPresets = load<unknown>(PRESETS, []);
let userPresets: Preset[] = (Array.isArray(storedPresets) ? storedPresets : [])
  .map((p) => cleanPreset(p, OVERLAY_KEYS))
  .filter((p): p is Preset => p !== null);
let variants: Layout[] = [];
let layout: Layout | null = null;

// Verlauf: commit() nach jeder abgeschlossenen Änderung merkt den vorigen Stand
let stable = JSON.stringify(state);
const past: string[] = [], future: string[] = [];
function commit() {
  const now = JSON.stringify(state);
  if (now === stable) return;
  past.push(stable);
  if (past.length > 100) past.shift();
  future.length = 0;
  stable = now;
}
function restore(from: string[], to: string[]) {
  const v = from.pop();
  if (!v) return;
  to.push(stable);
  state = JSON.parse(v);
  stable = v;
  update();
  syncControls();
}

// Neu setzen erst nach einer Tipp-Pause: lange Blöcke brauchen bis ~2 s je Durchlauf.
// flush() übernimmt eine wartende Eingabe sofort – vor Rückgängig, Klick und Ziehen, sonst gälten alte Indizes
let typing = 0;
function flush() {
  if (!typing) return;
  clearTimeout(typing);
  typing = 0;
  update();
  syncControls();
  commit();
}

function update() {
  const res = layoutText(state.text, { style: state.style, interlock: state.interlock, targetWidth: state.target, pins: state.pins, aspect: state.aspect });
  variants = res.variants;
  state.variant = Math.max(0, Math.min(state.variant, variants.length - 1));
  layout = variants[state.variant] ?? null;
  $("status").textContent = res.warnings.join(" · ");
  $("target").max = String(Math.max(8000, 600 * [...state.text].length)); // ~600 Einheiten je Zeichen reichen für jede Breite
  renderVariants();
  renderPreview();
  renderLetter();
  save(KEY, state);
}

function renderPreview() {
  const box = $("preview");
  if (!layout) {
    box.innerHTML = "";
    return;
  }
  const ov = state.overlay;
  const overlay: Overlay | null =
    ov && state.showOverlay ? { href: OVERLAYS[ov.src], x: ov.x, y: ov.y, w: ov.w, h: ov.h, opacity: state.opacity } : null;
  box.innerHTML = svgString(layout, state.style, {
    ink: state.ink,
    paper: state.paper,
    interactive: true,
    selected: state.selected,
    pinned: Object.keys(state.pins.letters).map(Number),
    pinnedJoins: Object.keys(state.pins.joins).map(Number),
    overlay,
  });
  const g = layout.glyphs.find((q) => q.index === state.selected);
  const ink = box.querySelector("#ink") as SVGGraphicsElement;
  if (!g) return;
  const layer = document.createElementNS(SVGNS, "g"); // oberste Ebene, damit Nachbar-Klickflächen die Griffe nicht verdecken
  layer.setAttribute("transform", `translate(${g.x} ${g.y ?? 0})`);
  ink.appendChild(layer);
  const size = 14 / (ink.getScreenCTM()?.a || 1); // 14 px, egal wie stark die Vorschau verkleinert ist
  for (const h of handles(g)) {
    const r = document.createElementNS(SVGNS, "rect");
    for (const [k, v] of Object.entries({ class: "handle", x: h.x - size / 2, y: h.y - size / 2, width: size, height: size }))
      r.setAttribute(k, String(v));
    r.addEventListener("pointerdown", (e) => drag(e, g, h.kind));
    layer.appendChild(r);
  }
}

/** Griffe in Buchstabenkoordinaten: Höhe, Breite, Balken, Fuß, oberer Arm. */
function handles(g: Placed): { kind: HandleKind; x: number; y: number }[] {
  const s = state.style, p = g.inst.p, has = g.inst.def.params, { minX, maxX } = g.inst.prof, top = cutTop(g.inst.def, p, s);
  const out: { kind: HandleKind; x: number; y: number }[] = has.h ? [{ kind: "h", x: (minX + maxX) / 2, y: top }] : []; // Satzzeichen: kein Höhengriff
  const inkTop = g.inst.ink.reduce((m, q) => Math.max(m, q.y), -Infinity); // Kleinbuchstaben ohne Oberlänge enden unter cutTop
  if (has.w) out.push({ kind: "w", x: maxX, y: Math.min(top, inkTop) / 2 });
  for (const d of g.inst.docks) {
    if (d.kind === "bar" && has.bar) out.push({ kind: "bar", x: (d.x0 + d.x1) / 2, y: d.y });
    if (d.kind === "foot" && has.foot) out.push({ kind: "foot", x: d.end, y: s.stroke / 2 });
  }
  if (has.top) out.push({ kind: "top", x: p.w + p.top, y: top - s.stroke / 2 });
  return out;
}

function fontPoint(e: PointerEvent) {
  const ink = $("preview").querySelector("#ink") as SVGGraphicsElement;
  return new DOMPoint(e.clientX, e.clientY).matrixTransform(ink.getScreenCTM()!.inverse());
}

/** Griff ziehen: Wert wird als Pin festgehalten, Engine rechnet live neu. */
function drag(e: PointerEvent, start: Placed, kind: HandleKind) {
  if (typing) return flush(); // Griffe gehören zum alten Text: erst neu setzen
  e.preventDefault();
  e.stopPropagation();
  const i = start.index, def = start.inst.def, s = state.style;
  const clamp = (k: string, v: number) => Math.min(def.params[k].max, Math.max(def.params[k].min, v));
  // höchstens einmal je Bildschirmbild neu setzen: mit Zielbreite dauert ein Durchlauf bis ~90 ms
  let frame = 0, last: PointerEvent | null = null;
  const move = (ev: PointerEvent) => {
    last = ev;
    if (!frame) frame = requestAnimationFrame(step);
  };
  const step = () => {
    frame = 0;
    const ev = last!;
    const g = layout?.glyphs.find((q) => q.index === i);
    if (!g) return;
    const pt = fontPoint(ev), x = pt.x - g.x, y = pt.y - (g.y ?? 0), p = g.inst.p; // Buchstabenkoordinaten, auch in tieferen Zeilen
    let v: Params;
    if (kind === "h") v = { h: clamp("h", y / s.capHeight) };
    else if (kind === "w") v = { w: clamp("w", p.w + x - g.inst.prof.maxX) };
    else if (kind === "bar") v = { bar: y < s.capHeight / 2 ? 1 : 0 };
    else if (kind === "foot") {
      const end = g.inst.docks.find((d) => d.kind === "foot") as { end: number };
      v = { foot: clamp("foot", p.foot + x - end.end) };
    } else v = { top: clamp("top", x - p.w) };
    state.pins.letters[i] = { ...state.pins.letters[i], ...v };
    update();
  };
  const up = () => {
    if (frame) {
      cancelAnimationFrame(frame);
      step(); // letzte Position nicht verlieren
    }
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    removeEventListener("pointercancel", up);
    commit();
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
}

function renderLetter() {
  const g = layout?.glyphs.find((q) => q.index === state.selected);
  $("letter").classList.toggle("on", !!g);
  if (!g || !layout) return;
  $("letterName").textContent = `Buchstabe „${g.char}“`;
  joinSelect($<HTMLSelectElement>("joinLeft"), g.index - 1);
  joinSelect($<HTMLSelectElement>("joinRight"), g.index);
  $("barRight").checked = !!(state.pins.joins[g.index]?.bar ?? layout.joins[g.index]?.bar);
  // Balken verbinden nur, wenn die Engine ihn an dieser Grenze ziehen kann; ein gesetzter Haken bleibt zum Abwählen anklickbar
  const n = layout.glyphs.find((q) => q.index === g.index + 1);
  const j = state.pins.joins[g.index] ?? layout.joins[g.index];
  const possible = !!n && (j?.type === "none" || j?.type === "share") && !!barLink(g.inst, g.x, n.inst, n.x, state.style);
  $("barRight").disabled = !$("barRight").checked && !possible;
}

/** Auswahlliste der möglichen Verbindungen an einer Grenze; Auswahl = Pin. */
function joinSelect(sel: HTMLSelectElement, boundary: number) {
  const opts = layout ? joinOptions(layout, boundary) : [];
  const auto = layout?.joins[boundary];
  sel.disabled = opts.length === 0;
  sel.innerHTML =
    `<option value="auto">automatisch${auto ? ` (${LABEL[jkey(auto)]})` : ""}</option>` +
    opts.map((j) => `<option value="${jkey(j)}">${LABEL[jkey(j)]}</option>`).join("");
  const pin = state.pins.joins[boundary];
  sel.value = pin ? jkey(pin) : "auto";
  sel.onchange = () => {
    if (sel.value === "auto") delete state.pins.joins[boundary];
    else {
      const autoBar = !!auto && jkey(auto) === sel.value && !!auto.bar; // gleiche Verbindung wie automatisch: Balken behalten
      const j = opts.find((o) => jkey(o) === sel.value)!;
      const barAllowed = j.type === "none" || j.type === "share"; // verschachteln/unterfahren tragen keinen Balken
      state.pins.joins[boundary] = { ...j, bar: barAllowed && (state.pins.joins[boundary]?.bar ?? autoBar) };
    }
    update();
    commit();
  };
}

function renderVariants() {
  $("variants").replaceChildren(
    ...variants.map((_, k) => {
      const b = document.createElement("button");
      b.textContent = String(k + 1);
      b.className = k === state.variant ? "on" : "";
      b.onclick = () => {
        flush(); // Variante gehört zum neuen Text
        state.variant = k;
        update();
        commit();
      };
      return b;
    }),
  );
}

function syncControls() {
  if ($("text").value !== state.text) $("text").value = state.text; // gleicher Text: Schreibmarke bleibt, wo sie ist
  $("aspect").value = String(aspectStop(state.aspect));
  $("aspectName").textContent = aspectName(state.aspect);
  $("interlock").value = String(state.interlock);
  $("targetFree").checked = state.target === null;
  $("target").disabled = state.target === null;
  $("target").value = String(state.target ?? Math.round(layout?.width ?? 2400));
  for (const k of ["stroke", "barHigh", "barLow", "wordGap"] as const) $(k).value = String(state.style[k]);
  $("overlay").checked = state.showOverlay;
  $("overlay").disabled = !state.overlay;
  $("opacity").value = String(state.opacity);
  $("inkColor").value = state.ink;
  $("paperColor").value = state.paper;
  $("transparent").checked = state.transparent;
}

// --- Bedienung -------------------------------------------------------------

$("preview").addEventListener("click", (e) => {
  if (typing) return flush(); // Klick traf den alten Text: erst neu setzen, dann wählen
  if ((e.target as Element).closest(".handle")) return; // Griff: Auswahl bleibt
  const hit = (e.target as Element).closest("[data-i]");
  state.selected = hit ? Number(hit.getAttribute("data-i")) : null;
  renderPreview();
  renderLetter();
  save(KEY, state);
});

$("text").addEventListener("input", () => {
  state.text = $("text").value.normalize("NFC"); // „Ä“ als A + Trema (NFD) würde sonst zerfallen
  state.pins = { letters: {}, joins: {} }; // Positionen verschieben sich beim Tippen
  state.selected = null;
  state.variant = 0;
  state.overlay = null;
  state.showOverlay = false;
  clearTimeout(typing);
  typing = setTimeout(flush, 200) as unknown as number;
});

$("aspect").addEventListener("input", () => {
  state.aspect = ASPECTS[Number($("aspect").value)] ?? null;
  $("aspectName").textContent = aspectName(state.aspect);
  update();
});
$("aspect").addEventListener("change", commit);

const sliders: [string, (v: number) => void][] = [
  ["interlock", (v) => (state.interlock = v)],
  ["target", (v) => (state.target = v)],
  ["stroke", (v) => (state.style = { ...state.style, stroke: v })],
  ["barHigh", (v) => (state.style = { ...state.style, barHigh: v })],
  ["barLow", (v) => (state.style = { ...state.style, barLow: v })],
  ["wordGap", (v) => (state.style = { ...state.style, wordGap: v })],
  ["opacity", (v) => (state.opacity = v)],
];
for (const [id, set] of sliders) {
  $(id).addEventListener("input", () => {
    set(Number($(id).value));
    update();
  });
  $(id).addEventListener("change", commit);
}

$("targetFree").addEventListener("change", () => {
  state.target = $("targetFree").checked ? null : Math.round(layout?.width ?? 2400);
  update();
  syncControls();
  commit();
});
$("overlay").addEventListener("change", () => {
  state.showOverlay = $("overlay").checked;
  update();
  commit();
});
// Farbfelder heißen inkColor/paperColor: die id "ink" gehört der Schriftgruppe im SVG
for (const [id, key] of [["inkColor", "ink"], ["paperColor", "paper"]] as const) {
  $(id).addEventListener("input", () => {
    state[key] = $(id).value;
    update();
  });
  $(id).addEventListener("change", commit);
}
$("transparent").addEventListener("change", () => {
  state.transparent = $("transparent").checked;
  save(KEY, state);
  commit();
});
$("barRight").addEventListener("change", () => {
  const i = state.selected;
  if (i === null || !layout) return;
  const cur = state.pins.joins[i] ?? layout.joins[i] ?? { type: "none" };
  state.pins.joins[i] = { ...cur, bar: $("barRight").checked };
  update();
  commit();
});
$("resetLetter").addEventListener("click", () => {
  const i = state.selected;
  if (i === null) return;
  delete state.pins.letters[i];
  delete state.pins.joins[i];
  delete state.pins.joins[i - 1];
  update();
  commit();
});

addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    flush(); // getippter Text wird erst ein Schritt, dann geht Rückgängig genau einen zurück
    if (e.shiftKey) restore(future, past);
    else restore(past, future);
    return;
  }
  if ((e.target as Element).closest?.("input, select, textarea")) return; // Regler und Felder behalten ihre Pfeiltasten
  const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  if (step) flush();
  if (step && variants[state.variant + step]) {
    state.variant += step;
    update();
    commit();
  }
});

// --- Vorlagen ----------------------------------------------------------------

const presets = () => [...BUILTIN, ...userPresets];
const escapeHtml = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function renderPresets() {
  $<HTMLSelectElement>("preset").innerHTML =
    `<option value="">Vorlagen …</option>` + presets().map((p, k) => `<option value="${k}">${escapeHtml(p.name)}</option>`).join("");
}
function usePreset(p: Preset) {
  state = fromPreset(p, state);
  update();
  syncControls();
  commit();
}
const toPreset = (name: string): Preset => ({
  name,
  text: state.text,
  style: state.style.id,
  styleValues: { stroke: state.style.stroke, barHigh: state.style.barHigh, barLow: state.style.barLow, wordGap: state.style.wordGap },
  controls: { targetWidth: state.target, interlock: state.interlock },
  variant: state.variant,
  pins: structuredClone(state.pins),
  aspect: state.aspect,
  ...(state.overlay ? { overlay: state.overlay } : {}),
});
$("preset").addEventListener("change", () => {
  const sel = $<HTMLSelectElement>("preset"), p = presets()[Number(sel.value)];
  sel.value = "";
  if (p) usePreset(p);
});
$("savePreset").addEventListener("click", () => {
  const name = prompt("Name der Vorlage", state.text)?.trim();
  if (!name) return;
  userPresets = [...userPresets.filter((p) => p.name !== name), toPreset(name)];
  save(PRESETS, userPresets);
  renderPresets();
});
$("exportPreset").addEventListener("click", () =>
  download(`${slug(state.text)}.json`, new Blob([JSON.stringify(toPreset(state.text), null, 2)], { type: "application/json" })),
);
$("importPreset").addEventListener("change", async () => {
  const input = $("importPreset"), file = input.files?.[0];
  if (!file) return;
  try {
    const p = cleanPreset(JSON.parse(await file.text()), OVERLAY_KEYS);
    if (!p) throw new Error("Format");
    userPresets = [...userPresets.filter((q) => q.name !== p.name), p];
    save(PRESETS, userPresets);
    renderPresets();
    usePreset(p);
  } catch {
    $("status").textContent = "Vorlage ungültig – ignoriert";
  } finally {
    input.value = "";
  }
});

// --- Export ------------------------------------------------------------------

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const slug = (t: string) =>
  t.trim().toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "neustift";
const exportSvg = () => (layout ? svgString(layout, state.style, { ink: state.ink, paper: state.transparent ? null : state.paper }) : null);

$("exportSvg").addEventListener("click", () => {
  flush(); // exportiert den getippten Text, nicht den vorigen
  const t = exportSvg();
  if (t) download(`${slug(state.text)}.svg`, new Blob([t], { type: "image/svg+xml" }));
});
$("exportPng").addEventListener("click", async () => {
  flush();
  const t = exportSvg();
  if (!t) return;
  const url = URL.createObjectURL(new Blob([t], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Number($<HTMLSelectElement>("pngScale").value), c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    c.toBlob((b) => (b ? download(`${slug(state.text)}.png`, b) : ($("status").textContent = "PNG-Export fehlgeschlagen")), "image/png");
  } catch {
    $("status").textContent = "PNG-Export fehlgeschlagen";
  } finally {
    URL.revokeObjectURL(url);
  }
});

renderPresets();
update();
syncControls();
