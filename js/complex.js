// Dedicated complex-number type and arithmetic. No parsing, no DOM.
// A Complex is an immutable {re, im} pair of finite-or-infinite doubles.
// Principal branches are used throughout (the same formulas as most CAS / handheld calculators):
//   ln z = ln|z| + i·arg z,  arg z ∈ (−π, π],  sqrt z = exp(½ ln z), asin z = −i ln(iz + √(1−z²)), …
import { EPS, PI, sinR, cosR, addSnap } from "./realmath.js";

export class Complex {
  constructor(re, im = 0) { this.re = re; this.im = im; }
  static of(v) { return v instanceof Complex ? v : new Complex(v, 0); }
}
export const isComplex = (v) => v instanceof Complex;
export const C = (re, im = 0) => new Complex(re, im);
export const I = new Complex(0, 1);
export const toC = Complex.of;

/** Turn a Complex with an exactly-zero imaginary part back into a plain number. */
export function norm(z) {
  if (!(z instanceof Complex)) return z;
  return z.im === 0 ? z.re + 0 : z; // "+ 0" turns -0 into 0
}
/** Revive {re, im} plain objects (from JSON storage). Returns null if v is not a complex-like object. */
export function reviveComplex(v) {
  if (v && typeof v === "object" && !Array.isArray(v) && Number.isFinite(v.re) && Number.isFinite(v.im)) return norm(new Complex(v.re, v.im));
  return null;
}
export const isFiniteC = (z) => Number.isFinite(z.re) && Number.isFinite(z.im);
export const isNaNC = (z) => Number.isNaN(z.re) || Number.isNaN(z.im);

// ---------- basic arithmetic ----------
export function add(a, b) { a = toC(a); b = toC(b); return new Complex(addSnap(a.re, b.re), addSnap(a.im, b.im)); }
export function sub(a, b) { a = toC(a); b = toC(b); return new Complex(addSnap(a.re, -b.re), addSnap(a.im, -b.im)); }
export function neg(a) { a = toC(a); return new Complex(-a.re, -a.im); }
export function conj(a) { a = toC(a); return new Complex(a.re, -a.im); }
export function mul(a, b) {
  a = toC(a); b = toC(b);
  return new Complex(addSnap(a.re * b.re, -(a.im * b.im)), addSnap(a.re * b.im, a.im * b.re));
}
/** Division by Smith's algorithm (avoids overflow/underflow in the intermediate |b|²). */
export function div(a, b) {
  a = toC(a); b = toC(b);
  if (b.im === 0) return new Complex(a.re / b.re, a.im / b.re);
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const r = b.im / b.re, d = b.re + b.im * r;
    return new Complex(addSnap(a.re, a.im * r) / d, addSnap(a.im, -a.re * r) / d);
  }
  const r = b.re / b.im, d = b.re * r + b.im;
  return new Complex(addSnap(a.re * r, a.im) / d, addSnap(a.im * r, -a.re) / d);
}
export const abs = (a) => { a = toC(a); return Math.hypot(a.re, a.im); };
/** Principal argument in radians, (−π, π]. */
export const arg = (a) => { a = toC(a); return Math.atan2(a.im, a.re); };
export const isZero = (a) => { a = toC(a); return a.re === 0 && a.im === 0; };
export const eq = (a, b) => { a = toC(a); b = toC(b); return a.re === b.re && a.im === b.im; };

/** r(cos θ + i sin θ) with θ in radians. */
export function fromPolar(r, theta) { return new Complex(r * cosR(theta), r * sinR(theta)); }

// ---------- exp / log / powers ----------
export function exp(z) {
  z = toC(z);
  const m = Math.exp(z.re);
  if (z.im === 0) return new Complex(m, 0);
  return new Complex(m * cosR(z.im), m * sinR(z.im));
}
export function ln(z) {
  z = toC(z);
  return new Complex(Math.log(abs(z)), arg(z));
}
export function sqrt(z) {
  z = toC(z);
  if (z.im === 0) return z.re >= 0 ? new Complex(Math.sqrt(z.re), 0) : new Complex(0, Math.sqrt(-z.re));
  const m = abs(z), t = Math.sqrt((m + Math.abs(z.re)) / 2);
  if (z.re >= 0) return new Complex(t, z.im / (2 * t));
  return new Complex(Math.abs(z.im) / (2 * t), Math.sign(z.im) * t);
}
/** Integer power by repeated squaring (exact for small Gaussian integers: i^2 = −1, (1+i)^2 = 2i). */
export function powInt(z, n) {
  z = toC(z);
  if (n < 0) return div(new Complex(1, 0), powInt(z, -n));
  let result = new Complex(1, 0), base = z;
  while (n > 0) {
    if (n & 1) result = mul(result, base);
    n = Math.floor(n / 2);
    if (n) base = mul(base, base);
  }
  return result;
}
/** z^w. Throws RangeError("zero-power") for 0 to a non-positive-real power (callers map it to a message). */
export function pow(z, w) {
  z = toC(z); w = toC(w);
  if (w.im === 0 && Number.isInteger(w.re) && Math.abs(w.re) <= 1024) {
    if (isZero(z) && w.re < 0) throw new RangeError("zero-power");
    return powInt(z, w.re);
  }
  if (isZero(z)) {
    if (w.re > 0) return new Complex(0, 0);
    throw new RangeError("zero-power");
  }
  return exp(mul(w, ln(z)));
}
/** All n principal n-th roots of z, starting with the principal root. */
export function nthRoots(z, n) {
  z = toC(z);
  if (!Number.isInteger(n) || n < 1) throw new RangeError("root-order");
  if (isZero(z)) return Array.from({ length: n }, () => new Complex(0, 0));
  const r = Math.pow(abs(z), 1 / n), t = arg(z);
  return Array.from({ length: n }, (_, k) => fromPolar(r, (t + 2 * PI * k) / n));
}

// ---------- trig / hyperbolic (radian arguments) ----------
export function sin(z) { z = toC(z); return new Complex(sinR(z.re) * Math.cosh(z.im), cosR(z.re) * Math.sinh(z.im)); }
export function cos(z) { z = toC(z); return new Complex(cosR(z.re) * Math.cosh(z.im), -sinR(z.re) * Math.sinh(z.im)); }
export function tan(z) {
  z = toC(z);
  // tan(x+iy) = (sin 2x + i sinh 2y)/(cos 2x + cosh 2y), evaluated in an overflow-safe form
  const E = Math.exp(-2 * Math.abs(z.im));
  const c2 = cosR(2 * z.re), s2 = sinR(2 * z.re);
  const den = 1 + 2 * c2 * E + E * E;
  if (den === 0) throw new RangeError("pole");
  return new Complex(2 * s2 * E / den, z.im === 0 ? 0 : Math.sign(z.im) * (1 - E * E) / den);
}
export function sinh(z) { z = toC(z); return new Complex(Math.sinh(z.re) * cosR(z.im), Math.cosh(z.re) * sinR(z.im)); }
export function cosh(z) { z = toC(z); return new Complex(Math.cosh(z.re) * cosR(z.im), Math.sinh(z.re) * sinR(z.im)); }
export function tanh(z) { // tanh z = −i tan(i z)
  z = toC(z);
  const t = tan(new Complex(-z.im, z.re));
  return new Complex(t.im, -t.re);
}
const half = (z) => new Complex(z.re / 2, z.im / 2);
export function asinh(z) { z = toC(z); return ln(add(z, sqrt(add(mul(z, z), 1)))); }
export function acosh(z) { z = toC(z); return ln(add(z, mul(sqrt(add(z, 1)), sqrt(sub(z, 1))))); }
export function atanh(z) {
  z = toC(z);
  if (z.im === 0 && Math.abs(z.re) === 1) throw new RangeError("pole");
  return half(sub(ln(add(1, z)), ln(sub(1, z))));
}
export function asin(z) { z = toC(z); const t = ln(add(mul(I, z), sqrt(sub(1, mul(z, z))))); return new Complex(t.im, -t.re); } // −i·t
export function acos(z) { z = toC(z); return sub(new Complex(PI / 2, 0), asin(z)); }
export function atan(z) {
  z = toC(z);
  if (z.re === 0 && Math.abs(z.im) === 1) throw new RangeError("pole");
  const t = sub(ln(sub(1, mul(I, z))), ln(add(1, mul(I, z))));   // ln(1−iz) − ln(1+iz)
  return mul(new Complex(0, 0.5), t);                             // (i/2)·t
}
