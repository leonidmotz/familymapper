# FamilyMapper

Guess 10 randomized primary language families from their contemporary speaker areas.

Language areas: [Glottography](https://doi.org/10.5334/johd.459) (asher2007world, CC-BY 4.0) ·
classification: [Glottolog](https://glottolog.org) · coastlines: Natural Earth.

## Data pipeline (Python venv, run from the project root)

    python prep/01_explore.py contemporary  # optional: inspect a layer
    python prep/02_curate.py                # playable pools (config.json + prep/curation.csv)
    python prep/03_export.py                # compact map files into web/public/data/

## Web app

    cd web && npm install
    npm run dev        # http://localhost:5173  (family browser: /browser.html)
    npm run build      # static site in web/dist/

## Publishing (GitHub Pages)

Pushing to `main` builds and publishes the site via `.github/workflows/deploy.yml`.
The map files in `web/public/data/` are committed; the raw data in `/data/` is not.
After changing the data, rerun `02` + `03`, commit `web/public/data/`, and push.

## Settings (config.json)

- `prep` / `export`: size cut-off, difficulty thresholds, simplification → rerun 02 + 03
- `game`: rounds, options, difficulty mix, region cap, order, title, tagline, url → read directly by the app
- `game.layers_offered`: `["contemporary"]`; add `"traditional"` to show the map choice again
- `game.show_daily`: `false`; `true` shows the daily-challenge checkbox
- `prep/curation.csv`: force a family in/out or set its difficulty → rerun 02 + 03
