# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools[woff]>=4.66", "ufo2ft>=3.9", "ufoLib2>=0.18", "skia-pathops>=0.9", "typing_extensions==4.15.0"]
# ///
"""Neustift bauen: build/kairos.json + build/features.fea → dist/Neustift-Regular.otf und .woff2 (Spec M2 §5.2)."""
import json
import sys
from pathlib import Path

import pathops
import ufo2ft
import ufoLib2
from fontTools.pens.basePen import BasePen

FORMAT = 1
ROOT = Path(__file__).resolve().parent.parent
BUILD, DIST = ROOT / "build", ROOT / "dist"


class CubicPen(BasePen):
    """Reicht Konturen weiter; quadratische Segmente aus skia-pathops werden exakt kubisch (CFF kennt nur kubische)."""

    def __init__(self, out):
        super().__init__(None)
        self.out = out

    def _moveTo(self, p):
        self.out.moveTo(p)

    def _lineTo(self, p):
        self.out.lineTo(p)

    def _curveToOne(self, a, b, c):
        self.out.curveTo(a, b, c)

    def _closePath(self):
        self.out.closePath()

    def _endPath(self):
        self.out.endPath()


def centerline(st: dict) -> pathops.Path:
    p = pathops.Path()
    p.moveTo(st["start"]["x"], st["start"]["y"])
    for g in st["segs"]:
        if g["k"] == "L":
            p.lineTo(g["p"]["x"], g["p"]["y"])
        else:
            p.cubicTo(g["c1"]["x"], g["c1"]["y"], g["c2"]["x"], g["c2"]["y"], g["p"]["x"], g["p"]["y"])
    if st.get("closed"):
        p.close()
    return p


def outline(parts: list, stroke: float) -> pathops.Path:
    """Wie der Renderer: Strich mit stumpfen Enden und Gehrung (Grenze 4), vereinigt, je Teil auf sein Band beschnitten."""
    out = pathops.Path()
    for part in parts:
        ink = pathops.Path()
        for st in part["strokes"]:
            p = centerline(st)
            p.stroke(stroke, pathops.LineCap.BUTT_CAP, pathops.LineJoin.MITER_JOIN, 4)
            ink.addPath(p)
        band = pathops.Path()
        b, t = part["bottom"], part["top"]
        band.moveTo(-1e5, b)
        band.lineTo(1e5, b)
        band.lineTo(1e5, t)
        band.lineTo(-1e5, t)
        band.close()
        out.addPath(pathops.op(ink, band, pathops.PathOp.INTERSECTION))
    out.simplify(clockwise=False)  # Überlappungen vereinigen, Außenkonturen gegen den Uhrzeigersinn (CFF)
    return out


def build() -> None:
    data = json.loads((BUILD / "kairos.json").read_text())
    if data.get("format") != FORMAT:
        sys.exit("build/kairos.json hat ein anderes Format – Export neu erzeugen: bun tools/export-font.ts")
    info = data["info"]
    ufo = ufoLib2.Font()
    i = ufo.info
    i.familyName, i.styleName, i.postscriptFontName = info["family"], info["style"], "Neustift-Regular"
    major, minor = info["version"].split()[0].split(".")
    i.versionMajor, i.versionMinor = int(major), int(minor) * 100  # 0.300 = Version 0.3 (UFO zählt Tausendstel)
    i.openTypeNameVersion = f"Version {info['version']}"  # Zeitstempel dahinter: jeder Build ist für macOS eine neue Fassung
    i.copyright = "Copyright (c) 2026, Hagen Aad Fock (https://font.fock.rocks)"
    i.openTypeNameDesigner, i.openTypeNameDesignerURL = "Hagen Aad Fock", "https://font.fock.rocks"
    i.openTypeNameLicense = "This Font Software is licensed under the SIL Open Font License, Version 1.1."
    i.openTypeNameLicenseURL = "https://openfontlicense.org"
    i.openTypeOS2Type = []  # installierbar: die OFL erlaubt Einbetten ohne Einschränkung
    i.openTypeNameUniqueID = f"Neustift-Regular {info['version']}"  # je Build neu: macOS erkennt die neue Fassung
    i.unitsPerEm, i.capHeight, i.xHeight = info["unitsPerEm"], info["capHeight"], info["xHeight"]
    i.ascender, i.descender = info["ascender"], info["descender"]
    i.openTypeOS2TypoAscender, i.openTypeOS2TypoDescender, i.openTypeOS2TypoLineGap = info["ascender"], info["descender"], 0
    i.openTypeHheaAscender, i.openTypeHheaDescender, i.openTypeHheaLineGap = info["ascender"], info["descender"], 0
    i.openTypeOS2WinAscent, i.openTypeOS2WinDescent = info["ascender"], -info["descender"]
    for g in data["glyphs"]:
        glyph = ufo.newGlyph(g["name"])
        glyph.width = g["advance"]
        glyph.unicodes = g["unicodes"]
        if g["parts"]:
            path = outline(g["parts"], info["stroke"])
            if path.area == 0:
                sys.exit(f"Glyphe ohne Kontur: {g['name']}")
            path.draw(CubicPen(glyph.getPen()))
    ufo.glyphOrder = [g["name"] for g in data["glyphs"]]
    for first, second, value in data["kerning"]:
        ufo.kerning[(first, second)] = value
    ufo.features.text = (BUILD / "features.fea").read_text()
    otf = ufo2ft.compileOTF(ufo, removeOverlaps=False)  # Konturen sind schon vereinigt
    DIST.mkdir(exist_ok=True)
    otf.save(DIST / "Neustift-Regular.otf")
    otf.flavor = "woff2"
    otf.save(DIST / "Neustift-Regular.woff2")
    print(f"dist/Neustift-Regular.otf + .woff2: {len(data['glyphs'])} Glyphen")


if __name__ == "__main__":
    build()
