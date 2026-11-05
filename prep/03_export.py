"""Family Mapper - step 6: export compact web files.

Run from the project root (after 02_curate.py):
    python prep/03_export.py

Needs Node.js (uses `npx mapshaper`). Simplification levels live in
config.json -> "export".

Writes:
  web/public/data/land.topojson
  web/public/data/<layer>/families.topojson   (object "families", id = glottocode)
  web/public/data/<layer>/families.json       (metadata list)
  web/public/data/<layer>/daily.json          (pre-computed daily challenges)
"""
from pathlib import Path
import json
import subprocess
import zipfile

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"
CONFIG = json.loads(CONFIG_PATH.read_text())
LAYERS = CONFIG["prep"]["layers"]
EXPORT = CONFIG.get("export", {})
# Either a percentage ("8%") or a resolution in metres ("interval=2000")
FAMILY_SIMPLIFY = EXPORT.get("family_simplify", "interval=2000")
LAND_SIMPLIFY = EXPORT.get("land_simplify", "25%")
QUANTIZATION = str(EXPORT.get("quantization", 100000))

PROCESSED = ROOT / "data/processed"
NE_DIR = ROOT / "data/raw/naturalearth"
WEB = ROOT / "web/public"
DATA = WEB / "data"


def mapshaper(*args):
    cmd = ["npx", "--yes", "mapshaper", *map(str, args)]
    print("  $", " ".join(cmd[3:]))
    subprocess.run(cmd, check=True)


def kb(path):
    return f"{path.stat().st_size / 1024:,.0f} KB"


def export_land():
    land_dir = NE_DIR / "ne_50m_land"
    if not land_dir.exists():
        with zipfile.ZipFile(NE_DIR / "ne_50m_land.zip") as z:
            z.extractall(land_dir)
    shp = next(land_dir.glob("*.shp"))
    out = DATA / "land.topojson"
    print("\nLand:")
    mapshaper(shp,
              "-simplify", LAND_SIMPLIFY, "keep-shapes",
              "-filter-fields",
              "-rename-layers", "land",
              "-o", "format=topojson", f"quantization={QUANTIZATION}", out)
    print(f"  -> {out.relative_to(ROOT)} ({kb(out)})")


def export_layer(layer):
    src = PROCESSED / layer / "pool.geojson"
    csv = PROCESSED / layer / "pool.csv"
    out_dir = DATA / layer
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{layer}:")
    topo = out_dir / "families.topojson"
    # No -clean: family areas may overlap on purpose; -clean would cut overlaps.
    mapshaper(src,
              "-simplify", FAMILY_SIMPLIFY, "keep-shapes",
              "-filter-fields", "glottocode",
              "-rename-layers", "families",
              "-o", "format=topojson", "id-field=glottocode",
              f"quantization={QUANTIZATION}", topo)

    df = pd.read_csv(csv)
    meta = []
    for _, r in df.iterrows():
        meta.append({
            "id": r.glottocode,
            "name": r["name"],
            "difficulty": r.difficulty,
            "region": r.region if isinstance(r.region, str) else None,
            "subregion": r.subregion if isinstance(r.subregion, str) else None,
            "area_km2": int(r.area_km2),
            "isolate": bool(getattr(r, "isolate", False) is True or str(getattr(r, "isolate", "")) == "True"),
            "rep": [round(r.rep_lon, 3), round(r.rep_lat, 3)],
            "neighbors": str(r.neighbors).split(";") if isinstance(r.neighbors, str) and r.neighbors else [],
            "neighbors_beast": str(r.neighbors_beast).split(";")
                               if isinstance(getattr(r, "neighbors_beast", None), str) else [],
        })
    meta_path = out_dir / "families.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1))

    counts = df.difficulty.value_counts().to_dict()
    print(f"  -> {topo.relative_to(ROOT)} ({kb(topo)})")
    print(f"  -> {meta_path.relative_to(ROOT)} ({kb(meta_path)}), "
          f"{len(meta)} families {counts}")


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    # (config.json is no longer copied: the web app imports it from the project root)
    export_land()
    for layer in LAYERS:
        export_layer(layer)
    print("\nDaily challenges:")
    subprocess.run(["node", str(ROOT / "web/scripts/make-daily.mjs")], check=True)
    print("\nDone.")


if __name__ == "__main__":
    main()
