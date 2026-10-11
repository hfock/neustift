import { expect, test } from "bun:test";
import dieFlaeche from "../presets/die-flaeche.json";
import hagen from "../presets/hagen-aad-fock.json";
import hagenBlock from "../presets/hagen-aad-fock-block.json";
import { layoutLine, layoutText, type Pins } from "../src/engine";
import { cleanPreset } from "../src/presets";
import { FLAECHE_1902 } from "../src/style";

for (const p of [dieFlaeche, hagen]) {
  test(`Vorlage „${p.name}“ lässt sich ohne Hinweise setzen`, () => {
    const r = layoutLine(p.text, { style: FLAECHE_1902, interlock: p.controls.interlock, targetWidth: p.controls.targetWidth, pins: p.pins as unknown as Pins });
    expect(r.warnings).toEqual([]);
    expect(r.variants.length).toBeGreaterThan(0);
  });
}

test("DIE FLÄCHE bringt Overlay-Maße mit", () => {
  const o = dieFlaeche.overlay;
  expect(o.src).toBe("die-flaeche");
  for (const v of [o.x, o.y, o.w, o.h]) expect(Number.isFinite(v)).toBe(true);
});

test("HAGEN AAD FOCK: AA mit gemeinsamen Füßen und durchgehendem Balken", () => {
  const v = layoutLine(hagen.text, { style: FLAECHE_1902, interlock: hagen.controls.interlock, targetWidth: null, pins: hagen.pins as unknown as Pins }).variants[0];
  expect(v.joins[6]).toEqual({ type: "share", sub: "leg", bar: true });
  expect(v.extras.length).toBe(1);
});

test("HAGEN AAD FOCK (Block): gültige Vorlage, zwei Zeilen", () => {
  const p = cleanPreset(hagenBlock, new Set())!;
  expect(p).not.toBeNull();
  expect(p.aspect).toBe(2);
  const r = layoutText(p.text, { style: FLAECHE_1902, interlock: p.controls.interlock, targetWidth: p.controls.targetWidth, pins: p.pins, aspect: p.aspect ?? null });
  expect(r.warnings).toEqual([]);
  expect(r.variants[0].lines).toBe(2);
});
