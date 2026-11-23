// FUNCTION graphs: y = f(x). Trace, zeros, extrema, intersections, derivative/tangent, definite integral, evaluate.
import { compileGraph, validate } from "../engine.js";
import { tok } from "../editor.js";
import { findZeros, findExtrema, findIntersections, fitY, integral, derivative } from "../numerics.js";
import { createRows } from "./rows.js";

export function createFunctionType(g) {
  const { st, app } = g;
  const compiled = new Map();
  let trace = null, ana = null, pending = null;

  const opts = () => ({ angle: st.settings.angle, vars: st.vars });
  const rows = createRows(g, {
    items: () => st.funcs, max: 10,
    fields: [{ key: "expr", ph: "f(x)" }],
    label: (i) => `Y${i + 1}=`,
    make: (id, color) => ({ id, expr: "", on: true, color }),
    validate: (f) => { const v = validate(f.expr, { ...opts(), complex: false }); return v.ok ? [] : [{ key: "expr", msg: v.error }]; },
    onEdit: (f) => { compiled.delete(f.id); ana = null; pending = null; },
    onToggle: (f) => { if (!f.on && trace && trace.id === f.id) trace = null; ana = null; g.showInfo(); },
    onRemove: (id) => { compiled.delete(id); if (trace && trace.id === id) trace = null; ana = null; pending = null; g.showInfo(); },
  });

  function fnFor(f) {
    const key = f.expr + "|" + st.settings.angle;
    let c = compiled.get(f.id);
    if (!c || c.key !== key) {
      let fn = null;
      try { if (f.expr.trim()) fn = compileGraph(f.expr, opts()); } catch { fn = null; }
      c = { key, fn };
      compiled.set(f.id, c);
    }
    return c.fn;
  }
  const enabled = () => st.funcs.map((f, i) => ({ f, i, fn: fnFor(f) })).filter((o) => o.f.on && o.fn);
  const fmt = (v) => g.fmt(v);
  const rn = g.rn;

  function draw(c) {
    const { ctx, X, Y, unX, W, H, view, colors } = c;
    const { fg, dim, bg } = colors;
    const fns = enabled();
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
    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = c.lineWidth;
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
    if (ana && ana.tangent) {
      const { x0, y0, m, color } = ana.tangent;
      ctx.strokeStyle = color; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(X(view.xMin), Y(y0 + m * (view.xMin - x0))); ctx.lineTo(X(view.xMax), Y(y0 + m * (view.xMax - x0))); ctx.stroke(); ctx.setLineDash([]);
    }
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

  function infoHtml() {
    if (ana && ana.html) return ana.html;
    if (trace) {
      const o = enabled().find((q) => q.f.id === trace.id);
      return o ? `<span><b>Y${o.i + 1}</b></span><span>x = <b>${fmt(trace.x)}</b></span><span>y = <b>${fmt(o.fn(trace.x))}</b></span>` : "";
    }
    if (pending) return pending.prompt;
    return "";
  }

  function tap(p) {
    const x = g.unX(p.x);
    if (pending && pending.tool === "int") { integralStep(x); return; }
    let best = null;
    for (const o of enabled()) {
      const y = o.fn(x);
      if (!Number.isFinite(y)) continue;
      const d = Math.abs(g.Y(y) - p.y);
      if (d < 44 && (!best || d < best.d)) best = { o, d };
    }
    ana = null;
    if (best) { trace = { id: best.o.f.id, x }; rows.selId = best.o.f.id; } else trace = null;
    g.showInfo(); g.schedule();
  }
  function traceStart() {
    const list = enabled();
    if (!list.length) { app.toast("Turn on a function first"); return null; }
    const o = list.find((q) => q.f.id === (trace ? trace.id : rows.selId)) || list[0];
    if (!trace) trace = { id: o.f.id, x: (g.view.xMin + g.view.xMax) / 2 };
    rows.selId = o.f.id;
    return o;
  }
  function arrow(dir) {
    const o = traceStart();
    if (!o) return;
    ana = null;
    if (dir === "left" || dir === "right") {
      const step = ((g.view.xMax - g.view.xMin) / g.W) * 3 * (dir === "left" ? -1 : 1);
      trace.x += step;
      if (trace.x < g.view.xMin || trace.x > g.view.xMax) {
        const xr = g.view.xMax - g.view.xMin; g.setView({ ...g.view, xMin: trace.x - xr / 2, xMax: trace.x + xr / 2 });
      }
    } else {
      const l = enabled(), i = l.findIndex((q) => q.f.id === trace.id);
      const n = l[(i + (dir === "down" ? 1 : -1) + l.length) % l.length];
      trace.id = n.f.id; rows.selId = n.f.id;
    }
    g.showInfo(); g.schedule();
  }

  // ---------- analysis tools ----------
  function target() {
    const l = enabled();
    if (!l.length) { g.showInfo('<span class="muted">Turn on a function first.</span>'); return null; }
    return l.find((q) => q.f.id === rows.selId) || l[0];
  }
  const label = (o) => `<span style="color:${o.f.color}"><b>Y${o.i + 1}</b></span>`;
  const pt = (p) => `<span>(<b>${fmt(p.x)}</b>, <b>${fmt(p.y)}</b>)</span>`;
  function listResult(title, o, points) {
    points = points.slice(0, 24);
    ana = { marks: points.map((p) => ({ ...p, color: o ? o.f.color : null })),
      html: `${o ? label(o) + " " : ""}<span>${title}:</span>` + (points.length ? points.map(pt).join("") : '<span class="muted">none in view</span>') };
    trace = null; g.showInfo(); g.schedule();
  }
  function integralStep(x) {
    const o = pending.o;
    if (pending.a === undefined) {
      pending.a = x; pending.prompt = `<span>Lower bound x = <b>${fmt(x)}</b> — tap the upper bound</span>`;
      g.showInfo(); g.schedule(); return;
    }
    let a = pending.a, b = x, sign = 1;
    if (b < a) { [a, b] = [b, a]; sign = -1; }
    const v = sign * integral(o.fn, a, b);
    pending = null;
    const shown = Number.isFinite(v) ? `<span><b>${fmt(v)}</b></span>` : '<span class="muted">does not converge (singularity inside the interval)</span>';
    ana = { integral: { a, b, id: o.f.id, color: o.f.color }, html: `${label(o)}<span>∫ from <b>${fmt(a)}</b> to <b>${fmt(b)}</b> =</span>${shown}` };
    g.showInfo(); g.schedule();
  }
  const view = () => g.view;
  const tools = {
    zero() { const o = target(); if (o) listResult("zeros", o, findZeros(o.fn, view().xMin, view().xMax).map((p) => ({ x: rn(p.x), y: 0 }))); },
    min() { const o = target(); if (o) listResult("minima", o, findExtrema(o.fn, view().xMin, view().xMax, "min").map((p) => ({ x: rn(p.x), y: p.y }))); },
    max() { const o = target(); if (o) listResult("maxima", o, findExtrema(o.fn, view().xMin, view().xMax, "max").map((p) => ({ x: rn(p.x), y: p.y }))); },
    inter() {
      const l = enabled();
      if (l.length < 2) { g.showInfo('<span class="muted">Turn on at least two functions.</span>'); return; }
      const out = [];
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++)
        findIntersections(l[i].fn, l[j].fn, view().xMin, view().xMax).forEach((p) => out.push({ x: rn(p.x), y: rn(p.y) }));
      listResult("intersections", null, out);
    },
    deriv() {
      const o = target();
      if (!o) return;
      const x0 = trace && trace.id === o.f.id ? trace.x : (view().xMin + view().xMax) / 2;
      const y0 = o.fn(x0), m = derivative(o.fn, x0);
      if (!Number.isFinite(y0) || !Number.isFinite(m)) { g.showInfo('<span class="muted">Not differentiable there (undefined, a corner, or infinite slope).</span>'); return; }
      ana = { tangent: { x0, y0, m, color: o.f.color }, marks: [{ x: x0, y: y0, color: o.f.color }],
        html: `${label(o)}<span>at x = <b>${fmt(x0)}</b></span><span>f(x) = <b>${fmt(y0)}</b></span><span>f′(x) = <b>${fmt(m)}</b></span><span>tangent: y = <b>${fmt(m)}</b>x ${y0 - m * x0 < 0 ? "−" : "+"} <b>${fmt(Math.abs(y0 - m * x0))}</b></span>` };
      trace = null; g.showInfo(); g.schedule();
    },
    integ() {
      const o = target();
      if (!o) return;
      ana = null; trace = null;
      pending = { tool: "int", o, prompt: `${label(o)}<span>Tap the lower bound on the graph</span>` };
      g.showInfo(); g.schedule();
    },
    evalAt() {
      const o = target();
      if (!o) return;
      g.promptValues(`Evaluate Y${o.i + 1}`, [{ key: "x", label: "x =" }], ({ x }) => {
        const y = o.fn(x);
        ana = { marks: [{ x, y, color: o.f.color }], html: `${label(o)}<span>x = <b>${fmt(x)}</b></span>` + (Number.isFinite(y) ? `<span>f(x) = <b>${fmt(y)}</b></span>` : '<span class="muted">f(x) is undefined there</span>') };
        trace = null; g.showInfo(); g.schedule();
      });
    },
  };

  return {
    id: "function", label: "FUNCTION", yLabel: "Y=", equalScale: true,
    varToken: () => tok("x"),
    rows, tools, draw, tap, arrow, infoHtml,
    hint: "Tap the graph to trace · drag to pan · pinch or wheel to zoom",
    clear() { const had = !!(pending || ana || trace); ana = null; trace = null; pending = null; return had; },
    fit() { const r = fitY(enabled().map((o) => o.fn), g.view.xMin, g.view.xMax); return r ? { ...g.view, ...r } : null; },
    trigView() { const deg = st.settings.angle === "deg", r = deg ? 360 : 2 * Math.PI; return { xMin: -r, xMax: r, yMin: -4, yMax: 4 }; },
    refresh() { compiled.clear(); rows.revalidateAll(); ana = null; },
    enabledCount: () => enabled().length,
    traceActive: () => !!trace,
    focusFirst() { if (st.funcs[0]) rows.focus(st.funcs[0].id); },
    addExpression(text) {
      let f = st.funcs.find((q) => !q.expr.trim());
      if (f) { f.expr = text; f.on = true; rows.setText(f.id, "expr", text); rows.render(); }
      else f = rows.add({ expr: text });
      if (!f) return null;
      compiled.delete(f.id); ana = null; app.save();
      rows.selId = f.id;
      return f;
    },
    unavailable: {},
  };
}
