// GRAPH screen: Y= function list + plot canvas + analysis tools.
import { el } from "./dom.js";
import { Editor } from "./editor.js";
import { compileGraph, validate } from "./engine.js";
import { PALETTE } from "./store.js";
import { findZeros, findExtrema, findIntersections, fitY, integral, derivative } from "./numerics.js";
import { formatNumber, escapeHtml } from "./format.js";

const MAX_FUNCS = 10;
const niceStep = (raw) => {
  const p = Math.pow(10, Math.floor(Math.log10(raw))), q = raw / p;
  return (q < 1.5 ? 1 : q < 3.5 ? 2 : q < 7.5 ? 5 : 10) * p;
};
const rn = (v) => Number(Number(v).toPrecision(8));

export function createGraphView(app) {
  const st = app.state;
  const root = el("section", "view graph");
  root.innerHTML = `
    <div class="gtabs"><button type="button" class="lcd-btn" data-pane="y">Y=</button><button type="button" class="lcd-btn" data-pane="plot">PLOT</button></div>
    <div class="glayout" data-pane="plot">
      <div class="y-pane">
        <div class="y-list" aria-label="Functions"></div>
        <div class="y-actions"><button type="button" class="lcd-btn" data-act="add">＋ Add function</button></div>
      </div>
      <div class="plot-pane">
        <div class="ptools">
          <button type="button" class="lcd-btn" data-act="zoomOut" title="Zoom out" aria-label="Zoom out">−</button>
          <button type="button" class="lcd-btn" data-act="zoomIn" title="Zoom in" aria-label="Zoom in">+</button>
          <button type="button" class="lcd-btn" data-act="reset" title="Reset view">Reset</button>
          <select data-act="preset" aria-label="Zoom presets"><option value="">Zoom…</option><option value="std">Standard</option><option value="trig">Trig</option><option value="fit">Fit Y</option><option value="square">Square</option></select>
          <span class="sep"></span>
          <button type="button" class="lcd-btn" data-act="zero" title="Zeros of the selected function in view">Zeros</button>
          <button type="button" class="lcd-btn" data-act="min">Min</button>
          <button type="button" class="lcd-btn" data-act="max">Max</button>
          <button type="button" class="lcd-btn" data-act="inter" title="Intersections of enabled functions">∩</button>
          <button type="button" class="lcd-btn" data-act="deriv" title="Derivative at the trace point">d/dx</button>
          <button type="button" class="lcd-btn" data-act="integ" title="Tap two bounds on the graph">∫</button>
          <button type="button" class="lcd-btn" data-act="clear">Clear</button>
        </div>
        <div class="canvas-wrap"><canvas aria-label="Function graph"></canvas></div>
        <div class="pinfo mono" aria-live="polite"></div>
      </div>
    </div>`;
  const list = root.querySelector(".y-list");
  const layout = root.querySelector(".glayout");
  const wrap = root.querySelector(".canvas-wrap");
  const canvas = root.querySelector("canvas");
  const info = root.querySelector(".pinfo");
  const ctx = canvas.getContext("2d");

  let pane = "plot";
  let activeId = null;       // focused Y= row (null = plot has focus)
  let selId = null;          // function used by trace / analysis tools
  const editors = new Map();
  const compiled = new Map();
  let view = { ...st.view };
  let W = 0, H = 0, sized = false;
  let trace = null, ana = null, pending = null, hover = null;
  let raf = 0, seen = false;

  // ---------- function list ----------
  const fnById = (id) => st.funcs.find((f) => f.id === id);
  const indexOf = (id) => st.funcs.findIndex((f) => f.id === id);

  function fnFor(f) {
    const key = f.expr + "|" + st.settings.angle;
    let c = compiled.get(f.id);
    if (!c || c.key !== key) {
      let fn = null;
      try { if (f.expr.trim()) fn = compileGraph(f.expr, { angle: st.settings.angle }); } catch { fn = null; }
      c = { key, fn };
      compiled.set(f.id, c);
    }
    return c.fn;
  }
  const enabled = () => st.funcs.map((f, i) => ({ f, i, fn: fnFor(f) })).filter((o) => o.f.on && o.fn);

  function editorFor(f) {
    let ed = editors.get(f.id);
    if (!ed) {
      ed = new Editor({
        placeholder: "f(x)",
        onFocus: () => focusRow(f.id),
        onChange: () => {
          f.expr = ed.text();
          compiled.delete(f.id);
          ana = null; pending = null;
          updateValidity(f);
          app.save(); schedule();
        },
      });
      ed.setText(f.expr, { silent: true });
      editors.set(f.id, ed);
    }
    return ed;
  }

  function updateValidity(f) {
    const row = list.querySelector(`.y-row[data-id="${f.id}"]`);
    if (!row) return;
    const v = validate(f.expr, { angle: st.settings.angle });
    row.querySelector(".ed").classList.toggle("bad", !v.ok);
    const m = row.querySelector(".msg");
    m.hidden = v.ok;
    m.textContent = v.ok ? "" : v.error;
  }

  function nextColor() {
    const used = new Set(st.funcs.map((f) => f.color));
    return PALETTE.find((c) => !used.has(c)) || PALETTE[st.funcs.length % PALETTE.length];
  }

  function renderRows() {
    list.innerHTML = "";
    st.funcs.forEach((f, i) => {
      const row = el("div", "y-row" + (f.id === selId ? " sel" : ""));
      row.dataset.id = f.id;
      row.innerHTML = `<button type="button" class="swatch" title="Change color" aria-label="Change color of Y${i + 1}" style="background:${f.color}"></button>
        <button type="button" class="lab${f.on ? " on" : ""}" title="Turn Y${i + 1} on or off" aria-pressed="${f.on}">Y${i + 1}=</button>
        <div class="edhost"></div>
        <button type="button" class="x" title="Remove" aria-label="Remove Y${i + 1}">✕</button>
        <div class="msg" hidden></div>`;
      const ed = editorFor(f);
      ed.attach(row.querySelector(".edhost"));
      ed.setFocused(f.id === activeId);
      list.appendChild(row);
      updateValidity(f);
    });
  }

  function markSelected() {
    list.querySelectorAll(".y-row").forEach((r) => r.classList.toggle("sel", Number(r.dataset.id) === selId));
  }

  function focusRow(id) {
    activeId = id; selId = id;
    editors.forEach((e, k) => e.setFocused(k === id));
    app.setActive(editors.get(id) || null);
    markSelected();
  }
  function focusPlot() {
    if (activeId === null) return;
    activeId = null;
    editors.forEach((e) => e.setFocused(false));
    app.setActive(null);
  }
  function focusEditor() {
    if (!st.funcs.length) addFunction();
    const id = fnById(activeId) ? activeId : fnById(selId) ? selId : st.funcs[0].id;
    if (pane !== "y") setPane("y");
    focusRow(id);
    return editors.get(id);
  }

  function addFunction(expr = "") {
    if (st.funcs.length >= MAX_FUNCS) { app.toast(`Up to ${MAX_FUNCS} functions`); return null; }
    const f = { id: st.nextId++, expr, on: true, color: nextColor() };
    st.funcs.push(f);
    editorFor(f);
    renderRows();
    focusRow(f.id);
    app.save(); schedule();
    return f;
  }
  function removeFunction(id) {
    const i = indexOf(id);
    if (i < 0) return;
    st.funcs.splice(i, 1);
    editors.delete(id); compiled.delete(id);
    if (trace && trace.id === id) trace = null;
    if (selId === id) selId = null;
    ana = null; pending = null;
    if (activeId === id) {
      activeId = null;
      const nb = st.funcs[Math.min(i, st.funcs.length - 1)];
      renderRows();
      if (nb) focusRow(nb.id); else app.setActive(null);
    } else renderRows();
    app.save(); schedule(); showInfo();
  }

  list.addEventListener("click", (e) => {
    const row = e.target.closest(".y-row");
    if (!row) return;
    const f = fnById(Number(row.dataset.id));
    if (!f) return;
    if (e.target.closest(".swatch")) {
      const k = PALETTE.indexOf(f.color);
      const used = new Set(st.funcs.filter((o) => o !== f).map((o) => o.color));
      let c = f.color;
      for (let step = 1; step <= PALETTE.length; step++) { const cand = PALETTE[(k + step + PALETTE.length) % PALETTE.length]; if (!used.has(cand)) { c = cand; break; } }
      f.color = c;
      row.querySelector(".swatch").style.background = c;
      app.save(); schedule();
    } else if (e.target.closest(".lab")) {
      f.on = !f.on;
      e.target.closest(".lab").classList.toggle("on", f.on);
      e.target.closest(".lab").setAttribute("aria-pressed", String(f.on));
      if (!f.on && trace && trace.id === f.id) trace = null;
      ana = null; app.save(); schedule(); showInfo();
    } else if (e.target.closest(".x")) removeFunction(f.id);
  });

  // ---------- view / geometry ----------
  const X = (x) => ((x - view.xMin) / (view.xMax - view.xMin)) * W;
  const Y = (y) => H - ((y - view.yMin) / (view.yMax - view.yMin)) * H;
  const unX = (px) => view.xMin + (px / W) * (view.xMax - view.xMin);
  const unY = (py) => view.yMax - (py / H) * (view.yMax - view.yMin);

  function commitView() { st.view = { ...view }; app.save(); }
  function applyAspect(force = false) {
    if (!W || !H || !(st.settings.equalScale || force)) return;
    const yc = (view.yMin + view.yMax) / 2, yr = ((view.xMax - view.xMin) * H) / W / 2;
    view = { ...view, yMin: yc - yr, yMax: yc + yr };
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
    if (p === "std") { view = { xMin: -10, xMax: 10, yMin: -6, yMax: 6 }; applyAspect(); }
    else if (p === "trig") {
      const deg = st.settings.angle === "deg", r = deg ? 360 : 2 * Math.PI;
      view = { xMin: -r, xMax: r, yMin: -4, yMax: 4 };
    } else if (p === "square") applyAspect(true);
    else if (p === "fit") {
      const r = fitY(enabled().map((o) => o.fn), view.xMin, view.xMax);
      if (r) view = { ...view, ...r }; else app.toast("Nothing to fit");
    }
    commitView(); schedule();
  }

  // ---------- drawing ----------
  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (!sized) { W = w; H = h; sized = true; applyAspect(); commitView(); }
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
    const cs = getComputedStyle(root);
    const col = (n) => cs.getPropertyValue(n).trim();
    const bg = col("--lcd-bg"), fg = col("--lcd-fg"), dim = col("--lcd-dim"), gridC = col("--lcd-grid"), axisC = col("--lcd-axis");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const xr = view.xMax - view.xMin, yr = view.yMax - view.yMin;
    const xs = niceStep(xr / Math.max(3, W / 80)), ys = niceStep(yr / Math.max(3, H / 60));
    ctx.lineWidth = 1;
    if (st.settings.grid) {
      ctx.strokeStyle = gridC; ctx.beginPath();
      for (let x = Math.ceil(view.xMin / xs) * xs; x <= view.xMax; x += xs) { const px = Math.round(X(x)) + .5; ctx.moveTo(px, 0); ctx.lineTo(px, H); }
      for (let y = Math.ceil(view.yMin / ys) * ys; y <= view.yMax; y += ys) { const py = Math.round(Y(y)) + .5; ctx.moveTo(0, py); ctx.lineTo(W, py); }
      ctx.stroke();
    }
    ctx.strokeStyle = axisC; ctx.lineWidth = 1.5; ctx.beginPath();
    if (view.xMin <= 0 && view.xMax >= 0) { const px = Math.round(X(0)) + .5; ctx.moveTo(px, 0); ctx.lineTo(px, H); }
    if (view.yMin <= 0 && view.yMax >= 0) { const py = Math.round(Y(0)) + .5; ctx.moveTo(0, py); ctx.lineTo(W, py); }
    ctx.stroke();
    if (st.settings.axisLabels) {
      ctx.fillStyle = dim; ctx.font = "11px ui-monospace, Menlo, Consolas, monospace";
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

    const fns = enabled();
    // integral shading under the curve
    if (ana && ana.integral) {
      const { a, b, id, color } = ana.integral, o = fns.find((q) => q.f.id === id);
      if (o) {
        ctx.fillStyle = color + "44"; ctx.beginPath();
        const y0 = Y(0), steps = 240;
        ctx.moveTo(X(a), y0);
        for (let i = 0; i <= steps; i++) { const x = a + ((b - a) * i) / steps, y = o.fn(x); ctx.lineTo(X(x), Number.isFinite(y) ? Y(y) : y0); }
        ctx.lineTo(X(b), y0); ctx.closePath(); ctx.fill();
      }
    }
    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = st.settings.lineWidth;
    for (const { f, fn } of fns) {
      ctx.strokeStyle = f.color; ctx.beginPath();
      let prev = null, prevY = 0, open = false;
      for (let px = 0; px <= W; px++) {
        const y = fn(unX(px));
        if (!Number.isFinite(y)) { prev = null; open = false; continue; }
        let py = Y(y);
        py = Math.max(-1e5, Math.min(1e5, py));
        if (prev === null) { ctx.moveTo(px, py); open = true; }
        else if (Math.abs(py - prev) > H * 0.6 && (y > 0) !== (prevY > 0)) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        prev = py; prevY = y;
      }
      if (open || prev !== null) ctx.stroke();
    }
    // tangent
    if (ana && ana.tangent) {
      const { x0, y0, m, color } = ana.tangent;
      ctx.strokeStyle = color; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(X(view.xMin), Y(y0 + m * (view.xMin - x0))); ctx.lineTo(X(view.xMax), Y(y0 + m * (view.xMax - x0))); ctx.stroke(); ctx.setLineDash([]);
    }
    // markers
    const dot = (x, y, color, r = 5) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, 7); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = bg; ctx.stroke();
    };
    if (ana && ana.marks) ana.marks.forEach((p) => dot(p.x, p.y, p.color || fg));
    if (pending && pending.a !== undefined) { ctx.strokeStyle = fg; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(pending.a), 0); ctx.lineTo(X(pending.a), H); ctx.stroke(); ctx.setLineDash([]); }
    if (trace) {
      const o = fns.find((q) => q.f.id === trace.id);
      if (o) {
        const y = o.fn(trace.x);
        if (Number.isFinite(y)) {
          ctx.strokeStyle = dim; ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.beginPath();
          ctx.moveTo(X(trace.x), 0); ctx.lineTo(X(trace.x), H); ctx.moveTo(0, Y(y)); ctx.lineTo(W, Y(y)); ctx.stroke(); ctx.setLineDash([]);
          dot(trace.x, y, o.f.color, 6);
        }
      }
    }
  }

  // ---------- info line ----------
  const fmt = (v) => formatNumber(rn(v), st.settings.notation === "normal" ? {} : st.settings);
  function showInfo(html) {
    if (html !== undefined) { info.innerHTML = html; return; }
    if (ana && ana.html) info.innerHTML = ana.html;
    else if (trace) {
      const o = enabled().find((q) => q.f.id === trace.id);
      info.innerHTML = o ? `<span><b>Y${o.i + 1}</b></span><span>x = <b>${fmt(trace.x)}</b></span><span>y = <b>${fmt(o.fn(trace.x))}</b></span>` : "";
    } else if (pending) info.innerHTML = pending.prompt;
    else info.innerHTML = '<span class="muted">Tap the graph to trace · drag to pan · pinch or wheel to zoom</span>';
  }

  // ---------- pointer interaction ----------
  const pts = new Map();
  let gesture = null;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, pos(e));
    focusPlot();
    if (pts.size === 1) gesture = { type: "pan", start: pos(e), v: { ...view }, moved: false };
    else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      gesture = { type: "pinch", d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), v: { ...view }, moved: true };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) {
      if (e.pointerType === "mouse" && st.settings.showCoords && !trace && !ana && !pending) {
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
      // anchor: the math point that was under the pinch centre at gesture start
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
      const g = gesture; gesture = null;
      if (g.type === "pan" && !g.moved && e.type === "pointerup") tap(pos(e));
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
  canvas.addEventListener("pointerleave", () => { if (!trace && !ana && !pending) showInfo(); });

  function tap(p) {
    const x = unX(p.x);
    if (pending && pending.tool === "int") { integralStep(x); return; }
    let best = null;
    for (const o of enabled()) {
      const y = o.fn(x);
      if (!Number.isFinite(y)) continue;
      const d = Math.abs(Y(y) - p.y);
      if (d < 44 && (!best || d < best.d)) best = { o, d };
    }
    ana = null;
    if (best) { trace = { id: best.o.f.id, x }; selId = best.o.f.id; markSelected(); }
    else trace = null;
    showInfo(); schedule();
  }

  // keyboard (arrow keys while the plot has focus)
  function traceStart() {
    const list2 = enabled();
    if (!list2.length) { app.toast("Turn on a function first"); return null; }
    const o = list2.find((q) => q.f.id === (trace ? trace.id : selId)) || list2[0];
    if (!trace) trace = { id: o.f.id, x: (view.xMin + view.xMax) / 2 };
    selId = o.f.id; markSelected();
    return o;
  }
  function arrow(dir) {
    const o = traceStart();
    if (!o) return;
    ana = null;
    if (dir === "left" || dir === "right") {
      const step = ((view.xMax - view.xMin) / W) * 3 * (dir === "left" ? -1 : 1);
      trace.x += step;
      if (trace.x < view.xMin || trace.x > view.xMax) {
        const xr = view.xMax - view.xMin; view = { ...view, xMin: trace.x - xr / 2, xMax: trace.x + xr / 2 };
      }
    } else {
      const l = enabled(), i = l.findIndex((q) => q.f.id === trace.id);
      const n = l[(i + (dir === "down" ? 1 : -1) + l.length) % l.length];
      trace.id = n.f.id; selId = n.f.id; markSelected();
    }
    showInfo(); schedule();
  }

  // ---------- analysis tools ----------
  function target() {
    const l = enabled();
    if (!l.length) { showInfo('<span class="muted">Turn on a function first.</span>'); return null; }
    return l.find((q) => q.f.id === selId) || l[0];
  }
  const label = (o) => `<span style="color:${o.f.color}"><b>Y${o.i + 1}</b></span>`;
  const pt = (p) => `<span>(<b>${fmt(p.x)}</b>, <b>${fmt(p.y)}</b>)</span>`;
  function listResult(title, o, points) {
    points = points.slice(0, 24);
    ana = { marks: points.map((p) => ({ ...p, color: o ? o.f.color : null })),
      html: `${o ? label(o) + " " : ""}<span>${title}:</span>` + (points.length ? points.map(pt).join("") : '<span class="muted">none in view</span>') };
    trace = null; showInfo(); schedule();
  }
  function integralStep(x) {
    const o = pending.o;
    if (pending.a === undefined) {
      pending.a = x; pending.prompt = `<span>Lower bound x = <b>${fmt(x)}</b> — tap the upper bound</span>`;
      showInfo(); schedule(); return;
    }
    let a = pending.a, b = x, sign = 1;
    if (b < a) { [a, b] = [b, a]; sign = -1; }
    const v = sign * integral(o.fn, a, b);
    pending = null;
    ana = { integral: { a, b, id: o.f.id, color: o.f.color }, html: `${label(o)}<span>∫ from <b>${fmt(a)}</b> to <b>${fmt(b)}</b> =</span><span><b>${fmt(v)}</b></span>` };
    showInfo(); schedule();
  }

  const actions = {
    zoomIn() { zoomAt(0.75, W / 2, H / 2); commitView(); },
    zoomOut() { zoomAt(1 / 0.75, W / 2, H / 2); commitView(); },
    reset() { setPreset("std"); trace = null; ana = null; pending = null; showInfo(); },
    zero() { const o = target(); if (o) listResult("zeros", o, findZeros(o.fn, view.xMin, view.xMax).map((p) => ({ x: rn(p.x), y: 0 }))); },
    min() { const o = target(); if (o) listResult("minima", o, findExtrema(o.fn, view.xMin, view.xMax, "min").map((p) => ({ x: rn(p.x), y: p.y }))); },
    max() { const o = target(); if (o) listResult("maxima", o, findExtrema(o.fn, view.xMin, view.xMax, "max").map((p) => ({ x: rn(p.x), y: p.y }))); },
    inter() {
      const l = enabled();
      if (l.length < 2) { showInfo('<span class="muted">Turn on at least two functions.</span>'); return; }
      const out = [];
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++)
        findIntersections(l[i].fn, l[j].fn, view.xMin, view.xMax).forEach((p) => out.push({ x: rn(p.x), y: rn(p.y) }));
      listResult("intersections", null, out);
    },
    deriv() {
      const o = target();
      if (!o) return;
      const x0 = trace && trace.id === o.f.id ? trace.x : (view.xMin + view.xMax) / 2;
      const y0 = o.fn(x0), m = derivative(o.fn, x0);
      if (!Number.isFinite(y0) || !Number.isFinite(m)) { showInfo('<span class="muted">Not differentiable there.</span>'); return; }
      ana = { tangent: { x0, y0, m, color: o.f.color }, marks: [{ x: x0, y: y0, color: o.f.color }],
        html: `${label(o)}<span>at x = <b>${fmt(x0)}</b></span><span>f(x) = <b>${fmt(y0)}</b></span><span>f′(x) = <b>${fmt(m)}</b></span>` };
      trace = null; showInfo(); schedule();
    },
    integ() {
      const o = target();
      if (!o) return;
      ana = null; trace = null;
      pending = { tool: "int", o, prompt: `${label(o)}<span>Tap the lower bound on the graph</span>` };
      showInfo(); schedule();
    },
    clear() { ana = null; trace = null; pending = null; showInfo(); schedule(); },
    add() { addFunction(); },
  };
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (b && b.tagName === "BUTTON" && actions[b.dataset.act]) actions[b.dataset.act]();
    const tab = e.target.closest("[data-pane]");
    if (tab && tab.tagName === "BUTTON") setPane(tab.dataset.pane);
  });
  root.querySelector('select[data-act="preset"]').addEventListener("change", (e) => {
    if (e.target.value) setPreset(e.target.value);
    e.target.value = ""; e.target.blur();
  });

  function setPane(p) {
    pane = p;
    layout.dataset.pane = p;
    root.querySelectorAll(".gtabs .lcd-btn").forEach((b) => b.classList.toggle("on", b.dataset.pane === p));
    app.updateKeypad();
    if (p === "y") { if (activeId === null && st.funcs.length) focusRow(fnById(selId) ? selId : st.funcs[0].id); }
    else requestAnimationFrame(() => { resize(); schedule(); });
  }

  renderRows();
  setPane("plot");
  showInfo();

  return {
    el: root,
    show() {
      if (!fnById(selId)) selId = null;
      if (!seen) { seen = true; if (st.funcs[0]) focusRow(st.funcs[0].id); }
      else app.setActive(editors.get(activeId) || null);
      requestAnimationFrame(() => { resize(); schedule(); });
    },
    needsKeypad() { return pane === "y" || !app.isStacked(); },
    activeEditor() { return editors.get(activeId) || null; },
    focusEditor,
    arrow,
    enter(ed) {
      const i = indexOf(activeId);
      if (i < 0) return;
      const f = st.funcs[i];
      if (st.funcs[i + 1]) focusRow(st.funcs[i + 1].id);
      else if (f.expr.trim()) addFunction();
      schedule();
    },
    showPlot() { setPane("plot"); },
    escape() { if (pending || ana || trace) { actions.clear(); return true; } return false; },
    addExpression(text) {
      let f = st.funcs.find((q) => !q.expr.trim());
      if (f) { f.expr = text; f.on = true; editors.get(f.id)?.setText(text, { silent: true }); renderRows(); }
      else f = addFunction(text);
      if (!f) return;
      compiled.delete(f.id); ana = null; app.save();
      selId = f.id; markSelected(); setPane("plot"); schedule();
    },
    refresh() { compiled.clear(); st.funcs.forEach(updateValidity); applyAspect(); showInfo(); schedule(); },
    onSettings(key) { if (key === "equalScale" && st.settings.equalScale) { applyAspect(); commitView(); } this.refresh(); },
  };
}
