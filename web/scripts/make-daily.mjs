// FamilyMapper - pre-computes the daily challenges (config.json -> game.daily).
// Writes web/public/data/<layer>/daily.json: one list of family ids per day.
// Day 1 is game.daily.start; after game.daily.days days the cycle starts again.
// Run after the map files changed:  node web/scripts/make-daily.mjs  (03_export.py does it)
import fs from "node:fs";
import { makeRng, pickRounds } from "../src/game.js";

const root = new URL("../../", import.meta.url);
const config = JSON.parse(fs.readFileSync(new URL("config.json", root)));
const { start = "2026-11-01", days = 1000 } = config.game.daily ?? {};
const layers = config.game.layers_offered ?? config.prep.layers;

for (const layer of layers) {
  const dir = new URL(`web/public/data/${layer}/`, root);
  const metaFile = new URL("families.json", dir);
  if (!fs.existsSync(metaFile)) { console.log(`daily: no ${layer} data, skipped`); continue; }
  const meta = JSON.parse(fs.readFileSync(metaFile));

  const rounds = [];
  let prev = new Set();
  for (let d = 0; d < days; d++) {
    // Leave yesterday's families out of the draw, as long as every difficulty tier
    // still has enough families for the mix; otherwise draw from the full pool.
    const rest = meta.filter((m) => !prev.has(m.id));
    const enough = Object.entries(config.game.mix ?? {})
      .every(([tier, k]) => rest.filter((m) => m.difficulty === tier).length >= k);
    const pick = pickRounds(enough ? rest : meta, config.game, makeRng(`daily|${layer}|${d}`))
      .map((m) => m.id);
    rounds.push(pick);
    prev = new Set(pick);
  }
  fs.writeFileSync(new URL("daily.json", dir), JSON.stringify({ start, days, rounds }));
  const counts = new Map();
  rounds.flat().forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  console.log(`daily: ${layer} - ${days} days from ${start}, ` +
              `${counts.size}/${meta.length} families used, each ${Math.min(...counts.values())}-${Math.max(...counts.values())} times`);
}
