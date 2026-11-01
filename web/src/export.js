// FamilyMapper - results image (3:4 portrait), drawn straight onto a <canvas>.
// (More reliable than screenshotting HTML: no font/SVG embedding problems.)
import { geoPath } from "d3-geo";
import { resultsProjection } from "./map.js";

const C = {
  bg: "#ffffff", panel: "#f4f7f6", ink: "#1d2a2f", muted: "#6b7a80", line: "#dfe5e3",
  ocean: "#eaf2f6", land: "#d3dad8", green: "#009e48", blue: "#0091d4", red: "#e0383e",
};
const FONT = '"Cabin Variable", "Cabin", system-ui, sans-serif';

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + "…").width > maxW) text = text.slice(0, -1);
  return text + "…";
}

/** Brand header: full-width green bar / wordmark flush left (+ label flush right) / blue bar.
 *  Returns bottom y. */
function brandHeader(ctx, W, pad, title, right) {
  ctx.fillStyle = C.green; ctx.fillRect(0, 0, W, 26);
  ctx.font = `700 76px ${FONT}`;
  ctx.fillStyle = C.blue;
  ctx.fillText(title, pad, 26 + 30 + 58);
  if (right) {                       // e.g. "Daily Challenge 2026-11-01", same baseline as the logo
    ctx.font = `700 34px ${FONT}`;
    ctx.fillStyle = C.ink;
    ctx.textAlign = "right";
    ctx.fillText(right, W - pad, 26 + 30 + 58);
    ctx.textAlign = "left";
  }
  ctx.fillStyle = C.blue; ctx.fillRect(0, 26 + 30 + 58 + 30, W, 13);
  return 26 + 30 + 58 + 30 + 13;
}

function badge(ctx, x, y, r, ok) {
  ctx.fillStyle = ok ? C.green : C.red; ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = r * 0.22; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  const k = r / 12;
  if (ok) { ctx.moveTo(x - 5.5 * k, y + 0.5 * k); ctx.lineTo(x - 1.5 * k, y + 4.5 * k); ctx.lineTo(x + 5.5 * k, y - 4 * k); }
  else { ctx.moveTo(x - 4.5 * k, y - 4.5 * k); ctx.lineTo(x + 4.5 * k, y + 4.5 * k);
         ctx.moveTo(x + 4.5 * k, y - 4.5 * k); ctx.lineTo(x - 4.5 * k, y + 4.5 * k); }
  ctx.stroke();
}

// ---------------------------------------------------------------- gaussian blur
// Three box blurs in a row approximate a Gaussian (works in every browser,
// unlike ctx.filter which Safari lacks).
function boxesForGauss(sigma, n = 3) {
  let wl = Math.floor(Math.sqrt((12 * sigma * sigma) / n + 1));
  if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wl + 2));
}

function boxBlur(src, dst, w, h, r, horizontal) {
  const inv = 1 / (r + r + 1);
  const outer = horizontal ? h : w, len = horizontal ? w : h, step = horizontal ? 4 : w * 4;
  for (let o = 0; o < outer; o++) {
    const base = horizontal ? o * w * 4 : o * 4;
    for (let c = 0; c < 4; c++) {
      const at = (j) => src[base + Math.min(Math.max(j, 0), len - 1) * step + c];
      let v = (r + 1) * at(0);
      for (let j = 0; j < r; j++) v += at(j);
      for (let j = 0; j < len; j++) {
        v += at(j + r) - at(j - r - 1);
        dst[base + j * step + c] = v * inv;
      }
    }
  }
}

/** Gaussian-blur a rectangle (in layout px) of a canvas drawn at `scale`. */
function blurRect(ctx, scale, x, y, w, h, sigma) {
  const X = Math.max(0, Math.round(x * scale)), Y = Math.max(0, Math.round(y * scale));
  const Wd = Math.min(ctx.canvas.width - X, Math.round(w * scale));
  const Hd = Math.min(ctx.canvas.height - Y, Math.round(h * scale));
  if (Wd <= 0 || Hd <= 0) return;
  const img = ctx.getImageData(X, Y, Wd, Hd);
  let a = Float32Array.from(img.data), b = new Float32Array(a.length);
  for (const box of boxesForGauss(sigma * scale)) {
    const r = (box - 1) / 2;
    boxBlur(a, b, Wd, Hd, r, true);
    boxBlur(b, a, Wd, Hd, r, false);
  }
  img.data.set(a);
  ctx.putImageData(img, X, Y);
}

/**
 * @param o { land, items:[{feature,correct}], answers, title, sub, url, scale,
 *            blur: true -> map and family names are blurred (no spoilers) }
 * @returns Promise<Blob> PNG, 1200 x 1600 (x scale)
 */
export async function resultsPng(o) {
  await Promise.all([
    document.fonts.load(`700 40px ${FONT}`),
    document.fonts.load(`400 20px ${FONT}`),
  ]);
  const W = 1200, H = 1600, pad = 56;            // 3:4
  const s = o.scale ?? 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * s; canvas.height = H * s;
  const ctx = canvas.getContext("2d");
  ctx.scale(s, s);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

  // --- header: green bar / FamilyMapper / blue bar
  const hb = brandHeader(ctx, W, pad, o.title, o.headerRight);
  ctx.font = `400 24px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(o.sub, pad, hb + 48);

  // --- score block -------------------------------
  const score = o.answers.filter((a) => a.correct).length;
  const n = o.answers.length;
  const sy = hb + 78, sh = 170;
  ctx.fillStyle = C.panel;
  ctx.fillRect(pad, sy, W - 2 * pad, sh);
  ctx.font = `700 120px ${FONT}`;
  ctx.fillStyle = C.ink;
  ctx.fillText(String(score), pad + 36, sy + 128);
  const scW = ctx.measureText(String(score)).width;
  ctx.font = `700 48px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(`/${n}`, pad + 40 + scW, sy + 128);
  // one square per round
  const sq = 44, gap = 10, rowW = n * sq + (n - 1) * gap;
  const qx = W - pad - 36 - rowW, qy = sy + (sh - sq) / 2 + 12;
  ctx.font = `400 20px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.fillText("families mapped correctly", qx, qy - 16);
  o.answers.forEach((a, i) => {
    ctx.fillStyle = a.correct ? C.green : C.red;
    ctx.fillRect(qx + i * (sq + gap), qy, sq, sq);
  });

  // --- map ---------------------------------------
  const mx = pad, my = sy + sh + 32, mapW = W - 2 * pad, mapH = Math.round(mapW / 2);
  ctx.save();
  ctx.beginPath(); ctx.rect(mx, my, mapW, mapH);
  ctx.fillStyle = C.ocean; ctx.fill(); ctx.clip();
  ctx.translate(mx, my);
  const path = geoPath(resultsProjection(mapW, mapH), ctx);
  ctx.beginPath(); path(o.land); ctx.fillStyle = C.land; ctx.fill();
  for (const it of [...o.items].sort((a, b) => a.correct - b.correct)) {
    const col = it.correct ? C.green : C.red;
    ctx.beginPath(); path(it.feature);
    ctx.fillStyle = col; ctx.fill();
    const [[x0, y0], [x1, y1]] = path.bounds(it.feature);
    if (Math.max(x1 - x0, y1 - y0) < 14) {
      ctx.beginPath(); ctx.arc((x0 + x1) / 2, (y0 + y1) / 2, 12, 0, 2 * Math.PI);
      ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.stroke();
    }
  }
  ctx.restore();
  if (o.blur) blurRect(ctx, s, mx, my, mapW, mapH, 11);

  // --- list: two columns -------------------------
  const rows = Math.ceil(n / 2), listTop = my + mapH + 44;
  const rowH = Math.min(110, (H - pad - 66 - listTop) / rows);  // fill the space above the footer
  const colW = (W - 2 * pad - 40) / 2;
  o.answers.forEach((a, i) => {
    const col = Math.floor(i / rows), row = i % rows;
    const x = pad + col * (colW + 40), y = listTop + row * rowH;
    badge(ctx, x + 20, y + 22, 20, a.correct);
    // 40px, shrinking for very long names (down to 28px) instead of cutting them off
    const label = `${i + 1}. ${a.name}`;
    let size = 40;
    do { ctx.font = `700 ${size}px ${FONT}`; } while (ctx.measureText(label).width > colW - 58 && --size > 28);
    ctx.fillStyle = C.ink;
    ctx.fillText(fitText(ctx, label, colW - 58), x + 56, y + 37);
    if (!a.correct) {
      ctx.font = `400 24px ${FONT}`;
      ctx.fillStyle = C.muted;
      ctx.fillText(fitText(ctx, `you said ${a.chosen}`, colW - 58), x + 56, y + 70);
    }
  });
  if (o.blur) {
    // names only - the ✓/✗ badges to the left stay sharp
    for (let col = 0; col < 2; col++) {
      const x = pad + col * (colW + 40) + 50;
      blurRect(ctx, s, x, listTop - 6, colW - 50, rows * rowH + 6, 15);
    }
  }

  // --- footer: link + data credit (no bars)
  ctx.fillStyle = C.line; ctx.fillRect(pad, H - pad - 44, W - 2 * pad, 2);
  if (o.url) {
    ctx.font = `700 40px ${FONT}`;
    ctx.fillStyle = C.blue;
    ctx.fillText(o.url, pad, H - pad + 10);
  }
  ctx.font = `400 17px ${FONT}`;
  ctx.fillStyle = C.muted;
  ctx.textAlign = "right";
  ctx.fillText("Data: Glottography (CC-BY 4.0) · Glottolog · Natural Earth", W - pad, H - pad + 2);
  ctx.textAlign = "left";

  return new Promise((res) => canvas.toBlob(res, "image/png"));
}
