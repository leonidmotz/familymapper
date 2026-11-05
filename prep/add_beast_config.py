"""One-off: add the beast-mode settings to config.json (keeps everything else as it is).
Run from the project root:  python prep/add_beast_config.py"""
import json

p = "config.json"
c = json.load(open(p))
c["prep"].setdefault("beast_min_area_km2", 0)   # smallest family allowed in beast mode
c["prep"].setdefault("draw_sheet", True)        # false skips the slow review image
c["prep"].setdefault("beast_isolates", True)    # language isolates are in beast mode too
c["game"].setdefault("beast", {
    "mix": {"easy": 1, "medium": 2, "hard": 3, "tiny": 4},   # per game, 10 in total
    "max_per_region": 4,
})
json.dump(c, open(p, "w"), indent=2, ensure_ascii=False)
open(p, "a").write("\n")
print("beast settings:", json.dumps(c["game"]["beast"]))
