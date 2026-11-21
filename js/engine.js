// Safe expression engine: lexer -> parser (AST) -> closure compiler.
// No eval(), no Function(). Values are numbers or arrays of numbers (lists).

export class CalcError extends Error {
  constructor(message) { super(message); this.name = "CalcError"; }
}

const isArr = Array.isArray;
const PI = Math.PI;

// ---------- helpers ----------
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

function gamma(z) {
  if (z < 0.5) return PI / (Math.sin(PI * z) * gamma(1 - z));
  z -= 1;
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let a = c[0];
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (z + i);
  return Math.sqrt(2 * PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
}
function fact(n) {
  if (Number.isInteger(n)) {
    if (n < 0) return NaN;
    if (n > 170) return Infinity;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }
  if (n < 0 && Number.isInteger(n)) return NaN;
  const r = gamma(n + 1);
  return Number.isFinite(r) ? r : NaN;
}
function pow(a, b) {
  if (a < 0 && !Number.isInteger(b)) {
    const f = toFractionParts(b, 999, 1e-12);
    if (f && f.q % 2 === 1) { const r = Math.pow(-a, b); return f.p % 2 === 0 ? r : -r; }
    return NaN;
  }
  return Math.pow(a, b);
}
const isInt = Number.isInteger;
function nPr(n, r) {
  if (!isInt(n) || !isInt(r) || n < 0 || r < 0 || r > n) return NaN;
  let v = 1; for (let i = 0; i < r; i++) v *= (n - i); return v;
}
function nCr(n, r) {
  if (!isInt(n) || !isInt(r) || n < 0 || r < 0 || r > n) return NaN;
  r = Math.min(r, n - r);
  let v = 1; for (let i = 1; i <= r; i++) v = v * (n - r + i) / i;
  return Math.round(v);
}
function gcd(a, b) {
  if (!isInt(a) || !isInt(b)) return NaN;
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
function roundHalfAway(x, n = 0) {
  if (!Number.isFinite(x)) return x;
  const f = Math.pow(10, n), s = x < 0 ? -1 : 1;
  const v = Math.abs(x) * f;
  const r = Math.round(Number(v.toPrecision(15)));
  return s * r / f;
}
function modulo(a, b) { return b === 0 ? NaN : a - b * Math.floor(a / b); }

// angle-aware trig with exact multiples of a quarter turn
function trigSet(angle) {
  const deg = angle === "deg";
  const quarter = deg ? 90 : PI / 2;
  const k = deg ? PI / 180 : 1;
  const quad = (x) => {
    const q = x / quarter, r = Math.round(q);
    if (Math.abs(q - r) <= 1e-14 * Math.max(1, Math.abs(q))) return ((r % 4) + 4) % 4;
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
  };
}

// ---------- names ----------
const UNARY_NAMES = ["sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
  "asinh", "acosh", "atanh", "sqrt", "cbrt", "abs", "ln", "exp", "floor", "ceil", "sign", "int", "fact"];
const OTHER_NAMES = ["log", "round", "mod", "npr", "ncr", "gcd", "lcm", "root", "min", "max",
  "sum", "mean", "dim", "nderiv", "fnint"];
export const FUNCTION_NAMES = [...UNARY_NAMES, ...OTHER_NAMES];
const CONSTS = { pi: PI, e: Math.E };
const ALL_NAMES = [...FUNCTION_NAMES, "pi", "e", "x", "ans"].sort((a, b) => b.length - a.length);
const FN_SET = new Set(FUNCTION_NAMES);

// ---------- lexer ----------
const isDigit = (c) => c !== undefined && c >= "0" && c <= "9";
const isLetter = (c) => c !== undefined && /[A-Za-zπ√]/.test(c);

function lex(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\u00a0") { i++; continue; }
    if (isDigit(c) || c === ".") {
      let j = i;
      while (isDigit(src[j])) j++;
      if (src[j] === ".") { j++; while (isDigit(src[j])) j++; }
      if (j === i + 1 && c === ".") throw new CalcError("Syntax error: stray decimal point");
      if (src[j] === "e" || src[j] === "E" || src[j] === "ᴇ") {
        let k = j + 1;
        if (src[k] === "+" || src[k] === "-" || src[k] === "−") k++;
        if (isDigit(src[k])) { while (isDigit(src[k])) k++; j = k; }
      }
      if (src[j] === ".") throw new CalcError("Syntax error: bad number");
      toks.push({ type: "num", value: Number(src.slice(i, j).replace("ᴇ", "e").replace("−", "-")) });
      i = j; continue;
    }
    if (isLetter(c)) {
      let j = i;
      while (isLetter(src[j])) j++;
      const run = src.slice(i, j).toLowerCase().replace(/π/g, "pi").replace(/√/g, "sqrt");
      let p = 0;
      while (p < run.length) {
        const hit = ALL_NAMES.find((nm) => run.startsWith(nm, p));
        if (!hit) throw new CalcError("Unknown name: " + run.slice(p));
        toks.push({ type: "name", value: hit });
        p += hit.length;
      }
      i = j; continue;
    }
    if (c === "*" && src[i + 1] === "*") { toks.push({ type: "op", value: "^" }); i += 2; continue; }
    const map = { "×": "*", "·": "*", "÷": "/", "−": "-", "–": "-" };
    const ch = map[c] || c;
    if ("+-*/^(),!%°{}".includes(ch)) { toks.push({ type: "op", value: ch }); i++; continue; }
    if (c === "²" || c === "³") {
      toks.push({ type: "op", value: "^" }, { type: "op", value: "(" },
        { type: "num", value: c === "²" ? 2 : 3 }, { type: "op", value: ")" });
      i++; continue;
    }
    throw new CalcError(`Syntax error: unexpected "${c}"`);
  }
  return toks;
}

// ---------- parser ----------
export function parse(src) {
  const t = lex(src);
  let i = 0;
  const peek = () => t[i];
  const isOp = (v) => t[i] && t[i].type === "op" && t[i].value === v;
  const startsPrimary = () => {
    const k = t[i];
    if (!k) return false;
    return k.type === "num" || k.type === "name" || (k.type === "op" && (k.value === "(" || k.value === "{"));
  };
  const close = () => {
    if (i >= t.length) return; // missing closers at the end are tolerated
    if (isOp(")")) { i++; return; }
    throw new CalcError("Syntax error: expected )");
  };

  function addsub() {
    let a = muldiv();
    while (isOp("+") || isOp("-")) {
      const op = t[i++].value;
      a = { t: "bin", op, a, b: muldiv() };
    }
    return a;
  }
  function muldiv() {
    let a = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) { const op = t[i++].value; a = { t: "bin", op, a, b: unary() }; }
      else if (startsPrimary()) a = { t: "bin", op: "*", a, b: unary() };
      else break;
    }
    return a;
  }
  function unary() {
    if (isOp("-")) { i++; return { t: "neg", a: unary() }; }
    if (isOp("+")) { i++; return unary(); }
    return power();
  }
  function power() {
    const base = postfix();
    if (isOp("^")) { i++; return { t: "bin", op: "^", a: base, b: unary() }; }
    return base;
  }
  function postfix() {
    let a = primary();
    for (;;) {
      if (isOp("!")) { i++; a = { t: "fact", a }; }
      else if (isOp("%")) { i++; a = { t: "bin", op: "/", a, b: { t: "num", v: 100 } }; }
      else if (isOp("°")) { i++; a = { t: "bin", op: "*", a, b: { t: "num", v: PI / 180 } }; }
      else break;
    }
    return a;
  }
  function args() {
    const list = [];
    if (i >= t.length || isOp(")")) { close(); return list; }
    list.push(addsub());
    while (isOp(",")) { i++; list.push(addsub()); }
    close();
    return list;
  }
  function primary() {
    const k = t[i++];
    if (!k) throw new CalcError("Syntax error: incomplete expression");
    if (k.type === "num") return { t: "num", v: k.value };
    if (k.type === "op") {
      if (k.value === "(") { const e = addsub(); close(); return e; }
      if (k.value === "{") {
        const items = [];
        if (!isOp("}")) { items.push(addsub()); while (isOp(",")) { i++; items.push(addsub()); } }
        if (i < t.length) { if (!isOp("}")) throw new CalcError("Syntax error: expected }"); i++; }
        return { t: "list", items };
      }
      throw new CalcError(`Syntax error: unexpected "${k.value}"`);
    }
    const name = k.value;
    if (name === "x") return { t: "var" };
    if (name === "ans") return { t: "ans" };
    if (name in CONSTS) return { t: "num", v: CONSTS[name] };
    if (FN_SET.has(name)) {
      if (!isOp("(")) throw new CalcError(`Syntax error: ${name} needs parentheses, e.g. ${name}(…)`);
      i++;
      return { t: "call", name, args: args() };
    }
    throw new CalcError("Unknown name: " + name);
  }

  if (!t.length) throw new CalcError("Empty expression");
  const ast = addsub();
  if (i < t.length) {
    const k = t[i];
    throw new CalcError(`Syntax error: unexpected "${k.value}"`);
  }
  return ast;
}

function usesVar(node) {
  switch (node.t) {
    case "var": return true;
    case "bin": return usesVar(node.a) || usesVar(node.b);
    case "neg": case "fact": return usesVar(node.a);
    case "call":
      // nDeriv(f,x,a) / fnInt(f,x,a,b) bind x inside their first argument
      return (node.name === "nderiv" || node.name === "fnint" ? node.args.slice(2) : node.args).some(usesVar);
    case "list": return node.items.some(usesVar);
    default: return false;
  }
}

// ---------- compiler ----------
function lift1(f) { return (v) => (isArr(v) ? v.map(f) : f(v)); }
function lift2(f) {
  return (a, b) => {
    const A = isArr(a), B = isArr(b);
    if (!A && !B) return f(a, b);
    if (A && B) {
      if (a.length !== b.length) throw new CalcError("Dimension mismatch");
      return a.map((v, i) => f(v, b[i]));
    }
    return A ? a.map((v) => f(v, b)) : b.map((v) => f(a, v));
  };
}
const flat = (args) => args.flatMap((a) => (isArr(a) ? a : [a]));

function integrate(f, a, b) {
  if (a === b) return 0;
  const simpson = (fa, fm, fb, h) => (h / 6) * (fa + 4 * fm + fb);
  const rec = (a, b, fa, fm, fb, whole, tol, depth) => {
    const m = (a + b) / 2, lm = (a + m) / 2, rm = (m + b) / 2;
    const flm = f(lm), frm = f(rm);
    const left = simpson(fa, flm, fm, m - a), right = simpson(fm, frm, fb, b - m);
    const diff = left + right - whole;
    if (depth <= 0 || Math.abs(diff) <= 15 * tol) return left + right + diff / 15;
    return rec(a, m, fa, flm, fm, left, tol / 2, depth - 1) + rec(m, b, fm, frm, fb, right, tol / 2, depth - 1);
  };
  const N = 32, h = (b - a) / N;
  let total = 0;
  for (let i = 0; i < N; i++) {
    const x0 = a + i * h, x1 = x0 + h, xm = (x0 + x1) / 2;
    const f0 = f(x0), fm = f(xm), f1 = f(x1);
    total += rec(x0, x1, f0, fm, f1, simpson(f0, fm, f1, h), 1e-11 / N, 18);
  }
  return total;
}
function derivative(f, a) {
  const h = 1e-3 * Math.max(1, Math.abs(a));
  return (-f(a + 2 * h) + 8 * f(a + h) - 8 * f(a - h) + f(a - 2 * h)) / (12 * h);
}
export { integrate as numIntegrate, derivative as numDerivative };

function buildFunctions(ctx) {
  const tr = trigSet(ctx.angle);
  const U = {
    sin: tr.sin, cos: tr.cos, tan: tr.tan, asin: tr.asin, acos: tr.acos, atan: tr.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh,
    acosh: (x) => (x < 1 ? NaN : Math.acosh(x)),
    atanh: (x) => (Math.abs(x) >= 1 ? (Math.abs(x) === 1 ? Math.sign(x) * Infinity : NaN) : Math.atanh(x)),
    sqrt: (x) => (x < 0 ? NaN : Math.sqrt(x)), cbrt: Math.cbrt, abs: Math.abs,
    ln: (x) => (x <= 0 ? NaN : Math.log(x)), exp: Math.exp, floor: Math.floor, ceil: Math.ceil,
    sign: Math.sign, int: Math.trunc, fact,
  };
  const logb = (x, b) => Math.log(x) / Math.log(b);
  return { U, logb };
}

export function compile(src, opts = {}) {
  const ctx = { angle: opts.angle || "rad", strict: !!opts.strict, ans: opts.ans === undefined ? 0 : opts.ans };
  const ast = parse(src);
  const { U, logb } = buildFunctions(ctx);
  const strict = ctx.strict;
  const div = (a, b) => { if (strict && b === 0) throw new CalcError("Divide by zero"); return a / b; };
  const add = lift2((a, b) => a + b), sub = lift2((a, b) => a - b), mul = lift2((a, b) => a * b);
  const dv = lift2(div);
  const pw = lift2((a, b) => {
    if (strict && a === 0 && b < 0) throw new CalcError("Divide by zero");
    return pow(a, b);
  });

  function c(node) {
    switch (node.t) {
      case "num": { const v = node.v; return () => v; }
      case "var": return (x) => x;
      case "ans": { const v = ctx.ans; return () => v; }
      case "neg": { const A = c(node.a); return (x) => { const a = A(x); return typeof a === "number" ? -a : a.map((v) => -v); }; }
      case "fact": { const A = c(node.a); const f = lift1(fact); return (x) => f(A(x)); }
      case "list": {
        const items = node.items.map(c);
        return (x) => items.map((f) => {
          const v = f(x);
          if (isArr(v)) throw new CalcError("Lists cannot be nested");
          return v;
        });
      }
      case "bin": {
        const A = c(node.a), B = c(node.b);
        const op = { "+": add, "-": sub, "*": mul, "/": dv, "^": pw }[node.op];
        if (node.op === "+") return (x) => { const a = A(x), b = B(x); return typeof a === "number" && typeof b === "number" ? a + b : add(a, b); };
        if (node.op === "-") return (x) => { const a = A(x), b = B(x); return typeof a === "number" && typeof b === "number" ? a - b : sub(a, b); };
        if (node.op === "*") return (x) => { const a = A(x), b = B(x); return typeof a === "number" && typeof b === "number" ? a * b : mul(a, b); };
        return (x) => op(A(x), B(x));
      }
      case "call": return call(node);
    }
    throw new CalcError("Syntax error");
  }

  function call(node) {
    const { name, args } = node;
    const n = args.length;
    const need = (lo, hi = lo) => {
      if (n < lo || n > hi) throw new CalcError(`${name}( takes ${lo === hi ? lo : lo + "–" + hi} argument${hi === 1 ? "" : "s"}`);
    };
    if (name === "nderiv") {
      need(3);
      const f = c(args[0]), at = c(args[2]);
      return (x) => derivative((t) => { const v = f(t); return typeof v === "number" ? v : NaN; }, at(x));
    }
    if (name === "fnint") {
      need(4);
      const f = c(args[0]), lo = c(args[2]), hi = c(args[3]);
      return (x) => integrate((t) => { const v = f(t); return typeof v === "number" ? v : NaN; }, lo(x), hi(x));
    }
    const A = args.map(c);
    if (name in U) {
      need(1);
      const u = lift1(U[name]), a0 = A[0], raw = U[name];
      return (x) => { const v = a0(x); return typeof v === "number" ? raw(v) : u(v); };
    }
    switch (name) {
      case "log": {
        need(1, 2);
        if (n === 1) { const u = lift1(Math.log10), a0 = A[0]; return (x) => { const v = a0(x); return typeof v === "number" ? (v <= 0 ? NaN : Math.log10(v)) : u(v); }; }
        const f = lift2((v, b) => (v <= 0 || b <= 0 ? NaN : logb(v, b)));
        return (x) => f(A[0](x), A[1](x));
      }
      case "round": {
        need(1, 2);
        const f = lift2((v, d) => roundHalfAway(v, d));
        return (x) => f(A[0](x), n === 2 ? A[1](x) : 0);
      }
      case "mod": { need(2); const f = lift2(modulo); return (x) => f(A[0](x), A[1](x)); }
      case "npr": { need(2); const f = lift2(nPr); return (x) => f(A[0](x), A[1](x)); }
      case "ncr": { need(2); const f = lift2(nCr); return (x) => f(A[0](x), A[1](x)); }
      case "gcd": { need(2); const f = lift2(gcd); return (x) => f(A[0](x), A[1](x)); }
      case "lcm": { need(2); const f = lift2((a, b) => (a === 0 || b === 0 ? 0 : Math.abs(a * b) / gcd(a, b))); return (x) => f(A[0](x), A[1](x)); }
      case "root": {
        need(2);
        const f = lift2((k, v) => pow(v, 1 / k));
        return (x) => f(A[0](x), A[1](x));
      }
      case "min": case "max": {
        need(1, 99);
        const fn = name === "min" ? Math.min : Math.max;
        return (x) => { const v = flat(A.map((f) => f(x))); return v.length ? fn(...v) : NaN; };
      }
      case "sum": case "mean": {
        need(1, 99);
        return (x) => {
          const v = flat(A.map((f) => f(x)));
          const s = v.reduce((p, q) => p + q, 0);
          return name === "sum" ? s : s / v.length;
        };
      }
      case "dim": { need(1); return (x) => { const v = A[0](x); return isArr(v) ? v.length : 1; }; }
    }
    throw new CalcError("Unknown function: " + name);
  }

  const fn = c(ast);
  fn.usesX = usesVar(ast);
  return fn;
}

function check(v) {
  if (typeof v === "number") {
    if (Number.isNaN(v)) throw new CalcError("Domain error: result is not a real number");
    if (!Number.isFinite(v)) throw new CalcError("Overflow: result is too large");
    return v;
  }
  v.forEach(check);
  return v;
}

/** Evaluate for the CALC screen. Throws CalcError. */
export function evaluate(src, opts = {}) {
  const fn = compile(src, { ...opts, strict: true });
  if (fn.usesX) throw new CalcError("x has no value here — send it to Y= with GRAPH, or use TABLE");
  return check(fn(0));
}

/** Compile a function of x for graphing/tables; returns x => number (NaN when undefined). */
export function compileGraph(src, opts = {}) {
  const fn = compile(src, { ...opts, strict: false });
  const g = (x) => {
    try {
      const v = fn(x);
      return typeof v === "number" ? v : NaN;
    } catch { return NaN; }
  };
  g.usesX = fn.usesX;
  return g;
}

/** Cheap validation used by editors. */
export function validate(src, opts = {}) {
  if (!src.trim()) return { ok: true, empty: true };
  try { const fn = compile(src, opts); return { ok: true, usesX: fn.usesX }; }
  catch (e) { return { ok: false, error: e.message }; }
}
