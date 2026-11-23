// Equation and system solving for the SOLVE sheet (and tests).
//   solveEquation("x^2-4=0")        polynomial -> exact/numerical roots incl. complex, multiplicities
//                                   anything else -> numerical real roots in an interval (or near a guess)
//   solveSystem(["2x+y=5","x-y=1"]) linear systems of 2 or 3 equations (or any m×n up to 3 unknowns)
import { CalcError, parse, splitRelation, collectVars } from "./parser.js";
import { compile, compileReal } from "./engine.js";
import { polynomialRoots, Fr, toExactFraction } from "./polynomial.js";
import { solveLinearSystem } from "./linalg.js";
import { findZeros, findRootNear } from "./numerics.js";
import * as CX from "./complex.js";
import { Complex, isComplex, norm } from "./complex.js";

const ORDER = ["x", "y", "z"];
const sortNames = (names) => names.slice().sort((a, b) => {
  const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
});

function sides(text) {
  const rel = splitRelation(text);
  if (!rel) return { lhs: text.trim(), rhs: "0" };
  if (rel.op !== "=") throw new CalcError("Use = for an equation (inequalities can be graphed in GRAPH → INEQUALITY)");
  return { lhs: rel.lhs, rhs: rel.rhs };
}
function unknownsOf(asts, vars) {
  const set = new Set();
  asts.forEach((a) => collectVars(a).forEach((n) => { if (!Object.prototype.hasOwnProperty.call(vars, n)) set.add(n); }));
  return sortNames([...set]);
}
function constValue(node, opts) {
  const v = compile(node, { angle: opts.angle, vars: opts.vars, ans: opts.ans, strict: true, indep: [] })();
  if (Array.isArray(v)) throw new CalcError("Lists are not allowed in equations");
  if (typeof v === "number" ? !Number.isFinite(v) : !CX.isFiniteC(v)) throw new CalcError("Equation contains an undefined or infinite constant");
  return v;
}

// ---------- univariate polynomial extraction (ascending coefficients) ----------
// Done in exact rational arithmetic when every constant is exactly rational (so (x+0.1)^2 expands to x²+0.2x+0.01 and
// not to 0.010000000000000002), otherwise in ordinary doubles/Complex.
class NotExact extends Error {}
const FLOAT_OPS = {
  zero: 0, one: 1,
  cst: (v) => v, add: (a, b) => norm(CX.add(a, b)), sub: (a, b) => norm(CX.sub(a, b)), mul: (a, b) => norm(CX.mul(a, b)),
  neg: (a) => norm(CX.neg(a)), div: (a, b) => norm(CX.div(a, b)), isZero: (a) => (typeof a === "number" ? a === 0 : CX.isZero(a)), out: (a) => a,
};
const EXACT_OPS = {
  zero: new Fr(0n), one: new Fr(1n),
  cst: (v) => { const f = toExactFraction(v); if (!f) throw new NotExact(); return f; },
  add: (a, b) => a.add(b), sub: (a, b) => a.sub(b), mul: (a, b) => a.mul(b), neg: (a) => a.neg(), div: (a, b) => a.div(b), isZero: (a) => a.isZero(), out: (a) => a.toNumber(),
};
function polyOf(node, v, opts, O) {
  if (!collectVars(node).has(v)) return [O.cst(constValue(node, opts))];
  const add = (p, q, sgn) => { const n = Math.max(p.length, q.length), r = []; for (let i = 0; i < n; i++) { const a = p[i] ?? O.zero, b = q[i] ?? O.zero; r.push(sgn === 1 ? O.add(a, b) : O.sub(a, b)); } return r; };
  const mul = (p, q) => { const r = new Array(p.length + q.length - 1).fill(O.zero); for (let i = 0; i < p.length; i++) for (let j = 0; j < q.length; j++) r[i + j] = O.add(r[i + j], O.mul(p[i], q[j])); return r; };
  switch (node.t) {
    case "var": return [O.zero, O.one];
    case "neg": { const a = polyOf(node.a, v, opts, O); return a && a.map(O.neg); }
    case "bin": {
      if (node.op === "^") {
        if (collectVars(node.b).has(v)) return null;
        const e = constValue(node.b, opts);
        if (typeof e !== "number" || !Number.isInteger(e) || e < 0 || e > 64) return null;
        const base = polyOf(node.a, v, opts, O);
        if (!base) return null;
        let r = [O.one];
        for (let k = 0; k < e; k++) r = mul(r, base);
        return r;
      }
      if (node.op === "/") {
        if (collectVars(node.b).has(v)) return null;
        const d = O.cst(constValue(node.b, opts)), a = polyOf(node.a, v, opts, O);
        if (!a) return null;
        if (O.isZero(d)) throw new CalcError("Division by zero in the equation");
        return a.map((c) => O.div(c, d));
      }
      const a = polyOf(node.a, v, opts, O), b = polyOf(node.b, v, opts, O);
      if (!a || !b) return null;
      return node.op === "*" ? mul(a, b) : add(a, b, node.op === "+" ? 1 : -1);
    }
    default: return null;
  }
}
/** Ascending numeric coefficients of the polynomial, or null if the expression is not a polynomial in v. */
function polynomialCoefficients(node, v, opts) {
  try { const p = polyOf(node, v, opts, EXACT_OPS); return p && p.map(EXACT_OPS.out); }
  catch (e) { if (!(e instanceof NotExact)) throw e; }
  const p = polyOf(node, v, opts, FLOAT_OPS);
  return p;
}

/**
 * solveEquation(text, {angle, vars, ans, lo, hi, guess, variable})
 *  -> {kind:"polynomial", variable, degree, roots, method, coefficients}
 *   | {kind:"numeric", variable, roots:[{value}], interval}
 *   | {kind:"identity"} | {kind:"none"}
 */
export function solveEquation(text, opts = {}) {
  opts = { angle: "rad", vars: {}, ...opts };
  const { lhs, rhs } = sides(text);
  const L = parse(lhs), Rr = parse(rhs);
  const unknowns = unknownsOf([L, Rr], opts.vars);
  let v = opts.variable;
  if (!v) {
    if (unknowns.length > 1) throw new CalcError(`The equation has several unknowns (${unknowns.join(", ")}) — define the extra letters or use the system solver`);
    v = unknowns[0];
  }
  if (!v) {
    const a = constValue(L, opts), b = constValue(Rr, opts);
    return { kind: CX.eq(a, b) ? "identity" : "none", constant: true };
  }
  const P = polynomialCoefficients({ t: "bin", op: "-", a: L, b: Rr }, v, opts);
  if (P) {
    const desc = P.slice().reverse();
    const res = polynomialRoots(desc);
    if (res.error) return { kind: "identity", variable: v };
    if (res.degree === 0) return { kind: "none", variable: v };
    return { kind: "polynomial", variable: v, degree: res.degree, roots: res.roots, method: res.method, coefficients: desc };
  }
  // numerical root finding over the reals
  const f = compileReal(`(${lhs})-(${rhs})`, { angle: opts.angle, vars: opts.vars, indep: [v] });
  if (opts.guess !== undefined) {
    const r = findRootNear(f, opts.guess);
    return { kind: "numeric", variable: v, roots: r.ok ? [{ value: Math.abs(r.x) < 1e-12 && f(0) === 0 ? 0 : r.x, exact: false, residual: r.residual }] : [], guess: opts.guess, interval: null };
  }
  const lo = opts.lo ?? -100, hi = opts.hi ?? 100;
  if (!(hi > lo)) throw new CalcError("The search interval needs min < max");
  const roots = findZeros(f, lo, hi, 20000).map((p) => ({ value: p.x, exact: false, residual: Math.abs(f(p.x)) }));
  return { kind: "numeric", variable: v, roots, interval: [lo, hi] };
}

// ---------- linear forms in several unknowns ----------
function linearOf(node, names, opts) {
  const vs = collectVars(node);
  if (!names.some((n) => vs.has(n))) return { c: realConst(node, opts), k: names.map(() => 0) };
  switch (node.t) {
    case "var": return { c: 0, k: names.map((n) => (n === node.name ? 1 : 0)) };
    case "neg": { const a = linearOf(node.a, names, opts); return a && { c: -a.c, k: a.k.map((x) => -x) }; }
    case "bin": {
      const a = linearOf(node.a, names, opts), b = linearOf(node.b, names, opts);
      if (!a || !b) return null;
      const aConst = a.k.every((x) => x === 0), bConst = b.k.every((x) => x === 0);
      if (node.op === "+") return { c: a.c + b.c, k: a.k.map((x, i) => x + b.k[i]) };
      if (node.op === "-") return { c: a.c - b.c, k: a.k.map((x, i) => x - b.k[i]) };
      if (node.op === "*") {
        if (aConst) return { c: a.c * b.c, k: b.k.map((x) => a.c * x) };
        if (bConst) return { c: a.c * b.c, k: a.k.map((x) => b.c * x) };
        return null;
      }
      if (node.op === "/" && bConst) { if (b.c === 0) throw new CalcError("Division by zero in the equation"); return { c: a.c / b.c, k: a.k.map((x) => x / b.c) }; }
      return null;
    }
    default: return null;
  }
}
function realConst(node, opts) {
  const v = constValue(node, opts);
  if (typeof v !== "number") throw new CalcError("The system solver needs real coefficients");
  return v;
}

/** solveSystem(["2x+3y=7", "x-y=1"], opts) -> {kind, unknowns, ...} (see linalg.solveLinearSystem) */
export function solveSystem(lines, opts = {}) {
  opts = { angle: "rad", vars: {}, ...opts };
  const eqs = lines.map((s) => s.trim()).filter(Boolean);
  if (!eqs.length) throw new CalcError("Enter at least one equation");
  const parts = eqs.map((s) => { const { lhs, rhs } = sides(s); return { L: parse(lhs), R: parse(rhs) }; });
  const unknowns = unknownsOf(parts.flatMap((p) => [p.L, p.R]), opts.vars);
  if (!unknowns.length) throw new CalcError("No unknowns found — use letters such as x, y, z");
  if (unknowns.length > 3) throw new CalcError(`Systems with up to 3 unknowns are supported (found ${unknowns.join(", ")})`);
  const A = [], b = [];
  for (let i = 0; i < parts.length; i++) {
    const lf = linearOf({ t: "bin", op: "-", a: parts[i].L, b: parts[i].R }, unknowns, opts);
    if (!lf) throw new CalcError(`Equation ${i + 1} is not linear in ${unknowns.join(", ")} — the system solver handles linear equations only (for curves, use GRAPH → intersections)`);
    A.push(lf.k); b.push(-lf.c + 0);
  }
  const res = solveLinearSystem(A, b, unknowns);
  return { ...res, unknowns, equations: eqs.length };
}
void Complex;
