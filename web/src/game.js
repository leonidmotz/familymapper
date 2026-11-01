// FamilyMapper - game logic (no DOM). All rules come from config.json -> "game".

// ---------------------------------------------------------------- random
// Seeded RNG so a "daily challenge" gives everyone the same 10 families.
export function makeRng(seed) {
  if (seed == null) return Math.random;
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => { // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Today's date in the player's own time zone, as YYYY-MM-DD. */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Which pre-computed daily challenge is due today (0-based), cycling after `days`. */
export function dailyIndex(start, days, d = new Date()) {
  const [y, m, dd] = start.split("-").map(Number);
  const k = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(y, m - 1, dd)) / 864e5);
  return ((k % days) + days) % days;
}

// ---------------------------------------------------------------- rounds
const TIERS = ["easy", "medium", "hard"];

/** Pick the families to ask about, respecting the difficulty mix and region cap. */
export function pickRounds(meta, cfg, rng) {
  const total = cfg.rounds;
  const cap = cfg.max_per_region ?? Infinity;
  const perRegion = new Map();
  const chosen = [];
  const used = new Set();

  const take = (m) => {
    chosen.push(m);
    used.add(m.id);
    perRegion.set(m.region, (perRegion.get(m.region) ?? 0) + 1);
  };
  const allowed = (m, ignoreCap = false) =>
    !used.has(m.id) && (ignoreCap || (perRegion.get(m.region) ?? 0) < cap);

  // 1. Fill each tier as far as the mix asks.
  for (const tier of TIERS) {
    const want = cfg.mix?.[tier] ?? 0;
    for (const m of shuffle(meta.filter((x) => x.difficulty === tier), rng)) {
      if (chosen.filter((c) => c.difficulty === tier).length >= want) break;
      if (allowed(m)) take(m);
    }
  }
  // 2. Top up if a tier was too small (or the mix doesn't add up to `rounds`).
  for (const ignoreCap of [false, true]) {
    for (const m of shuffle(meta, rng)) {
      if (chosen.length >= total) break;
      if (allowed(m, ignoreCap)) take(m);
    }
  }
  const picked = chosen.slice(0, total);

  // 3. Order: "ramp" = easy first, hard last (shuffled within a tier).
  if ((cfg.order ?? "ramp") === "ramp") {
    return TIERS.flatMap((t) => shuffle(picked.filter((m) => m.difficulty === t), rng));
  }
  return shuffle(picked, rng);
}

/** Answer options for one round: the target, some neighbours, the rest random. */
export function makeOptions(target, meta, byId, cfg, rng) {
  const n = cfg.options_per_round ?? 6;
  const opts = [target];
  const has = (m) => opts.some((o) => o.id === m.id);

  const neighbours = shuffle(
    target.neighbors.map((id) => byId.get(id)).filter(Boolean), rng);
  for (const m of neighbours) {
    if (opts.length > (cfg.neighbor_distractors ?? 0)) break;
    if (!has(m)) opts.push(m);
  }
  for (const m of shuffle(meta, rng)) {
    if (opts.length >= n) break;
    if (!has(m)) opts.push(m);
  }
  return shuffle(opts, rng);
}

/** Plain-text summary for sharing, e.g. "FamilyMapper · Daily challenge #3\n7/10 🟩🟥…". */
export function shareText(title, modeLabel, answers, gameLabel) {
  const score = answers.filter((a) => a.correct).length;
  const squares = answers.map((a) => (a.correct ? "🟩" : "🟥")).join("");
  const head = [title, modeLabel, gameLabel].filter(Boolean).join(" · ");
  return `${head}\n${score}/${answers.length} ${squares}`;
}
