"""
make_schema2_fixture.py: builds the schema 2 test repository (tests/fixtures/cards-repo) from the schema 1 one
(tests/fixtures/cards-repo-v1) with the exporter's own tools, so the fixture has exactly the exporter's format:

  - migrate_schema2.py puts the two test cards in "Espansione di prova" (year 2026);
  - the expansion gets a synthetic cover (3:1) and symbol, and a second expansion without year, cover or symbol
    gets a copy of the test card ("testcard-bis");
  - rarities: "rara" with a symbol (testcard), "comune" without (testcard-bis); the promo card has none.

Synthetic images only (no real artwork). Run from the binder-app root, with a checkout of binder-cards next to it:

  python3 tools/make_schema2_fixture.py [--tools ../binder-cards/tools]
Requires: Python 3.9+, pillow, numpy.
"""
import argparse, io, json, os, shutil, subprocess, sys, tempfile
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument("--tools", default=os.path.join("..", "binder-cards", "tools"))
A = ap.parse_args()
TOOLS = os.path.abspath(A.tools)
SRC = os.path.abspath(os.path.join("tests", "fixtures", "cards-repo-v1"))
OUT = os.path.abspath(os.path.join("tests", "fixtures", "cards-repo"))
sys.path.insert(0, TOOLS)
import catalog  # noqa: E402  (the exporter's catalog module)


def png(im):
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def cover():
    w, h = 1536, 512
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(40 + 60 * t), int(70 + 90 * t), int(150 - 40 * t)))
    for k in range(0, w, 96):
        d.line([(k, 0), (k - 200, h)], fill=(255, 255, 255), width=2)
    d.ellipse([w * 0.42, h * 0.18, w * 0.58, h * 0.66], fill=(140, 230, 120), outline=(20, 40, 20), width=6)
    return png(im)


def symbol(points, color):
    im = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    ImageDraw.Draw(im).polygon(points, fill=color, outline=(255, 255, 255, 255))
    return png(im)


STAR = [(128, 16), (158, 98), (244, 98), (174, 150), (200, 236), (128, 184), (56, 236), (82, 150), (12, 98), (98, 98)]
DIAMOND = [(128, 20), (236, 128), (128, 236), (20, 128)]

work = tempfile.mkdtemp(prefix="binder-fixture-")
repo = os.path.join(work, "repo")
shutil.copytree(SRC, repo, ignore=shutil.ignore_patterns(".DS_Store"))
subprocess.run([sys.executable, os.path.join(TOOLS, "migrate_schema2.py"), "--repo", repo, "--set-id", "espansione-prova",
                "--set-name", "Espansione di prova", "--set-year", "2026"], check=True)

cat = catalog.load(repo)
first = catalog.find(cat["sets"], "espansione-prova")
first["cover"] = catalog.import_image(repo, "sets/espansione-prova", "cover", cover())
first["symbol"] = catalog.import_image(repo, "sets/espansione-prova", "symbol", symbol(DIAMOND, (70, 160, 255, 255)))
cat["sets"].append({"id": "seconda-espansione", "name": "Seconda espansione", "order": 2, "year": None,
                    "cover": None, "symbol": None})
cat["rarities"] = [
    {"id": "comune", "name": "Comune", "order": 1, "symbol": None},
    {"id": "rara", "name": "Rara", "order": 2,
     "symbol": catalog.import_image(repo, "rarities/rara", "symbol", symbol(STAR, (255, 205, 60, 255)))},
]
catalog.update_card_meta(cat, "testcard", {"rarity": "rara"})

# a copy of the test card in the second expansion
src_dir = os.path.join(repo, "cards", "testcard.card")
bis_dir = os.path.join(repo, "cards", "testcard-bis.card")
shutil.copytree(src_dir, bis_dir)
card = json.load(open(os.path.join(bis_dir, "card.json"), encoding="utf-8"))
card["id"] = "testcard-bis"
version, sizes = catalog.write_card_json(bis_dir, card)
meta = catalog.new_card_meta(cat, "testcard-bis", name="Carta di prova bis", number="2", set="seconda-espansione",
                             rarity="comune")
catalog.put_card(cat, "testcard-bis", meta, {"version": version, "immersive": True, "hasFront": True, "bytes": sizes})
catalog.save(repo, cat)

shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(repo, OUT)
shutil.rmtree(work)
print("schema 2 fixture written to", os.path.relpath(OUT))
