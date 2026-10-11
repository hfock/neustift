import { expect, test } from "bun:test";
import dieFlaeche from "../presets/die-flaeche.json";
import hagen from "../presets/hagen-aad-fock.json";
import { cleanPins, cleanPreset, cleanState, type State } from "../src/presets";
import { FLAECHE_1902 } from "../src/style";

const KNOWN = new Set(["die-flaeche"]);
const valid: State = {
  text: "DIE FLÄCHE", interlock: 0.5, target: null, style: { ...FLAECHE_1902 }, variant: 0, pins: { letters: {}, joins: {} },
  ink: "#1d1a17", paper: "#ece2cf", transparent: false, overlay: null, showOverlay: false, opacity: 0.5, selected: null, aspect: null,
};

test("cleanPins: nur endliche Zahlen und bekannte Verbindungen", () => {
  expect(cleanPins({ letters: { 1: { w: 300 } }, joins: { 4: { type: "nest", bar: false } } })).not.toBeNull();
  expect(cleanPins({ letters: {}, joins: { 1: { type: "share", sub: "cross" }, 2: { type: "tail" } } })).not.toBeNull(); // Kleinbuchstaben (M4)
  expect(cleanPins({ letters: { 1: { w: "300" } }, joins: {} })).toBeNull();
  expect(cleanPins({ letters: {}, joins: { 4: { type: "warp" } } })).toBeNull();
  expect(cleanPins({ letters: {}, joins: { 4: { type: "share", sub: "leg", bar: "ja" } } })).toBeNull();
  for (const bad of [null, 5, "x", [], { letters: [] }]) expect(cleanPins(bad)).toBeNull();
});

test("cleanPreset: gültige Vorlage bleibt, Text wird NFC, Kaputtes wird abgelehnt", () => {
  expect(cleanPreset(dieFlaeche, KNOWN)?.name).toBe("DIE FLÄCHE");
  expect(cleanPreset({ ...dieFlaeche, text: "FLÄCHE" }, KNOWN)?.text).toBe("FLÄCHE");
  expect(cleanPreset({ ...dieFlaeche, variant: 1.5 }, KNOWN)?.variant).toBe(0);
  expect(cleanPreset({ ...dieFlaeche, overlay: { ...dieFlaeche.overlay, src: "toString" } }, KNOWN)).toBeNull();
  expect(cleanPreset({ ...dieFlaeche, controls: { targetWidth: "breit", interlock: 0.5 } }, KNOWN)).toBeNull();
  expect(cleanPreset({ ...dieFlaeche, styleValues: { stroke: 30, wordGap: 120 } }, KNOWN)).not.toBeNull();
  expect(cleanPreset({ ...dieFlaeche, styleValues: { stroke: 1e7 } }, KNOWN)).toBeNull(); // würde die Seite einfrieren
  expect(cleanPreset({ ...dieFlaeche, styleValues: { capHeight: 900 } }, KNOWN)).toBeNull(); // kein Regler
  for (const bad of [null, 5, "x", [], {}]) expect(cleanPreset(bad, KNOWN)).toBeNull();
});

test("cleanPreset: beide mitgelieferten Vorlagen bestehen die Prüfung", () => {
  for (const p of [dieFlaeche, hagen]) expect(cleanPreset(p, KNOWN)).not.toBeNull();
});

test("cleanState: gültiger Stand bleibt, kaputter Speicher führt zum Standard statt zum Absturz", () => {
  expect(cleanState(valid, KNOWN)).toEqual(valid);
  expect(cleanState({ ...valid, ink: '"/><script>' }, KNOWN)).toBeNull();
  expect(cleanState({ ...valid, overlay: { src: "constructor", x: 0, y: 0, w: 1, h: 1 } }, KNOWN)).toBeNull();
  expect(cleanState({ ...valid, style: { ...FLAECHE_1902, capHeight: "700" } }, KNOWN)).toBeNull();
  expect(cleanState({ ...valid, style: { ...FLAECHE_1902, stroke: 30 } }, KNOWN)).not.toBeNull();
  expect(cleanState({ ...valid, style: { ...FLAECHE_1902, stroke: 1e7 } }, KNOWN)).toBeNull();
  expect(cleanState({ ...valid, style: { ...FLAECHE_1902, capHeight: 1e9 } }, KNOWN)).toBeNull();
  for (const bad of [null, 5, "x", [], {}, { text: "DIE" }]) expect(cleanState(bad, KNOWN)).toBeNull();
});

test("cleanState: Stand von vor M4 ohne x-Höhe bleibt gültig und bekommt den Grundwert", () => {
  const { xHeight: _, ...old } = FLAECHE_1902;
  const st = cleanState({ ...valid, style: old }, KNOWN);
  expect(st).not.toBeNull();
  expect(st!.style.xHeight).toBe(300);
  expect(st!.text).toBe(valid.text);
  expect(cleanState({ ...valid, style: { ...old, xHeight: null } }, KNOWN)).toBeNull(); // null würde den Grundwert überschreiben
});

test("Seitenverhältnis: fehlend = frei (null), 2 gilt, −1/0/unendlich/Text abgelehnt", () => {
  const { aspect: _, ...old } = valid; // Stand von vor M3
  expect(cleanState(old, KNOWN)!.aspect).toBeNull();
  expect(cleanState({ ...valid, aspect: 2 }, KNOWN)!.aspect).toBe(2);
  expect(cleanState({ ...valid, aspect: null }, KNOWN)!.aspect).toBeNull();
  for (const bad of [-1, 0, Infinity, NaN, "2"]) expect(cleanState({ ...valid, aspect: bad }, KNOWN)).toBeNull();
  expect(cleanPreset(dieFlaeche, KNOWN)!.aspect).toBeNull();
  expect(cleanPreset({ ...dieFlaeche, aspect: 2 }, KNOWN)!.aspect).toBe(2);
  for (const bad of [-1, 0, Infinity, "2"]) expect(cleanPreset({ ...dieFlaeche, aspect: bad }, KNOWN)).toBeNull();
});
