// Family Mapper - step 7: family browser (checks data + rendering before the quiz).
import { loadConfig, loadLand, loadLayer, drawFamily, drawInset } from "./map.js";

const $ = (id) => document.getElementById(id);
const ui = {
  layer: $("layer"), family: $("family"), random: $("random"), hide: $("hide"),
  map: $("map"), inset: $("inset"), info: $("info"),
};

let land, data, current;

function fmt(n) { return n.toLocaleString("en-US"); }

function showInfo(m) {
  const name = ui.hide.checked ? "???" : m.name;
  ui.info.innerHTML = `
    <h2>${name}</h2>
    <dl>
      <dt>Glottocode</dt><dd>${ui.hide.checked ? "…" : m.id}</dd>
      <dt>Difficulty</dt><dd>${m.difficulty}</dd>
      <dt>Region</dt><dd>${m.region ?? "–"}${m.subregion ? ` · ${m.subregion}` : ""}</dd>
      <dt>Area</dt><dd>${fmt(m.area_km2)} km²</dd>
      <dt>Neighbours</dt><dd>${m.neighbors.slice(0, 5)
        .map((id) => data.byId.get(id)?.name ?? id).join(", ")}</dd>
    </dl>`;
}

function render() {
  if (!current) return;
  const fam = data.features.get(current);
  const m = data.byId.get(current);
  if (!fam) { ui.info.textContent = `No geometry for ${current}`; return; }
  drawFamily(ui.map, land, fam);
  drawInset(ui.inset, land, fam);
  showInfo(m);
}

function fillFamilies() {
  const sorted = [...data.meta].sort((a, b) => a.name.localeCompare(b.name));
  ui.family.replaceChildren(...sorted.map((m) => {
    const o = new Option(`${m.name} (${m.difficulty})`, m.id);
    return o;
  }));
}

async function switchLayer(layer) {
  ui.info.textContent = "Loading…";
  data = await loadLayer(layer);
  fillFamilies();
  if (!data.byId.has(current)) current = data.meta[0].id;
  ui.family.value = current;
  render();
}

async function init() {
  const config = await loadConfig();
  document.title = config.game.title;
  const layers = config.prep.layers;
  ui.layer.replaceChildren(...layers.map(
    (l) => new Option(config.game.layer_labels?.[l] ?? l, l)));
  ui.layer.value = config.game.default_layer;

  land = await loadLand();
  await switchLayer(ui.layer.value);

  ui.layer.onchange = () => switchLayer(ui.layer.value);
  ui.family.onchange = () => { current = ui.family.value; render(); };
  ui.random.onclick = () => {
    current = data.meta[Math.floor(Math.random() * data.meta.length)].id;
    ui.family.value = current;
    render();
  };
  ui.hide.onchange = render;
  window.addEventListener("resize", render);
}

init().catch((err) => {
  ui.info.innerHTML = `<b>Could not load data.</b><br>${err.message}<br><br>
    Did you run <code>python prep/03_export.py</code>?`;
  console.error(err);
});
