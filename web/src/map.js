// FamilyMapper - map rendering (shared by the browser and, later, the game).
import { geoEqualEarth, geoPath, geoArea, geoCentroid } from "d3-geo";
import { feature } from "topojson-client";

const SVG_NS = "http://www.w3.org/2000/svg";
const cache = new Map(); // layer -> { meta, byId, features }

// ---------------------------------------------------------------- data
export async function loadLand() {
  if (cache.has("__land")) return cache.get("__land");
  const topo = await (await fetch("./data/land.topojson")).json();
  const land = feature(topo, topo.objects.land);
  cache.set("__land", land);
  return land;
}

// Loads one layer once; later calls come from memory (instant mode switching).
export async function loadLayer(layer) {
  if (cache.has(layer)) return cache.get(layer);
  const [topo, meta] = await Promise.all([
    fetch(`./data/${layer}/families.topojson`).then((r) => r.json()),
    fetch(`./data/${layer}/families.json`).then((r) => r.json()),
  ]);
  const fc = feature(topo, topo.objects.families);
  const features = new Map();
  for (const f of fc.features) features.set(String(f.id), fixWinding(f));
  const byId = new Map(meta.map((m) => [m.id, m]));
  const data = { meta, byId, features };
  cache.set(layer, data);
  return data;
}

// d3 treats rings spherically: a polygon wound the "wrong" way covers the whole
// globe minus the shape. If a feature covers more than half the sphere, flip it.
function fixWinding(f) {
  if (geoArea(f) > 2 * Math.PI) {
    const g = f.geometry;
    const rev = (poly) => poly.map((ring) => ring.slice().reverse());
    if (g.type === "Polygon") g.coordinates = rev(g.coordinates);
    if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map(rev);
  }
  return f;
}

// ---------------------------------------------------------------- drawing
function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function size(svg) {
  const r = svg.getBoundingClientRect();
  return [Math.max(40, r.width), Math.max(20, r.height)];
}

/**
 * Draw one family on a borderless map.
 * opts.padding     fraction of the view kept free around the family (context)
 * opts.maxZoom     max zoom relative to the whole-world view (small families)
 * opts.markerBelowPx  draw a circle around families smaller than this on screen
 */
export function drawFamily(svg, land, fam, opts = {}) {
  const { padding = 0.18, maxZoom = 7, markerBelowPx = 40, markerMinR = 18 } = opts;
  const [w, h] = size(svg);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.replaceChildren();

  // Centre the projection on the family (handles dateline-crossing families).
  const [lon, lat] = geoCentroid(fam);
  const proj = geoEqualEarth().rotate([-lon, 0]);

  const world = geoEqualEarth().rotate([-lon, 0]).fitSize([w, h], { type: "Sphere" });
  const pad = Math.min(w, h) * padding;
  proj.fitExtent([[pad, pad], [w - pad, h - pad]], fam);

  if (proj.scale() <= world.scale()) {
    // Family is (nearly) global: show the whole world, never zoom out past it
    // and never shift it towards the family's centroid.
    proj.scale(world.scale()).translate(world.translate());
  } else if (proj.scale() > world.scale() * maxZoom) {
    // Tiny family: cap the zoom so some coastline stays visible, centre on it.
    proj.scale(world.scale() * maxZoom).translate([w / 2, h / 2]);
    const [x, y] = proj([lon, lat]);
    proj.translate([w - x, h - y]);
  }

  const path = geoPath(proj);
  el("path", { class: "land", d: path(land) }, svg);
  el("path", { class: "target", d: path(fam) }, svg);

  // Highlight tiny families with a ring.
  const [[x0, y0], [x1, y1]] = path.bounds(fam);
  if (Math.max(x1 - x0, y1 - y0) < markerBelowPx) {
    el("circle", {
      class: "marker", cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
      r: Math.max(markerMinR, Math.max(x1 - x0, y1 - y0)),
    }, svg);
  }
  return proj;
}

/** Small world overview with a dot where the family is. */
export function drawInset(svg, land, fam) {
  const [w, h] = size(svg);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.replaceChildren();
  const proj = geoEqualEarth().fitSize([w, h], { type: "Sphere" });
  const path = geoPath(proj);
  el("path", { class: "land", d: path(land) }, svg);
  el("path", { class: "target", d: path(fam) }, svg);
  const [x, y] = proj(geoCentroid(fam));
  el("circle", { class: "marker", cx: x, cy: y, r: 7 }, svg);
}

// ---------------------------------------------------------------- results map
/** World view for the results: item = { feature, correct }. */
export function resultsProjection(w, h) {
  return geoEqualEarth().rotate([-10, 0]).fitSize([w, h], { type: "Sphere" });
}

/** Draw all guessed families at once: green = right, red = wrong (SVG). */
export function drawResults(svg, land, items) {
  const [w, h] = size(svg);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.replaceChildren();
  const path = geoPath(resultsProjection(w, h));
  el("path", { class: "land", d: path(land) }, svg);
  // Wrong ones first, so a right answer is never hidden under a wrong one.
  const ordered = [...items].sort((a, b) => a.correct - b.correct);
  for (const it of ordered) {
    const cls = it.correct ? "res-ok" : "res-miss";
    el("path", { class: cls, d: path(it.feature) }, svg);
    const [[x0, y0], [x1, y1]] = path.bounds(it.feature);
    if (Math.max(x1 - x0, y1 - y0) < 12) {   // tiny family: add a ring
      el("circle", { class: `${cls} ring`, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, r: 9 }, svg);
    }
  }
}
