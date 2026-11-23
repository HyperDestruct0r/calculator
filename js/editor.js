// Token-based expression editor. Each key press adds one token ("sin(" is a single token),
// so backspace behaves like a handheld calculator. The serialized text feeds the parser.
import { FUNCTION_NAMES } from "./engine.js";

const DISPLAY = {
  "asin(": "sin⁻¹(", "acos(": "cos⁻¹(", "atan(": "tan⁻¹(", "asinh(": "sinh⁻¹(", "acosh(": "cosh⁻¹(", "atanh(": "tanh⁻¹(",
  "sqrt(": "√(", "cbrt(": "∛(", "root(": "ˣ√(", "ncr(": "nCr(", "npr(": "nPr(", "nderiv(": "nDeriv(", "fnint(": "fnInt(",
  "pi": "π", "ans": "Ans", "*": "×", "/": "÷", "^(2)": "²", "^(3)": "³", "^(-1)": "⁻¹", "E": "ᴇ",
  "theta": "θ", "tau": "τ", "phi": "φ", "euler": "γ", "<=": "≤", ">=": "≥", "ipart(": "iPart(", "fpart(": "fPart(", "polyroots(": "polyRoots(",
};
const MULTI = [...new Set([
  ...FUNCTION_NAMES.map((n) => n + "("), "10^(", "e^(", "^(2)", "^(3)", "^(-1)", "pi", "ans", "theta", "tau", "phi", "euler", "<=", ">=",
])].sort((a, b) => b.length - a.length);

export const FN_TOKEN_NAMES = FUNCTION_NAMES.slice().sort((a, b) => b.length - a.length);

export const tok = (t, d, extra = {}) => ({ t, d: d ?? DISPLAY[t] ?? t, ...extra });
export const fnTok = (name, d) => tok(name + "(", d);
export const ANS = tok("ans", "Ans", { operand: true });

const OPERAND_END = new Set([")", "}", "pi", "e", "i", "x", "ans", "theta", "tau", "phi", "euler", "!", "%", "°", "^(2)", "^(3)", "^(-1)", "."]);
export function endsOperand(t) {
  return !!t && (/^[\da-z]$/.test(t.t) || OPERAND_END.has(t.t));
}

/** Convert canonical text (as produced by serialize) back into tokens. */
export function textToTokens(text) {
  const out = [];
  const s = String(text).replace(/\s+/g, "").replace(/θ/g, "theta").replace(/τ/g, "tau").replace(/φ/g, "phi").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/->/g, "→");
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i).toLowerCase();
    const hit = MULTI.find((m) => rest.startsWith(m));
    if (hit) { out.push(tok(hit)); i += hit.length; continue; }
    const c = s[i];
    if (c === "E" && out.length && /^[\d.]$/.test(out[out.length - 1].t) && /^[\d+-]/.test(s[i + 1] || "")) { out.push(tok("E")); i++; continue; }
    if (c === "-") {
      const prev = out[out.length - 1];
      out.push(endsOperand(prev) ? tok("-", "−", { binop: true }) : tok("-", "⁻", { neg: true }));
    } else if (c === "*" || c === "/" || c === "+" || c === "^") out.push(tok(c, undefined, { binop: true }));
    else if (/[a-z]/i.test(c)) out.push(tok(c.toLowerCase()));
    else if (/[\d.,()!{}%°<>=→]/.test(c)) out.push(tok(c));
    i++;
  }
  return out;
}

export function tokensToText(tokens) { return tokens.map((t) => t.t).join(""); }
export function textToDisplay(text) { return textToTokens(text).map((t) => t.d).join(""); }

export class Editor {
  constructor({ autoAns = false, placeholder = "", onChange = null, onFocus = null } = {}) {
    this.tokens = [];
    this.cur = 0;
    this.autoAns = autoAns;
    this.placeholder = placeholder;
    this.onChange = onChange;
    this.onFocus = onFocus;
    this.focused = false;
    this.el = null;
  }
  attach(el) {
    this.el = el;
    el.classList.add("ed");
    if (this.placeholder) el.dataset.ph = this.placeholder;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const span = e.target.closest(".tok");
      if (span) {
        const r = span.getBoundingClientRect();
        const i = Number(span.dataset.i);
        this.cur = e.clientX > r.left + r.width / 2 ? i + 1 : i;
      } else this.cur = this.tokens.length;
      if (this.onFocus) this.onFocus(this);
      this.render();
    });
    this.render();
    return this;
  }
  text() { return tokensToText(this.tokens); }
  isEmpty() { return this.tokens.length === 0; }
  setText(text, { silent = false } = {}) {
    this.tokens = textToTokens(text || "");
    this.cur = this.tokens.length;
    this.changed(silent);
  }
  setFocused(f) { this.focused = f; if (this.el) this.el.classList.toggle("focused", f); this.render(); }
  changed(silent) { this.render(); if (!silent && this.onChange) this.onChange(this); }
  prev() { return this.tokens[this.cur - 1]; }
  insert(toks) {
    const list = Array.isArray(toks) ? toks : [toks];
    this.tokens.splice(this.cur, 0, ...list);
    this.cur += list.length;
    this.changed();
  }
  /** Typing "sin(" on a physical keyboard: merge the typed letters into one function token. */
  mergeFunctionName() {
    let j = this.cur, letters = "";
    while (j > 0 && /^[a-z]$/.test(this.tokens[j - 1].t)) { j--; letters = this.tokens[j].t + letters; }
    const name = FN_TOKEN_NAMES.find((n) => letters.endsWith(n));
    if (name) {
      const start = this.cur - name.length;
      this.tokens.splice(start, name.length, fnTok(name));
      this.cur = start + 1;
      this.changed();
      return true;
    }
    return false;
  }
  backspace() { if (this.cur > 0) { this.tokens.splice(--this.cur, 1); this.changed(); } }
  del() { if (this.cur < this.tokens.length) { this.tokens.splice(this.cur, 1); this.changed(); } }
  left() { if (this.cur > 0) { this.cur--; this.render(); } }
  right() { if (this.cur < this.tokens.length) { this.cur++; this.render(); } }
  home() { this.cur = 0; this.render(); }
  end() { this.cur = this.tokens.length; this.render(); }
  clear() { this.tokens = []; this.cur = 0; this.changed(); }
  render() {
    if (!this.el) return;
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    let html = "";
    this.tokens.forEach((t, i) => {
      if (this.focused && i === this.cur) html += '<span class="cur"></span>';
      html += `<span class="tok${t.neg ? " neg" : ""}" data-i="${i}">${esc(t.d)}</span>`;
    });
    if (this.focused && this.cur >= this.tokens.length) html += '<span class="cur"></span>';
    this.el.innerHTML = html;
    if (this.focused) {
      const c = this.el.querySelector(".cur");
      if (c && c.scrollIntoView) c.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }
}
