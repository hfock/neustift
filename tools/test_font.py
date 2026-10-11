# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools[woff]>=4.66", "ufo2ft>=3.9", "ufoLib2>=0.18", "skia-pathops>=0.9", "uharfbuzz>=0.50"]
# ///
"""Font prüfen (Spec M2 §7): Zeichentabelle, Konturen, Formung mit harfbuzz, Tintenfläche gegen die Engine."""
import json
import sys
from pathlib import Path

import pathops
import uharfbuzz as hb
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

sys.path.insert(0, str(Path(__file__).parent))
from build_font import BUILD, DIST, outline  # noqa: E402  gleiche Strich-Strecke wie der Build

OTF = DIST / "Neustift-Regular.otf"
PUNCT = {"hyphen", "endash", "parenleft", "parenright", "period", "comma", "colon", "semicolon", "exclam", "question", "slash", "quotesingle",
         "quoteright", "quotedbl", "quotedblbase", "quotedblleft", "quotesinglbase", "quoteleft", "guillemotleft", "guillemotright"}
ARM = {("E", "hyphen"), ("F", "hyphen"), ("L", "hyphen"), ("T", "hyphen"), ("hyphen", "T"), ("t", "hyphen")}
SLANT = {("A", "hyphen"), ("hyphen", "Z"), ("hyphen", "two"), ("endash", "two")}
# Feinschliff-Beispiele: Text, Mitte je Strich/Klammer (x = x-Höhen-Mitte, c = Versalhöhen-Mitte)
FEIN = [("E-g", "x"), ("E-G", "c"), ("F-a", "x"), ("L-T", "c"), ("H-H", "c"), ("T-Shirt", "c"), ("Ost-West", "c"), ("e-mail", "x"), ("E-mail", "x"),
        ("x-Achse", "c"), ("A-Z", "c"), ("10-20", "c"), ("10–20 Uhr", "c"), ("und – so", "x"), ("(neu)", "xx"), ("(NEU)", "cc"), ("(Hagen)", "cc"),
        ("(neu und alt)", "xx"), ("FF.", ""), ("T.", ""), ("r.", ""), ("„Typ“", ""), ("L'", ""), ("e- und", "x"), ("A-", "c")]
fails: list[str] = []


def check(ok: bool, msg: str) -> None:
    if not ok:
        fails.append(msg)


def ink(glyphset, name: str, x: float = 0) -> pathops.Path:
    p = pathops.Path()
    glyphset[name].draw(TransformPen(p.getPen(), (1, 0, 0, 1, x, 0)))
    return p


def grow(p: pathops.Path, d: float) -> pathops.Path:
    """Fläche um d Einheiten nach allen Seiten erweitert."""
    edge, out = pathops.Path(), pathops.Path()
    edge.addPath(p)
    edge.stroke(2 * d, pathops.LineCap.ROUND_CAP, pathops.LineJoin.ROUND_JOIN, 4)
    edge.convertConicsToQuads()  # runde Ecken kommen als Kegelschnitte, simplify kennt nur Quadrate und Kubische
    out.addPath(p)
    out.addPath(edge)
    out.simplify()
    return out


def shape(font: hb.Font, text: str, features: dict) -> list[list[tuple[str, int]]]:
    """Glyphen je Wort mit Ursprung (Vorschübe samt Unterschneidung)."""
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, features)
    words, cur, x = [], [], 0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = font.glyph_to_string(info.codepoint)
        if name == "space":
            words, cur = words + [cur] if cur else words, []
        else:
            cur.append((name, x))
        x += pos.x_advance
    return words + [cur] if cur else words


def main() -> None:
    data = json.loads((BUILD / "kairos.json").read_text())
    otf = TTFont(OTF)
    glyphset, cmap = otf.getGlyphSet(), otf.getBestCmap()

    # 1 Zeichentabelle deckt alle Zeichen ab, Kleinbuchstaben eingeschlossen
    missing = sorted(hex(u) for g in data["glyphs"] for u in g["unicodes"] if u not in cmap)
    check(not missing, f"Zeichen fehlen in der Zeichentabelle: {missing}")

    # 2 Konturen: nichts überlappt, alles im Band
    for g in data["glyphs"]:
        if not g["parts"]:
            continue
        p, u = ink(glyphset, g["name"]), ink(glyphset, g["name"])
        u.simplify()
        check(abs(u.area - p.area) <= 0.005 * p.area + 1, f"{g['name']}: Konturen überlappen")
        _, ymin, _, ymax = p.bounds
        bottom, top = min(q["bottom"] for q in g["parts"]), max(q["top"] for q in g["parts"])
        check(bottom - 1 <= ymin and ymax <= top + 1, f"{g['name']}: Kontur verlässt das Band ({ymin:.0f}…{ymax:.0f})")

    # 3 Formung mit harfbuzz: Glyphenfolge und Schritte wie die Engine; 4 Tintenfläche gegen die Engine
    font = hb.Font(hb.Face(hb.Blob.from_file_path(str(OTF))))
    for e in data["expect"]:
        got = shape(font, e["text"], e["features"])
        names, want = [[n for n, _ in w] for w in got], [[g["name"] for g in w] for w in e["words"]]
        check(names == want, f"„{e['text']}“ {e['features']}: {names} statt {want}")
        for gw, ww in zip(got, e["words"]):
            for (n1, x1), (n2, x2), a, b in zip(gw, gw[1:], ww, ww[1:]):
                check(abs((x2 - x1) - (b["x"] - a["x"])) <= 1, f"„{e['text']}“ {n1}→{n2}: Schritt {x2 - x1} statt {b['x'] - a['x']:.1f}")
        if e["parts"]:
            want_ink, got_ink = outline(e["parts"], data["info"]["stroke"]), pathops.Path()
            for name, x in got[0]:
                got_ink.addPath(ink(glyphset, name, x))
            got_ink.simplify()
            # Rundung auf ganze Einheiten verschiebt Kanten um bis zu 1; gezählt wird, was mehr als 1,5 Einheiten abweicht
            diff = pathops.op(want_ink, grow(got_ink, 1.5), pathops.PathOp.DIFFERENCE).area + pathops.op(got_ink, grow(want_ink, 1.5), pathops.PathOp.DIFFERENCE).area
            check(diff <= 0.01 * want_ink.area, f"„{e['text']}“: Tintenfläche weicht um {diff / want_ink.area:.2%} ab")

    # 5 Feinschliff: Satzzeichen nie näher als der Buchstabenabstand (unter Arme und in Schrägen erlaubt), nie überlappend, Höhe je Umgebung, case nimmt sie zurück
    gap, cap, xh = 56, data["info"]["capHeight"], data["info"]["xHeight"]
    punct = lambda n: n.split(".")[0] in PUNCT
    for text, mids in FEIN:
        glyphs = [g for w in shape(font, text, {}) for g in w]
        for (a, xa), (b, xb) in zip(glyphs, glyphs[1:]):
            if punct(a) or punct(b):
                pa, pb = ink(glyphset, a, xa), ink(glyphset, b, xb)
                check(pathops.op(pa, pb, pathops.PathOp.INTERSECTION).area < 1, f"„{text}“ {a}|{b}: Tinte überlappt")
                check(pathops.op(grow(pa, gap - 1.5), pb, pathops.PathOp.INTERSECTION).area < 1, f"„{text}“ {a}|{b}: näher als {gap}")
        # neben Armen (E, F, L, T, t) nie unter/über ihnen: waagrecht außerhalb der Nachbartinte im Band; in Schrägen (A, Z, 2) eingerückt
        for (a, xa), (b, xb) in zip(glyphs, glyphs[1:]):
            pair = (a.split(".")[0], b.split(".")[0])
            if pair in ARM or pair in SLANT:
                pa, pb = ink(glyphset, a, xa), ink(glyphset, b, xb)
                dash = pa if pair[0] in ("hyphen", "endash") else pb  # Nachbartinte zählt bis 0,6 Versalhöhe über und unter dem Strich (PUNCT_REACH)
                band = pathops.Path()
                band.moveTo(-1e5, dash.bounds[1] - 0.6 * cap)
                band.lineTo(1e5, dash.bounds[1] - 0.6 * cap)
                band.lineTo(1e5, dash.bounds[3] + 0.6 * cap)
                band.lineTo(-1e5, dash.bounds[3] + 0.6 * cap)
                band.close()
                pa, pb = (pa, pathops.op(pb, band, pathops.PathOp.INTERSECTION)) if dash is pa else (pathops.op(pa, band, pathops.PathOp.INTERSECTION), pb)
                light = pb.bounds[0] - pa.bounds[2]
                ok = light >= gap - data["info"]["stroke"] / 2 - 1 if pair in ARM else light < 0  # Toleranz: Gehrungsspitzen kennt die Engine-Tinte nicht
                check(ok, f"„{text}“ {a}|{b}: Lücke der Kästen {light:.0f} ({'Arm' if pair in ARM else 'Schräge'})")
        got = [round((lambda b: (b[1] + b[3]) / 2)(ink(glyphset, n).bounds)) for n, _ in glyphs if n.split(".")[0] in ("hyphen", "endash", "parenleft", "parenright")]
        check(got == [{"x": xh // 2, "c": cap // 2}[m] for m in mids], f"„{text}“: Mitten {got} statt {mids}")
        cased = [n for w in shape(font, text, {"case": True}) for n, _ in w]
        check(not any(n.endswith(".lc") for n in cased), f"„{text}“ mit case: {cased}")

    print(f"{len(data['expect'])} Sollwerte geprüft ({len(data['glyphs'])} Glyphen, {len(data['kerning'])} Unterschneidungen im Font)")
    if fails:
        print("\n".join(f"✗ {f}" for f in fails))
        sys.exit(1)
    print("✓ Font in Ordnung")


if __name__ == "__main__":
    main()
