// Keypad layout: each key has a primary and an optional 2nd action.
import { tok, fnTok } from "./editor.js";

const T = (t, d, extra) => ({ tok: tok(t, d, extra) });
const F = (name, d) => ({ tok: fnTok(name, d) });
const C = (cmd) => ({ cmd });
const num = (n) => T(String(n));
const op = (t, d) => T(t, d, { binop: true });
const SUP = (t, d) => T(t, d, { binop: true });

// [label, primary, 2nd label, 2nd action, css class]
const K = (label, a, label2 = "", b = null, cls = "k-fn", aria = "") => ({ label, a, label2, b, cls, aria });

export const MEMORY_KEYS = [
  K("MC", C("mc"), "", null, "k-mem", "Memory clear"),
  K("MR", C("mr"), "", null, "k-mem", "Memory recall"),
  K("M+", C("mplus"), "", null, "k-mem", "Add to memory"),
  K("M−", C("mminus"), "", null, "k-mem", "Subtract from memory"),
  K("MS", C("ms"), "", null, "k-mem", "Store in memory"),
];

export const KEYS = [
  K("2nd", C("second"), "", null, "k-second", "Second function"),
  K("X,T,θ,n", C("xvar"), "mod", F("mod"), "k-var", "Graph variable (x, t, θ or n)"),
  K("MATH", C("math"), "", null, "k-fn", "More functions"),
  K("◀", C("left"), "|◀", C("home"), "k-arrow", "Cursor left"),
  K("▶", C("right"), "▶|", C("end"), "k-arrow", "Cursor right"),

  K("sin", F("sin"), "sin⁻¹", F("asin"), "k-fn"),
  K("cos", F("cos"), "cos⁻¹", F("acos"), "k-fn"),
  K("tan", F("tan"), "tan⁻¹", F("atan"), "k-fn"),
  K("▲", C("up"), "", null, "k-arrow", "Previous entry"),
  K("▼", C("down"), "", null, "k-arrow", "Next entry"),

  K("log", F("log"), "10ˣ", T("10^(", "10^("), "k-fn"),
  K("ln", F("ln"), "eˣ", T("e^(", "e^("), "k-fn"),
  K("x²", SUP("^(2)", "²"), "√x", F("sqrt", "√("), "k-fn", "Square"),
  K("x³", SUP("^(3)", "³"), "∛x", F("cbrt", "∛("), "k-fn", "Cube"),
  K("xʸ", op("^", "^"), "ˣ√", F("root", "ˣ√("), "k-fn", "Power"),

  K("√", F("sqrt", "√("), "x²", SUP("^(2)", "²"), "k-fn", "Square root"),
  K("|x|", F("abs"), "round", F("round"), "k-fn", "Absolute value"),
  K("n!", SUP("!", "!"), "nCr", F("ncr", "nCr("), "k-fn", "Factorial"),
  K("x⁻¹", SUP("^(-1)", "⁻¹"), "nPr", F("npr", "nPr("), "k-fn", "Reciprocal"),
  K("F↔D", C("fd"), "mixed", C("mixed"), "k-fn", "Fraction / decimal"),

  K("π", T("pi", "π", { operand: true }), "°", T("°", "°"), "k-fn"),
  K("e", T("e"), "STO▸", T("→", "→"), "k-fn", "Euler's number"),
  K("(", T("("), "{", T("{"), "k-fn"),
  K(")", T(")"), "}", T("}"), "k-fn"),
  K(",", T(","), "ᴇ", T("E", "ᴇ"), "k-fn", "Comma"),

  K("7", num(7), "", null, "k-num"), K("8", num(8), "", null, "k-num"), K("9", num(9), "", null, "k-num"),
  K("÷", op("/", "÷"), "", null, "k-op", "Divide"), K("DEL", C("del"), "", null, "k-del", "Delete"),

  K("4", num(4), "", null, "k-num"), K("5", num(5), "", null, "k-num"), K("6", num(6), "", null, "k-num"),
  K("×", op("*", "×"), "", null, "k-op", "Multiply"), K("AC", C("clear"), "", null, "k-del", "Clear"),

  K("1", num(1), "", null, "k-num"), K("2", num(2), "", null, "k-num"), K("3", num(3), "", null, "k-num"),
  K("−", op("-", "−"), "", null, "k-op", "Subtract"), K("ANS", T("ans", "Ans", { operand: true, binop: true }), "SOLVE", C("solver"), "k-fn", "Last answer"),

  K("0", num(0), "VARS", C("vars"), "k-num"), K(".", T("."), "i", T("i"), "k-num", "Decimal point"),
  K("(−)", T("-", "⁻", { neg: true }), "CMPLX", C("cmplx"), "k-fn", "Negative sign"),
  K("+", op("+", "+"), "", null, "k-op", "Add"), K("ENTER", C("enter"), "ENTRY", C("entry"), "k-enter", "Enter"),
];

const REPEATABLE = new Set(["del", "left", "right", "up", "down"]);

/** Build keypad DOM. `press(key)` is called for a key activation. */
export function buildKeypad(root, press) {
  root.innerHTML = "";
  const mem = document.createElement("div");
  mem.className = "mem-row";
  const grid = document.createElement("div");
  grid.className = "k-grid";
  const make = (k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.tabIndex = -1; // the physical keyboard drives the calculator; keys stay mouse/touch targets
    b.className = "k " + k.cls;
    b.setAttribute("aria-label", k.aria || k.label);
    if (k.b) b.dataset.has2 = "1";
    b.innerHTML = `${k.label2 ? `<span class="sec">${k.label2}</span>` : ""}<span class="main">${k.label}</span>`;
    const rep = k.a.cmd && REPEATABLE.has(k.a.cmd);
    if (rep) {
      let t1, t2, fired = false;
      const stop = () => { clearTimeout(t1); clearInterval(t2); };
      b.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); fired = true; press(k);
        t1 = setTimeout(() => { t2 = setInterval(() => press(k, true), 70); }, 420);
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => b.addEventListener(ev, stop));
      b.addEventListener("click", (e) => { e.preventDefault(); if (!fired) press(k); fired = false; });
    } else {
      b.addEventListener("pointerdown", (e) => e.preventDefault()); // never steal focus
      b.addEventListener("click", () => press(k));
    }
    return b;
  };
  MEMORY_KEYS.forEach((k) => mem.appendChild(make(k)));
  KEYS.forEach((k) => grid.appendChild(make(k)));
  root.append(mem, grid);
}
