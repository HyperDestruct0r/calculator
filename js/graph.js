// GRAPH screen controller: graph-type selector, editor pane, canvas (grid, axes, pan/zoom), analysis tool bar.
// Each graph type (FUNCTION, POLAR, PARAMETRIC, INEQUALITY, SEQUENCE) is an adapter in js/graphui/.
import { el } from "./dom.js";
import { formatNumber } from "./format.js";
import { createFunctionType } from "./graphui/function.js";
import { createCurveType } from "./graphui/curves.js";
import { createInequalityType } from "./graphui/inequality.js";
import { createSequenceType } from "./graphui/sequence.js";

const niceStep = (raw) => {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), q = raw / p;
  return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * p;
};
const rn = (v) => Number(Number(v).toPrecision(8));
const TYPE_IDS = ["function", "polar", "parametric", "inequality", "sequence"];
const TYPE_BUTTONS = [["function", "FUNC"], ["polar", "POLAR"], ["parametric", "PARAM"], ["inequality", "INEQ"], ["sequence", "SEQ"]];
const STD_VIEW = { xMin: -10, xMax: 10, yMin: -6, yMax: 6 };

export function createGraphView(app) {
  const st = app.state;
  const root = el("section", "view graph");
  root.innerHTML = `
    <div class="gtype" role="tablist" aria-label="Graph type">${TYPE_BUTTONS.map(([id, l]) => `<button type="button" class="lcd-btn" role="tab" data-type="${id}">${l}</button>`).join("")}</div>
    <div class="gtabs"><button type="button" class="lcd-btn" data-pane="y">Y=</button><button type="button" class="lcd-btn" data-pane="plot">PLOT</button></div>
    <div class="glayout" data-pane="plot">
      <div class="y-pane">
        <div class="y-list" aria-label="Entries"></div>
        <div class="y-extra"></div>
        <div class="y-actions"><button type="button" class="lcd-btn" data-act="add">＋ Add</button><span class="xkeys"></span></div>
      </div>
      <div class="plot-pane">
        <div class="ptools">
          <button type="button" class="lcd-btn" data-act="zoomOut" title="Zoom out" aria-label="Zoom out">−</button>
          <button type="button" class="lcd-btn" data-act="zoomIn" title="Zoom in" aria-label="Zoom in">+</button>
          <button type="button" class="lcd-btn" data-act="reset" title="Reset view">Reset</button>
          <select data-act="preset" aria-label="Zoom presets"><option value="">Zoom…</option><option value="std">Standard</option><option value="trig">Trig</option><option value="fit">Fit</option><option value="square">Square</option></select>
          <span class="sep"></span>
          <button type="button" class="lcd-btn" data-act="zero" title="Zeros">Zeros</button>
          <button type="button" class="lcd-btn" data-act="min">Min</button>
          <button type="button" class="lcd-btn" data-act="max">Max</button>
          <button type="button" class="lcd-btn" data-act="inter" title="Intersections">∩</button>
          <button type="button" class="lcd-btn" data-act="deriv" title="Derivative / tangent line">d/dx</button>
          <button type="button" class="lcd-btn" data-act="integ" title="Definite integral">∫</button>
          <button type="button" class="lcd-btn" data-act="eval" title="Evaluate at a value">Eval</button>
          <button type="button" class="lcd-btn" data-act="clear">Clear</button>
        </div>
        <div class="canvas-wrap"><canvas aria-label="Graph"></canvas></div>
        <div class="pinfo mono" aria-live="polite"></div>
      </div>
    </div>`;
  const list = root.querySelector(".y-list");
  const extra = root.querySelector(".y-extra");
  const xkeys = root.querySelector(".xkeys");
  const layout = root.querySelector(".glayout");
  const wrap = root.querySelector(".canvas-wrap");
  const canvas = root.querySelector("canvas");
  const info = root.querySelector(".pinfo");
  const ctx = canvas.getContext("2d");

  let pane = "plot";
  let view = { ...st.view };
  let W = 0, H = 0, sized = false;
  let raf = 0, seen = false;
  let hover = null;

  // ---------- geometry (functions of the current view) ----------
  const X = (x) => ((x - view.xMin) / (view.xMax - view.xMin)) * W;
  const Y = (y) => H - ((y - view.yMin) / (view.yMax - view.yMin)) * H;
  const unX = (px) => view.xMin + (px / W) * (view.xMax - view.xMin);
  const unY = (py) => view.yMax - (py / H) * (view.yMax - view.yMin);
  const fmt = (v) => formatNumber(rn(v), st.settings.notation === "normal" ? {} : st.settings);
  function colors() {
    const cs = getComputedStyle(root), col = (n) => cs.getPropertyValue(n).trim();
    return { bg: col("--lcd-bg"), fg: col("--lcd-fg"), dim: col("--lcd-dim"), grid: col("--lcd-grid"), axis: col("--lcd-axis") };
  }

  // context handed to the adapters
  const g = {
    app, st, rn, fmt, X, Y, unX, unY, colors,
    get W() { return W; }, get H() { return H; }, get view() { return view; },
    setView(v) { view = v; schedule(); },
    schedule() { schedule(); },
    showInfo(html) { showInfo(html); },
    promptValues(title, fields, cb) { app.promptValues(title, fields, cb); },
  };
  const adapters = {
    function: createFunctionType(g),
    polar: createCurveType(g, "polar"),
    parametric: createCurveType(g, "param"),
    inequality: createInequalityType(g),
    sequence: createSequenceType(g),
  };
  if (!TYPE_IDS.includes(st.graphType)) st.graphType = "function";
  const A = () => adapters[st.graphType];

  // ---------- view persistence per graph type ----------
  const storedView = (t) => (t === "function" ? st.view : st.views[t]);
  function commitView() { if (st.graphType === "function") st.view = { ...view }; else st.views[st.graphType] = { ...view }; app.save(); }
  function applyAspect(force = false) {
    if (!W || !H || A().equalScale === false || !(st.settings.equalScale || force)) return;
    const yc = (view.yMin + view.yMax) / 2, yr = ((view.xMax - view.xMin) * H) / W / 2;
    view = { ...view, yMin: yc - yr, yMax: yc + yr };
  }
  function loadView() {
    const v = storedView(st.graphType);
    if (v) view = { ...v };
    else {
      const f = st.graphType === "sequence" ? A().fit() : null;
      view = f || { ...STD_VIEW };
      applyAspect();
    }
  }
  function zoomAt(f, px, py) {
    const xr = view.xMax - view.xMin, yr = view.yMax - view.yMin;
    const nx = Math.min(1e9, Math.max(1e-9, xr * f)), ny = Math.min(1e9, Math.max(1e-9, yr * f));
    const xm = unX(px), ym = unY(py);
    const xMin = xm - (px / W) * nx, yMax = ym + (py / H) * ny;
    view = { xMin, xMax: xMin + nx, yMin: yMax - ny, yMax };
    schedule();
  }
  function setPreset(p) {
    if (p === "std") { view = { ...STD_VIEW }; applyAspect(); }
    else if (p === "trig") {
      if (st.graphType === "function") view = adapters.function.trigView();
      else { view = { ...STD_VIEW }; applyAspect(); showInfo('<span class="muted">The Trig window is for FUNCTION graphs; showing Standard.</span>'); }
    } else if (p === "square") { if (A().equalScale === false) showInfo('<span class="muted">Square scaling does not apply to sequences (the axes are n and u(n)).</span>'); else applyAspect(true); }
    else if (p === "fit") { const r = A().fit(); if (r) view = r; else app.toast("Nothing to fit"); if (r) applyAspect(); }
    commitView(); schedule();
  }

  // ---------- canvas ----------
  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (!sized) { W = w; H = h; sized = true; loadView(); applyAspect(); commitView(); }
    else if (w !== W || h !== H) { // keep units-per-pixel constant
      const xc = (view.xMin + view.xMax) / 2, yc = (view.yMin + view.yMax) / 2;
      const xr = ((view.xMax - view.xMin) * w) / W, yr = ((view.yMax - view.yMin) * h) / H;
      view = { xMin: xc - xr / 2, xMax: xc + xr / 2, yMin: yc - yr / 2, yMax: yc + yr / 2 };
      W = w; H = h;
    }
    schedule();
  }
  new ResizeObserver(resize).observe(wrap);
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }

  function draw() {
    if (!W || !H || !root.classList.contains("active")) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = colors();
    ctx.fillStyle = c.bg; ctx.fillRect(0, 0, W, H);
    const xr = view.xMax - view.xMin, yr = view.yMax - view.yMin;
    const xs = niceStep(xr / Math.max(3, W / 80)), ys = niceStep(yr / Math.max(3, H / 60));
    ctx.lineWidth = 1;
    if (st.settings.grid) {
      ctx.strokeStyle = c.grid; ctx.beginPath();
      for (let x = Math.ceil(view.xMin / xs) * xs; x <= view.xMax; x += xs) { const px = Math.round(X(x)) + .5; ctx.moveTo(px, 0); ctx.lineTo(px, H); }
      for (let y = Math.ceil(view.yMin / ys) * ys; y <= view.yMax; y += ys) { const py = Math.round(Y(y)) + .5; ctx.moveTo(0, py); ctx.lineTo(W, py); }
      ctx.stroke();
    }
    ctx.strokeStyle = c.axis; ctx.lineWidth = 1.5; ctx.beginPath();
    if (view.xMin <= 0 && view.xMax >= 0) { const px = Math.round(X(0)) + .5; ctx.moveTo(px, 0); ctx.lineTo(px, H); }
    if (view.yMin <= 0 && view.yMax >= 0) { const py = Math.round(Y(0)) + .5; ctx.moveTo(0, py); ctx.lineTo(W, py); }
    ctx.stroke();
    if (st.settings.axisLabels) {
      ctx.fillStyle = c.dim; ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
      const lblY = Math.min(H - 4, Math.max(12, Y(0) + 13)), lblX = Math.min(W - 4, Math.max(4, X(0) + 4));
      ctx.textAlign = "left";
      for (let x = Math.ceil(view.xMin / xs) * xs; x <= view.xMax; x += xs) {
        if (Math.abs(x) < xs / 1e6) continue;
        ctx.fillText(formatNumber(rn(x)), X(x) + 3, lblY);
      }
      const onRight = lblX > W - 50;
      ctx.textAlign = onRight ? "right" : "left";
      for (let y = Math.ceil(view.yMin / ys) * ys; y <= view.yMax; y += ys) {
        if (Math.abs(y) < ys / 1e6) continue;
        ctx.fillText(formatNumber(rn(y)), onRight ? W - 4 : lblX, Y(y) - 3);
      }
      ctx.textAlign = "left";
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    A().draw({ ctx, X, Y, unX, unY, W, H, view, colors: c, lineWidth: st.settings.lineWidth, angle: st.settings.angle });
    ctx.restore();
  }

  function showInfo(html) {
    if (html !== undefined) { info.innerHTML = html; return; }
    const h = A().infoHtml();
    if (h) info.innerHTML = h;
    else info.innerHTML = `<span class="muted">${A().hint}</span>`;
  }

  // ---------- pointer interaction ----------
  const pts = new Map();
  let gesture = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, pos(e));
    A().rows.blur();
    if (pts.size === 1) gesture = { type: "pan", start: pos(e), v: { ...view }, moved: false };
    else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      gesture = { type: "pinch", d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), v: { ...view }, moved: true };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) {
      if (e.pointerType === "mouse" && st.settings.showCoords && !A().traceActive() && !A().infoHtml()) {
        const p = pos(e);
        showInfo(`<span>x = <b>${fmt(unX(p.x))}</b></span><span>y = <b>${fmt(unY(p.y))}</b></span>`);
      }
      return;
    }
    pts.set(e.pointerId, pos(e));
    if (!gesture) return;
    const v = gesture.v, xr = v.xMax - v.xMin, yr = v.yMax - v.yMin;
    if (gesture.type === "pan" && pts.size === 1) {
      const p = pos(e), dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) > 5) gesture.moved = true;
      if (gesture.moved) {
        view = { xMin: v.xMin - (dx / W) * xr, xMax: v.xMax - (dx / W) * xr, yMin: v.yMin + (dy / H) * yr, yMax: v.yMax + (dy / H) * yr };
        schedule();
      }
    } else if (gesture.type === "pinch" && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const f = Math.min(50, Math.max(0.02, gesture.d / dist));
      const startMid = gesture.mid || (gesture.mid = { x: mid.x, y: mid.y });
      const mx = v.xMin + (startMid.x / W) * xr, my = v.yMax - (startMid.y / H) * yr;
      const nx = xr * f, ny = yr * f;
      const xMin = mx - (mid.x / W) * nx, yMax = my + (mid.y / H) * ny;
      view = { xMin, xMax: xMin + nx, yMin: yMax - ny, yMax };
      schedule();
    }
  });
  const end = (e) => {
    const had = pts.delete(e.pointerId);
    if (!had || !gesture) return;
    if (pts.size === 0) {
      const gs = gesture; gesture = null;
      if (gs.type === "pan" && !gs.moved && e.type === "pointerup") A().tap(pos(e));
      else commitView();
    } else if (gesture.type === "pinch") { gesture = null; commitView(); }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = pos(e);
    zoomAt(e.deltaY < 0 ? 0.85 : 1 / 0.85, p.x, p.y);
    clearTimeout(canvas._t); canvas._t = setTimeout(commitView, 300);
  }, { passive: false });
  canvas.addEventListener("pointerleave", () => { if (!A().traceActive() && !A().infoHtml()) showInfo(); });

  // ---------- tool bar ----------
  const TOOL_NAMES = ["zero", "min", "max", "inter", "deriv", "integ"];
  function runTool(name) {
    const a = A();
    const f = a.tools && a.tools[name];
    if (f) { f(); return; }
    const msg = (a.unavailable && a.unavailable[name]) || "This tool is not available for this graph type.";
    showInfo(`<span class="muted">${msg}</span>`);
  }
  const actions = {
    zoomIn() { zoomAt(0.75, W / 2, H / 2); commitView(); },
    zoomOut() { zoomAt(1 / 0.75, W / 2, H / 2); commitView(); },
    reset() { setPreset("std"); A().clear(); showInfo(); },
    clear() { A().clear(); showInfo(); schedule(); },
    add() { A().rows.add(); },
  };
  TOOL_NAMES.forEach((n) => { actions[n] = () => runTool(n); });
  actions.eval = () => runTool("evalAt"); // the toolbar button is data-act="eval"
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-type]");
    if (t && t.tagName === "BUTTON") { setType(t.dataset.type); return; }
    const b = e.target.closest("[data-act]");
    if (b && b.tagName === "BUTTON" && actions[b.dataset.act]) actions[b.dataset.act]();
    const tab = e.target.closest("[data-pane]");
    if (tab && tab.tagName === "BUTTON") setPane(tab.dataset.pane);
    if (b || t || tab) e.target.closest("button")?.blur(); // keep keyboard input going to the editors
    if (e.target.closest(".xk")) {
      const k = A().extraKeys[Number(e.target.closest(".xk").dataset.i)];
      if (k) app.insertToken(k[1]());
    }
  });
  list.addEventListener("click", (e) => A().rows.onClick(e));
  root.querySelector('select[data-act="preset"]').addEventListener("change", (e) => {
    if (e.target.value) setPreset(e.target.value);
    e.target.value = ""; e.target.blur();
  });

  // ---------- graph type / panes ----------
  function renderType() {
    const a = A();
    root.querySelectorAll(".gtype .lcd-btn").forEach((b) => { const on = b.dataset.type === st.graphType; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
    root.querySelector('.gtabs [data-pane="y"]').textContent = a.yLabel;
    root.dataset.gtype = st.graphType;
    a.rows.render(list);
    extra.innerHTML = "";
    if (a.panel) { extra.appendChild(a.panel.el); a.panel.refresh(); }
    xkeys.innerHTML = a.extraKeys ? a.extraKeys.map(([l], i) => `<button type="button" class="lcd-btn xk" data-i="${i}">${l}</button>`).join("") : "";
    root.querySelector('[data-act="add"]').textContent = "＋ Add";
    showInfo();
  }
  function setType(t) {
    if (!TYPE_IDS.includes(t) || t === st.graphType) return;
    A().rows.blur(); A().clear();
    commitView();
    st.graphType = t;
    loadView();
    app.save();
    renderType();
    if (pane === "y") { const a = A(); const it = a.rows.items()[0]; if (it) a.rows.focus(a.rows.selId && a.rows.byId(a.rows.selId) ? a.rows.selId : it.id); }
    app.updateKeypad();
    schedule();
  }
  function setPane(p) {
    pane = p;
    layout.dataset.pane = p;
    root.querySelectorAll(".gtabs .lcd-btn").forEach((b) => b.classList.toggle("on", b.dataset.pane === p));
    app.updateKeypad();
    if (p === "y") { const a = A(); if (a.rows.activeId === null && a.rows.items().length) a.rows.focus(a.rows.byId(a.rows.selId) ? a.rows.selId : a.rows.items()[0].id); }
    else requestAnimationFrame(() => { resize(); schedule(); });
  }
  function focusEditor() {
    const a = A();
    if (!a.rows.items().length) a.rows.add();
    const id = a.rows.byId(a.rows.activeId) ? a.rows.activeId : a.rows.byId(a.rows.selId) ? a.rows.selId : a.rows.items()[0].id;
    if (pane !== "y") setPane("y");
    return a.rows.focus(id);
  }

  renderType();
  setPane("plot");

  return {
    el: root,
    show() {
      if (!seen) { seen = true; A().focusFirst(); }
      else app.setActive(A().rows.activeEditor());
      requestAnimationFrame(() => { resize(); schedule(); });
    },
    needsKeypad() { return pane === "y" || !app.isStacked(); },
    activeEditor() { return A().rows.activeEditor(); },
    focusEditor,
    /** token for the X,T,θ,n key in the current graph type */
    varToken() { return A().varToken(); },
    graphType() { return st.graphType; },
    setType,
    arrow(dir, ed) {
      if (ed && (dir === "up" || dir === "down")) { A().rows.moveFocus(dir); return; }
      A().arrow(dir);
    },
    enter() { A().rows.enter(); schedule(); },
    showPlot() { setPane("plot"); },
    escape() { if (A().clear()) { showInfo(); schedule(); return true; } return false; },
    addExpression(text) {
      setType("function");
      const f = adapters.function.addExpression(text);
      if (!f) return;
      setPane("plot"); schedule();
    },
    refresh() { Object.values(adapters).forEach((a) => a.refresh()); applyAspect(); showInfo(); schedule(); },
    onSettings(key) { if (key === "equalScale" && st.settings.equalScale) { applyAspect(); commitView(); } this.refresh(); },
  };
}
