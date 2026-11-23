// Shared helpers for sampled curves (polar, parametric): range parsing and discontinuity-aware splitting.
import { evaluate } from "../engine.js";

export const MAX_POINTS = 20000;

/** Default ranges per angle unit. step is the sampling interval. */
export function defaultRange(kind, angle) {
  const deg = angle === "deg";
  if (kind === "polar" || kind === "param") return deg ? { min: 0, max: 360, step: 3 } : { min: 0, max: 2 * Math.PI, step: Math.PI / 60 };
  return { min: 0, max: 0, step: 1 };
}

/**
 * Resolve {min,max,step} text fields (expressions allowed, e.g. "2π", "pi/60"). Empty fields use the defaults.
 * Returns {min, max, step, error?}.
 */
export function resolveRange(fields, kind, angle, vars = {}) {
  const d = defaultRange(kind, angle);
  const out = { ...d };
  for (const [k, label] of [["min", "min"], ["max", "max"], ["step", "step"]]) {
    const text = fields && fields[k];
    if (text === undefined || String(text).trim() === "") continue;
    try {
      const v = evaluate(String(text), { angle, vars });
      if (typeof v !== "number") return { ...out, error: `${label} must be a real number` };
      out[k] = v;
    } catch (e) { return { ...out, error: `${label}: ${e.message}` }; }
  }
  if (!(out.max > out.min)) return { ...out, error: "max must be greater than min" };
  if (!(out.step > 0)) return { ...out, error: "step must be greater than 0" };
  return out;
}

/** Parameter values min, min+step, …, max (max always included). Returns {values, capped}. */
export function parameterValues(min, max, step, limit = MAX_POINTS) {
  let n = Math.floor((max - min) / step + 1e-9) + 1;
  let capped = false;
  if (n > limit) { n = limit; step = (max - min) / (limit - 1); capped = true; }
  const values = new Array(n);
  for (let i = 0; i < n; i++) values[i] = min + i * step;
  if (!capped && values[n - 1] < max - step * 1e-6) values.push(max);
  else if (!capped) values[n - 1] = Math.min(values[n - 1], max);
  return { values, capped };
}

/**
 * Split sampled points into continuous polylines (arrays of point indices).
 * A new polyline starts at a non-finite point, at a point beyond ±limit, or where successive points are further
 * apart than maxJump (a pole / asymptote jump).
 */
export function splitCurve(xs, ys, maxJump = Infinity, limit = 1e9) {
  const out = [];
  let cur = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > limit || Math.abs(y) > limit) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    if (cur.length) {
      const j = cur[cur.length - 1];
      if (Math.hypot(x - xs[j], y - ys[j]) > maxJump) { out.push(cur); cur = []; }
    }
    cur.push(i);
  }
  if (cur.length) out.push(cur);
  return out;
}
