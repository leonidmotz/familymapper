"""One-off: add Abkhaz-Adyge + Hmong-Mien as hard, Kartvelian as medium (contemporary).
Run from the project root:  python prep/set_overrides.py   (then rerun 02 + 03)"""
import geopandas as gpd, pandas as pd

LAYER = "contemporary"
WANT = {  # name as in the data -> (force in?, difficulty)
    "Abkhaz-Adyge": ("in", "hard"),
    "Hmong-Mien":   ("in", "hard"),
    "Kartvelian":   ("",   "medium"),
}

fam = gpd.read_file(f"data/raw/asher2007world/cldf/{LAYER}/families.geojson")
fam = fam.rename(columns={"title": "name", "cldf:languageReference": "glottocode"})
area = fam.to_crs("EPSG:8857").geometry.area / 1e6

p = "prep/curation.csv"
cur = pd.read_csv(p, dtype=str).fillna("")
for name, (force, diff) in WANT.items():
    hit = fam[fam["name"].str.lower() == name.lower()]
    if hit.empty:
        close = fam[fam["name"].str.contains(name.split("-")[0], case=False)]["name"].tolist()
        print(f"NOT IN DATA: {name}  (similar: {close or 'none'})")
        continue
    code = hit["glottocode"].iloc[0]
    print(f"{name}: {code}, {area[hit.index[0]]:,.0f} km² -> {force or 'auto'}, {diff}")
    if code not in set(cur["glottocode"]):
        cur = pd.concat([cur, pd.DataFrame([{"glottocode": code, "name": name}])], ignore_index=True).fillna("")
    row = cur["glottocode"] == code
    if force:
        cur.loc[row, LAYER] = force
    cur.loc[row, "difficulty"] = diff
cur.to_csv(p, index=False)
print("updated", p)
