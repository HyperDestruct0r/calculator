// Lexer and parser: source text -> AST. No evaluation happens here and no eval()/Function() is used.
// Also: relation splitting (lhs < rhs), assignment detection (a=5 / 5→a) and free-variable analysis.

export class CalcError extends Error {
  constructor(message) { super(message); this.name = "CalcError"; }
}

// ---------- names ----------
const UNARY_NAMES = ["sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh",
  "asinh", "acosh", "atanh", "sqrt", "cbrt", "abs", "ln", "exp", "floor", "ceil", "sign", "int", "fact",
  "gamma", "fib", "catalan", "ipart", "fpart", "arg", "conj", "real", "imag"];
const OTHER_NAMES = ["log", "round", "mod", "rem", "idiv", "npr", "ncr", "gcd", "lcm", "root", "roots", "min", "max",
  "sum", "mean", "dim", "angle", "hypot", "polar", "polyroots", "nderiv", "fnint", "solve"];
export const FUNCTION_NAMES = [...UNARY_NAMES, ...OTHER_NAMES];
export const FN_SET = new Set(FUNCTION_NAMES);
export const UNARY_SET = new Set(UNARY_NAMES);
/** Functions whose 2nd argument is a bound variable: nDeriv(f, x, a), fnInt(f, x, a, b), solve(f, x, guess). */
export const BINDERS = new Set(["nderiv", "fnint", "solve"]);

/** Built-in constants (numbers). `i` is handled separately as the imaginary unit. */
export const CONSTANTS = {
  pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2, euler: 0.5772156649015329,
};
export const BUILTIN_CONSTANT_NAMES = ["pi", "e", "i", "tau", "phi", "euler"];
const KNOWN = [...FUNCTION_NAMES, ...BUILTIN_CONSTANT_NAMES, "ans", "theta"].sort((a, b) => b.length - a.length);
export const RESERVED_NAMES = new Set([...KNOWN]);
/** Letters that can hold user values. `e` and `i` are built-in constants. */
export const isVariableName = (n) => /^[a-z]$/.test(n) && n !== "e" && n !== "i";

// ---------- lexer ----------
const isDigit = (c) => c !== undefined && c >= "0" && c <= "9";
const isLetter = (c) => c !== undefined && /[A-Za-zπ√θτφ]/.test(c);
const GLYPH = { "π": "pi", "√": "sqrt", "θ": "theta", "τ": "tau", "φ": "phi" };

export function lex(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  const push = (type, value, pos, end, extra) => toks.push({ type, value, pos, end, ...extra });
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
      push("num", Number(src.slice(i, j).replace("ᴇ", "e").replace("−", "-")), i, j);
      i = j; continue;
    }
    if (isLetter(c)) {
      let j = i;
      while (isLetter(src[j])) j++;
      const run = src.slice(i, j).toLowerCase().replace(/[πθτφ√]/g, (g) => GLYPH[g]);
      let p = 0;
      while (p < run.length) {
        const hit = KNOWN.find((nm) => run.startsWith(nm, p));
        if (hit) { push("name", hit, i, j); p += hit.length; continue; }
        const ch = run[p];
        if (/[a-z]/.test(ch)) { push("name", ch, i, j); p++; continue; }
        throw new CalcError("Unknown name: " + run.slice(p));
      }
      i = j; continue;
    }
    if (c === "*" && src[i + 1] === "*") { push("op", "^", i, i + 2); i += 2; continue; }
    if ((c === "<" || c === ">") && src[i + 1] === "=") { push("op", c + "=", i, i + 2); i += 2; continue; }
    if (c === "-" && src[i + 1] === ">") { push("op", "→", i, i + 2); i += 2; continue; }
    const map = { "×": "*", "·": "*", "÷": "/", "−": "-", "–": "-", "≤": "<=", "≥": ">=" };
    const ch = map[c] || c;
    if ("+-*/^(),!%°{}<>=→".includes(ch) || ch === "<=" || ch === ">=") { push("op", ch, i, i + 1); i++; continue; }
    if (c === "²" || c === "³") {
      push("op", "^", i, i + 1); push("op", "(", i, i + 1);
      push("num", c === "²" ? 2 : 3, i, i + 1); push("op", ")", i, i + 1);
      i++; continue;
    }
    throw new CalcError(`Syntax error: unexpected "${c}"`);
  }
  return toks;
}

// ---------- parser ----------
/**
 * parse(src, opts) -> AST.
 *   opts.refs: names that act as sequence references, e.g. ["u"]: u(n-1) -> {t:"ref"}.
 */
export function parse(src, opts = {}) { return parseTokens(lex(src), opts); }

export function parseTokens(t, opts = {}) {
  const refs = new Set(opts.refs || []);
  let i = 0;
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
      else if (isOp("°")) { i++; a = { t: "deg", a }; } // converts to the current angle unit at evaluation time
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
      if (["<", ">", "<=", ">=", "="].includes(k.value)) throw new CalcError(`Unexpected "${k.value}" — relations are only allowed in inequalities and SOLVE`);
      if (k.value === "→") throw new CalcError("Unexpected → — store with  value → letter");
      throw new CalcError(`Syntax error: unexpected "${k.value}"`);
    }
    const name = k.value;
    if (refs.has(name) && isOp("(")) {
      i++;
      const a = args();
      if (a.length !== 1) throw new CalcError(`${name}( takes one index, e.g. ${name}(n-1)`);
      return { t: "ref", name, arg: a[0] };
    }
    if (name === "ans") return { t: "ans" };
    if (name === "i") return { t: "imag" };
    if (name in CONSTANTS) return { t: "num", v: CONSTANTS[name], name };
    if (FN_SET.has(name)) {
      if (!isOp("(")) throw new CalcError(`Syntax error: ${name} needs parentheses, e.g. ${name}(…)`);
      i++;
      const node = { t: "call", name, args: args() };
      if (BINDERS.has(name)) {
        const v = node.args[1];
        if (!v || v.t !== "var") throw new CalcError(`${name}( needs a variable as its 2nd argument, e.g. ${name}(f, x, …)`);
      }
      return node;
    }
    return { t: "var", name }; // theta, x, a, … — resolved by the compiler
  }

  if (!t.length) throw new CalcError("Empty expression");
  const ast = addsub();
  if (i < t.length) {
    const k = t[i];
    if (["<", ">", "<=", ">=", "="].includes(k.value)) throw new CalcError(`Unexpected "${k.value}" — relations are only allowed in inequalities and SOLVE`);
    throw new CalcError(`Syntax error: unexpected "${k.value}"`);
  }
  return ast;
}

// ---------- relations (a < b, a = b …) ----------
const REL_OPS = ["<", ">", "<=", ">=", "="];
/** Split "lhs REL rhs" at its single top-level relation operator. Returns {lhs, op, rhs, strict, inclusive}. */
export function splitRelation(src) {
  const toks = lex(src);
  let depth = 0, hit = -1;
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.type !== "op") continue;
    if (tk.value === "(" || tk.value === "{") depth++;
    else if (tk.value === ")" || tk.value === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && REL_OPS.includes(tk.value)) {
      if (hit >= 0) throw new CalcError("Only one relation (<, >, ≤, ≥ or =) is allowed");
      hit = k;
    }
  }
  if (hit < 0) return null;
  const op = toks[hit].value;
  const lhs = src.slice(0, toks[hit].pos).trim(), rhs = src.slice(toks[hit].end).trim();
  if (!lhs || !rhs) throw new CalcError("A relation needs an expression on both sides");
  return { lhs, rhs, op, strict: op === "<" || op === ">", inclusive: op === "<=" || op === ">=" || op === "=" };
}

/**
 * Detect "a=expr" or "expr→a". Returns {name, expr} or null; throws for attempts to redefine built-ins.
 * Only single-letter names can be assigned (a–z except e and i).
 */
export function parseAssignment(src) {
  const toks = lex(src);
  const arrow = toks.findIndex((k) => k.type === "op" && k.value === "→");
  if (arrow >= 0) {
    if (arrow !== toks.length - 2 || arrow === 0) throw new CalcError("Store with  value → letter  (the letter goes last)");
    return checkTarget(toks[toks.length - 1], src.slice(0, toks[arrow].pos).trim());
  }
  if (toks.length >= 3 && toks[0].type === "name" && toks[1].type === "op" && toks[1].value === "=" &&
      !toks.slice(2).some((k) => k.type === "op" && REL_OPS.includes(k.value))) {
    return checkTarget(toks[0], src.slice(toks[2].pos).trim());
  }
  return null;
}
function checkTarget(tok, expr) {
  if (tok.type !== "name") throw new CalcError("Can only store into a letter variable (a–z)");
  const n = tok.value;
  if (n === "e" || n === "i" || n in CONSTANTS) throw new CalcError(`${n === "pi" ? "π" : n} is a built-in constant and cannot be redefined`);
  if (!isVariableName(n)) throw new CalcError(`"${n}" is a reserved name — use a single letter (a–z, not e or i)`);
  if (!expr) throw new CalcError("Nothing to store");
  return { name: n, expr };
}

// ---------- analysis ----------
/** Names of free variables (everything that is not bound by nDeriv/fnInt/solve). */
export function collectVars(ast, bound = new Set(), out = new Set()) {
  switch (ast.t) {
    case "var": if (!bound.has(ast.name)) out.add(ast.name); break;
    case "bin": collectVars(ast.a, bound, out); collectVars(ast.b, bound, out); break;
    case "neg": case "fact": case "deg": collectVars(ast.a, bound, out); break;
    case "ref": collectVars(ast.arg, bound, out); break;
    case "list": ast.items.forEach((x) => collectVars(x, bound, out)); break;
    case "call":
      if (BINDERS.has(ast.name)) {
        const b = new Set(bound); b.add(ast.args[1].name);
        collectVars(ast.args[0], b, out);
        ast.args.slice(2).forEach((x) => collectVars(x, bound, out));
      } else ast.args.forEach((x) => collectVars(x, bound, out));
      break;
    default: break;
  }
  return out;
}
export function usesImag(ast) {
  switch (ast.t) {
    case "imag": return true;
    case "bin": return usesImag(ast.a) || usesImag(ast.b);
    case "neg": case "fact": case "deg": return usesImag(ast.a);
    case "ref": return usesImag(ast.arg);
    case "list": return ast.items.some(usesImag);
    case "call": return ast.args.some(usesImag);
    default: return false;
  }
}
