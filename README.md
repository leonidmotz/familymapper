# FamilyMapper

**Play:** [leonidmotz.eu/familymapper](https://leonidmotz.eu/familymapper/)

Guess 10 randomized primary language families from their contemporary speaker areas.
Each round shows where one top-level language family is spoken, on a world map without
borders or names; pick the right family from six options. At the end you get a map of all
ten families (green = right, red = wrong) and a shareable image (map and names blurred, so it
doesn't spoil the game for others).

**Daily challenge:** everyone gets the same ten families on the same day (by the player's own
date). 1,000 challenges are pre-computed (`web/public/data/contemporary/daily.json`, starting
2026-11-01); after that the cycle starts again. **Random game:** ten new families every time.

**Beast mode** (for both): no easy families, and every family below the
30,000 km² cut-off can come up too, as well as language isolates: 0 easy, 2 medium, 3 hard and
5 tiny families or isolates (`game.beast` in `config.json`). Beast mode has its own daily challenges.

## Data

| What | Source | Licence |
|---|---|---|
| Language family areas | [Glottography](https://doi.org/10.5334/johd.459), dataset `asher2007world`, contemporary layer ([Zenodo](https://doi.org/10.5281/zenodo.15287258)) | CC-BY 4.0 |
| Original maps | Asher & Moseley (eds.), *Atlas of the World's Languages*, 2nd ed., Routledge 2007 | via Glottography |
| Family classification | [Glottolog](https://glottolog.org) (top-level families) | CC-BY 4.0 |
| Coastlines | [Natural Earth](https://www.naturalearthdata.com) 1:50m land | public domain |

**Processing** (`prep/`):

- Glottography already aggregates the Atlas' language polygons into Glottolog top-level families.
- Families with doubtful source polygons are excluded (`exclude` in `config.json`). Huavean is
  excluded because its polygon includes the Yucatán Peninsula, apparently a digitising error.
- Non-genealogical groupings (Sign Language, Pidgin, Unclassifiable, …) are removed; language
  isolates appear only in beast mode.
- Families smaller than 30,000 km² are left out of normal mode, because they would be invisible
  on a world map; beast mode includes them (zoomed in further). Manual exceptions are listed in
  `prep/curation.csv`.
- Difficulty comes from the family's area (easy ≥ 2 million km², medium ≥ 400,000 km²),
  with manual overrides; each game mixes 3 easy, 4 medium and 3 hard families.
- Polygons are simplified to about 2 km resolution with mapshaper. Overlaps and small
  outlying areas are kept as in the source.

**Caveats:** Language areas are approximate and contested; the Atlas reflects one
publication's view at one point in time. Some Glottocode assignments in the source data
may be imperfect. Corrections are best reported upstream at
[github.com/Glottography](https://github.com/Glottography).

**Citation:** Ranacher, P., Forkel, R., et al. (2026). Glottography: an open-source
geolinguistic data platform for mapping the world's languages. *Journal of Open Humanities
Data* 12: 47. https://doi.org/10.5334/johd.459

## Building it yourself

Data pipeline (Python 3 with geopandas; Node.js for mapshaper), from the project root:

    python prep/02_curate.py     # playable families -> data/processed/
    python prep/03_export.py     # compact map files + daily challenges -> web/public/data/

The raw data (`data/raw/`, not in this repository) comes from
`git clone https://github.com/Glottography/asher2007world` plus the Natural Earth files
`ne_110m_admin_0_countries.zip` and `ne_50m_land.zip` in `data/raw/naturalearth/`.

Web app:

    cd web
    npm install
    npm run dev      # local preview at http://localhost:5173 (family browser: /browser.html)
    npm run build    # static site in web/dist/

Pushing to `main` publishes the site via GitHub Pages (`.github/workflows/deploy.yml`).
Game settings (rounds, options, difficulty mix, title, link) are in `config.json`.
