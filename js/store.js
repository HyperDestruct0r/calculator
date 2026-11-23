// Persistent state (localStorage with graceful in-memory fallback) + legacy migration.
import { reviveComplex } from "./complex.js";
import { isVariableName } from "./parser.js";

const KEY = "cgcalc-state-v2"; // unchanged on purpose: v2 data is read and extended, never discarded
const LEGACY_MEMORY = "cgcalc-memory";
const LEGACY_HISTORY = "cgcalc-history";

export const PALETTE = ["#4da3ff", "#ff6b6b", "#34d399", "#fbbf24", "#c084fc", "#fb923c", "#2dd4bf", "#f472b6", "#a3e635", "#94a3b8"];

export const DEFAULT_SETTINGS = {
  angle: "rad", theme: "dark", frac: "frac", mixed: false,
  notation: "normal", digits: "float",
  grid: true, axisLabels: true, lineWidth: 2.5, equalScale: true, showCoords: true,
  complex: "rect", // "real" (non-real results are errors) | "rect" (a+bi) | "polar" (r(cos θ + i sin θ))
};

export function defaultState() {
  return {
    v: 3,
    settings: { ...DEFAULT_SETTINGS },
    funcs: [
      { id: 1, expr: "x^2", on: true, color: PALETTE[0] },
      { id: 2, expr: "sin(x)", on: true, color: PALETTE[1] },
      { id: 3, expr: "2x+1", on: false, color: PALETTE[2] },
      { id: 4, expr: "log(x)", on: false, color: PALETTE[3] },
    ],
    graphType: "function",
    polars: [{ id: 5, expr: "2cos(3theta)", on: true, color: PALETTE[0] }],
    params: [{ id: 6, x: "3cos(t)", y: "2sin(t)", on: true, color: PALETTE[1] }],
    ineqs: [{ id: 7, expr: "y>x^2", on: true, color: PALETTE[2] }],
    seqs: [{ id: 8, expr: "n^2", init: "", on: true, color: PALETTE[3] }],
    gset: { polar: { min: "", max: "", step: "" }, param: { min: "", max: "", step: "" }, seq: { nMin: "1", nMax: "20" } },
    views: {},
    nextId: 9,
    vars: {},
    view: { xMin: -10, xMax: 10, yMin: -6, yMax: 6 },
    table: { fn: "all", start: "-5", end: "5", step: "1" },
    memory: 0,
    ans: 0,
    history: [],
    draft: "",
  };
}

let storage = null;
try { storage = window.localStorage; storage.getItem("x"); } catch { storage = null; }
const mem = {};
const read = (k) => (storage ? storage.getItem(k) : mem[k] ?? null);
const write = (k, v) => { try { if (storage) storage.setItem(k, v); else mem[k] = v; } catch { /* quota / blocked */ } };
export const storageAvailable = () => !!storage;

function sane(n, fallback) { return typeof n === "number" && Number.isFinite(n) ? n : fallback; }

/** Revive a stored value: number, Complex ({re,im}) or list. Returns undefined if it is not a valid value. */
export function reviveValue(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (Array.isArray(v)) { const out = v.map(reviveValue); return out.some((x) => x === undefined) ? undefined : out; }
  const c = reviveComplex(v);
  return c === null ? undefined : c;
}
const str = (v, d = "") => (typeof v === "string" ? v : d);
function loadItems(raw, fields, fallback, idStart) {
  if (!Array.isArray(raw)) return fallback;
  let next = idStart;
  return raw.filter((f) => f && typeof f === "object").map((f, i) => {
    const o = { id: sane(f.id, next++), on: f.on !== false, color: typeof f.color === "string" ? f.color : PALETTE[i % PALETTE.length] };
    fields.forEach((k) => { o[k] = str(f[k]); });
    return o;
  });
}

export function load() {
  const st = defaultState();
  let raw = null;
  try { raw = JSON.parse(read(KEY) || "null"); } catch { raw = null; }
  if (raw && typeof raw === "object") {
    Object.assign(st.settings, raw.settings || {});
    if (Array.isArray(raw.funcs) && raw.funcs.length) {
      st.funcs = raw.funcs.filter((f) => f && typeof f.expr === "string").map((f, i) => ({
        id: sane(f.id, i + 1), expr: f.expr, on: !!f.on, color: typeof f.color === "string" ? f.color : PALETTE[i % PALETTE.length],
      }));
    }
    st.polars = loadItems(raw.polars, ["expr"], st.polars, 1000);
    st.params = loadItems(raw.params, ["x", "y"], st.params, 2000);
    st.ineqs = loadItems(raw.ineqs, ["expr"], st.ineqs, 3000);
    st.seqs = loadItems(raw.seqs, ["expr", "init"], st.seqs, 4000);
    if (["function", "polar", "parametric", "inequality", "sequence"].includes(raw.graphType)) st.graphType = raw.graphType;
    if (raw.gset && typeof raw.gset === "object") for (const k of Object.keys(st.gset)) if (raw.gset[k] && typeof raw.gset[k] === "object") for (const f of Object.keys(st.gset[k])) st.gset[k][f] = str(raw.gset[k][f], st.gset[k][f]);
    if (raw.views && typeof raw.views === "object") for (const [k, v] of Object.entries(raw.views)) if (v && ["xMin", "xMax", "yMin", "yMax"].every((q) => Number.isFinite(v[q])) && v.xMax > v.xMin && v.yMax > v.yMin) st.views[k] = v;
    if (raw.vars && typeof raw.vars === "object") for (const [k, v] of Object.entries(raw.vars)) { const rv = reviveValue(v); if (isVariableName(k) && rv !== undefined) st.vars[k] = rv; }
    const all = [...st.funcs, ...st.polars, ...st.params, ...st.ineqs, ...st.seqs];
    st.nextId = Math.max(sane(raw.nextId, 1), ...all.map((f) => f.id + 1));
    if (raw.view && ["xMin", "xMax", "yMin", "yMax"].every((k) => Number.isFinite(raw.view[k])) && raw.view.xMax > raw.view.xMin && raw.view.yMax > raw.view.yMin) st.view = raw.view;
    if (raw.table) Object.assign(st.table, raw.table);
    st.memory = sane(raw.memory, 0);
    { const a = reviveValue(raw.ans); st.ans = a === undefined ? 0 : a; }
    if (Array.isArray(raw.history)) {
      st.history = raw.history.filter((h) => h && typeof h.expr === "string").map((h) => ({ ...h, value: reviveValue(h.value) })).filter((h) => h.value !== undefined).slice(0, 200);
    }
    st.draft = typeof raw.draft === "string" ? raw.draft : "";
  } else {
    // First run on v2: migrate v1 keys (memory number + [{expr,value}] history).
    const m = Number(read(LEGACY_MEMORY));
    if (Number.isFinite(m)) st.memory = m;
    try {
      const h = JSON.parse(read(LEGACY_HISTORY) || "[]");
      if (Array.isArray(h)) st.history = h.filter((e) => e && typeof e.expr === "string" && Number.isFinite(e.value))
        .map((e) => ({ expr: e.expr, value: e.value, angle: "rad", t: 0 })).slice(0, 200);
    } catch { /* ignore */ }
    if (st.history.length) st.ans = st.history[0].value;
  }
  if (!["dark", "light", "auto"].includes(st.settings.theme)) st.settings.theme = "dark";
  if (!["real", "rect", "polar"].includes(st.settings.complex)) st.settings.complex = "rect";
  return st;
}

let timer = null, current = null;
export function save(state) {
  current = state;
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}
export function flush() {
  clearTimeout(timer);
  if (current) write(KEY, JSON.stringify(current));
}
export function wipe() {
  try { if (storage) { storage.removeItem(KEY); storage.removeItem(LEGACY_MEMORY); storage.removeItem(LEGACY_HISTORY); } } catch { /* ignore */ }
  current = null;
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
}
