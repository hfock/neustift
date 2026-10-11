export interface Style {
  id: string;
  capHeight: number; // Versalhöhe (Tinte), Grundlinie y = 0
  stroke: number; // Strichstärke
  barHigh: number; // obere Balkenlinie (Mittellinie)
  barLow: number; // untere Balkenlinie (Mittellinie)
  xHeight: number; // Höhe der Kleinbuchstaben ohne Ober- und Unterlänge (Tinte)
  gap: number; // Buchstabenabstand = kleinste waagrechte Lichtweite
  wordGap: number; // Wortabstand
  clearance: number; // Lichtweite beim Verschachteln und Unterfahren
  armGap: number; // Mindest-Lichtweite überall (hart); Armende vor Hindernis; Spalt C → Stamm
  nestGap: number; // F-Stamm (Tinte rechts) bis verschachtelter Buchstabe (Tinte links)
  nestOverhang: number; // so weit ragt der F-Mittelarm über den verschachtelten Buchstaben
  footGap: number; // Fußende vor dem rechten A-Bein
  dotOffset: number; // Umlautpunkte: Abstand von der A-Mitte
  apexW: number; // Breite der flachen A-Spitze (Mittellinie)
}

/** Stil „Fläche 1902“, gemessen am Blatt „Die Fläche“ Bd. I S. 97 (1 px ≈ 1,38 Einheiten). */
export const FLAECHE_1902: Style = {
  id: "flaeche-1902",
  capHeight: 700,
  stroke: 26,
  barHigh: 546,
  barLow: 154,
  xHeight: 300,
  gap: 56,
  wordGap: 206, // Font: Leerzeichen 150 + Seitenabstände 56 (Feinschliff, vorher 136 = 80 + 56)
  clearance: 36,
  armGap: 20,
  nestGap: 152,
  nestOverhang: 97,
  footGap: 105,
  dotOffset: 93,
  apexW: 30,
};
