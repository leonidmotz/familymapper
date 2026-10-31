"""Family Mapper - step 3: explore the family polygons of asher2007world (contemporary).

Run from the project root:
    python prep/01_explore.py               # contemporary layer (default)
    python prep/01_explore.py traditional   # time-of-contact layer

Outputs (in data/processed/, suffixed with the layer name):
    families_summary_<layer>.csv   one row per family: name, glottocode, area, bbox, parts
    overview_<layer>.png           all families on one world map
    contact_sheet_<layer>.png      every family drawn on its own, largest first
"""
from pathlib import Path
import math
import sys

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
LAYER = sys.argv[1] if len(sys.argv) > 1 else "contemporary"
SRC = ROOT / f"data/raw/asher2007world/cldf/{LAYER}/families.geojson"
OUT = ROOT / "data/processed"
OUT.mkdir(parents=True, exist_ok=True)

gdf = gpd.read_file(SRC)

# --- 1. What's in the file? -------------------------------------------------
print(f"\n{len(gdf)} features, CRS: {gdf.crs}")
print("\nColumns:", list(gdf.columns))
print("\nFirst 5 rows (without geometry):")
print(gdf.drop(columns="geometry").head().to_string())


def pick(cands):
    for c in cands:
        if c in gdf.columns:
            return c
    return None


name_col = pick(["Name", "name", "title", "Title", "Family", "family", "label"])
code_col = pick(["cldf:languageReference", "Glottocode", "glottocode",
                 "Language_ID", "ID", "id", "cldf:id"])
print(f"\nUsing name column: {name_col!r}, glottocode column: {code_col!r}")

# --- 2. Clean + measure ----------------------------------------------------
gdf["geometry"] = gdf.geometry.make_valid()
try:
    eq = gdf.to_crs("EPSG:8857")  # Equal Earth, equal-area
except Exception:
    eq = gdf.to_crs("+proj=eqearth +datum=WGS84 +units=m")
gdf["area_km2"] = (eq.geometry.area / 1e6).round(0)
gdf["n_parts"] = gdf.geometry.apply(lambda g: len(getattr(g, "geoms", [g])))
b = gdf.geometry.bounds
gdf["minx"], gdf["miny"], gdf["maxx"], gdf["maxy"] = b.minx, b.miny, b.maxx, b.maxy
gdf["crosses_dateline"] = (gdf.maxx - gdf.minx) > 300

gdf = gdf.sort_values("area_km2", ascending=False).reset_index(drop=True)
label = gdf[name_col] if name_col else gdf.index.astype(str)

cols = [c for c in [name_col, code_col] if c] + [
    "area_km2", "n_parts", "minx", "miny", "maxx", "maxy", "crosses_dateline"]
gdf[cols].to_csv(OUT / f"families_summary_{LAYER}.csv", index=False)

print(f"\nDuplicate names: {label.duplicated().sum()}")
print("\nArea distribution (km²):")
print(gdf.area_km2.describe().round(0).to_string())
print(f"\nFamilies < 10,000 km²: {(gdf.area_km2 < 1e4).sum()}")
print(f"Families < 50,000 km²: {(gdf.area_km2 < 5e4).sum()}")
print(f"Crossing the dateline: {list(label[gdf.crosses_dateline])}")
print("\nTop 25 by area:")
print(gdf[[c for c in [name_col] if c] + ["area_km2"]].head(25).to_string())

# Simplified copies for drawing only (full-res polygons make plotting very slow)
print("\nDrawing images...", flush=True)
draw = gdf.geometry.simplify(0.02, preserve_topology=True)
eq_draw = gpd.GeoSeries(draw, crs=gdf.crs).to_crs(eq.crs)

# --- 3. Overview map --------------------------------------------------------
fig, ax = plt.subplots(figsize=(20, 10))
gpd.GeoDataFrame(geometry=eq_draw).plot(ax=ax, column=gdf.index % 20, cmap="tab20",
                       edgecolor="white", linewidth=0.2)
ax.set_axis_off()
ax.set_title(f"asher2007world {LAYER} - {len(gdf)} family areas")
fig.savefig(OUT / f"overview_{LAYER}.png", dpi=120, bbox_inches="tight")
plt.close(fig)

# --- 4. Contact sheet: each family alone ------------------------------------
n = len(gdf)
ncols = 10
nrows = math.ceil(n / ncols)
fig, axes = plt.subplots(nrows, ncols, figsize=(ncols * 2.2, nrows * 2.4))
for i, ax in enumerate(axes.flat):
    ax.set_axis_off()
    if i >= n:
        continue
    gpd.GeoSeries([draw.iloc[i]]).plot(ax=ax, color="#d9541e")
    ax.set_title(f"{label.iloc[i]}\n{int(gdf.area_km2.iloc[i]):,} km²", fontsize=7)
fig.subplots_adjust(left=0.01, right=0.99, top=0.99, bottom=0.01,
                    wspace=0.15, hspace=0.45)
fig.savefig(OUT / f"contact_sheet_{LAYER}.png", dpi=90)
plt.close(fig)

print(f"\nWrote {OUT}/families_summary_{LAYER}.csv, overview_{LAYER}.png, "
      f"contact_sheet_{LAYER}.png")
