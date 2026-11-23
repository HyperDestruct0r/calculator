// Application shell: state, modes, keypad dispatch, keyboard handling, PWA wiring.
import { load, save, flush } from "./store.js";
import { Editor, tok, ANS, endsOperand, textToTokens } from "./editor.js";
import { buildKeypad } from "./keypad.js";
import { evaluate, run } from "./engine.js";
import { openMathSheet, openSolverSheet, openVarsSheet, openPromptSheet } from "./sheets.js";
import { formatValue, formatNumber, numberToEntryText } from "./format.js";
import { createCalcView } from "./calc.js";
import { createGraphView } from "./graph.js";
import { createTableView } from "./table.js";
import { createHistoryView } from "./history.js";
import { createSettingsView } from "./settings.js";

const state = load();
const $ = (id) => document.getElementById(id);
const MODES = ["calc", "graph", "table", "history", "settings"];
const wideMQ = window.matchMedia("(min-width: 860px) and (min-height: 440px)");
const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
let installEvent = null;
let toastTimer = 0;

const app = {
  state,
  mode: "calc",
  second: false,
  active: null,
  views: {},

  save() { save(state); },
  evalOpts() { return { angle: state.settings.angle, ans: state.ans, vars: state.vars, complex: state.settings.complex !== "real" }; },
  /** Run one CALC line (expression or store). Applies a store to the variables. */
  runLine(text) {
    const r = run(text, app.evalOpts());
    if (r.kind === "assign") { state.vars[r.name] = r.value; app.varsChanged(); }
    return r;
  },
  varsChanged() {
    app.save();
    if (app.views.graph) app.views.graph.refresh();
    if (app.views.table) app.views.table.refresh();
  },
  promptValues(title, fields, cb) { openPromptSheet(app, title, fields, cb); },
  fmt(v) { return formatValue(v, state.settings); },
  isStacked() { return !wideMQ.matches; },
  canInstall() { return !!installEvent; },
  async install() {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch { /* dismissed */ }
    installEvent = null;
    if (app.mode === "settings") app.views.settings.refresh();
  },

  toast(msg, ms = 2200) {
    const t = $("toast");
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.textContent = ""; }, ms);
  },

  // ----- modes -----
  setMode(m) {
    if (!MODES.includes(m)) return;
    app.closeOverlay();
    app.mode = m;
    $("app").dataset.mode = m;
    document.querySelectorAll("#modes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    for (const [k, v] of Object.entries(app.views)) v.el.classList.toggle("active", k === m);
    if (app.active) app.active.setFocused(false);
    app.active = null;
    app.views[m].show();
    if (m === "calc") app.setActive(app.views.calc.editor);
    app.updateKeypad();
  },
  setActive(ed) {
    if (app.active && app.active !== ed) app.active.setFocused(false);
    app.active = ed;
    if (ed) ed.setFocused(true);
  },
  updateKeypad() {
    const v = app.views[app.mode];
    if (!v) return; // views are still being constructed
    const need = app.mode === "history" || app.mode === "settings" ? false : v.needsKeypad ? v.needsKeypad() : true;
    $("app").classList.toggle("no-keypad", !need);
  },
  /** Make sure there is an editor to receive typed input, switching screens if needed. */
  ensureEditor() {
    if (app.active) return app.active;
    const m = app.mode;
    if (m === "graph") return app.views.graph.focusEditor();
    if (m === "table") { app.setActive(app.views.table.defaultEditor()); return app.active; }
    if (m !== "calc") app.setMode("calc");
    app.setActive(app.views.calc.editor);
    return app.active;
  },
  plotExpression(text) {
    app.setMode("graph");
    app.views.graph.addExpression(text);
    app.toast("Added to Y=");
  },

  // ----- settings / status -----
  applySettings(key) {
    const s = state.settings;
    const dark = s.theme === "auto" ? darkMQ.matches : s.theme === "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]').content = dark ? "#0e1117" : "#dfe4ec";
    app.refreshStatus();
    Object.values(app.views).forEach((v) => { if (v.onSettings) v.onSettings(key); else if (v.refresh) v.refresh(); });
    app.save();
  },
  refreshStatus() {
    $("angleBtn").textContent = state.settings.angle === "deg" ? "DEG" : "RAD";
    $("fracBtn").textContent = state.settings.frac === "frac" ? "FRAC" : "DEC";
    const m = $("chipMem");
    m.hidden = !state.memory;
    m.title = "Memory: " + formatNumber(state.memory, state.settings);
    $("chip2nd").classList.toggle("on", app.second);
    $("keypad").classList.toggle("second", app.second);
  },
  setSecond(on) { app.second = on; app.refreshStatus(); },

  // ----- overlay -----
  openOverlay(node) {
    const o = $("overlay");
    o.innerHTML = "";
    o.appendChild(node);
    o.hidden = false;
  },
  closeOverlay() { const o = $("overlay"); if (!o.hidden) { o.hidden = true; o.innerHTML = ""; return true; } return false; },

  // ----- key dispatch -----
  press(key) {
    const a = app.second && key.b ? key.b : key.a;
    if (a.cmd === "second") { app.setSecond(!app.second); return; }
    if (app.second) app.setSecond(false);
    app.exec(a);
  },
  exec(a) {
    if (a.tok) app.insertToken(a.tok);
    else if (a.cmd) app.command(a.cmd);
  },
  insertToken(t) {
    const ed = app.ensureEditor();
    if (!ed) return;
    if (ed.autoAns && ed.isEmpty() && t.binop && t.t !== "ans") ed.insert(ANS);
    ed.insert(t);
  },
  typeChar(c) {
    const ed = app.ensureEditor();
    if (!ed) return;
    if (/^[\d.]$/.test(c)) return app.insertToken(tok(c));
    switch (c) {
      case "+": case "*": case "/": case "^": return app.insertToken(tok(c, undefined, { binop: true }));
      case "-":
        if (endsOperand(ed.prev())) return app.insertToken(tok("-", "−", { binop: true }));
        return ed.insert(tok("-", "⁻", { neg: true }));
      case "(": if (!ed.mergeFunctionName()) ed.insert(tok("(")); return;
      case "<": case ">": case "=": case "→": return ed.insert(tok(c));
      case ")": case ",": case "!": case "%": case "{": case "}": case "°": return ed.insert(tok(c));
      default: if (/^[a-zA-Z]$/.test(c)) ed.insert(tok(c.toLowerCase()));
    }
  },
  command(cmd) {
    const m = app.mode, v = app.views[m];
    const ed = app.active;
    switch (cmd) {
      case "enter": {
        const e = ed || app.ensureEditor();
        if (m === "calc") v.enter(); else if (v.enter) v.enter(e);
        break;
      }
      case "entry": if (m === "calc") { const t = v.lastExpression(); if (t) v.insertText(t); } break;
      case "del": if (ed) ed.backspace(); break;
      case "clear": if (m === "calc") v.clearAll(); else if (ed) ed.clear(); break;
      case "left": case "right": if (ed) ed[cmd](); else if (v.arrow) v.arrow(cmd); break;
      case "home": case "end": if (ed) ed[cmd](); break;
      case "up": case "down": if (v.arrow) v.arrow(cmd, ed); break;
      case "fd": state.settings.frac = state.settings.frac === "frac" ? "dec" : "frac"; app.applySettings(); app.toast(state.settings.frac === "frac" ? "Fractions" : "Decimals"); break;
      case "mixed": state.settings.mixed = !state.settings.mixed; state.settings.frac = "frac"; app.applySettings(); app.toast(state.settings.mixed ? "Mixed numbers" : "Improper fractions"); break;
      case "math": openMathSheet(app, "MATH"); break;
      case "cmplx": openMathSheet(app, "CMPLX"); break;
      case "solver": openSolverSheet(app); break;
      case "vars": openVarsSheet(app); break;
      case "xvar": { const e = app.ensureEditor(); if (e) app.insertToken(app.mode === "graph" ? app.views.graph.varToken() : tok("x")); break; }
      case "mc": state.memory = 0; app.memoryChanged("Memory cleared"); break;
      case "mr": {
        const e = app.ensureEditor();
        if (e) e.insert(textToTokens(numberToEntryText(state.memory)));
        break;
      }
      case "mplus": case "mminus": case "ms": app.memoryOp(cmd); break;
      case "escape": app.escape(); break;
    }
  },
  escape() {
    if (app.second) { app.setSecond(false); return; }
    if (app.closeOverlay()) return;
    const v = app.views[app.mode];
    if (v.escape && v.escape()) return;
    if (app.active) app.active.clear();
  },

  // ----- memory -----
  currentValue() {
    if (app.mode === "calc") {
      const text = app.views.calc.editor.text();
      if (text.trim()) return evaluate(text, app.evalOpts());
    }
    return state.ans;
  },
  memoryOp(op) {
    try {
      const v = app.currentValue();
      if (typeof v !== "number") throw new Error("Memory holds a single number, not a list");
      if (op === "ms") state.memory = v;
      else if (op === "mplus") state.memory += v;
      else state.memory -= v;
      app.memoryChanged("M = " + formatNumber(state.memory, state.settings));
    } catch (e) { app.toast(e.message); }
  },
  memoryChanged(msg) { app.refreshStatus(); app.save(); app.toast(msg); },

  // ----- dialogs -----
  openHelp() {
    const rows = [
      ["0-9 . + - * / ^ ( )", "Type numbers and operators"], ["sin( cos( sqrt( …", "Type function names; “(” completes them"],
      ["Enter  or  =", "Evaluate (CALC) / next field (GRAPH, TABLE)"], ["Shift+Enter", "CALC: plot expression in Y="],
      ["Backspace  ·  Delete", "Delete before / after cursor"], ["← → Home End", "Move cursor (or trace in GRAPH)"],
      ["↑ ↓", "Recall previous entries (CALC) · switch field / function"], ["Esc", "Cancel 2nd, close menus, or clear the line"],
      ["` (backtick)", "Toggle the 2nd key"], ["a=5  ·  5 → a", "Store a value in a letter (CALC)"], ["2nd + . · 2nd + (−) · 2nd + ANS · 2nd + 0", "i · CMPLX menu · SOLVE · VARS"], ["Alt+1 … Alt+5", "CALC · GRAPH · TABLE · HISTORY · SETTINGS"],
      ["Ctrl+← / Ctrl+→", "Previous / next mode"], ["Ctrl+V", "Paste an expression"],
    ];
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.innerHTML = `<h2>Keyboard shortcuts</h2><table>${rows.map(([k, d]) => `<tr><td>${k}</td><td>${d}</td></tr>`).join("")}</table><button type="button" class="close">Close</button>`;
    sheet.addEventListener("click", (e) => { if (e.target.closest(".close")) app.closeOverlay(); });
    app.openOverlay(sheet);
  },
};

// ---------- keyboard ----------
function onKeyDown(e) {
  if (e.defaultPrevented || e.isComposing) return;
  const t = e.target;
  const tag = t && t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") { if (e.key === "Escape") t.blur(); return; }
  if (tag === "BUTTON" && (e.key === "Enter" || e.key === " ")) return; // native button activation (Tab users)
  const stop = () => e.preventDefault();

  if (e.altKey && /^Digit[1-5]$/.test(e.code)) { stop(); app.setMode(MODES[Number(e.code.slice(5)) - 1]); return; }
  if (e.ctrlKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    stop();
    const i = MODES.indexOf(app.mode);
    app.setMode(MODES[(i + (e.key === "ArrowRight" ? 1 : MODES.length - 1)) % MODES.length]);
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return; // leave copy / paste / browser shortcuts alone
  if (!$("overlay").hidden && e.key !== "Escape") return;

  if (e.code === "Backquote") { stop(); app.setSecond(!app.second); return; }
  const entryMode = app.mode === "history" || app.mode === "settings";
  const k = e.key;
  const typed = k.length === 1 && k !== " ";
  if (typed) {
    stop();
    if (app.second) app.setSecond(false);
    if (k === "=") {
      const ed = app.active;
      // "=" evaluates in CALC, but is a relation in graph editors and after a lone variable letter (a=5)
      if (ed && (app.mode === "graph" || (app.mode === "calc" && /^[a-z]$/.test(ed.text())))) { ed.insert(tok("=")); return; }
      app.command("enter"); return;
    }
    if (entryMode) app.setMode("calc");
    app.typeChar(k);
    return;
  }
  switch (k) {
    case "Enter":
      stop();
      if (entryMode) { app.setMode("calc"); return; }
      if (e.shiftKey && app.mode === "calc") app.views.calc.enter({ shift: true });
      else if (e.shiftKey && app.mode === "graph") app.views.graph.showPlot();
      else app.command("enter");
      break;
    case "Backspace": stop(); if (entryMode) app.setMode("calc"); app.command("del"); break;
    case "Delete": stop(); if (app.active) app.active.del(); break;
    case "Escape": stop(); app.command("escape"); break;
    case "ArrowLeft": stop(); app.command("left"); break;
    case "ArrowRight": stop(); app.command("right"); break;
    case "ArrowUp": if (!entryMode) { stop(); app.command("up"); } break;
    case "ArrowDown": if (!entryMode) { stop(); app.command("down"); } break;
    case "Home": stop(); app.command("home"); break;
    case "End": stop(); app.command("end"); break;
  }
}
document.addEventListener("keydown", onKeyDown);
document.addEventListener("paste", (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
  if (!text.trim()) return;
  e.preventDefault();
  if (app.mode === "history" || app.mode === "settings") app.setMode("calc");
  const ed = app.ensureEditor();
  if (ed) ed.insert(textToTokens(text.replace(/[^\dA-Za-z+\-*/^().,!%{}×÷−π√²³°\s]/g, "")));
});
document.addEventListener("pointerdown", (e) => {
  const o = $("overlay");
  if (!o.hidden && e.target === o) app.closeOverlay();
});

// ---------- boot ----------
function boot() {
  const screen = $("screen");
  app.views = {
    calc: createCalcView(app), graph: createGraphView(app), table: createTableView(app),
    history: createHistoryView(app), settings: createSettingsView(app),
  };
  Object.values(app.views).forEach((v) => screen.appendChild(v.el));
  buildKeypad($("keypad"), (key) => app.press(key));

  document.querySelectorAll("#modes button").forEach((b) => b.addEventListener("click", () => { app.setMode(b.dataset.mode); b.blur(); }));
  $("angleBtn").addEventListener("click", (e) => { state.settings.angle = state.settings.angle === "deg" ? "rad" : "deg"; app.applySettings(); app.toast(state.settings.angle === "deg" ? "Degrees" : "Radians"); e.currentTarget.blur(); });
  $("fracBtn").addEventListener("click", (e) => { app.command("fd"); e.currentTarget.blur(); });
  $("themeBtn").addEventListener("click", (e) => {
    const dark = document.documentElement.dataset.theme === "dark";
    state.settings.theme = dark ? "light" : "dark";
    app.applySettings();
    e.currentTarget.blur();
  });
  $("helpBtn").addEventListener("click", (e) => { app.openHelp(); e.currentTarget.blur(); });
  darkMQ.addEventListener("change", () => { if (state.settings.theme === "auto") app.applySettings(); });
  wideMQ.addEventListener("change", () => app.updateKeypad());

  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; if (app.mode === "settings") app.views.settings.refresh(); });
  window.addEventListener("appinstalled", () => { installEvent = null; });

  app.applySettings();
  app.setMode("calc"); // the app always opens on the standard calculator
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then(() => {
      if (app.mode === "settings") app.views.settings.refresh();
    }).catch(() => { /* offline support unavailable */ });
  });
}

boot();
window.addEventListener("pagehide", flush);
