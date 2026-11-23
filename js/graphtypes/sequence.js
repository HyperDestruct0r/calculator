// SEQUENCE graphs: explicit u(n)=n² and recursive u(n)=u(n-1)+u(n-2) with initial values.
import { CalcError, parse } from "../parser.js";
import { compile, evaluate } from "../engine.js";

export const MAX_TERMS = 5000;

function hasRef(ast) {
  if (!ast || typeof ast !== "object") return false;
  if (ast.t === "ref") return true;
  return Object.values(ast).some((v) => (Array.isArray(v) ? v.some(hasRef) : v && typeof v === "object" ? hasRef(v) : false));
}

/**
 * computeSequence({expr, init}, {nMin, nMax, angle, vars}) -> {terms:[{n, value}], error?, recursive}
 *  expr  formula for u(n), may use u(n-1), u(n-2)…
 *  init  comma separated values of u(nMin), u(nMin+1), … (needed for recursive sequences)
 * Terms are computed in increasing n, so there is no recursion and no stack growth. A reference to a term that is
 * not available yet (u(n), u(n+1)) is reported as an error. At most MAX_TERMS terms are computed.
 */
export function computeSequence({ expr, init = "" }, { nMin = 1, nMax = 20, angle = "rad", vars = {} } = {}) {
  const fail = (msg, terms = [], recursive = false) => ({ terms, error: msg, recursive });
  if (!String(expr || "").trim()) return fail("Enter a formula for u(n)");
  if (!Number.isInteger(nMin) || !Number.isInteger(nMax)) return fail("nMin and nMax must be integers");
  if (nMax < nMin) return fail("nMax must be at least nMin");
  if (nMax - nMin + 1 > MAX_TERMS) return fail(`Too many terms (the limit is ${MAX_TERMS})`);
  let ast;
  try { ast = parse(expr, { refs: ["u"] }); } catch (e) { return fail(e.message); }
  const recursive = hasRef(ast);
  let initVals = [];
  if (String(init).trim()) {
    try {
      const v = evaluate("{" + init + "}", { angle, vars });
      initVals = v.map((q) => { if (typeof q !== "number") throw new CalcError("Initial values must be real numbers"); return q; });
    } catch (e) { return fail("Initial values: " + e.message, [], recursive); }
  }
  if (recursive && !initVals.length) return fail(`A recursive sequence needs initial value(s), e.g. 1 for u(${nMin})`, [], true);
  const vals = new Map();
  let n = nMin;
  const resolve = (name, k) => {
    if (k < nMin) throw new CalcError(`u(${k}) is undefined: the sequence starts at n = ${nMin}`);
    if (k >= n) throw new CalcError(`u(${k}) is not available yet — a term may only use earlier terms`);
    const v = vals.get(k);
    if (!Number.isFinite(v)) throw new CalcError(`u(${k}) is undefined, so later terms depend on an undefined value`);
    return v;
  };
  let fn;
  try { fn = compile(ast, { angle, vars, strict: true, indep: ["n"], refs: ["u"], resolve, complex: false }); }
  catch (e) { return fail(e.message, [], recursive); }
  const terms = [];
  let error;
  for (n = nMin; n <= nMax; n++) {
    let value;
    const k = n - nMin;
    if (k < initVals.length) value = initVals[k];
    else {
      try {
        const v = fn(n);
        if (typeof v !== "number") throw new CalcError("Terms must be real numbers");
        if (Number.isNaN(v)) throw new CalcError("Domain error: u(" + n + ") is undefined");
        if (!Number.isFinite(v)) throw new CalcError(`u(${n}) is too large to represent`);
        value = v;
      } catch (e) {
        if (!error) error = `n = ${n}: ${e.message}`;
        value = NaN;
        if (recursive) { terms.push({ n, value }); break; }
      }
    }
    vals.set(n, value);
    terms.push({ n, value });
  }
  return { terms, error, recursive };
}
