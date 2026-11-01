// FamilyMapper - the game UI: start screen -> 10 rounds -> results card.
import config from "../../config.json";
import { loadLand, loadLayer, drawFamily, drawInset, drawResults } from "./map.js";
import { resultsPng } from "./export.js";
import { makeRng, pickRounds, makeOptions, shareText, localDate, dailyIndex } from "./game.js";

const $ = (id) => document.getElementById(id);
const screens = ["start", "play", "results"];

let land, data, layer, rng, daily;   // daily = { no, date } or null
let rounds = [], answers = [], idx = 0, options = [], answered = false;

// ---------------------------------------------------------------- helpers
function show(name) {
  for (const s of screens) $(s).hidden = s !== name;
  $("status").hidden = name !== "play";
}
const label = (l) => config.game.layer_labels?.[l] ?? l;
const fmt = (n) => n.toLocaleString("en-US");
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// ---------------------------------------------------------------- start
function buildStart() {
  const layers = config.game.layers_offered ?? config.prep.layers;
  $("modes-box").hidden = layers.length < 2;   // one map only -> no choice shown
  $("kind-box").hidden = !config.game.show_daily;
  const kind = store.get("fm-kind") === "random" ? "random" : "daily";
  document.querySelector(`input[name="kind"][value="${kind}"]`).checked = true;
  for (const r of document.querySelectorAll('input[name="kind"]')) r.onchange = kindHint;
  kindHint();
  const saved = store.get("fm-layer");
  const def = layers.includes(saved) ? saved
    : layers.includes(config.game.default_layer) ? config.game.default_layer : layers[0];
  $("modes").replaceChildren(...layers.map((l) => {
    const lab = document.createElement("label");
    lab.className = "mode";
    lab.innerHTML = `<input type="radio" name="mode" value="${l}"
      ${l === def ? "checked" : ""}> ${label(l)}`;
    return lab;
  }));
}

function kindHint() {
  $("kind-hint").textContent = selectedKind() === "daily"
    ? `Challenge of ${localDate()}: the same ten families for everyone today.`
    : "Ten new families every game.";
}
const selectedKind = () =>
  config.game.show_daily ? document.querySelector('input[name="kind"]:checked').value : "random";

const dailyCache = new Map();
async function loadDaily(l) {
  if (!dailyCache.has(l)) {
    const r = await fetch(`./data/${l}/daily.json`);
    dailyCache.set(l, r.ok ? await r.json() : null);
  }
  return dailyCache.get(l);
}

async function startGame() {
  layer = document.querySelector('input[name="mode"]:checked').value;
  store.set("fm-layer", layer);
  $("start-btn").disabled = true;
  $("start-btn").textContent = "Loading…";
  const kind = selectedKind();
  store.set("fm-kind", kind);
  let schedule = null;
  try {
    data = await loadLayer(layer);
    if (kind === "daily") schedule = await loadDaily(layer);
  } finally {
    $("start-btn").disabled = false;
    $("start-btn").textContent = "Start";
  }
  if (kind === "daily") {
    const d = config.game.daily ?? {};
    const start = schedule?.start ?? d.start ?? "2026-11-01";
    const days = schedule?.days ?? d.days ?? 1000;
    const i = dailyIndex(start, days);
    daily = { no: i + 1, date: localDate() };
    rng = makeRng(`daily|${layer}|${i}|options`);   // same answer options for everyone
    rounds = (schedule?.rounds?.[i] ?? []).map((id) => data.byId.get(id)).filter(Boolean);
    if (rounds.length < config.game.rounds) {       // schedule missing or data changed
      const extra = pickRounds(data.meta.filter((m) => !rounds.includes(m)), config.game,
                               makeRng(`daily|${layer}|${i}`));
      rounds = rounds.concat(extra).slice(0, config.game.rounds);
    }
  } else {
    daily = null;
    rng = makeRng(null);
    rounds = pickRounds(data.meta, config.game, rng);
  }
  answers = [];
  idx = 0;
  show("play");
  window.scrollTo(0, 0);
  playRound();
}

// ---------------------------------------------------------------- rounds
function updateStatus() {
  $("round").textContent = `Round ${idx + 1} / ${rounds.length}`;
  $("score").textContent = `Score ${answers.filter((a) => a.correct).length}`;
}

function playRound() {
  const target = rounds[idx];
  answered = false;
  updateStatus();
  const fam = data.features.get(target.id);
  drawFamily($("map"), land, fam);
  drawInset($("inset"), land, fam, { ring: target.difficulty !== "easy" });

  options = makeOptions(target, data.meta, data.byId, config.game, rng);
  $("options").replaceChildren(...options.map((m, i) => {
    const b = document.createElement("button");
    b.className = "option";
    b.innerHTML = `<span class="key">${i + 1}</span>${m.name}`;
    b.onclick = () => answer(i);
    return b;
  }));
  $("reveal").hidden = true;
}

function answer(i) {
  if (answered) return;
  answered = true;
  const target = rounds[idx];
  const chosen = options[i];
  const correct = chosen.id === target.id;
  answers.push({ id: target.id, name: target.name, chosen: chosen.name, correct,
                 difficulty: target.difficulty });

  [...$("options").children].forEach((b, j) => {
    b.disabled = true;
    if (options[j].id === target.id) b.classList.add("right");
    else if (j === i) b.classList.add("wrong");
  });
  $("reveal-text").innerHTML = `<span class="verdict">${correct
      ? `<span class="badge ok">✓</span> Correct!`
      : `<span class="badge miss">✗</span> <span>It's <b>${target.name}</b>.</span>`}</span>
    <span class="facts">${fmt(target.area_km2)} km² · ${target.difficulty}</span>`;
  $("next-btn").textContent = idx + 1 < rounds.length ? "Next" : "See results";
  $("reveal").hidden = false;
  updateStatus();
  $("next-btn").focus({ preventScroll: true });
  $("reveal").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function next() {
  if (!answered) return;
  idx += 1;
  if (idx < rounds.length) playRound();
  else showResults();
}

// ---------------------------------------------------------------- results
function showResults() {
  const score = answers.filter((a) => a.correct).length;
  const rows = Math.ceil(answers.length / 2);
  $("card").innerHTML = `
    <div class="card-head">
      <div class="card-sub">${subtitle()}</div>
      <div class="card-score">${score}<span>/${answers.length}</span></div>
    </div>
    <svg id="results-map" role="img" aria-label="Map of all families in this game"></svg>
    <ol class="card-list" style="grid-template-rows: repeat(${rows}, auto)">
      ${answers.map((a, i) => `
        <li class="${a.correct ? "ok" : "miss"}">
          <span class="badge">${a.correct ? "✓" : "✗"}</span>
          <span><b>${i + 1}. ${a.name}</b>${a.correct ? "" :
            ` <small>you said ${a.chosen}</small>`}</span>
        </li>`).join("")}
    </ol>
    <div class="card-foot">Data: Glottography · Glottolog · Natural Earth</div>`;
  show("results");
  window.scrollTo(0, 0);
  drawResultsMap(); // needs the layout to exist, so draw after showing
}

const offeredLayers = () => config.game.layers_offered ?? config.prep.layers;
// The date is part of the daily label, so it's only added separately for random games.
const gameLabel = () => (daily ? `Daily challenge ${daily.date}` : `Random game · ${localDate()}`);
const subtitle = () =>
  [offeredLayers().length > 1 ? label(layer) : null, gameLabel()]
    .filter(Boolean).join(" · ");
const resultItems = () =>
  answers.map((a) => ({ feature: data.features.get(a.id), correct: a.correct }));
const drawResultsMap = () => drawResults($("results-map"), land, resultItems());

async function downloadCard() {
  const btn = $("download-btn");
  btn.disabled = true;
  try {
    const blob = await resultsPng({
      land, items: resultItems(), answers,
      title: config.game.title, url: config.game.url,
      sub: config.game.tagline ?? "",
      headerRight: daily ? `Daily Challenge ${daily.date}` : `Random Game ${localDate()}`,
      blur: true,                                     // no spoilers in shared images
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `familymapper-${daily ? "daily" : "game"}-${localDate()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    console.error(err);
    alert("Could not create the image: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function copyResult() {
  // Only name the map mode when players can actually choose between modes.
  const mode = offeredLayers().length > 1 ? label(layer) : null;
  const text = shareText(config.game.title, mode, answers, gameLabel()) +
    (config.game.url ? `\n${config.game.url}` : "");
  try {
    await navigator.clipboard.writeText(text);
    $("copy-btn").textContent = "Copied!";
    setTimeout(() => ($("copy-btn").textContent = "Copy result"), 1500);
  } catch {
    prompt("Copy your result:", text);
  }
}

// ---------------------------------------------------------------- init
document.addEventListener("keydown", (e) => {
  if ($("play").hidden) return;
  const n = Number(e.key);
  if (!answered && n >= 1 && n <= options.length) answer(n - 1);
  else if (answered && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); next(); }
});
window.addEventListener("resize", () => {
  if (!$("results").hidden) drawResultsMap();
  if (!$("play").hidden && rounds[idx]) {
    const fam = data.features.get(rounds[idx].id);
    drawFamily($("map"), land, fam);
    drawInset($("inset"), land, fam, { ring: rounds[idx].difficulty !== "easy" });
  }
});

async function init() {
  document.title = config.game.title;
  buildStart();
  land = await loadLand();
  $("start-btn").onclick = startGame;
  $("next-btn").onclick = next;
  $("download-btn").onclick = downloadCard;
  $("copy-btn").onclick = copyResult;
  $("again-btn").onclick = () => show("start");
  show("start");
}

init().catch((err) => {
  $("start").innerHTML = `<div class="panel"><b>Could not load data.</b><br>${err.message}
    <br><br>Did you run <code>python prep/03_export.py</code>?</div>`;
  console.error(err);
});
