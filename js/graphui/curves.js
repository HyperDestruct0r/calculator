// Shared adapter for sampled curves: POLAR (r = f(θ)) and PARAMETRIC (x = f(t), y = g(t)).
import { validate } from "../engine.js";
import { tok } from "../editor.js";
import { derivativeEx, findZeros, findExtrema, integrateEx } from "../numerics.js";
import { resolveRange, splitCurve } from "../graphtypes/curve.js";
import { compilePolar, samplePolar, polarAsParametric, polarToXY } from "../graphtypes/polar.js";
import { compileParametric, sampleParametric } from "../graphtypes/parametric.js";
import { createRows, createFieldsPanel } from "./rows.js";

const CONFIG = {
  polar: {
    id: "polar", gtype: "polar", label: "POLAR", yLabel: "r=", gset: "polar", pname: "θ", ptoken: "theta",
    items: (st) => st.polars, fields: [{ key: "expr", ph: "r(θ)" }], rowLabel: (i) => `r${i + 1}=`,
    make: (id, color) => ({ id, expr: "", on: true, color }),
    compile: (item, o) => compilePolar(item.expr, o),
    ready: (item) => item.expr.trim(),
    validate: (item, o) => (!item.expr.trim() ? [] : check(item.expr, { ...o, indep: ["theta"], alias: { t: "theta" } }, "expr")),
    sample: (c, r, angle) => samplePolar(c, { ...r, angle }),
    point: (c, p, angle) => { const rv = c(p); const [x, y] = polarToXY(rv, p, angle); return { x, y, r: rv }; },
    geometry: (c, angle) => polarAsParametric(c, angle),
    zeroTitle: "r = 0 (curve passes through the origin) at", zeroPoint: () => ({ x: 0, y: 0 }),
    zeroFn: (c) => c, extremaFn: (c) => c, extremaTitle: (k) => (k === "min" ? "r minima" : "r maxima"),
    infoFor: (name, p, pt, fmt) => `<span>θ = <b>${fmt(p)}</b></span><span>r = <b>${fmt(pt.r)}</b></span><span>x = <b>${fmt(pt.x)}</b></span><span>y = <b>${fmt(pt.y)}</b></span>`,
    integTitle: "swept area ½∫r² dθ",
  },
  param: {
    id: "parametric", gtype: "param", label: "PARAMETRIC", yLabel: "x(t)", gset: "param", pname: "t", ptoken: "t",
    items: (st) => st.params, fields: [{ key: "x", ph: "x(t)", label: "x=" }, { key: "y", ph: "y(t)", label: "y=" }], rowLabel: (i) => `T${i + 1}`,
    make: (id, color) => ({ id, x: "", y: "", on: true, color }),
    compile: (item, o) => compileParametric(item.x, item.y, o),
    ready: (item) => item.x.trim() && item.y.trim(),
    validate: (item, o) => [["x", item.x], ["y", item.y]].flatMap(([k, t]) => (t.trim() ? check(t, { ...o, indep: ["t"] }, k) : [])),
    sample: (c, r) => sampleParametric(c, r),
    point: (c, p) => ({ x: c.fx(p), y: c.fy(p) }),
    geometry: (c) => ({ fx: c.fx, fy: c.fy, toParam: (t) => t }),
    zeroTitle: "x-intercepts (y(t) = 0) at", zeroFn: (c) => c.fy, extremaFn: (c) => c.fy,
    extremaTitle: (k) => (k === "min" ? "lowest points (min y)" : "highest points (max y)"),
    infoFor: (name, p, pt, fmt) => `<span>t = <b>${fmt(p)}</b></span><span>x = <b>${fmt(pt.x)}</b></span><span>y = <b>${fmt(pt.y)}</b></span>`,
    integTitle: "arc length ∫√(x′²+y′²) dt",
  },
};
function check(text, o, key) {
  const v = validate(text, { ...o, complex: false });
  return v.ok ? [] : [{ key, msg: v.error }];
}

export function createCurveType(g, kind) {
  const cfg = CONFIG[kind];
  const { st, app } = g;
  const compiled = new Map();
  let trace = null, ana = null;
  const angle = () => st.settings.angle;
  const co = () => ({ angle: angle(), vars: st.vars });
  const fmt = (v) => g.fmt(v);

  const rows = createRows(g, {
    items: () => cfg.items(st), max: 8, fields: cfg.fields, label: cfg.rowLabel, make: cfg.make,
    validate: (item) => cfg.validate(item, co()),
    onEdit: (item) => { compiled.delete(item.id); ana = null; },
    onToggle: (item) => { if (!item.on && trace && trace.id === item.id) trace = null; ana = null; g.showInfo(); },
    onRemove: (id) => { compiled.delete(id); if (trace && trace.id === id) trace = null; ana = null; g.showInfo(); },
  });

  function compiledFor(item) {
    const key = cfg.fields.map((f) => item[f.key]).join("|") + "|" + angle();
    let c = compiled.get(item.id);
    if (!c || c.key !== key) {
      let fn = null;
      try { if (cfg.ready(item)) fn = cfg.compile(item, co()); } catch { fn = null; }
      c = { key, fn };
      compiled.set(item.id, c);
    }
    return c.fn;
  }
  const range = () => resolveRange(st.gset[cfg.gset], kind, angle(), st.vars);
  const enabled = () => cfg.items(st).map((item, i) => ({ item, i, c: compiledFor(item) })).filter((o) => o.item.on && o.c);
  const target = () => { const l = enabled(); return l.find((q) => q.item.id === rows.selId) || l[0] || null; };

  const panel = createFieldsPanel(g, {
    title: `${cfg.pname} range`,
    fields: [
      { key: "min", label: `${cfg.pname}min`, ph: () => defaultText("min") },
      { key: "max", label: `${cfg.pname}max`, ph: () => defaultText("max") },
      { key: "step", label: `${cfg.pname}step`, ph: () => defaultText("step") },
    ],
    store: st.gset[cfg.gset],
    validate: () => range().error || null,
    onChange: () => { ana = null; },
  });
  function defaultText(k) {
    const d = resolveRange({}, kind, angle());
    return k === "step" ? (angle() === "deg" ? "3" : "π/60") : String(angle() === "deg" ? d[k] : k === "max" ? "2π" : "0");
  }

  function pxJump() { const v = g.view; return 0.75 * Math.max(v.xMax - v.xMin, v.yMax - v.yMin); }

  function draw(c) {
    const { ctx, X, Y, colors } = c;
    const r = range();
    if (r.error) return;
    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = c.lineWidth;
    for (const { item, c: fn } of enabled()) {
      const s = cfg.sample(fn, r, angle());
      ctx.strokeStyle = item.color; ctx.fillStyle = item.color; ctx.beginPath();
      for (const line of splitCurve(s.xs, s.ys, pxJump(), 1e7)) {
        if (line.length === 1) { ctx.moveTo(X(s.xs[line[0]]) + 1, Y(s.ys[line[0]])); ctx.arc(X(s.xs[line[0]]), Y(s.ys[line[0]]), 1.5, 0, 7); continue; }
        line.forEach((idx, k) => { const px = X(s.xs[idx]), py = Y(s.ys[idx]); if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      }
      ctx.stroke();
    }
    if (ana && ana.tangent) {
      const t = ana.tangent;
      ctx.strokeStyle = t.color; ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; ctx.beginPath();
      if (t.vertical) { ctx.moveTo(X(t.x0), 0); ctx.lineTo(X(t.x0), c.H); }
      else { ctx.moveTo(X(c.view.xMin), Y(t.y0 + t.m * (c.view.xMin - t.x0))); ctx.lineTo(X(c.view.xMax), Y(t.y0 + t.m * (c.view.xMax - t.x0))); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    const dot = (x, y, color, rad = 5) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      ctx.beginPath(); ctx.arc(X(x), Y(y), rad, 0, 7); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = colors.bg; ctx.stroke();
    };
    if (ana && ana.marks) ana.marks.forEach((p) => dot(p.x, p.y, p.color || colors.fg));
    if (trace) {
      const o = enabled().find((q) => q.item.id === trace.id);
      if (o) { const pt = cfg.point(o.c, trace.p, angle()); dot(pt.x, pt.y, o.item.color, 6); }
    }
  }

  function infoHtml() {
    if (ana && ana.html) return ana.html;
    if (trace) {
      const o = enabled().find((q) => q.item.id === trace.id);
      if (o) return `<span style="color:${o.item.color}"><b>${cfg.rowLabel(o.i).replace("=", "")}</b></span>` + cfg.infoFor(cfg.pname, trace.p, cfg.point(o.c, trace.p, angle()), fmt);
    }
    const r = range();
    if (r.error) return `<span style="color:var(--danger)">${r.error}</span>`;
    return "";
  }

  function tap(p) {
    const r = range();
    if (r.error) return;
    let best = null;
    for (const o of enabled()) {
      const s = cfg.sample(o.c, r, angle());
      for (let k = 0; k < s.xs.length; k++) {
        if (!Number.isFinite(s.xs[k]) || !Number.isFinite(s.ys[k])) continue;
        const d = Math.hypot(g.X(s.xs[k]) - p.x, g.Y(s.ys[k]) - p.y);
        if (d < 44 && (!best || d < best.d)) best = { o, d, p: (s.thetas || s.ts)[k] };
      }
    }
    ana = null;
    if (best) { trace = { id: best.o.item.id, p: best.p }; rows.selId = best.o.item.id; } else trace = null;
    g.showInfo(); g.schedule();
  }
  function arrow(dir) {
    const l = enabled();
    if (!l.length) { app.toast("Turn on a curve first"); return; }
    const r = range();
    if (r.error) return;
    ana = null;
    if (!trace) { const o = l.find((q) => q.item.id === rows.selId) || l[0]; trace = { id: o.item.id, p: r.min }; rows.selId = o.item.id; }
    if (dir === "left" || dir === "right") trace.p = Math.min(r.max, Math.max(r.min, trace.p + (dir === "right" ? r.step : -r.step)));
    else { const i = l.findIndex((q) => q.item.id === trace.id); const n = l[(i + (dir === "down" ? 1 : -1) + l.length) % l.length]; trace.id = n.item.id; rows.selId = n.item.id; }
    g.showInfo(); g.schedule();
  }

  const needTarget = () => { const o = target(); if (!o) g.showInfo(`<span class="muted">Turn on a ${kind === "polar" ? "polar curve" : "parametric curve"} first.</span>`); return o; };
  const rangeOrMsg = () => { const r = range(); if (r.error) { g.showInfo(`<span style="color:var(--danger)">${r.error}</span>`); return null; } return r; };
  const label = (o) => `<span style="color:${o.item.color}"><b>${cfg.rowLabel(o.i).replace("=", "")}</b></span>`;
  const rn = g.rn;
  function show(html, marks) { ana = { html, marks: marks || [] }; trace = null; g.showInfo(); g.schedule(); }

  const tools = {
    zero() {
      const o = needTarget(), r = o && rangeOrMsg();
      if (!r) return;
      const zs = findZeros(cfg.zeroFn(o.c), r.min, r.max, 4000).slice(0, 24);
      const pts = zs.map((z) => (cfg.zeroPoint ? { ...cfg.zeroPoint(), p: z.x } : { x: cfg.point(o.c, z.x, angle()).x, y: 0, p: z.x }));
      show(`${label(o)}<span>${cfg.zeroTitle}:</span>` + (zs.length ? zs.map((z, k) => `<span>${cfg.pname} = <b>${fmt(rn(z.x))}</b>${kind === "param" ? ` → (<b>${fmt(rn(pts[k].x))}</b>, 0)` : ""}</span>`).join("") : '<span class="muted">none in range</span>'),
        pts.map((q) => ({ x: q.x, y: q.y, color: o.item.color })));
    },
    ...Object.fromEntries(["min", "max"].map((kd) => [kd, () => {
      const o = needTarget(), r = o && rangeOrMsg();
      if (!r) return;
      const ex = findExtrema(cfg.extremaFn(o.c), r.min, r.max, kd, 4000).slice(0, 24);
      const pts = ex.map((e) => ({ ...cfg.point(o.c, e.x, angle()), p: e.x }));
      show(`${label(o)}<span>${cfg.extremaTitle(kd)}:</span>` + (ex.length ? pts.map((q) => `<span>${cfg.pname} = <b>${fmt(rn(q.p))}</b> → (<b>${fmt(rn(q.x))}</b>, <b>${fmt(rn(q.y))}</b>)</span>`).join("") : '<span class="muted">none in range</span>'),
        pts.map((q) => ({ x: q.x, y: q.y, color: o.item.color })));
    }])),
    deriv() {
      const o = needTarget(), r = o && rangeOrMsg();
      if (!r) return;
      const p0 = trace && trace.id === o.item.id ? trace.p : (r.min + r.max) / 2;
      const geo = cfg.geometry(o.c, angle());
      const phi = geo.toParam(p0);
      const dx = derivativeEx(geo.fx, phi), dy = derivativeEx(geo.fy, phi);
      const pt = cfg.point(o.c, p0, angle());
      if (!dx.ok || !dy.ok || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) { g.showInfo('<span class="muted">No tangent there (undefined, a corner, or the curve is not smooth).</span>'); return; }
      const mark = [{ x: pt.x, y: pt.y, color: o.item.color }];
      const head = `${label(o)}<span>at ${cfg.pname} = <b>${fmt(rn(p0))}</b></span><span>(x, y) = (<b>${fmt(pt.x)}</b>, <b>${fmt(pt.y)}</b>)</span>`;
      const scale = Math.max(Math.abs(dx.value), Math.abs(dy.value), 1e-300);
      if (Math.abs(dx.value) < 1e-9 * scale && Math.abs(dy.value) < 1e-9 * scale) { show(head + '<span class="muted">stationary point (dx = dy = 0): no tangent direction</span>', mark); return; }
      if (Math.abs(dx.value) < 1e-9 * scale) { ana = { tangent: { x0: pt.x, y0: pt.y, vertical: true, color: o.item.color }, marks: mark, html: head + "<span>vertical tangent: x = <b>" + fmt(pt.x) + "</b></span>" }; }
      else { const m = dy.value / dx.value; ana = { tangent: { x0: pt.x, y0: pt.y, m, color: o.item.color }, marks: mark, html: head + `<span>dy/dx = <b>${fmt(m)}</b></span>` }; }
      trace = null; g.showInfo(); g.schedule();
    },
    integ() {
      const o = needTarget(), r = o && rangeOrMsg();
      if (!r) return;
      const geo = cfg.geometry(o.c, angle());
      let res;
      if (kind === "polar") {
        const u = angle() === "deg" ? Math.PI / 180 : 1;
        res = integrateEx((phi) => { const rv = o.c(phi / u); return 0.5 * rv * rv; }, r.min * u, r.max * u);
      } else {
        const speed = (t) => { const a = derivativeEx(geo.fx, t), b = derivativeEx(geo.fy, t); return a.ok && b.ok ? Math.hypot(a.value, b.value) : NaN; };
        res = integrateEx(speed, r.min, r.max);
      }
      const note = kind === "polar" ? "area swept by the radius vector; overlapping loops count twice" : "";
      show(`${label(o)}<span>${cfg.integTitle} over [${fmt(rn(r.min))}, ${fmt(rn(r.max))}] =</span>` + (res.ok ? `<span><b>${fmt(res.value)}</b></span>${note ? `<span class="muted">${note}</span>` : ""}` : '<span class="muted">could not be computed (curve not smooth or undefined somewhere in the range)</span>'));
    },
    evalAt() {
      const o = needTarget();
      if (!o) return;
      g.promptValues(`Evaluate ${label(o).replace(/<[^>]+>/g, "")}`, [{ key: "p", label: `${cfg.pname} =` }], ({ p }) => {
        const pt = cfg.point(o.c, p, angle());
        const ok = Number.isFinite(pt.x) && Number.isFinite(pt.y);
        show(`${label(o)}` + (ok ? cfg.infoFor(cfg.pname, p, pt, fmt) : `<span class="muted">undefined at ${cfg.pname} = ${fmt(p)}</span>`), ok ? [{ x: pt.x, y: pt.y, color: o.item.color }] : []);
      });
    },
  };

  return {
    id: cfg.id, gtype: cfg.gtype, label: cfg.label, yLabel: cfg.yLabel, equalScale: true,
    varToken: () => tok(cfg.ptoken),
    rows, tools, draw, tap, arrow, infoHtml, panel,
    hint: kind === "polar" ? "Tap a curve to trace θ · ←/→ step θ · drag to pan · pinch or wheel to zoom" : "Tap a curve to trace t · ←/→ step t · drag to pan · pinch or wheel to zoom",
    clear() { const had = !!(ana || trace); ana = null; trace = null; return had; },
    fit() {
      const r = range();
      if (r.error) return null;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const o of enabled()) {
        const s = cfg.sample(o.c, r, angle());
        s.xs.forEach((x, k) => { const y = s.ys[k]; if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e6 && Math.abs(y) < 1e6) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
      }
      if (!Number.isFinite(x0)) return null;
      const px = (x1 - x0 || 2) * 0.1, py = (y1 - y0 || 2) * 0.1;
      return { xMin: x0 - px, xMax: x1 + px, yMin: y0 - py, yMax: y1 + py };
    },
    refresh() { compiled.clear(); rows.revalidateAll(); panel.refresh(); ana = null; },
    enabledCount: () => enabled().length,
    traceActive: () => !!trace,
    focusFirst() { const it = cfg.items(st)[0]; if (it) rows.focus(it.id); },
    unavailable: { inter: `Intersections are only available for FUNCTION graphs. ${kind === "polar" ? "Polar" : "Parametric"} curves can intersect at different parameter values, which this tool does not search for.` },
  };
}
