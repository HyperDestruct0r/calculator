// Real-number helpers shared by the engine, the complex module and the graph types.
// Pure functions only (no DOM), so everything here can be tested under Node.

export const PI = Math.PI;
export const EPS = 2.220446049250313e-16;
export const isInt = Number.isInteger;

/**
 * a + b with cancellation detection. When the sum is smaller than the rounding error of the
 * operands (|a+b| <= 4ε·max(|a|,|b|)) the result is indistinguishable from zero, so return an exact 0.
 * This turns 0.1+0.2-0.3 into 0 without touching legitimately small results such as 1e-20 + 3e-20.
 */
export function addSnap(a, b) {
  const r = a + b;
  if (r !== 0 && Number.isFinite(r)) {
    const m = Math.max(Math.abs(a), Math.abs(b));
    if (Math.abs(r) <= 4 * EPS * m) return 0;
  }
  return r;
}

export function toFractionParts(x, maxDen = 10000, tol = 1e-11) {
  if (!Number.isFinite(x) || Math.abs(x) > 1e9) return null;
  if (Number.isInteger(x)) return { p: x, q: 1 };
  const sign = x < 0 ? -1 : 1, a = Math.abs(x);
  const eps = tol * Math.max(1, a);
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = a;
  for (let i = 0; i < 40; i++) {
    const ai = Math.floor(b);
    const h2 = ai * h1 + h0, k2 = ai * k1 + k0;
    if (k2 > maxDen) return null;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (Math.abs(a - h1 / k1) < eps) return { p: sign * h1, q: k1 };
    const frac = b - ai;
    if (frac < 1e-15) break;
    b = 1 / frac;
  }
  return null;
}

// ---------- gamma / factorial ----------
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function gamma(z) {
  if (Number.isInteger(z)) { if (z <= 0) return NaN; if (z <= 171) return fact(z - 1); return Infinity; }
  if (z < 0.5) return PI / (Math.sin(PI * z) * gamma(1 - z));
  z -= 1;
  const g = 7;
  let a = LANCZOS[0];
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += LANCZOS[i] / (z + i);
  return Math.sqrt(2 * PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
}
export function fact(n) {
  if (Number.isInteger(n)) {
    if (n < 0) return NaN;
    if (n > 170) return Infinity;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }
  const r = gamma(n + 1);
  return Number.isFinite(r) ? r : NaN;
}

// ---------- combinatorics / number theory ----------
export function nPr(n, r) {
  if (!isInt(n) || !isInt(r) || n < 0 || r < 0 || r > n) return NaN;
  let v = 1; for (let i = 0; i < r; i++) v *= (n - i); return v;
}
export function nCr(n, r) {
  if (!isInt(n) || !isInt(r) || n < 0 || r < 0 || r > n) return NaN;
  r = Math.min(r, n - r);
  let v = 1; for (let i = 1; i <= r; i++) v = v * (n - r + i) / i;
  return Math.round(v);
}
export function gcd(a, b) {
  if (!isInt(a) || !isInt(b)) return NaN;
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
export function lcm(a, b) {
  if (!isInt(a) || !isInt(b)) return NaN;
  if (a === 0 || b === 0) return 0;
  return Math.abs(a / gcd(a, b) * b);
}
/** Fibonacci with fib(0)=0, fib(1)=1 (exact through the double-precision range via BigInt). */
export function fib(n) {
  if (!isInt(n) || n < 0) return NaN;
  if (n > 1476) return Infinity;
  let a = 0n, b = 1n;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return Number(a);
}
export function catalan(n) {
  if (!isInt(n) || n < 0) return NaN;
  if (n > 500) return Infinity;
  let c = 1n;
  for (let i = 0; i < n; i++) c = (c * BigInt(2 * (2 * i + 1))) / BigInt(i + 2);
  return Number(c);
}

// ---------- rounding / remainders ----------
export function roundHalfAway(x, n = 0) {
  if (!Number.isFinite(x)) return x;
  const f = Math.pow(10, n), s = x < 0 ? -1 : 1;
  const v = Math.abs(x) * f;
  const r = Math.round(Number(v.toPrecision(15)));
  return s * r / f;
}
/** Floored modulo: result has the sign of b (mathematical mod). */
export function modulo(a, b) { return b === 0 ? NaN : a - b * Math.floor(a / b); }
/** Truncated remainder: result has the sign of a (like JS %, C fmod). */
export function rem(a, b) { return b === 0 ? NaN : a % b; }

// ---------- trigonometry ----------
/**
 * Angle-aware trig that returns exact values at multiples of a quarter turn.
 * The tolerance is relative to the multiple r (not to 1), so a genuinely tiny argument
 * such as 1e-16 is NOT mistaken for 0.
 */
export function trigSet(angle) {
  const deg = angle === "deg";
  const quarter = deg ? 90 : PI / 2;
  const k = deg ? PI / 180 : 1;
  const quad = (x) => {
    if (x === 0) return 0;
    const q = x / quarter, r = Math.round(q);
    if (r !== 0 && Math.abs(q - r) <= 1e-14 * Math.abs(r)) return ((r % 4) + 4) % 4;
    return -1;
  };
  const out = (r) => deg ? (r / PI) * 180 : r;
  const clean = (v) => (Number.isFinite(v) ? Number(v.toPrecision(15)) : v);
  return {
    sin: (x) => { const m = quad(x); return m >= 0 ? [0, 1, 0, -1][m] : clean(Math.sin(x * k)); },
    cos: (x) => { const m = quad(x); return m >= 0 ? [1, 0, -1, 0][m] : clean(Math.cos(x * k)); },
    tan: (x) => { const m = quad(x); return m >= 0 ? (m % 2 === 0 ? 0 : NaN) : clean(Math.tan(x * k)); },
    asin: (x) => (x > 1 || x < -1) ? NaN : clean(out(Math.asin(x))),
    acos: (x) => (x > 1 || x < -1) ? NaN : clean(out(Math.acos(x))),
    atan: (x) => clean(out(Math.atan(x))),
    atan2: (y, x) => clean(out(Math.atan2(y, x))),
    toRad: (x) => x * k,
    fromRad: out,
  };
}
const radTrig = trigSet("rad");
export const sinR = radTrig.sin, cosR = radTrig.cos;

// ---------- powers ----------
/** Real power. Negative base with an odd-denominator rational exponent gives the real root (−8)^(1/3) = −2. */
export function powReal(a, b) {
  if (a < 0 && !Number.isInteger(b)) {
    const f = toFractionParts(b, 999, 1e-12);
    if (f && f.q % 2 === 1) { const r = Math.pow(-a, b); return f.p % 2 === 0 ? r : -r; }
    return NaN;
  }
  return Math.pow(a, b);
}
