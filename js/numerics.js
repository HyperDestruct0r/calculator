// Numerical tools: differentiation, integration, root finding, extrema, intersections.
// Pure functions of plain JS callbacks f(x) -> number; no engine or DOM dependency.

const fin = Number.isFinite;

// =====================================================================================
// Differentiation — Ridders' extrapolation, with an error estimate and corner detection
// =====================================================================================
/**
 * derivativeEx(f, a) -> { value, err, ok, reason }
 * ok=false (and value=NaN) when f is undefined near a, has a corner/cusp at a, or the estimate does not converge.
 */
export function derivativeEx(f, a) {
  if (!fin(a)) return { value: NaN, err: Infinity, ok: false, reason: "undefined" };
  const f0 = f(a);
  if (!fin(f0)) return { value: NaN, err: Infinity, ok: false, reason: "undefined" };
  // Ridders' extrapolation from several starting step sizes (a relative one for slowly varying functions,
  // absolute ones for functions that oscillate on a unit scale even far from the origin).
  const starts = [0.02 * Math.max(1, Math.abs(a)), 0.1, 0.002];
  let best = null;
  for (const h0 of starts) {
    const r = ridders(f, a, h0);
    if (!r) continue;
    if (!best || r.err < best.err) best = r;
    if (r.err <= 1e-9 * Math.max(1, Math.abs(r.value))) break;
  }
  if (!best) return { value: NaN, err: Infinity, ok: false, reason: "undefined" };
  // Corner / cusp test. Second-order one-sided slopes sR(h), sL(h) both converge to f'(a) with an O(h^2) error, so
  // their difference shrinks rapidly as h is halved; at a corner the difference stays constant (or grows).
  const slopes = (h) => [(-3 * f0 + 4 * f(a + h) - f(a + 2 * h)) / (2 * h), (3 * f0 - 4 * f(a - h) + f(a - 2 * h)) / (2 * h)];
  let hs = Math.min(1e-5 * Math.max(1, Math.abs(a)), 1e-4), sR, sL;
  if (a !== 0 && Math.abs(a) < 1) hs = Math.min(hs, Math.abs(a) / 50); // stay small relative to a near a domain edge
  for (let k = 0; k < 25; k++, hs /= 2) { [sR, sL] = slopes(hs); if (fin(sR) && fin(sL)) break; }
  if (!fin(sR) || !fin(sL)) return { value: NaN, err: Infinity, ok: false, reason: "undefined" };
  const [sR2, sL2] = slopes(hs / 2);
  const d1 = Math.abs(sR - sL), d2 = Math.abs(sR2 - sL2);
  const small = 1e-9 * (1 + Math.abs(sR) + Math.abs(sL));
  if (!fin(sR2) || !fin(sL2) || (d1 > small && d2 > 0.5 * d1)) return { value: NaN, err: Infinity, ok: false, reason: "corner" };
  if (best.err > 1e-6 * Math.max(1, Math.abs(best.value))) return { value: NaN, err: best.err, ok: false, reason: "irregular" };
  return { value: best.value, err: best.err, ok: true };
}
function ridders(f, a, h) {
  const CON = 1.4, CON2 = CON * CON, NTAB = 12, SAFE = 2;
  const T = Array.from({ length: NTAB }, () => new Array(NTAB).fill(0));
  const dd = (hh) => (f(a + hh) - f(a - hh)) / (2 * hh);
  T[0][0] = dd(h);
  for (let k = 0; k < 14 && !fin(T[0][0]); k++) { h /= 4; T[0][0] = dd(h); } // stay inside the domain of f
  if (!fin(T[0][0])) return null;
  let best = T[0][0], err = Infinity;
  for (let i = 1; i < NTAB; i++) {
    h /= CON;
    T[0][i] = dd(h);
    if (!fin(T[0][i])) break;
    let fac = CON2;
    for (let j = 1; j <= i; j++) {
      T[j][i] = (T[j - 1][i] * fac - T[j - 1][i - 1]) / (fac - 1);
      fac *= CON2;
      const errt = Math.max(Math.abs(T[j][i] - T[j - 1][i]), Math.abs(T[j][i] - T[j - 1][i - 1]));
      if (errt <= err) { err = errt; best = T[j][i]; }
    }
    if (Math.abs(T[i][i] - T[i - 1][i - 1]) >= SAFE * err) break;
  }
  return { value: best, err };
}
/** Derivative value, or NaN when it does not exist / cannot be estimated reliably. */
export function derivative(f, a) { return derivativeEx(f, a).value; }

// =====================================================================================
// Integration — globally adaptive Gauss–Kronrod (G7, K15), QUADPACK style
// =====================================================================================
const XGK = [0.991455371120812639206854697526329, 0.949107912342758524526189684047851, 0.864864423359769072789712788640926,
  0.741531185599394439863864773280788, 0.586087235467691130294144838258730, 0.405845151377397166906606412076961,
  0.207784955007898467600689403773245, 0];
const WGK = [0.022935322010529224963732008058970, 0.063092092629978553290700663189204, 0.104790010322250183839876322541518,
  0.140653259715525918745189590510238, 0.169004726639267902826583426598550, 0.190350578064785409913256402421014,
  0.204432940075298892414161999234649, 0.209482141084727828012999174891714];
const WG = [0.129484966168869693270611432679082, 0.279705391489276667901467771423780, 0.381830050505118944950369775488975,
  0.417959183673469387755102040816327];

function gk15(f, a, b) {
  const c = (a + b) / 2, h = (b - a) / 2;
  const fc = f(c);
  let resK = fc * WGK[7], resG = fc * WG[3];
  let bad = !fin(fc);
  for (let j = 0; j < 7; j++) {
    const dx = h * XGK[j];
    const f1 = f(c - dx), f2 = f(c + dx);
    if (!fin(f1) || !fin(f2)) bad = true;
    resK += WGK[j] * (f1 + f2);
    if (j % 2 === 1) resG += WG[(j - 1) / 2] * (f1 + f2);
  }
  return { val: resK * h, err: Math.abs((resK - resG) * h), bad };
}

/**
 * integrateEx(f, a, b, {relTol, absTol, maxIntervals}) -> { value, err, ok, reason }
 * reason: "undefined" (f not finite somewhere), "noconverge" (singularity / too oscillatory).
 */
export function integrateEx(f, a, b, { relTol = 1e-10, absTol = 1e-13, maxIntervals = 600 } = {}) {
  if (!fin(a) || !fin(b)) return { value: NaN, err: Infinity, ok: false, reason: "bounds" };
  if (a === b) return { value: 0, err: 0, ok: true };
  let sign = 1;
  if (b < a) { [a, b] = [b, a]; sign = -1; }
  // start from 8 panels so oscillatory integrands are seen before the error control runs
  const N0 = 8, w = (b - a) / N0;
  let ivs = [];
  for (let k = 0; k < N0; k++) {
    const lo = a + k * w, hi = k === N0 - 1 ? b : lo + w;
    const r = gk15(f, lo, hi);
    if (r.bad) return { value: NaN, err: Infinity, ok: false, reason: "undefined" };
    ivs.push({ a: lo, b: hi, ...r });
  }
  let total = 0, errSum = 0;
  const sums = () => { total = 0; errSum = 0; for (const v of ivs) { total += v.val; errSum += v.err; } };
  sums();
  let guard = 0;
  while (errSum > Math.max(absTol, relTol * Math.abs(total)) && ivs.length < maxIntervals && guard++ < 5000) {
    let k = 0;
    for (let q = 1; q < ivs.length; q++) if (ivs[q].err > ivs[k].err) k = q;
    const v = ivs[k], m = (v.a + v.b) / 2;
    if (m <= v.a || m >= v.b) break; // interval cannot be split any further
    const L = gk15(f, v.a, m), R = gk15(f, m, v.b);
    if (L.bad || R.bad) return { value: NaN, err: Infinity, ok: false, reason: "undefined" };
    ivs.splice(k, 1, { a: v.a, b: m, ...L }, { a: m, b: v.b, ...R });
    sums();
  }
  const ok = errSum <= Math.max(absTol, relTol * Math.abs(total)) * 10; // allow a small slack before declaring failure
  return { value: sign * total, err: errSum, ok, reason: ok ? undefined : "noconverge" };
}
/** Integral value, or NaN if the integrand is undefined / the integral does not converge. */
export function integral(f, a, b) { const r = integrateEx(f, a, b); return r.ok ? r.value : NaN; }

// =====================================================================================
// Root finding
// =====================================================================================
/** Brent's method on a bracketing interval [a,b] (f(a), f(b) of opposite sign). Returns NaN if f becomes undefined. */
export function brent(f, a, b, fa = f(a), fb = f(b), tol = 1e-15) {
  if (!fin(fa) || !fin(fb)) return NaN;
  if (fa === 0) return a;
  if (fb === 0) return b;
  if ((fa < 0) === (fb < 0)) return NaN;
  let c = a, fc = fa, d = b - a, e = d;
  for (let i = 0; i < 300; i++) {
    if ((fb > 0) === (fc > 0)) { c = a; fc = fa; d = b - a; e = d; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol * Math.max(1, Math.abs(b)) * 1e-0;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) return b;
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      let p, q, r;
      const s = fb / fa;
      if (a === c) { p = 2 * xm * s; q = 1 - s; }
      else { q = fa / fc; r = fb / fc; p = s * (2 * xm * q * (q - r) - (b - a) * (r - 1)); q = (q - 1) * (r - 1) * (s - 1); }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) { e = d; d = p / q; }
      else { d = xm; e = d; }
    } else { d = xm; e = d; }
    a = b; fa = fb;
    b += Math.abs(d) > tol1 ? d : (xm > 0 ? tol1 : -tol1);
    fb = f(b);
    if (!fin(fb)) return NaN;
  }
  return b;
}

/**
 * Find a root of f near `guess` (Newton with numerical derivative, then expanding bracket search + Brent).
 * Returns { x, ok, method, residual }.
 */
export function findRootNear(f, guess, { lo = -Infinity, hi = Infinity, tol = 1e-12 } = {}) {
  const f0 = f(guess);
  const accept = (x, method) => {
    const r = f(x);
    const scale = Math.max(1, Math.abs(f0) * 1e-6);
    const ok = fin(r) && Math.abs(r) <= 1e-9 * scale + 1e-12 && x >= lo && x <= hi;
    return { x, ok, method, residual: r };
  };
  // 1) Newton
  let x = guess;
  for (let i = 0; i < 80; i++) {
    const fx = f(x);
    if (!fin(fx)) break;
    if (fx === 0) return accept(x, "newton");
    const d = derivativeEx(f, x);
    const dv = fin(d.value) ? d.value : (f(x + 1e-7 * Math.max(1, Math.abs(x))) - fx) / (1e-7 * Math.max(1, Math.abs(x)));
    if (!fin(dv) || dv === 0) break;
    let nx = x - fx / dv;
    if (!fin(nx)) break;
    if (Math.abs(nx - x) <= tol * Math.max(1, Math.abs(nx))) { const r = accept(nx, "newton"); if (r.ok) return r; break; }
    x = nx;
  }
  // 2) expanding bracket around the guess, then Brent
  let step = 0.05 * Math.max(1, Math.abs(guess));
  for (let k = 0; k < 60; k++, step *= 1.6) {
    const pts = [guess - step, guess + step];
    for (const p of pts) {
      if (p < lo || p > hi) continue;
      const fp = f(p);
      if (fin(fp) && fin(f0) && (fp < 0) !== (f0 < 0)) {
        const lo2 = Math.min(p, guess), hi2 = Math.max(p, guess);
        const r = brent(f, lo2, hi2);
        if (fin(r)) return accept(r, "bracket");
      }
    }
    // also try a sampled scan inside [guess-step, guess+step] for a sign change
    const n = 40, a = Math.max(lo, guess - step), b = Math.min(hi, guess + step);
    let px = a, py = f(a);
    for (let q = 1; q <= n; q++) {
      const qx = a + (b - a) * q / n, qy = f(qx);
      if (fin(py) && fin(qy) && py !== qy && (py < 0) !== (qy < 0)) {
        const r = brent(f, px, qx);
        if (fin(r)) return accept(r, "bracket");
      }
      px = qx; py = qy;
    }
  }
  return { x: NaN, ok: false, method: "none", residual: NaN };
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

/** If x is within rounding distance of 0 and f(0) is exactly 0, report exactly 0 (no 1e-17 noise). */
function snapZero(f, x, a, b) {
  return Math.abs(x) < 1e-9 * (b - a) && f(0) === 0 ? 0 : x;
}

/** All zeros of f on [a,b]: sign changes plus touching (even-multiplicity) roots. */
export function findZeros(f, a, b, n = 3000) {
  const { xs, ys } = sample(f, a, b, n);
  const scale = Math.max(1e-12, ...ys.filter(fin).map(Math.abs).slice(0, 400));
  const res = [];
  for (let i = 0; i < n; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    if (!fin(y0) || !fin(y1)) continue;
    if (y0 === 0) { res.push({ x: xs[i], y: 0 }); continue; }
    if ((y0 < 0) !== (y1 < 0) && y1 !== 0) {
      const r = brent(f, xs[i], xs[i + 1], y0, y1);
      const fr = f(r);
      // reject poles (sign flips through infinity)
      if (fin(r) && fin(fr) && Math.abs(fr) < 1e-6 * Math.max(1, Math.abs(y0), Math.abs(y1), scale * 1e-3)) res.push({ x: snapZero(f, r, a, b), y: 0 });
    } else if (i > 0 && fin(ys[i - 1])) {
      // local minimum of |f| that nearly touches zero (e.g. x^2)
      const a0 = Math.abs(ys[i - 1]), a1 = Math.abs(y0), a2 = Math.abs(y1);
      if (a1 < a0 && a1 <= a2 && a1 < 1e-2 * Math.max(a0, a2, 1e-12)) {
        const r = golden((t) => Math.abs(f(t)), xs[i - 1], xs[i + 1]);
        if (Math.abs(f(r)) < 1e-9 * Math.max(1, scale)) res.push({ x: snapZero(f, r, a, b), y: 0 });
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
