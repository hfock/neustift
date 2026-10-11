import type { Pins } from "./engine";
import { FLAECHE_1902, type Style } from "./style";

export type OverlayRef = { src: string; x: number; y: number; w: number; h: number };
export type Preset = {
  name: string;
  text: string;
  style: string;
  styleValues?: Partial<Style>;
  controls: { targetWidth: number | null; interlock: number };
  variant: number;
  pins: Pins;
  overlay?: OverlayRef;
  aspect?: number | null; // Seitenverhältnis Breite : Höhe, fehlend = frei
};
/** Stand der Oberfläche, wie er im Browser-Speicher liegt. */
export type State = {
  text: string;
  interlock: number;
  target: number | null;
  style: Style;
  variant: number;
  pins: Pins;
  ink: string;
  paper: string;
  transparent: boolean;
  overlay: OverlayRef | null;
  showOverlay: boolean;
  opacity: number;
  selected: number | null;
  aspect: number | null;
};

const JOIN_TYPES = new Set(["none", "nest", "underrun", "share", "tail"]), JOIN_SUBS = new Set(["term", "stem", "leg", "cross"]);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Seitenverhältnis: fehlend oder null = frei; sonst endlich und > 0. undefined = ungültig. */
const cleanAspect = (v: unknown) => (v === undefined || v === null ? null : isNum(v) && v > 0 ? v : undefined);
const isColor = (v: unknown) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
/** Nur die Feinheiten-Regler dürfen Stilwerte ändern – und nur in ihrem Spielraum (wie in index.html); riesige Werte würden die Seite einfrieren. */
const STYLE_RANGES: Record<string, [number, number]> = { stroke: [14, 44], barHigh: [420, 640], barLow: [60, 280], wordGap: [40, 400] };
const inStyleRange = (k: string, v: unknown) => isNum(v) && v >= STYLE_RANGES[k][0] && v <= STYLE_RANGES[k][1];
const overlayOk = (o: unknown, known: ReadonlySet<string>) =>
  isObj(o) && typeof o.src === "string" && known.has(o.src) && [o.x, o.y, o.w, o.h].every(isNum);

/** Pins aus Vorlage oder Speicher prüfen: nur endliche Zahlen und bekannte Verbindungen, sonst null. */
export function cleanPins(raw: unknown): Pins | null {
  if (!isObj(raw) || !isObj(raw.letters) || !isObj(raw.joins)) return null;
  for (const ps of Object.values(raw.letters)) if (!isObj(ps) || !Object.values(ps).every(isNum)) return null;
  for (const j of Object.values(raw.joins)) {
    if (!isObj(j) || !JOIN_TYPES.has(j.type as string)) return null;
    if (j.sub !== undefined && !JOIN_SUBS.has(j.sub as string)) return null;
    if (j.bar !== undefined && typeof j.bar !== "boolean") return null;
  }
  return raw as Pins;
}

/** Vorlage prüfen (Import und Speicher). Text wird NFC-normalisiert, damit Pin-Indizes passen; known = bekannte Overlay-Schlüssel. */
export function cleanPreset(raw: unknown, known: ReadonlySet<string>): Preset | null {
  if (!isObj(raw) || typeof raw.name !== "string" || typeof raw.text !== "string" || typeof raw.style !== "string") return null;
  const c = raw.controls;
  if (!isObj(c) || !isNum(c.interlock) || (c.targetWidth !== null && !isNum(c.targetWidth))) return null;
  const sv = raw.styleValues;
  if (sv !== undefined && !(isObj(sv) && Object.entries(sv).every(([k, v]) => k in STYLE_RANGES && inStyleRange(k, v)))) return null;
  if (raw.overlay !== undefined && !overlayOk(raw.overlay, known)) return null;
  const pins = cleanPins(raw.pins);
  if (!pins) return null;
  const aspect = cleanAspect(raw.aspect);
  if (aspect === undefined) return null;
  const variant = Number.isInteger(raw.variant) && (raw.variant as number) >= 0 ? (raw.variant as number) : 0;
  return { ...(raw as Preset), text: raw.text.normalize("NFC"), variant, pins, aspect };
}

/** Gespeicherten Oberflächen-Stand prüfen; null heißt: Standard verwenden statt abzustürzen. */
export function cleanState(raw: unknown, known: ReadonlySet<string>): State | null {
  if (!isObj(raw) || typeof raw.text !== "string" || !cleanPins(raw.pins)) return null;
  const st = raw.style;
  const base = FLAECHE_1902 as unknown as Record<string, unknown>;
  const styleOk =
    isObj(st) &&
    Object.keys(base).every((k) => (k === "id" ? typeof st.id === "string" : k in STYLE_RANGES ? inStyleRange(k, st[k]) : (st[k] === undefined || st[k] === base[k]))); // fehlende feste Werte (ältere Stände, z. B. ohne xHeight) gelten als Grundwert
  const aspect = cleanAspect(raw.aspect);
  const ok =
    aspect !== undefined &&
    styleOk &&
    isColor(raw.ink) &&
    isColor(raw.paper) &&
    isNum(raw.interlock) &&
    isNum(raw.opacity) &&
    Number.isInteger(raw.variant) &&
    (raw.target === null || isNum(raw.target)) &&
    (raw.overlay === null || overlayOk(raw.overlay, known)) &&
    (raw.selected === null || Number.isInteger(raw.selected)) &&
    typeof raw.showOverlay === "boolean" &&
    typeof raw.transparent === "boolean";
  return ok ? { ...(raw as State), style: { ...FLAECHE_1902, ...(st as Partial<Style>) }, text: raw.text.normalize("NFC"), aspect: aspect ?? null } : null;
}
