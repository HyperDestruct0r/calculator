// SEQUENCE graphs: discrete points (n, u(n)); explicit and recursive definitions.
import { evaluate } from "../engine.js";
import { tok } from "../editor.js";
import { computeSequence } from "../graphtypes/sequence.js";
import { createRows, createFieldsPanel } from "./rows.js";

export function createSequenceType(g) {
  const { st, app } = g;
  const co = () => ({ angle: st.settings.angle, vars: st.vars });
  const fmt = (v) => g.fmt(v);
  let trace = null, ana = null;
  const cache = new Map();

  /** {nMin, nMax, error?} from the panel text (empty = 1 and 20). */
  function nRange() {
    const get = (k, d) => {
      const t = (st.gset.seq[k] || "").trim();
      if (!t) return d;
      const v = evaluate(t, co());
      if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`${k} must be an integer`);
      return v;
    };
    try { const nMin = get("nMin", 1), nMax = get("nMax", 20); if (nMax < nMin) return { nMin, nMax, error: "nMax must be at least nMin" }; return { nMin, nMax }; }
    catch (e) { return { nMin: 1, nMax: 20, error: e.message }; }
  }
  function termsFor(item) {
    const r = nRange();
    const key = [item.expr, item.init, r.nMin, r.nMax, st.settings.angle, JSON.stringify(st.vars)].join("|");
    let c = cache.get(item.id);
    if (!c || c.key !== key) { c = { key, res: r.error ? { terms: [], error: r.error } : computeSequence(item, { nMin: r.nMin, nMax: r.nMax, ...co() }) }; cache.set(item.id, c); }
    return c.res;
  }

  const rows = createRows(g, {
    items: () => st.seqs, max: 6,
    fields: [{ key: "expr", ph: "u(n)", label: "u(n)=" }, { key: "init", ph: "e.g. 1,1", label: "u(nMin)=" }],
    label: (i) => `u${i + 1}`,
    make: (id, color) => ({ id, expr: "", init: "", on: true, color }),
    validate: (item) => {
      if (!item.expr.trim()) return [];
      const res = termsFor(item);
      if (!res.error) return [];
      return [{ key: /^Initial/.test(res.error) ? "init" : "expr", msg: res.error }];
    },
    onEdit: (item) => { cache.delete(item.id); ana = null; },
    onToggle: (item) => { if (!item.on && trace && trace.id === item.id) trace = null; g.showInfo(); },
    onRemove: (id) => { cache.delete(id); if (trace && trace.id === id) trace = null; },
  });

  const panel = createFieldsPanel(g, {
    title: "n range",
    fields: [{ key: "nMin", label: "nMin", ph: "1" }, { key: "nMax", label: "nMax", ph: "20" }],
    store: st.gset.seq,
    validate: () => nRange().error || null,
    onChange: () => { ana = null; },
  });

  const enabled = () => st.seqs.map((item, i) => ({ item, i, res: item.on && item.expr.trim() ? termsFor(item) : null })).filter((o) => o.item.on && o.res && o.res.terms.some((t) => Number.isFinite(t.value)));

  function draw(c) {
    const { ctx, X, Y, colors, H } = c;
    for (const { item, res } of enabled()) {
      ctx.strokeStyle = item.color + "55"; ctx.lineWidth = 1; ctx.beginPath();
      const y0 = Y(0);
      for (const t of res.terms) { if (!Number.isFinite(t.value)) continue; ctx.moveTo(X(t.n), Math.max(-50, Math.min(H + 50, y0))); ctx.lineTo(X(t.n), Math.max(-1e4, Math.min(1e4, Y(t.value)))); }
      ctx.stroke();
      ctx.fillStyle = item.color; ctx.strokeStyle = colors.bg; ctx.lineWidth = 2;
      for (const t of res.terms) {
        if (!Number.isFinite(t.value)) continue;
        const px = X(t.n), py = Y(t.value);
        if (py < -20 || py > H + 20) continue;
        ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 7); ctx.fill(); ctx.stroke();
      }
    }
    if (trace) {
      const o = enabled().find((q) => q.item.id === trace.id);
      const t = o && o.res.terms.find((q) => q.n === trace.n);
      if (t && Number.isFinite(t.value)) { ctx.beginPath(); ctx.arc(X(t.n), Y(t.value), 8, 0, 7); ctx.strokeStyle = colors.fg; ctx.lineWidth = 2; ctx.stroke(); }
    }
    if (ana && ana.marks) ana.marks.forEach((p) => { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 8, 0, 7); ctx.strokeStyle = colors.fg; ctx.lineWidth = 2; ctx.stroke(); });
  }

  const infoFor = (o, n) => {
    const t = o.res.terms.find((q) => q.n === n);
    return `<span style="color:${o.item.color}"><b>u${o.i + 1}</b></span><span>n = <b>${n}</b></span>` + (t && Number.isFinite(t.value) ? `<span>u(n) = <b>${fmt(t.value)}</b></span>` : '<span class="muted">undefined</span>');
  };
  function infoHtml() {
    if (ana && ana.html) return ana.html;
    if (trace) { const o = enabled().find((q) => q.item.id === trace.id); if (o) return infoFor(o, trace.n); }
    return "";
  }
  function tap(p) {
    let best = null;
    for (const o of enabled()) for (const t of o.res.terms) {
      if (!Number.isFinite(t.value)) continue;
      const d = Math.hypot(g.X(t.n) - p.x, g.Y(t.value) - p.y);
      if (d < 36 && (!best || d < best.d)) best = { o, d, n: t.n };
    }
    ana = null;
    if (best) { trace = { id: best.o.item.id, n: best.n }; rows.selId = best.o.item.id; } else trace = null;
    g.showInfo(); g.schedule();
  }
  function arrow(dir) {
    const l = enabled();
    if (!l.length) { app.toast("Turn on a sequence first"); return; }
    const r = nRange();
    ana = null;
    if (!trace) { const o = l.find((q) => q.item.id === rows.selId) || l[0]; trace = { id: o.item.id, n: r.nMin }; rows.selId = o.item.id; }
    if (dir === "left" || dir === "right") trace.n = Math.min(r.nMax, Math.max(r.nMin, trace.n + (dir === "right" ? 1 : -1)));
    else { const i = l.findIndex((q) => q.item.id === trace.id); const n = l[(i + (dir === "down" ? 1 : -1) + l.length) % l.length]; trace.id = n.item.id; rows.selId = n.item.id; }
    g.showInfo(); g.schedule();
  }

  const why = "Sequences are discrete points, so this calculus tool does not apply. Use TABLE to list the terms, or graph a continuous formula as a FUNCTION.";
  const tools = {
    evalAt() {
      const l = enabled();
      if (!l.length) { g.showInfo('<span class="muted">Turn on a sequence first.</span>'); return; }
      const o = l.find((q) => q.item.id === rows.selId) || l[0];
      g.promptValues(`Evaluate u${o.i + 1}(n)`, [{ key: "n", label: "n =" }], ({ n }) => {
        if (!Number.isInteger(n)) { g.showInfo('<span class="muted">n must be an integer.</span>'); return; }
        const t = o.res.terms.find((q) => q.n === n);
        ana = { html: t ? infoFor(o, n) : `<span class="muted">n = ${n} is outside the computed range (${nRange().nMin} … ${nRange().nMax}).</span>`, marks: t && Number.isFinite(t.value) ? [{ x: n, y: t.value }] : [] };
        trace = null; g.showInfo(); g.schedule();
      });
    },
  };

  return {
    id: "sequence", label: "SEQUENCE", yLabel: "u(n)", equalScale: false,
    varToken: () => tok("n"),
    rows, tools, draw, tap, arrow, infoHtml, panel,
    hint: "Tap a point to read u(n) · ←/→ step n · TABLE lists every term",
    clear() { const had = !!(ana || trace); ana = null; trace = null; return had; },
    fit() {
      const r = nRange();
      if (r.error) return null;
      let lo = 0, hi = 0;
      for (const o of enabled()) o.res.terms.forEach((t) => { if (Number.isFinite(t.value) && Math.abs(t.value) < 1e12) { lo = Math.min(lo, t.value); hi = Math.max(hi, t.value); } });
      const px = Math.max(1, (r.nMax - r.nMin) * 0.08), py = (hi - lo || 2) * 0.1;
      return { xMin: r.nMin - px, xMax: r.nMax + px, yMin: lo - py, yMax: hi + py };
    },
    refresh() { cache.clear(); rows.revalidateAll(); panel.refresh(); ana = null; },
    enabledCount: () => enabled().length,
    traceActive: () => !!trace,
    focusFirst() { if (st.seqs[0]) rows.focus(st.seqs[0].id); },
    unavailable: { zero: why, min: why, max: why, inter: why, deriv: why, integ: why },
  };
}
