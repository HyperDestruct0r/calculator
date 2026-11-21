// Numerical tools for the graph screen: roots, extrema, intersections, derivative, integral.
export { numIntegrate as integral, numDerivative as derivative } from "./engine.js";

const fin = Number.isFinite;

function bisect(f, a, b, fa, fb) {
  // Brent-style: bisection with secant acceleration, robust and simple.
  let lo = a, hi = b, flo = fa, fhi = fb;
  for (let i = 0; i < 200; i++) {
    let m = (lo + hi) / 2;
    if (i % 2 === 0 && fhi !== flo) { // regula falsi step, kept inside the bracket
      const s = hi - fhi * (hi - lo) / (fhi - flo);
      if (s > Math.min(lo, hi) && s < Math.max(lo, hi)) m = s;
    }
    const fm = f(m);
    if (!fin(fm)) return NaN;
    if (fm === 0) return m;
    if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else { hi = m; fhi = fm; }
    if (Math.abs(hi - lo) < 1e-14 * Math.max(1, Math.abs(lo))) break;
  }
  return (lo + hi) / 2;
}

function golden(f, a, b) { // minimise f on [a,b]
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < 120; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
    if (Math.abs(b - a) < 1e-13 * Math.max(1, Math.abs(a))) break;
  }
  return (a + b) / 2;
}

function sample(f, a, b, n) {
  const xs = new Array(n + 1), ys = new Array(n + 1);
  for (let i = 0; i <= n; i++) { xs[i] = a + (b - a) * (i / n); ys[i] = f(xs[i]); }
  return { xs, ys };
}

function dedupe(points, tol) {
  const out = [];
  for (const p of points.sort((a, b) => a.x - b.x)) {
    if (!out.length || Math.abs(p.x - out[out.length - 1].x) > tol) out.push(p);
  }
  return out;
}

/** All zeros of f on [a,b]: sign changes plus touching (even-multiplicity) roots. */
export function findZeros(f, a, b, n = 3000) {
  const { xs, ys } = sample(f, a, b, n);
  const scale = Math.max(1e-12, ...ys.filter(fin).map(Math.abs).slice(0, 400)) ;
  const res = [];
  for (let i = 0; i < n; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    if (!fin(y0) || !fin(y1)) continue;
    if (y0 === 0) { res.push({ x: xs[i], y: 0 }); continue; }
    if ((y0 < 0) !== (y1 < 0) && y1 !== 0) {
      const r = bisect(f, xs[i], xs[i + 1], y0, y1);
      const fr = f(r);
      // reject poles (sign flips through infinity)
      if (fin(r) && fin(fr) && Math.abs(fr) < 1e-6 * Math.max(1, Math.abs(y0), Math.abs(y1), scale * 1e-3)) res.push({ x: r, y: 0 });
    } else if (i > 0 && fin(ys[i - 1])) {
      // local minimum of |f| that nearly touches zero (e.g. x^2)
      const a0 = Math.abs(ys[i - 1]), a1 = Math.abs(y0), a2 = Math.abs(y1);
      if (a1 < a0 && a1 <= a2 && a1 < 1e-2 * Math.max(a0, a2, 1e-12)) {
        const r = golden((t) => Math.abs(f(t)), xs[i - 1], xs[i + 1]);
        if (Math.abs(f(r)) < 1e-9 * Math.max(1, scale)) res.push({ x: r, y: 0 });
      }
    }
  }
  if (fin(ys[n]) && ys[n] === 0) res.push({ x: xs[n], y: 0 });
  return dedupe(res, (b - a) * 1e-6);
}

/** Local minima (kind="min") or maxima (kind="max") of f on [a,b]. */
export function findExtrema(f, a, b, kind = "min", n = 3000) {
  const sgn = kind === "min" ? 1 : -1;
  const h = (t) => sgn * f(t);
  const { xs, ys } = sample(f, a, b, n);
  const res = [];
  for (let i = 1; i < n; i++) {
    const y0 = sgn * ys[i - 1], y1 = sgn * ys[i], y2 = sgn * ys[i + 1];
    if (!fin(y0) || !fin(y1) || !fin(y2)) continue;
    if (y1 < y0 && y1 <= y2) {
      const x = golden(h, xs[i - 1], xs[i + 1]);
      const y = f(x);
      if (fin(y)) res.push({ x: Math.abs(x) < 1e-9 ? 0 : x, y: Math.abs(x) < 1e-9 ? f(0) : y });
    }
  }
  return dedupe(res, (b - a) * 1e-6);
}

/** Intersections of f and g on [a,b]. */
export function findIntersections(f, g, a, b, n = 3000) {
  return findZeros((t) => f(t) - g(t), a, b, n).map((p) => ({ x: p.x, y: f(p.x) })).filter((p) => fin(p.y));
}

/** Auto-fit y range for a list of functions across [a,b]. */
export function fitY(fns, a, b, n = 600) {
  const vals = [];
  for (const f of fns) for (let i = 0; i <= n; i++) { const y = f(a + (b - a) * i / n); if (fin(y)) vals.push(y); }
  if (!vals.length) return null;
  vals.sort((p, q) => p - q);
  const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.ceil(vals.length * 0.98) - 1];
  const pad = (hi - lo || 2) * 0.12;
  return { yMin: lo - pad, yMax: hi + pad };
}
