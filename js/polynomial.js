// Polynomial root finding.
//   * Polynomials whose coefficients are exactly rational are handled with BigInt arithmetic:
//     square-free decomposition (Yun) gives exact multiplicities, the rational root theorem gives exact rational roots,
//     quadratic factors use the exact discriminant.
//   * Everything else (irrational roots of degree ≥ 3, floating-point coefficients, complex coefficients) uses the
//     Aberth–Ehrlich iteration with Newton polishing. Those roots are labelled approximate (exact: false).
import { Complex, isComplex, norm } from "./complex.js";
import { toFractionParts, EPS } from "./realmath.js";

// ======================= exact rational arithmetic =======================
const babs = (a) => (a < 0n ? -a : a);
function bgcd(a, b) { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; }
export class Fr {
  constructor(n, d = 1n) {
    if (d < 0n) { n = -n; d = -d; }
    const g = bgcd(n, d) || 1n;
    this.n = n / g; this.d = d / g;
  }
  add(o) { return new Fr(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Fr(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Fr(this.n * o.n, this.d * o.d); }
  div(o) { return new Fr(this.n * o.d, this.d * o.n); }
  neg() { return new Fr(-this.n, this.d); }
  isZero() { return this.n === 0n; }
  toNumber() { return ratioToNumber(this.n, this.d); }
}
const bitLen = (a) => babs(a).toString(2).length;
function ratioToNumber(n, d) {
  const sh = Math.max(0, Math.max(bitLen(n), bitLen(d)) - 900);
  return Number(n >> BigInt(sh)) / Number(d >> BigInt(sh));
}
const FZERO = new Fr(0n), FONE = new Fr(1n);
/** A number as an exact Fr if (and only if) it equals p/q exactly as a double; otherwise null. */
export function toExactFraction(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (Number.isInteger(v)) return new Fr(BigInt(v));
  const f = toFractionParts(v, 1000000, 1e-15);
  return f && f.p / f.q === v ? new Fr(BigInt(f.p), BigInt(f.q)) : null;
}

// polynomials: arrays of Fr, ascending powers
const ptrim = (p) => { let k = p.length; while (k > 0 && p[k - 1].isZero()) k--; return p.slice(0, k); };
const pdeg = (p) => ptrim(p).length - 1;
function psub(a, b) { const n = Math.max(a.length, b.length), r = []; for (let i = 0; i < n; i++) r.push((a[i] || FZERO).sub(b[i] || FZERO)); return ptrim(r); }
function pderiv(p) { return ptrim(p.slice(1).map((c, i) => c.mul(new Fr(BigInt(i + 1))))); }
function pdivmod(a, b) {
  a = ptrim(a); b = ptrim(b);
  if (!b.length) throw new Error("division by zero polynomial");
  let r = a.slice(), q = new Array(Math.max(0, a.length - b.length + 1)).fill(FZERO);
  const lead = b[b.length - 1];
  while (r.length >= b.length && r.length) {
    const k = r.length - b.length, f = r[r.length - 1].div(lead);
    q[k] = f;
    for (let i = 0; i < b.length; i++) r[i + k] = r[i + k].sub(f.mul(b[i]));
    r = ptrim(r.slice(0, r.length - 1)); // leading term is now zero
  }
  return { q: ptrim(q), r: ptrim(r) };
}
const pmonic = (p) => { p = ptrim(p); if (!p.length) return p; const l = p[p.length - 1]; return p.map((c) => c.div(l)); };
function pgcd(a, b) { a = ptrim(a); b = ptrim(b); while (b.length) { [a, b] = [b, pdivmod(a, b).r]; } return pmonic(a); }
const pone = (p) => p.length === 1 && p[0].n === 1n && p[0].d === 1n;

/** Yun's square-free decomposition: [{poly, mult}] with each poly square-free and monic. */
function squareFree(P) {
  const Pd = pderiv(P);
  const a0 = pgcd(P, Pd);
  let b = pdivmod(P, a0).q, c = pdivmod(Pd, a0).q;
  let d = psub(c, pderiv(b));
  const out = [];
  for (let i = 1; i <= 2000 && pdeg(b) > 0; i++) {
    const a = pgcd(b, d);
    if (pdeg(a) > 0) out.push({ poly: a, mult: i });
    b = pdivmod(b, a).q;
    c = pdivmod(d, a).q;
    d = psub(c, pderiv(b));
  }
  return out;
}

function divisors(nBig) {
  const n = Number(babs(nBig));
  if (!Number.isSafeInteger(n) || n === 0 || n > 1e12) return null;
  const small = [], large = [];
  for (let i = 1; i * i <= n; i++) if (n % i === 0) { small.push(i); if (i * i !== n) large.push(n / i); }
  return [...small, ...large.reverse()].map(BigInt);
}

/** Exact rational roots of a square-free integer-coefficient polynomial; returns {roots:[{p,q}], rest:poly} */
function rationalRoots(P) {
  let poly = ptrim(P);
  const roots = [];
  for (;;) {
    const deg = pdeg(poly);
    if (deg < 1) break;
    // integer coefficients (clear denominators)
    let den = 1n;
    for (const c of poly) den = (den * c.d) / bgcd(den, c.d);
    const ci = poly.map((c) => (c.n * den) / c.d);
    const dA = divisors(ci[0]), dL = divisors(ci[ci.length - 1]);
    if (!dA || !dL || dA.length * dL.length > 60000) break;
    let found = null;
    outer: for (const p of dA) for (const q of dL) {
      if (bgcd(p, q) !== 1n) continue;
      for (const sgn of [1n, -1n]) {
        const pp = sgn * p;
        let h = ci[deg]; // Horner on the homogeneous form: sum c_k p^k q^(n-k)
        let qpow = 1n;
        const qp = [1n]; for (let k = 1; k <= deg; k++) qp.push(qp[k - 1] * q);
        for (let k = deg - 1; k >= 0; k--) h = h * pp + ci[k] * qp[deg - k];
        void qpow;
        if (h === 0n) { found = { p: pp, q }; break outer; }
      }
    }
    if (!found) break;
    roots.push(found);
    poly = pdivmod(poly, [new Fr(-found.p, found.q), FONE]).q; // divide by (x - p/q)
  }
  return { roots, rest: poly };
}

// ======================= complex helpers on [re, im] pairs =======================
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdivp = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const cabs = (a) => Math.hypot(a[0], a[1]);
function horner(co, z) { // co ascending [re,im]; returns [p, dp]
  let p = co[co.length - 1], dp = [0, 0];
  for (let k = co.length - 2; k >= 0; k--) {
    dp = cmul(dp, z); dp = [dp[0] + p[0], dp[1] + p[1]];
    p = cmul(p, z); p = [p[0] + co[k][0], p[1] + co[k][1]];
  }
  return [p, dp];
}
function aberth(co) {
  const n = co.length - 1;
  const lead = co[n];
  const mono = co.map((c) => cdivp(c, lead));
  // centre and radius of the starting circle
  const centre = [-mono[n - 1][0] / n, -mono[n - 1][1] / n];
  let rad = 0;
  for (let k = 1; k <= n; k++) rad = Math.max(rad, Math.pow(cabs(mono[n - k]), 1 / k));
  rad = rad || 1;
  const z = Array.from({ length: n }, (_, k) => {
    const ang = (2 * Math.PI * k) / n + 0.4;
    return [centre[0] + rad * Math.cos(ang), centre[1] + rad * Math.sin(ang)];
  });
  for (let it = 0; it < 1000; it++) {
    let maxStep = 0;
    for (let k = 0; k < n; k++) {
      const [p, dp] = horner(mono, z[k]);
      if (p[0] === 0 && p[1] === 0) continue;
      if (dp[0] === 0 && dp[1] === 0) { z[k] = [z[k][0] + 1e-8, z[k][1] + 1e-8]; maxStep = 1; continue; }
      const ratio = cdivp(p, dp);
      let s = [0, 0];
      for (let j = 0; j < n; j++) if (j !== k) { const d = [z[k][0] - z[j][0], z[k][1] - z[j][1]]; if (d[0] || d[1]) { const inv = cdivp([1, 0], d); s = [s[0] + inv[0], s[1] + inv[1]]; } }
      const rs = cmul(ratio, s);
      const w = cdivp(ratio, [1 - rs[0], -rs[1]]);
      if (!Number.isFinite(w[0]) || !Number.isFinite(w[1])) continue;
      z[k] = [z[k][0] - w[0], z[k][1] - w[1]];
      maxStep = Math.max(maxStep, cabs(w) / Math.max(1, cabs(z[k])));
    }
    if (maxStep < 1e-16) break;
  }
  // Newton polish
  for (let k = 0; k < n; k++) for (let it = 0; it < 4; it++) {
    const [p, dp] = horner(mono, z[k]);
    if (cabs(dp) === 0) break;
    const st = cdivp(p, dp);
    if (!Number.isFinite(st[0])) break;
    z[k] = [z[k][0] - st[0], z[k][1] - st[1]];
  }
  return z;
}

/** Roots of a polynomial with numeric (Number/Complex) coefficients, ascending order. Returns [{value, multiplicity, exact:false}] */
function numericRoots(coAsc, realCoeffs) {
  const co = coAsc.map((c) => (isComplex(c) ? [c.re, c.im] : [c, 0]));
  const n = co.length - 1;
  let z = aberth(co);
  const polyAt = (zz) => horner(co, zz)[0];
  const sizeAt = (zz) => { let s = 0, m = 1; for (const c of co) { s += cabs(c) * m; m *= cabs(zz); } return s || 1; };
  if (realCoeffs) {
    // real roots: snap near-real values by re-polishing on the real line; make conjugate pairs exactly symmetric
    z = z.map((r) => {
      if (Math.abs(r[1]) <= 1e-9 * Math.max(1, Math.abs(r[0]))) {
        let x = r[0];
        for (let it = 0; it < 6; it++) { const [p, dp] = horner(co, [x, 0]); if (dp[0] === 0) break; const nx = x - p[0] / dp[0]; if (!Number.isFinite(nx)) break; x = nx; }
        const before = cabs(polyAt(r)), after = cabs(polyAt([x, 0]));
        if (after <= before * 10 + 1e-300 || after / sizeAt([x, 0]) < 1e-14) return [x, 0];
      }
      return r;
    });
    const used = new Array(n).fill(false);
    for (let a = 0; a < n; a++) {
      if (used[a] || z[a][1] === 0) continue;
      let best = -1, bd = Infinity;
      for (let b = 0; b < n; b++) if (b !== a && !used[b] && z[b][1] !== 0) { const d = Math.hypot(z[a][0] - z[b][0], z[a][1] + z[b][1]); if (d < bd) { bd = d; best = b; } }
      if (best >= 0 && bd < 1e-7 * Math.max(1, cabs(z[a]))) {
        const re = (z[a][0] + z[best][0]) / 2, im = (Math.abs(z[a][1]) + Math.abs(z[best][1])) / 2;
        const sa = Math.sign(z[a][1]);
        z[a] = [re, sa * im]; z[best] = [re, -sa * im];
        used[a] = used[best] = true;
      }
    }
  }
  // cluster nearly coincident roots into multiple roots (estimate)
  const out = [];
  const taken = new Array(n).fill(false);
  for (let a = 0; a < n; a++) {
    if (taken[a]) continue;
    const cl = [a]; taken[a] = true;
    for (let b = a + 1; b < n; b++) if (!taken[b] && Math.hypot(z[a][0] - z[b][0], z[a][1] - z[b][1]) < 1e-5 * Math.max(1, cabs(z[a]))) { cl.push(b); taken[b] = true; }
    const re = cl.reduce((s, k) => s + z[k][0], 0) / cl.length, im = cl.reduce((s, k) => s + z[k][1], 0) / cl.length;
    const r = [re, realCoeffs && Math.abs(im) <= 1e-9 * Math.max(1, Math.abs(re)) ? 0 : im];
    out.push({ value: r[1] === 0 ? r[0] : new Complex(r[0], r[1]), multiplicity: cl.length, exact: false, estimatedMultiplicity: cl.length > 1 });
  }
  return out;
}

/** Quadratic a x² + b x + c with a numerically stable formula; returns two root values (Number or Complex). */
function quadratic(a, b, c) {
  const D = b * b - 4 * a * c;
  if (D >= 0) {
    const s = Math.sqrt(D), q = -(b + (b >= 0 ? s : -s)) / 2;
    if (q === 0) return [0, 0];
    return [q / a, c / q];
  }
  const re = -b / (2 * a), im = Math.sqrt(-D) / (2 * Math.abs(a));
  return [new Complex(re, im), new Complex(re, -im)];
}

// ======================= public API =======================
const sortKey = (r) => (isComplex(r.value) ? [1, r.value.re, r.value.im] : [0, r.value, 0]);
function sortRoots(list) {
  return list.sort((a, b) => { const x = sortKey(a), y = sortKey(b); return x[0] - y[0] || x[1] - y[1] || y[2] - x[2]; });
}
function evalResidual(coAsc, v) {
  const z = isComplex(v) ? [v.re, v.im] : [v, 0];
  const co = coAsc.map((c) => (isComplex(c) ? [c.re, c.im] : [c, 0]));
  const [p] = horner(co, z);
  let s = 0, m = 1;
  for (const c of co) { s += cabs(c) * m; m *= cabs(z); }
  return cabs(p) / (s || 1);
}

/**
 * polynomialRoots([a_n, …, a_1, a_0]) — coefficients from the highest power down (numbers or Complex).
 * Returns { degree, roots: [{ value, multiplicity, exact, residual }], method } or { error }.
 */
export function polynomialRoots(coeffsDesc) {
  let desc = coeffsDesc.map((c) => (isComplex(c) ? (c.im === 0 ? c.re : c) : c));
  for (const c of desc) {
    if (typeof c === "number" ? !Number.isFinite(c) : !(Number.isFinite(c.re) && Number.isFinite(c.im))) return { error: "Coefficients must be finite numbers" };
  }
  const isZ = (c) => (typeof c === "number" ? c === 0 : c.re === 0 && c.im === 0);
  while (desc.length && isZ(desc[0])) desc = desc.slice(1);
  if (!desc.length) return { error: "All coefficients are zero — every number is a root" };
  const degree = desc.length - 1;
  if (degree === 0) return { degree: 0, roots: [], method: "constant" };
  const asc = desc.slice().reverse();
  let zeroMult = 0;
  while (isZ(asc[0])) { asc.shift(); zeroMult++; }
  const roots = [];
  if (zeroMult) roots.push({ value: 0, multiplicity: zeroMult, exact: true });
  const complexCoeffs = asc.some((c) => typeof c !== "number");
  let method = "numerical";
  if (asc.length > 1) {
    // try the exact rational path
    let frs = null;
    if (!complexCoeffs) {
      frs = [];
      for (const c of asc) {
        if (Number.isInteger(c)) { frs.push(new Fr(BigInt(c))); continue; }
        const f = toFractionParts(c, 1000000, 1e-15);
        if (!f || f.p / f.q !== c) { frs = null; break; }
        frs.push(new Fr(BigInt(f.p), BigInt(f.q)));
      }
    }
    if (frs) {
      method = "exact rational factoring + numerical for irrational roots";
      for (const { poly, mult } of squareFree(frs)) {
        const { roots: rr, rest } = rationalRoots(poly);
        for (const r of rr) roots.push({ value: Number(r.p) / Number(r.q), multiplicity: mult, exact: true, frac: { p: r.p, q: r.q } });
        const d = pdeg(rest);
        if (d === 2) {
          const [a, b, c] = [rest[2], rest[1], rest[0]].map((f) => f.toNumber());
          quadratic(a, b, c).forEach((v) => roots.push({ value: v, multiplicity: mult, exact: false }));
        } else if (d >= 1) {
          numericRoots(rest.map((f) => f.toNumber()), true).forEach((r) => roots.push({ ...r, multiplicity: mult, estimatedMultiplicity: false }));
        }
      }
    } else if (!complexCoeffs && asc.length === 3) {
      method = "quadratic formula";
      const [c, b, a] = asc;
      const [r1, r2] = quadratic(a, b, c);
      if ((isComplex(r1) ? false : r1 === r2)) roots.push({ value: r1, multiplicity: 2, exact: false });
      else { roots.push({ value: r1, multiplicity: 1, exact: false }); roots.push({ value: r2, multiplicity: 1, exact: false }); }
    } else if (asc.length === 2) {
      method = "linear";
      const [c, b] = asc;
      roots.push({ value: complexCoeffs ? norm(divC(neg(c), b)) : -c / b, multiplicity: 1, exact: false });
    } else {
      method = "Aberth–Ehrlich iteration";
      roots.push(...numericRoots(asc, !complexCoeffs));
    }
  }
  const ascForResidual = asc;
  roots.forEach((r) => { r.residual = evalResidual(ascForResidual, r.value); });
  return { degree, roots: sortRoots(roots), method };
}
const neg = (c) => (typeof c === "number" ? -c : new Complex(-c.re, -c.im));
function divC(a, b) {
  const A = typeof a === "number" ? new Complex(a, 0) : a, B = typeof b === "number" ? new Complex(b, 0) : b;
  const d = B.re * B.re + B.im * B.im;
  return new Complex((A.re * B.re + A.im * B.im) / d, (A.im * B.re - A.re * B.im) / d);
}
void EPS;
