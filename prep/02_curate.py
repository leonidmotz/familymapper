"""Family Mapper - step 5: curate the playable family pool for both layers.

Run from the project root:
    python prep/02_curate.py

Tunable rules (size cut-off, difficulty thresholds, layers) live in config.json
(section "prep"); per-family exceptions live in prep/curation.csv.

What it does, per layer (traditional + contemporary):
  1. Loads asher2007world family areas and tags each entry as family / isolate
     via languages.csv (Glottolog_Languoid_Level + Family).
  2. Drops isolates and non-genealogical Glottolog groupings (Sign Language,
     Pidgin, Unclassifiable, ...).
  3. Measures area (equal-area projection), assigns a region from Natural
     Earth, a default difficulty, and the 10 nearest families (for distractors).
  (Known errors in the source polygons are corrected first, see prep/geometry_fixes.json.)
  4. Applies the automatic rule (area >= MIN_AREA_KM2) plus your manual
     overrides from prep/curation.csv.

Outputs:
  prep/curation.csv                    your override sheet (created once, kept on reruns)
  data/processed/<layer>/pool.geojson  playable families, full resolution + metadata
  data/processed/<layer>/pool.csv      same, without geometry
  data/processed/<layer>/pool_sheet.png  contact sheet of the pool for review
"""
from pathlib import Path
import json
import math

import numpy as np
import pandas as pd
import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
ASHER = ROOT / "data/raw/asher2007world/cldf"
NE_COUNTRIES = ROOT / "data/raw/naturalearth/ne_110m_admin_0_countries.zip"
OUT = ROOT / "data/processed"
CURATION = ROOT / "prep/curation.csv"
FIXES = ROOT / "prep/geometry_fixes.json"   # corrections for errors in the source polygons
CONFIG = json.loads((ROOT / "config.json").read_text())["prep"]

LAYERS = CONFIG["layers"]
MIN_AREA_KM2 = CONFIG["min_area_km2"]          # automatic cut-off for playable families
SHEET_FLOOR_KM2 = CONFIG["sheet_floor_km2"]    # smaller entries don't go into curation.csv
DIFF_MIN = CONFIG["difficulty_min_area_km2"]   # e.g. {"easy": 2e6, "medium": 4e5}
EQUAL_AREA = "EPSG:8857"                       # Equal Earth

# Glottolog top-level groupings that are not genealogical families
PSEUDO = {
    "sign language", "unclassifiable", "pidgin", "mixed language",
    "artificial language", "speech register", "unattested", "bookkeeping",
}


def difficulty_for(area_km2):
    if area_km2 >= DIFF_MIN["easy"]:
        return "easy"
    if area_km2 >= DIFF_MIN["medium"]:
        return "medium"
    return "hard"


# ---------------------------------------------------------------------------
def load_layer(layer):
    fam = gpd.read_file(ASHER / layer / "families.geojson")
    fam = fam.rename(columns={"title": "name", "cldf:languageReference": "glottocode"})
    fam = fam[["name", "glottocode", "geometry"]]

    langs = pd.read_csv(
        ASHER / layer / "languages.csv",
        usecols=["ID", "Glottolog_Languoid_Level", "Family"],
    ).drop_duplicates("ID")
    fam = fam.merge(langs, left_on="glottocode", right_on="ID", how="left")

    level = fam["Glottolog_Languoid_Level"]
    fam["kind"] = np.select(
        [level.eq("family"), level.eq("language") & fam["Family"].isna()],
        ["family", "isolate"],
        default="other",
    )
    fam.loc[fam["name"].str.lower().isin(PSEUDO), "kind"] = "pseudo"
    fam = fam.drop(columns=["ID", "Glottolog_Languoid_Level", "Family"])

    fam["geometry"] = fam.geometry.make_valid()
    fam = apply_geometry_fixes(fam, layer)
    fam["area_km2"] = (fam.to_crs(EQUAL_AREA).geometry.area / 1e6).round(0)

    counts = fam["kind"].value_counts().to_dict()
    print(f"[{layer}] {len(fam)} entries: {counts}")
    other = fam.loc[fam.kind == "other", "name"].tolist()
    if other:
        print(f"[{layer}] not clearly family/isolate (excluded): {other}")
    return fam


def apply_geometry_fixes(fam, layer):
    """Move polygon parts from one family to another, for known errors in the source.
    Each fix in prep/geometry_fixes.json: {"from", "to", "bbox": [minx, miny, maxx, maxy],
    "layers": [...] (optional), "reason"}. A part moves if its centre lies inside bbox."""
    if not FIXES.exists():
        return fam
    from shapely.geometry import box
    from shapely.ops import unary_union
    for fx in json.loads(FIXES.read_text()):
        if layer not in fx.get("layers", LAYERS):
            continue
        src = fam.index[fam["glottocode"] == fx["from"]]
        dst = fam.index[fam["glottocode"] == fx["to"]]
        if src.empty or dst.empty:
            print(f"[{layer}] fix {fx['from']} -> {fx['to']}: family not found, skipped")
            continue
        area = box(*fx["bbox"])
        parts = list(getattr(fam.at[src[0], "geometry"], "geoms", [fam.at[src[0], "geometry"]]))
        move = [p for p in parts if area.contains(p.representative_point())]
        keep = [p for p in parts if p not in move]
        if not move:
            print(f"[{layer}] fix {fx['from']} -> {fx['to']}: nothing inside bbox, skipped")
            continue
        fam.at[src[0], "geometry"] = unary_union(keep) if keep else None
        fam.at[dst[0], "geometry"] = unary_union([fam.at[dst[0], "geometry"], *move])
        print(f"[{layer}] fix: moved {len(move)} part(s) from {fx['from']} to {fx['to']} ({fx.get('reason', '')})")
    return fam[fam.geometry.notna()]


def largest_part(geom):
    parts = getattr(geom, "geoms", [geom])
    return max(parts, key=lambda g: g.area)


def add_region(gdf, countries):
    """Region = Natural Earth continent/subregion nearest to the largest part's
    representative point."""
    pts = gpd.GeoDataFrame(
        {"glottocode": gdf["glottocode"].values},
        geometry=[largest_part(g).representative_point() for g in gdf.geometry],
        crs=gdf.crs,
    )
    joined = gpd.sjoin_nearest(
        pts.to_crs(EQUAL_AREA), countries.to_crs(EQUAL_AREA), how="left"
    ).drop_duplicates("glottocode")
    lookup = joined.set_index("glottocode")
    gdf["region"] = gdf["glottocode"].map(lookup["CONTINENT"])
    gdf["subregion"] = gdf["glottocode"].map(lookup["SUBREGION"])
    gdf["rep_lon"] = [p.x for p in pts.geometry]
    gdf["rep_lat"] = [p.y for p in pts.geometry]
    return gdf


def add_neighbors(pool, k=10):
    lon = np.radians(pool["rep_lon"].to_numpy())
    lat = np.radians(pool["rep_lat"].to_numpy())
    dlat = lat[:, None] - lat[None, :]
    dlon = lon[:, None] - lon[None, :]
    a = np.sin(dlat / 2) ** 2 + np.cos(lat[:, None]) * np.cos(lat[None, :]) * np.sin(dlon / 2) ** 2
    dist = 2 * np.arcsin(np.sqrt(a))
    np.fill_diagonal(dist, np.inf)
    codes = pool["glottocode"].to_numpy()
    pool["neighbors"] = [
        ";".join(codes[np.argsort(row)[:k]]) for row in dist
    ]
    return pool


# ---------------------------------------------------------------------------
def build_curation_sheet(layers):
    """One row per candidate family across both layers. Override columns:
    traditional / contemporary: blank = automatic rule, 'in' or 'out' = force
    difficulty: blank = automatic, or easy / medium / hard
    """
    rows = {}
    for layer, gdf in layers.items():
        fams = gdf[(gdf.kind == "family") & (gdf.area_km2 >= SHEET_FLOOR_KM2)]
        for _, r in fams.iterrows():
            row = rows.setdefault(r.glottocode, {"glottocode": r.glottocode, "name": r["name"]})
            row[f"area_{layer}"] = int(r.area_km2)
    auto = pd.DataFrame(rows.values())
    for layer in LAYERS:
        if f"area_{layer}" not in auto:
            auto[f"area_{layer}"] = np.nan
        auto[layer] = ""
    auto["difficulty"] = ""
    auto["note"] = ""
    auto = auto.sort_values(f"area_{LAYERS[0]}", ascending=False)

    if CURATION.exists():
        old = pd.read_csv(CURATION, dtype=str).fillna("")
        keep = ["glottocode"] + LAYERS + ["difficulty", "note"]
        for c in keep:
            if c not in old.columns:
                old[c] = ""
        # Rows you added by hand (e.g. a family below sheet_floor_km2) are kept too,
        # as long as they carry an override.
        has_override = old[LAYERS + ["difficulty"]].apply(lambda col: col.str.strip() != "").any(axis=1)
        extra = old[~old["glottocode"].isin(auto["glottocode"]) & has_override]
        auto = auto.drop(columns=[c for c in keep if c != "glottocode"])
        auto = auto.merge(old[keep], on="glottocode", how="left").fillna(
            {c: "" for c in keep})
        if len(extra):
            auto = pd.concat([auto, extra[["glottocode", "name"] + keep[1:]]
                              if "name" in extra else extra[keep]], ignore_index=True)
        print(f"\nKept your overrides from {CURATION.name}")
    else:
        print(f"\nCreated {CURATION} - edit it to force families in/out")

    cols = ["glottocode", "name"] + [f"area_{l}" for l in LAYERS] + LAYERS + ["difficulty", "note"]
    auto[cols].to_csv(CURATION, index=False)
    return auto.set_index("glottocode")


def contact_sheet(pool, land, path, title):
    n = len(pool)
    ncols = 8
    nrows = max(1, math.ceil(n / ncols))
    fig, axes = plt.subplots(nrows, ncols, figsize=(ncols * 2.6, nrows * 2.6))
    draw = pool.geometry.simplify(0.02, preserve_topology=True)
    for i, ax in enumerate(np.atleast_1d(axes).flat):
        ax.set_axis_off()
        if i >= n:
            continue
        r = pool.iloc[i]
        minx, miny, maxx, maxy = draw.iloc[i].bounds
        pad = max(6, 0.35 * max(maxx - minx, maxy - miny))
        land.plot(ax=ax, color="#d8d4cc", edgecolor="none")
        gpd.GeoSeries([draw.iloc[i]]).plot(ax=ax, color="#d9541e")
        ax.set_xlim(max(-180, minx - pad), min(180, maxx + pad))
        ax.set_ylim(max(-90, miny - pad), min(90, maxy + pad))
        ax.set_title(f"{r['name']}\n{int(r.area_km2):,} km² · {r.difficulty}", fontsize=7)
    fig.suptitle(title, fontsize=12)
    fig.subplots_adjust(left=0.01, right=0.99, top=0.97, bottom=0.01,
                        wspace=0.1, hspace=0.35)
    fig.savefig(path, dpi=90)
    plt.close(fig)


# ---------------------------------------------------------------------------
def main():
    countries = gpd.read_file(f"zip://{NE_COUNTRIES}")
    countries.columns = [c.upper() if c != "geometry" else c for c in countries.columns]
    countries = countries[["CONTINENT", "SUBREGION", "geometry"]]
    land = gpd.GeoDataFrame(geometry=[countries.union_all()], crs=countries.crs)

    layers = {layer: load_layer(layer) for layer in LAYERS}
    sheet = build_curation_sheet(layers)

    exclude = set(CONFIG.get("exclude", []))   # glottocodes never shown in the game
    for layer, gdf in layers.items():
        fams = gdf[(gdf.kind == "family") & ~gdf["glottocode"].isin(exclude)].copy()

        override = fams["glottocode"].map(sheet[layer]).fillna("").str.strip().str.lower()
        auto_in = fams["area_km2"] >= MIN_AREA_KM2
        include = (auto_in & override.ne("out")) | override.eq("in")
        pool = fams[include].copy()

        pool = add_region(pool, countries)
        manual = pool["glottocode"].map(sheet["difficulty"]).fillna("").str.strip().str.lower()
        pool["difficulty"] = np.where(
            manual.isin(["easy", "medium", "hard"]), manual,
            pool["area_km2"].apply(difficulty_for))
        pool = pool.sort_values("area_km2", ascending=False).reset_index(drop=True)
        pool = add_neighbors(pool)

        b = pool.geometry.bounds
        pool["minx"], pool["miny"], pool["maxx"], pool["maxy"] = b.minx, b.miny, b.maxx, b.maxy

        out = OUT / layer
        out.mkdir(parents=True, exist_ok=True)
        pool = pool.drop(columns=["kind"])
        pool.to_file(out / "pool.geojson", driver="GeoJSON")
        pool.drop(columns="geometry").to_csv(out / "pool.csv", index=False)

        print(f"\n[{layer}] pool: {len(pool)} families "
              f"({pool.difficulty.value_counts().to_dict()})")
        print(f"[{layer}] by region: {pool.region.value_counts().to_dict()}")

        print(f"[{layer}] drawing contact sheet...", flush=True)
        contact_sheet(pool, land, out / "pool_sheet.png",
                      f"Family Mapper - {layer} pool ({len(pool)} families)")

    print(f"\nDone. Review data/processed/<layer>/pool_sheet.png, "
          f"then edit prep/curation.csv and rerun if needed.")


if __name__ == "__main__":
    main()
