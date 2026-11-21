// Persistent state (localStorage with graceful in-memory fallback) + legacy migration.
const KEY = "cgcalc-state-v2";
const LEGACY_MEMORY = "cgcalc-memory";
const LEGACY_HISTORY = "cgcalc-history";

export const PALETTE = ["#4da3ff", "#ff6b6b", "#34d399", "#fbbf24", "#c084fc", "#fb923c", "#2dd4bf", "#f472b6", "#a3e635", "#94a3b8"];

export const DEFAULT_SETTINGS = {
  angle: "rad", theme: "dark", frac: "frac", mixed: false,
  notation: "normal", digits: "float",
  grid: true, axisLabels: true, lineWidth: 2.5, equalScale: true, showCoords: true,
};

export function defaultState() {
  return {
    v: 2,
    settings: { ...DEFAULT_SETTINGS },
    funcs: [
      { id: 1, expr: "x^2", on: true, color: PALETTE[0] },
      { id: 2, expr: "sin(x)", on: true, color: PALETTE[1] },
      { id: 3, expr: "2x+1", on: false, color: PALETTE[2] },
      { id: 4, expr: "log(x)", on: false, color: PALETTE[3] },
    ],
    nextId: 5,
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
    st.nextId = Math.max(sane(raw.nextId, 1), ...st.funcs.map((f) => f.id + 1));
    if (raw.view && ["xMin", "xMax", "yMin", "yMax"].every((k) => Number.isFinite(raw.view[k])) && raw.view.xMax > raw.view.xMin && raw.view.yMax > raw.view.yMin) st.view = raw.view;
    if (raw.table) Object.assign(st.table, raw.table);
    st.memory = sane(raw.memory, 0);
    st.ans = Array.isArray(raw.ans) ? raw.ans : sane(raw.ans, 0);
    if (Array.isArray(raw.history)) st.history = raw.history.filter((h) => h && typeof h.expr === "string").slice(0, 200);
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
