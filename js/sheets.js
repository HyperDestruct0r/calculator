// Overlay sheets: MATH/NUM/CMPLX/REL menu, SOLVE (equation, polynomial, system), VARS, value prompt.
import { tok, fnTok } from "./editor.js";
import { evaluate } from "./engine.js";
import { solveEquation, solveSystem } from "./solver.js";
import { polynomialRoots } from "./polynomial.js";
import { escapeHtml, numberToEntryText, formatNumber } from "./format.js";
import { isVariableName } from "./parser.js";
import { isComplex } from "./complex.js";

const sheetEl = (html) => { const s = document.createElement("div"); s.className = "sheet"; s.innerHTML = html; return s; };
const wireEscape = (app, s) => s.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); app.closeOverlay(); } });

// ====================== value prompt (used by the Eval tools) ======================
export function openPromptSheet(app, title, fields, cb) {
  const s = sheetEl(`<h2>${escapeHtml(title)}</h2>
    ${fields.map((f) => `<label class="pf"><span>${escapeHtml(f.label)}</span><input type="text" data-k="${f.key}" autocomplete="off" spellcheck="false" inputmode="text"></label>`).join("")}
    <div class="pf-err" hidden></div>
    <div class="btnrow"><button type="button" class="close">Cancel</button><button type="button" class="go">OK</button></div>`);
  const err = s.querySelector(".pf-err");
  const go = () => {
    const vals = {};
    for (const f of fields) {
      const inp = s.querySelector(`input[data-k="${f.key}"]`);
      try {
        const v = evaluate(inp.value || "", { ...app.evalOpts(), complex: false });
        if (typeof v !== "number") throw new Error("needs a single real number");
        vals[f.key] = v;
      } catch (e) { err.hidden = false; err.textContent = `${f.label.replace(/\s*=\s*$/, "")}: ${e.message}`; inp.focus(); return; }
    }
    app.closeOverlay();
    cb(vals);
  };
  s.addEventListener("click", (e) => { if (e.target.closest(".close")) app.closeOverlay(); else if (e.target.closest(".go")) go(); });
  s.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  wireEscape(app, s);
  app.openOverlay(s);
  setTimeout(() => s.querySelector("input")?.focus(), 30);
}

// ====================== MATH / NUM / CMPLX / REL menu ======================
const fn = (label, name, note = "") => ({ label, note, make: () => fnTok(name) });
const tk = (label, t, d, note = "") => ({ label, note, make: () => tok(t, d) });
const TABS = {
  MATH: [
    fn("nDeriv(", "nderiv", "derivative at a point"), fn("fnInt(", "fnint", "definite integral"), fn("solve(", "solve", "root near a guess"),
    fn("nCr(", "ncr", "combinations"), fn("nPr(", "npr", "permutations"), fn("mod(", "mod", "modulo (sign of divisor)"),
    fn("gcd(", "gcd", "greatest common divisor"), fn("lcm(", "lcm", "least common multiple"),
    fn("min(", "min", "list or values"), fn("max(", "max", "list or values"), fn("sum(", "sum", "of a list"), fn("mean(", "mean", "of a list"),
    fn("round(", "round", "round(x, digits)"), fn("floor(", "floor"), fn("ceil(", "ceil"), fn("int(", "int", "truncate"), fn("sign(", "sign"),
    fn("log(x,b)", "log", "log base b"), fn("ˣ√", "root", "root(n, x)"),
    fn("sinh(", "sinh"), fn("cosh(", "cosh"), fn("tanh(", "tanh"), fn("sinh⁻¹(", "asinh"), fn("cosh⁻¹(", "acosh"), fn("tanh⁻¹(", "atanh"),
    tk("°", "°", "°", "degrees"), tk("%", "%", "%", "percent"), tk("ᴇ", "E", "ᴇ", "×10ⁿ"), { label: "{ }", note: "list", make: () => [tok("{"), tok("}")], back: 1 },
  ],
  NUM: [
    fn("iPart(", "ipart", "integer part"), fn("fPart(", "fpart", "fractional part"), fn("rem(", "rem", "remainder (sign of dividend)"), fn("idiv(", "idiv", "floor division"),
    fn("fib(", "fib", "Fibonacci"), fn("catalan(", "catalan", "Catalan number"), fn("gamma(", "gamma", "Γ(x)"), fn("hypot(", "hypot", "√(a²+b²)"), fn("angle(", "angle", "angle(y, x)"),
    tk("τ", "tau", "τ", "2π"), tk("φ", "phi", "φ", "golden ratio"), tk("γ", "euler", "γ", "Euler–Mascheroni"), tk("π", "pi", "π"), tk("e", "e", "e"),
  ],
  CMPLX: [
    tk("i", "i", "i", "imaginary unit"), fn("conj(", "conj", "conjugate"), fn("real(", "real", "real part"), fn("imag(", "imag", "imaginary part"),
    fn("abs(", "abs", "magnitude |z|"), fn("arg(", "arg", "argument (DEG/RAD)"), fn("polar(", "polar", "polar(r, θ) → a+bi"), fn("roots(", "roots", "roots(n, z): all n-th roots"),
    fn("polyRoots(", "polyroots", "polyRoots({a,b,c}) highest power first"),
    { label: "Show a+bi", note: "rectangular results", cmd: () => ({ complex: "rect" }) },
    { label: "Show r(cos θ+i sin θ)", note: "polar results", cmd: () => ({ complex: "polar" }) },
    { label: "Real only", note: "complex results are errors", cmd: () => ({ complex: "real" }) },
  ],
  REL: [
    tk("y", "y", "y"), tk("<", "<", "<"), tk(">", ">", ">"), tk("≤", "<=", "≤"), tk("≥", ">=", "≥"), tk("=", "=", "="),
    tk("→", "→", "→", "store: 5 → a"), tk("θ", "theta", "θ", "polar variable"), tk("t", "t", "t", "parametric variable"), tk("n", "n", "n", "sequence index"),
  ],
};

export function openMathSheet(app, tab = "MATH") {
  const s = sheetEl("");
  const render = (t) => {
    const items = TABS[t];
    s.innerHTML = `<div class="tabs">${Object.keys(TABS).map((k) => `<button type="button" data-tab="${k}" class="${k === t ? "on" : ""}">${k}</button>`).join("")}</div>
      <div class="menu-grid">${items.map((it, i) => `<button type="button" data-i="${i}">${escapeHtml(it.label)}${it.note ? `<small>${escapeHtml(it.note)}</small>` : ""}</button>`).join("")}</div>
      <button type="button" class="close">Close</button>`;
    s.dataset.cur = t;
  };
  render(tab);
  s.addEventListener("click", (e) => {
    const tb = e.target.closest("button[data-tab]");
    if (tb) { render(tb.dataset.tab); return; }
    if (e.target.closest(".close")) { app.closeOverlay(); return; }
    const b = e.target.closest("[data-i]");
    if (!b) return;
    const it = TABS[s.dataset.cur][Number(b.dataset.i)];
    if (it.cmd) {
      const patch = it.cmd();
      Object.assign(app.state.settings, patch);
      app.applySettings("complex");
      app.toast(patch.complex === "rect" ? "Complex results: a+bi" : patch.complex === "polar" ? "Complex results: polar" : "Real mode");
      app.closeOverlay();
      return;
    }
    app.closeOverlay();
    const made = it.make();
    if (Array.isArray(made)) { const ed = app.ensureEditor(); if (ed) { ed.insert(made); ed.left(); } }
    else app.insertToken(made);
  });
  wireEscape(app, s);
  app.openOverlay(s);
}

// ====================== VARS ======================
export function openVarsSheet(app) {
  const st = app.state;
  const s = sheetEl("");
  const letters = "abcdfghjklmnopqrstuvwxyz".split("");
  const render = () => {
    s.innerHTML = `<h2>VARS</h2>
      <h3 class="sub">Built-in constants <span class="muted">(read-only)</span></h3>
      <div class="menu-grid">${[["π", "pi"], ["e", "e"], ["i", "i"], ["τ", "tau"], ["φ", "phi"], ["γ", "euler"]].map(([l, t]) => `<button type="button" data-const="${t}" data-d="${l}">${l}</button>`).join("")}</div>
      <h3 class="sub">Your variables <span class="muted">(store with  value → letter  or  a=5)</span></h3>
      <div class="menu-grid vgrid">${letters.map((l) => {
        const has = Object.prototype.hasOwnProperty.call(st.vars, l);
        return `<button type="button" data-var="${l}" class="${has ? "def" : ""}"><b>${l}</b><small>${has ? escapeHtml(app.fmt(st.vars[l]).text) : "—"}</small></button>`;
      }).join("")}</div>
      <div class="btnrow"><button type="button" data-act="sto">→ STO</button><button type="button" data-act="clr">Clear all variables</button><button type="button" class="close">Close</button></div>`;
  };
  render();
  s.addEventListener("click", (e) => {
    const c = e.target.closest("[data-const]");
    if (c) { app.closeOverlay(); app.insertToken(tok(c.dataset.const, c.dataset.d)); return; }
    const v = e.target.closest("[data-var]");
    if (v) { app.closeOverlay(); app.insertToken(tok(v.dataset.var)); return; }
    const a = e.target.closest("[data-act]");
    if (a && a.dataset.act === "sto") { app.closeOverlay(); app.insertToken(tok("→", "→")); return; }
    if (a && a.dataset.act === "clr") { if (Object.keys(st.vars).length && confirm("Clear all stored variables?")) { st.vars = {}; app.varsChanged(); render(); } return; }
    if (e.target.closest(".close")) app.closeOverlay();
  });
  // long-press / right-click on a defined variable clears it
  s.addEventListener("contextmenu", (e) => {
    const v = e.target.closest("[data-var]");
    if (v && Object.prototype.hasOwnProperty.call(st.vars, v.dataset.var)) { e.preventDefault(); delete st.vars[v.dataset.var]; app.varsChanged(); render(); }
  });
  wireEscape(app, s);
  app.openOverlay(s);
}

// ====================== SOLVE ======================
const sgn = (x) => (x < 0 ? "−" : "+");
export function openSolverSheet(app, tab = "equation") {
  const st = app.state;
  const s = sheetEl(`<h2>SOLVE</h2>
    <div class="tabs"><button type="button" data-tab="equation">Equation</button><button type="button" data-tab="poly">Polynomial</button><button type="button" data-tab="system">System</button></div>
    <div class="pane" data-pane="equation">
      <label class="pf"><span>Equation</span><input type="text" data-k="eq" placeholder="x^3 − 6x^2 + 11x = 6   or   cos(x) = x" autocomplete="off" spellcheck="false"></label>
      <details class="adv"><summary>Numerical options (non-polynomial equations)</summary>
        <div class="pf-row"><label class="pf"><span>Search from</span><input type="text" data-k="lo" placeholder="−100"></label><label class="pf"><span>to</span><input type="text" data-k="hi" placeholder="100"></label></div>
        <label class="pf"><span>or start near (Newton)</span><input type="text" data-k="guess" placeholder="optional guess"></label></details>
    </div>
    <div class="pane" data-pane="poly">
      <label class="pf"><span>Coefficients, highest power first</span><input type="text" data-k="coef" placeholder="1, 0, −4   →   x² − 4" autocomplete="off" spellcheck="false"></label>
    </div>
    <div class="pane" data-pane="system">
      <label class="pf"><span>Equation 1</span><input type="text" data-k="s1" placeholder="2x + y = 5"></label>
      <label class="pf"><span>Equation 2</span><input type="text" data-k="s2" placeholder="x − y = 1"></label>
      <label class="pf"><span>Equation 3 (optional)</span><input type="text" data-k="s3" placeholder="x + y + z = 6"></label>
    </div>
    <div class="btnrow"><button type="button" class="close">Close</button><button type="button" class="go">Solve</button></div>
    <div class="sol-out" aria-live="polite"></div>`);
  const out = s.querySelector(".sol-out");
  let cur = tab;
  const inp = (k) => s.querySelector(`[data-k="${k}"]`);
  const setTab = (t) => {
    cur = t;
    s.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    s.querySelectorAll(".pane").forEach((p) => { p.hidden = p.dataset.pane !== t; });
    out.innerHTML = "";
  };
  const fv = (v) => app.fmt(v).html;
  const num = (text, label) => {
    if (!text.trim()) return undefined;
    const v = evaluate(text, { ...app.evalOpts(), complex: false });
    if (typeof v !== "number") throw new Error(`${label} must be a single real number`);
    return v;
  };
  const rootRow = (name, r) => {
    const tag = r.exact ? '<span class="tag ex">exact</span>' : '<span class="tag ap">≈ numerical</span>';
    const mult = r.multiplicity > 1 ? ` <span class="tag">multiplicity ${r.multiplicity}${r.estimatedMultiplicity ? " (estimated)" : ""}</span>` : "";
    const entry = escapeHtml(numberToEntryText(r.value));
    return `<button type="button" class="root" data-entry="${entry}" title="Insert into CALC"><span class="res">${name} = ${fv(r.value)}</span>${tag}${mult}</button>`;
  };
  const polyReport = (name, res) => {
    if (!res.roots.length) return '<p class="bad">No roots: the polynomial is a non-zero constant.</p>';
    const worst = Math.max(...res.roots.map((r) => r.residual || 0));
    const nReal = res.roots.filter((r) => !isComplex(r.value)).reduce((a, r) => a + r.multiplicity, 0);
    return `<p class="sum">Degree ${res.degree} · ${nReal} real and ${res.degree - nReal} complex root${res.degree - nReal === 1 ? "" : "s"} (counted with multiplicity)</p>` +
      res.roots.map((r) => rootRow(name, r)).join("") +
      `<p class="note">Method: ${escapeHtml(res.method)}. Tap a root to insert it into CALC.${worst > 1e-9 ? ' <b class="bad">Warning: large residual — the polynomial may be ill-conditioned.</b>' : ""}</p>`;
  };
  function solve() {
    try {
      if (cur === "equation") {
        const text = inp("eq").value;
        if (!text.trim()) throw new Error("Enter an equation");
        const lo = num(inp("lo").value, "Search start"), hi = num(inp("hi").value, "Search end"), guess = num(inp("guess").value, "Guess");
        const r = solveEquation(text, { angle: st.settings.angle, vars: st.vars, ans: st.ans, lo, hi, guess });
        if (r.kind === "identity") out.innerHTML = '<p class="sum">Infinitely many solutions — the equation is true for every value.</p>';
        else if (r.kind === "none") out.innerHTML = '<p class="bad">No solution — the equation can never be true.</p>';
        else if (r.kind === "polynomial") out.innerHTML = polyReport(r.variable, r);
        else out.innerHTML = r.roots.length
          ? `<p class="sum">Numerical real root${r.roots.length === 1 ? "" : "s"} ${r.interval ? `in [${fv(r.interval[0])}, ${fv(r.interval[1])}]` : `near ${fv(r.guess)}`}</p>` + r.roots.map((q) => rootRow(r.variable, { ...q, multiplicity: 1 })).join("") +
            '<p class="note">Approximations found by sign-change search + Brent\'s method. Only real roots inside the interval are reported; roots outside it or complex roots are not searched for. Touching roots (like x² = 0) can be missed.</p>'
          : `<p class="bad">No real root found ${r.interval ? "in the interval" : "near that guess"}. There may be none, or they lie elsewhere — try another interval or guess.</p>`;
      } else if (cur === "poly") {
        const text = inp("coef").value;
        if (!text.trim()) throw new Error("Enter the coefficients, e.g. 1, 0, -4");
        const list = evaluate("{" + text.replace(/\s+$/, "") + "}", app.evalOpts());
        const res = polynomialRoots(list);
        if (res.error) throw new Error(res.error);
        out.innerHTML = polyReport("x", res);
      } else {
        const lines = ["s1", "s2", "s3"].map((k) => inp(k).value);
        const r = solveSystem(lines, { angle: st.settings.angle, vars: st.vars, ans: st.ans });
        if (r.kind === "none") out.innerHTML = '<p class="bad">No solution — the equations contradict each other.</p>';
        else if (r.kind === "unique") {
          out.innerHTML = `<p class="sum">Unique solution${r.exact ? " (exact)" : " (numerical, floating point)"}</p>` +
            r.unknowns.map((n, i) => `<button type="button" class="root" data-entry="${escapeHtml(numberToEntryText(r.values[i]))}"><span class="res">${n} = ${fv(r.values[i])}</span></button>`).join("");
        } else {
          const term = (c, name) => `${sgn(c)} ${formatNumber(Math.abs(c), st.settings)}·${name}`;
          out.innerHTML = `<p class="sum">Infinitely many solutions (rank ${r.rank} of ${r.unknowns.length} unknowns). Free: ${r.free.join(", ")}.</p>` +
            r.pivots.map((p) => `<div class="res line">${p.name} = ${formatNumber(p.c, st.settings)} ${p.coefs.map((c, k) => (Math.abs(c) < 1e-12 ? "" : term(c, r.free[k]))).join(" ")}</div>`).join("") +
            r.free.map((n) => `<div class="res line">${n} = ${n} <span class="muted">(any value)</span></div>`).join("");
        }
      }
    } catch (e) { out.innerHTML = `<p class="bad">${escapeHtml(e.message || String(e))}</p>`; }
  }
  s.addEventListener("click", (e) => {
    const t = e.target.closest(".tabs button");
    if (t) { setTab(t.dataset.tab); return; }
    if (e.target.closest(".close")) { app.closeOverlay(); return; }
    if (e.target.closest(".go")) { solve(); return; }
    const root = e.target.closest(".root");
    if (root) { app.closeOverlay(); app.setMode("calc"); app.views.calc.insertText(root.dataset.entry); }
  });
  s.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); solve(); } });
  wireEscape(app, s);
  setTab(tab);
  app.openOverlay(s);
  setTimeout(() => s.querySelector(".pane:not([hidden]) input")?.focus(), 30);
}
void isVariableName;
