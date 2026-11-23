// Expression engine: AST (parser.js) -> closure compiler.  No eval(), no Function().
// Values are plain numbers, Complex objects (complex.js) or lists (arrays) of those.
//
// compile(src, opts) options:
//   angle     "rad" | "deg"
//   strict    true  -> throw CalcError with a specific message for domain errors / overflow / divide-by-zero
//             false -> return NaN/Infinity instead (graphing and tables)
//   complex   false -> real mode: no automatic promotion to complex (sqrt(-4) is a domain error; the real
//                      odd root (-8)^(1/3) = -2 is used).  Default true: principal complex values.
//   ans       value of Ans
//   vars      user variables {a: 5, ...}
//   indep     names of independent variables, passed positionally to the compiled function (default ["x"])
//   alias     {t: "theta"} — alternative spellings of an independent variable
//   refs      names usable like u(n-1) (sequence terms) together with resolve(name, index)
import { CalcError, FUNCTION_NAMES, UNARY_SET, BINDERS, parse, collectVars, lex, parseAssignment } from "./parser.js";
import * as R from "./realmath.js";
import * as CX from "./complex.js";
import { Complex, isComplex, norm } from "./complex.js";
import { derivativeEx, integrateEx, findRootNear } from "./numerics.js";
import { polynomialRoots } from "./polynomial.js";

export { CalcError, FUNCTION_NAMES, parse };
export { toFractionParts } from "./realmath.js";
export { integral as numIntegrate, derivative as numDerivative } from "./numerics.js";

const isArr = Array.isArray;
const { PI } = R;

function map1(a, f) { return isArr(a) ? a.map(f) : f(a); }
function map2(a, b, f) {
  const A = isArr(a), B = isArr(b);
  if (!A && !B) return f(a, b);
  if (A && B) {
    if (a.length !== b.length) throw new CalcError("Dimension mismatch");
    return a.map((v, i) => f(v, b[i]));
  }
  return A ? a.map((v) => f(v, b)) : b.map((v) => f(a, v));
}
const flat = (args) => args.flatMap((a) => (isArr(a) ? a : [a]));
/** number -> itself, Complex with im != 0 / list -> NaN. */
function realOf(v) { return typeof v === "number" ? v : isComplex(v) && v.im === 0 ? v.re : NaN; }

export function compile(srcOrAst, opts = {}) {
  const angle = opts.angle || "rad";
  const strict = !!opts.strict;
  const promote = opts.complex !== false;
  const ans = opts.ans === undefined ? 0 : opts.ans;
  const vars = opts.vars || {};
  const indep = opts.indep || ["x"];
  const alias = opts.alias || {};
  const tr = R.trigSet(angle);
  const ast = typeof srcOrAst === "string" ? parse(srcOrAst, { refs: opts.refs }) : srcOrAst;
  const dom = (msg) => { if (strict) throw new CalcError(msg); return NaN; };
  const ovf = (v) => { if (strict && (v === Infinity || v === -Infinity)) throw new CalcError("Overflow: result is too large"); return v; };
  const ovfC = (z) => { if (strict && isComplex(z) && (Math.abs(z.re) === Infinity || Math.abs(z.im) === Infinity)) throw new CalcError("Overflow: result is too large"); return z; };

  // ---- scalar arithmetic ----
  const sAdd = (a, b) => (typeof a === "number" && typeof b === "number" ? R.addSnap(a, b) : norm(CX.add(a, b)));
  const sSub = (a, b) => (typeof a === "number" && typeof b === "number" ? R.addSnap(a, -b) : norm(CX.sub(a, b)));
  const sMul = (a, b) => (typeof a === "number" && typeof b === "number" ? ovf(a * b) : ovfC(norm(CX.mul(a, b))));
  const sDiv = (a, b) => {
    if (strict && (b === 0 || (isComplex(b) && CX.isZero(b)))) throw new CalcError("Divide by zero");
    return typeof a === "number" && typeof b === "number" ? a / b : ovfC(norm(CX.div(a, b)));
  };
  const sPow = (a, b) => {
    if (typeof a === "number" && typeof b === "number") {
      if (a === 0 && b === 0) return dom("Undefined: 0^0 is indeterminate");
      if (a === 0 && b < 0) { if (strict) throw new CalcError("Divide by zero"); return Infinity; }
      if (a < 0 && !Number.isInteger(b) && promote) return ovfC(norm(CX.pow(a, b)));
      return ovf(R.powReal(a, b));
    }
    try { return ovfC(norm(CX.pow(a, b))); }
    catch (e) { if (e instanceof RangeError) return dom("Divide by zero (0 raised to a non-positive power)"); throw e; }
  };
  const sNeg = (a) => (typeof a === "number" ? -a : norm(CX.neg(a)));
  const needReal = (name, v) => {
    if (typeof v === "number") return v;
    throw new CalcError(`${name}( needs a real number`);
  };
  const toRadC = (z) => (angle === "deg" ? CX.mul(z, PI / 180) : z);
  const fromRadC = (z) => (angle === "deg" ? CX.mul(z, 180 / PI) : z);
  const cwrap = (name, f) => (z) => { try { return norm(f(z)); } catch (e) { if (e instanceof RangeError) throw new CalcError(`Undefined: ${name} has a pole at this value`); throw e; } };

  // ---- unary functions: { r: real handler, c: complex handler } ----
  const lnReal = (x, name = "ln") => {
    if (x > 0) return Math.log(x);
    if (x === 0) return dom(`${name}(0) is undefined`);
    return promote ? norm(CX.ln(x)) : dom(`${name} of a negative number is not real (turn on a+bi mode for complex results)`);
  };
  const U = {
    sin: { r: tr.sin, c: (z) => CX.sin(toRadC(z)) },
    cos: { r: tr.cos, c: (z) => CX.cos(toRadC(z)) },
    tan: { r: (x) => { const v = tr.tan(x); return Number.isNaN(v) ? dom(`tan is undefined at odd multiples of ${angle === "deg" ? "90°" : "π/2"}`) : v; }, c: (z) => CX.tan(toRadC(z)) },
    asin: { r: (x) => (Math.abs(x) <= 1 ? tr.asin(x) : promote ? norm(fromRadC(CX.asin(x))) : dom("asin is only real for −1 ≤ x ≤ 1 (turn on a+bi mode)")), c: (z) => fromRadC(CX.asin(z)) },
    acos: { r: (x) => (Math.abs(x) <= 1 ? tr.acos(x) : promote ? norm(fromRadC(CX.acos(x))) : dom("acos is only real for −1 ≤ x ≤ 1 (turn on a+bi mode)")), c: (z) => fromRadC(CX.acos(z)) },
    atan: { r: tr.atan, c: (z) => fromRadC(CX.atan(z)) },
    sinh: { r: (x) => ovf(Math.sinh(x)), c: CX.sinh },
    cosh: { r: (x) => ovf(Math.cosh(x)), c: CX.cosh },
    tanh: { r: Math.tanh, c: CX.tanh },
    asinh: { r: Math.asinh, c: CX.asinh },
    acosh: { r: (x) => (x >= 1 ? Math.acosh(x) : promote ? norm(CX.acosh(x)) : dom("acosh needs x ≥ 1 (turn on a+bi mode)")), c: CX.acosh },
    atanh: { r: (x) => (Math.abs(x) < 1 ? Math.atanh(x) : Math.abs(x) === 1 ? dom("atanh(±1) is infinite") : promote ? norm(CX.atanh(x)) : dom("atanh needs −1 < x < 1 (turn on a+bi mode)")), c: CX.atanh },
    sqrt: { r: (x) => (x >= 0 ? Math.sqrt(x) : promote ? norm(CX.sqrt(x)) : dom("√ of a negative number is not real (turn on a+bi mode)")), c: CX.sqrt },
    cbrt: { r: Math.cbrt, c: (z) => CX.pow(z, 1 / 3) },
    abs: { r: Math.abs, c: (z) => CX.abs(z) },
    ln: { r: (x) => lnReal(x), c: (z) => { if (CX.isZero(z)) throw new CalcError("ln(0) is undefined"); return CX.ln(z); } },
    exp: { r: (x) => ovf(Math.exp(x)), c: (z) => CX.exp(z) },
    floor: { r: Math.floor }, ceil: { r: Math.ceil }, sign: { r: Math.sign }, int: { r: Math.trunc }, ipart: { r: Math.trunc },
    fpart: { r: (x) => x - Math.trunc(x) },
    fact: { r: (x) => { const v = R.fact(x); return Number.isNaN(v) ? dom("Factorial is undefined for negative integers") : ovf(v); } },
    gamma: { r: (x) => { const v = R.gamma(x); return Number.isNaN(v) ? dom("Γ is undefined at zero and negative integers") : ovf(v); } },
    fib: { r: (n) => (Number.isInteger(n) && n >= 0 ? ovf(R.fib(n)) : dom("fib needs an integer n ≥ 0")) },
    catalan: { r: (n) => (Number.isInteger(n) && n >= 0 ? ovf(R.catalan(n)) : dom("catalan needs an integer n ≥ 0")) },
    arg: { r: (x) => (x === 0 ? dom("arg(0) is undefined") : tr.fromRad(x > 0 ? 0 : PI)), c: (z) => tr.fromRad(CX.arg(z)) },
    conj: { r: (x) => x, c: CX.conj },
    real: { r: (x) => x, c: (z) => z.re },
    imag: { r: () => 0, c: (z) => z.im },
  };
  function unaryOf(name) {
    const h = U[name];
    return (v) => map1(v, (s) => {
      if (typeof s === "number") return h.r(s);
      if (isComplex(s)) {
        if (!h.c) throw new CalcError(`${name}( needs a real number`);
        return ovfC(cwrap(name, h.c)(s));
      }
      throw new CalcError("Lists cannot be nested");
    });
  }

  // ---- compiler ----
  let nslots = indep.length;
  const scope0 = {};
  indep.forEach((n, k) => { scope0[n] = k; });
  Object.entries(alias).forEach(([a, target]) => { if (target in scope0) scope0[a] = scope0[target]; });

  function c(node, scope) {
    switch (node.t) {
      case "num": { const v = node.v; return () => v; }
      case "imag": { const v = new Complex(0, 1); return () => v; }
      case "var": {
        const name = node.name;
        if (name in scope) { const k = scope[name]; return (env) => env[k]; }
        if (Object.prototype.hasOwnProperty.call(vars, name)) { const v = vars[name]; return () => v; }
        if (name === "x") throw new CalcError(opts.xMessage || "x has no value here — send it to Y= with GRAPH, or use TABLE");
        if (name === "theta") throw new CalcError("θ has no value here — it is the variable of POLAR graphs");
        throw new CalcError(`Undefined variable ${name} — define it first, e.g.  5 → ${name}`);
      }
      case "ans": return () => ans;
      case "neg": { const A = c(node.a, scope); return (env) => map1(A(env), sNeg); }
      case "fact": { const A = c(node.a, scope); const f = unaryOf("fact"); return (env) => f(A(env)); }
      case "deg": {
        const A = c(node.a, scope);
        if (angle === "deg") return A; // 30° is 30 when angles are in degrees
        return (env) => map1(A(env), (v) => sMul(v, PI / 180));
      }
      case "list": {
        const items = node.items.map((n) => c(n, scope));
        return (env) => items.map((f) => {
          const v = f(env);
          if (isArr(v)) throw new CalcError("Lists cannot be nested");
          return v;
        });
      }
      case "ref": {
        if (!opts.resolve) throw new CalcError(`${node.name}( is only available in SEQUENCE graphs`);
        const A = c(node.arg, scope);
        return (env) => { const k = realOf(A(env)); if (!Number.isInteger(k)) throw new CalcError(`${node.name}( needs an integer index`); return opts.resolve(node.name, k); };
      }
      case "bin": {
        const A = c(node.a, scope), B = c(node.b, scope);
        const op = { "+": sAdd, "-": sSub, "*": sMul, "/": sDiv, "^": sPow }[node.op];
        if (node.op === "+") return (env) => { const a = A(env), b = B(env); return typeof a === "number" && typeof b === "number" ? R.addSnap(a, b) : map2(a, b, sAdd); };
        if (node.op === "-") return (env) => { const a = A(env), b = B(env); return typeof a === "number" && typeof b === "number" ? R.addSnap(a, -b) : map2(a, b, sSub); };
        return (env) => map2(A(env), B(env), op);
      }
      case "call": return call(node, scope);
    }
    throw new CalcError("Syntax error");
  }

  function call(node, scope) {
    const { name, args } = node;
    const n = args.length;
    const need = (lo, hi = lo) => {
      if (n < lo || n > hi) throw new CalcError(`${name}( takes ${lo === hi ? lo : lo + "–" + hi} argument${hi === 1 ? "" : "s"}`);
    };
    if (BINDERS.has(name)) return binder(node, scope, need);
    const A = args.map((a) => c(a, scope));
    if (UNARY_SET.has(name)) {
      need(1);
      const f = unaryOf(name), a0 = A[0];
      return (env) => f(a0(env));
    }
    const intArgs = (label, f) => (x, y) => { const v = f(x, y); return Number.isNaN(v) ? dom(`${label} needs integers (0 ≤ r ≤ n)`) : ovf(v); };
    switch (name) {
      case "log": {
        need(1, 2);
        if (n === 1) {
          return (env) => map1(A[0](env), (v) => {
            if (typeof v === "number") return v > 0 ? Math.log10(v) : v === 0 ? dom("log(0) is undefined") : promote ? norm(CX.div(CX.ln(v), Math.LN10)) : dom("log of a negative number is not real (turn on a+bi mode)");
            if (CX.isZero(v)) throw new CalcError("log(0) is undefined");
            return norm(CX.div(CX.ln(v), Math.LN10));
          });
        }
        return (env) => map2(A[0](env), A[1](env), (v, b) => {
          if (typeof v === "number" && typeof b === "number" && v > 0 && b > 0) return b === 1 ? dom("log base 1 is undefined") : Math.log(v) / Math.log(b);
          if (typeof v === "number" && typeof b === "number" && !promote) return dom("log needs x > 0 and base b > 0 (turn on a+bi mode)");
          if ((typeof v === "number" && v === 0) || (typeof b === "number" && b === 0)) return dom("log(0) is undefined");
          return sDiv(norm(CX.ln(v)), norm(CX.ln(b)));
        });
      }
      case "round": {
        need(1, 2);
        return (env) => map2(A[0](env), n === 2 ? A[1](env) : 0, (v, d) => R.roundHalfAway(needReal("round", v), needReal("round", d)));
      }
      case "mod": case "rem": case "idiv": {
        need(2);
        const f = name === "mod" ? R.modulo : name === "rem" ? R.rem : (a, b) => (b === 0 ? NaN : Math.floor(a / b));
        return (env) => map2(A[0](env), A[1](env), (a, b) => { const v = f(needReal(name, a), needReal(name, b)); return Number.isNaN(v) ? dom(`${name}(a, 0) is undefined`) : v; });
      }
      case "npr": case "ncr": case "gcd": case "lcm": {
        need(2);
        const f = { npr: R.nPr, ncr: R.nCr, gcd: R.gcd, lcm: R.lcm }[name];
        const label = { npr: "nPr", ncr: "nCr", gcd: "gcd", lcm: "lcm" }[name];
        const g = intArgs(label, f);
        return (env) => map2(A[0](env), A[1](env), (a, b) => g(needReal(name, a), needReal(name, b)));
      }
      case "angle": { // angle(y, x): direction of the point (x, y) in the current angle unit
        need(2);
        return (env) => map2(A[0](env), A[1](env), (y, x) => {
          y = needReal("angle", y); x = needReal("angle", x);
          return x === 0 && y === 0 ? dom("angle(0, 0) is undefined") : tr.atan2(y, x);
        });
      }
      case "hypot": {
        need(2);
        return (env) => map2(A[0](env), A[1](env), (a, b) => ovf(Math.hypot(needReal("hypot", a), needReal("hypot", b))));
      }
      case "polar": { // polar(r, θ) = r(cos θ + i sin θ), θ in the current angle unit
        need(2);
        return (env) => map2(A[0](env), A[1](env), (r, t) => {
          r = needReal("polar", r); t = needReal("polar", t);
          return norm(new Complex(r * tr.cos(t), r * tr.sin(t)));
        });
      }
      case "root": {
        need(2);
        return (env) => map2(A[0](env), A[1](env), (k, v) => {
          if (typeof k !== "number") throw new CalcError("root( needs a real order");
          if (k === 0) return dom("root(0, x) is undefined");
          return sPow(v, 1 / k);
        });
      }
      case "roots": { // all n-th roots of z, as a list
        need(2);
        return (env) => {
          const k = realOf(A[0](env)), z = A[1](env);
          if (!Number.isInteger(k) || k < 1 || k > 100) throw new CalcError("roots(n, z): n must be an integer from 1 to 100");
          if (isArr(z)) throw new CalcError("roots( takes a single number");
          return CX.nthRoots(z, k).map(norm);
        };
      }
      case "polyroots": { // polyroots({a, b, c}) — coefficients from the highest power down
        need(1, 99);
        return (env) => {
          const coeffs = flat(A.map((f) => f(env)));
          const res = polynomialRoots(coeffs);
          if (res.error) throw new CalcError(res.error);
          return res.roots.flatMap((r) => Array.from({ length: r.multiplicity }, () => norm(r.value)));
        };
      }
      case "min": case "max": {
        need(1, 99);
        const fn = name === "min" ? Math.min : Math.max;
        return (env) => { const v = flat(A.map((f) => f(env))).map((q) => needReal(name, q)); return v.length ? fn(...v) : NaN; };
      }
      case "sum": case "mean": {
        need(1, 99);
        return (env) => {
          const v = flat(A.map((f) => f(env)));
          let s = 0;
          for (const q of v) s = sAdd(s, q);
          return name === "sum" ? s : sDiv(s, v.length);
        };
      }
      case "dim": { need(1); return (env) => { const v = A[0](env); return isArr(v) ? v.length : 1; }; }
    }
    throw new CalcError("Unknown function: " + name);
  }

  // nDeriv(f, v, a)   fnInt(f, v, a, b)   solve(f, v, guess [, lo, hi])
  function binder(node, scope, need) {
    const { name, args } = node;
    const v = args[1].name, slot = nslots++;
    const inner = { ...scope, [v]: slot };
    const f = c(args[0], inner);
    const pt = (env, k, label) => {
      const z = realOf(c(args[k], scope)(env));
      if (!Number.isFinite(z)) throw new CalcError(`${name}( needs a real number for ${label}`);
      return z;
    };
    const mk = (env) => (t) => {
      const old = env[slot];
      env[slot] = t;
      try { return realOf(f(env)); } catch (e) { if (strict && !(e instanceof CalcError)) return NaN; throw e; } finally { env[slot] = old; }
    };
    if (name === "nderiv") {
      need(3);
      const at = c(args[2], scope);
      return (env) => {
        const a = realOf(at(env));
        if (!Number.isFinite(a)) throw new CalcError("nDeriv( needs a real point");
        const r = derivativeEx(mk(env), a);
        if (r.ok) return r.value;
        if (!strict) return NaN;
        if (r.reason === "corner") throw new CalcError(`Derivative does not exist at ${v} = ${fmtNum(a)} (corner or cusp)`);
        if (r.reason === "undefined") throw new CalcError(`Function is undefined at or near ${v} = ${fmtNum(a)}`);
        throw new CalcError(`Derivative at ${v} = ${fmtNum(a)} could not be estimated reliably (infinite slope or too irregular)`);
      };
    }
    if (name === "fnint") {
      need(4);
      const lo = c(args[2], scope), hi = c(args[3], scope);
      return (env) => {
        const a = realOf(lo(env)), b = realOf(hi(env));
        if (!Number.isFinite(a) || !Number.isFinite(b)) throw new CalcError("fnInt( needs real, finite limits");
        const r = integrateEx(mk(env), a, b);
        if (r.ok) return r.value;
        if (!strict) return NaN;
        if (r.reason === "undefined") throw new CalcError(`Integrand is undefined somewhere between ${fmtNum(a)} and ${fmtNum(b)}`);
        throw new CalcError("Integral did not converge (singularity in the interval, or too oscillatory)");
      };
    }
    // solve
    need(3, 5);
    const g0 = c(args[2], scope);
    const lo = n5(args, 3) ? c(args[3], scope) : null, hi = n5(args, 4) ? c(args[4], scope) : null;
    return (env) => {
      const guess = realOf(g0(env));
      if (!Number.isFinite(guess)) throw new CalcError("solve( needs a real starting guess");
      const L = lo ? realOf(lo(env)) : -Infinity, H = hi ? realOf(hi(env)) : Infinity;
      const g = mk(env);
      const r = findRootNear(g, guess, { lo: L, hi: H });
      if (r.ok) return Math.abs(r.x) < 1e-12 && g(0) === 0 ? 0 : r.x;
      if (!strict) return NaN;
      throw new CalcError(`No real root found near ${v} = ${fmtNum(guess)} (try another guess or use SOLVE)`);
    };
  }
  const n5 = (a, k) => a.length > k;

  const root = c(ast, scope0);
  const env = [];
  const fn = (a, b, d) => { env[0] = a; env[1] = b; env[2] = d; return root(env); };
  const free = collectVars(ast);
  fn.freeVars = free;
  fn.usesX = free.has("x");
  fn.uses = (nm) => free.has(nm) || Object.keys(alias).some((k) => k === nm && free.has(k));
  fn.ast = ast;
  return fn;
}

const fmtNum = (v) => String(Number(v.toPrecision(10)));

// ---------- results ----------
function check(v, allowComplex) {
  if (isArr(v)) { v.forEach((x) => check(x, allowComplex)); return v; }
  if (typeof v === "number") {
    if (Number.isNaN(v)) throw new CalcError("Domain error: the result is undefined");
    if (!Number.isFinite(v)) throw new CalcError("Overflow: result is too large");
    return v;
  }
  if (isComplex(v)) {
    if (CX.isNaNC(v)) throw new CalcError("Domain error: the result is undefined");
    if (!CX.isFiniteC(v)) throw new CalcError("Overflow: result is too large");
    if (!allowComplex) throw new CalcError("Non-real result — turn on a+bi mode in SETTINGS to see complex values");
    return v;
  }
  throw new CalcError("Unsupported value");
}

/** Evaluate for the CALC screen. Throws CalcError. */
export function evaluate(src, opts = {}) {
  const fn = compile(src, { ...opts, strict: true, indep: [] });
  return check(fn(), opts.complex !== false);
}

/**
 * Execute one CALC line: an expression, or a store ("a=5", "5→a").
 * Returns {kind:"assign", name, value} or {kind:"value", value}.
 */
export function run(src, opts = {}) {
  const asg = parseAssignment(src);
  if (asg) {
    const value = evaluate(asg.expr, opts);
    return { kind: "assign", name: asg.name, value };
  }
  return { kind: "value", value: evaluate(src, opts) };
}

/** Compile a real-valued function of the named independent variables; returns (a,b,c)=>number (NaN when undefined). */
export function compileReal(src, opts = {}) {
  const fn = compile(src, { ...opts, strict: false, complex: false });
  const g = (a, b, d) => {
    try { return realOf(fn(a, b, d)); } catch { return NaN; }
  };
  g.usesX = fn.usesX; g.freeVars = fn.freeVars; g.uses = fn.uses; g.ast = fn.ast;
  return g;
}
/** Compile a function of x for graphing/tables; returns x => number (NaN when undefined). */
export const compileGraph = compileReal;

/** Cheap validation used by editors. */
export function validate(src, opts = {}) {
  if (!src.trim()) return { ok: true, empty: true };
  try { const fn = compile(src, opts); return { ok: true, usesX: fn.usesX, freeVars: fn.freeVars }; }
  catch (e) { return { ok: false, error: e.message }; }
}

/** Does the expression mention the variable x (used for the "Plot in Y=" hint)? */
export function mentionsX(src) {
  try { return collectVars(parse(src)).has("x"); } catch { return false; }
}
