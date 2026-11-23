// INEQUALITY graphs: shaded solution regions with dashed (strict) or solid (inclusive) boundaries.
import { tok } from "../editor.js";
import { findIntersections } from "../numerics.js";
import { compileInequality, regionIsAbove, sampleRegion, contourSegments, chainSegments } from "../graphtypes/inequality.js";
import { createRows } from "./rows.js";

export function createInequalityType(g) {
  const { st, app } = g;
  const compiled = new Map();
  let ana = null, test = null;
  const co = () => ({ angle: st.settings.angle, vars: st.vars });
  const fmt = (v) => g.fmt(v);

  const rows = createRows(g, {
    items: () => st.ineqs, max: 8,
    fields: [{ key: "expr", ph: "y > x²" }],
    label: (i) => `R${i + 1}:`,
    make: (id, color) => ({ id, expr: "", on: true, color }),
    validate: (item) => { if (!item.expr.trim()) return []; try { compileInequality(item.expr, co()); return []; } catch (e) { return [{ key: "expr", msg: e.message }]; } },
    onEdit: (item) => { compiled.delete(item.id); ana = null; },
    onToggle: () => { g.showInfo(); },
    onRemove: (id) => { compiled.delete(id); },
  });

  function compiledFor(item) {
    const key = item.expr + "|" + st.settings.angle;
    let c = compiled.get(item.id);
    if (!c || c.key !== key) {
      let q = null;
      try { if (item.expr.trim()) q = compileInequality(item.expr, co()); } catch { q = null; }
      c = { key, q }; compiled.set(item.id, c);
    }
    return c.q;
  }
  const enabled = () => st.ineqs.map((item, i) => ({ item, i, q: compiledFor(item) })).filter((o) => o.item.on && o.q);

  function draw(c) {
    const { ctx, X, Y, unX, unY, W, H, view, colors } = c;
    for (const { item, q } of enabled()) {
      const fill = item.color + "46";
      // ---- shading ----
      if (!q.equality && q.form === "y") {
        ctx.fillStyle = fill;
        const above = regionIsAbove(q);
        for (let px = 0; px < W; px += 2) {
          const y = q.boundary(unX(px + 1));
          if (!Number.isFinite(y)) continue;
          const py = Math.max(0, Math.min(H, Y(y)));
          if (above) ctx.fillRect(px, 0, 2, py); else ctx.fillRect(px, py, 2, H - py);
        }
      } else if (!q.equality && q.form === "x") {
        ctx.fillStyle = fill;
        const right = regionIsAbove(q);
        for (let py = 0; py < H; py += 2) {
          const x = q.boundary(unY(py + 1));
          if (!Number.isFinite(x)) continue;
          const px = Math.max(0, Math.min(W, X(x)));
          if (right) ctx.fillRect(px, py, W - px, 2); else ctx.fillRect(0, py, px, 2);
        }
      } else if (!q.equality) {
        const cell = 4, nx = Math.ceil(W / cell), ny = Math.ceil(H / cell);
        const mask = sampleRegion(q, view, nx, ny);
        ctx.fillStyle = fill;
        for (let j = 0; j < ny; j++) {
          let i = 0;
          while (i < nx) {
            if (!mask[j * nx + i]) { i++; continue; }
            let k = i; while (k < nx && mask[j * nx + k]) k++;
            ctx.fillRect(i * cell, j * cell, (k - i) * cell, cell);
            i = k;
          }
        }
      }
      // ---- boundary: dashed when strict, solid when inclusive (or an equation) ----
      ctx.strokeStyle = item.color; ctx.lineWidth = c.lineWidth; ctx.lineJoin = "round"; ctx.lineCap = "butt";
      ctx.setLineDash(q.strict ? [9, 7] : []);
      ctx.beginPath();
      if (q.form === "y") {
        let prev = null;
        for (let px = 0; px <= W; px++) {
          const y = q.boundary(unX(px));
          if (!Number.isFinite(y)) { prev = null; continue; }
          const py = Math.max(-1e5, Math.min(1e5, Y(y)));
          if (prev === null || Math.abs(py - prev) > H * 0.6) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          prev = py;
        }
      } else if (q.form === "x") {
        let prev = null;
        for (let py = 0; py <= H; py++) {
          const x = q.boundary(unY(py));
          if (!Number.isFinite(x)) { prev = null; continue; }
          const px = Math.max(-1e5, Math.min(1e5, X(x)));
          if (prev === null || Math.abs(px - prev) > W * 0.6) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          prev = px;
        }
      } else {
        const cell = 3, nx = Math.ceil(W / cell), ny = Math.ceil(H / cell);
        for (const line of chainSegments(contourSegments(q.F, view, nx, ny))) {
          line.forEach(([x, y], k) => { if (k === 0) ctx.moveTo(X(x), Y(y)); else ctx.lineTo(X(x), Y(y)); });
        }
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    const dot = (x, y, color, r = 5) => { ctx.beginPath(); ctx.arc(X(x), Y(y), r, 0, 7); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = colors.bg; ctx.stroke(); };
    if (ana && ana.marks) ana.marks.forEach((p) => dot(p.x, p.y, p.color || colors.fg));
    if (test) dot(test.x, test.y, colors.fg, 5);
  }

  function checkPoint(x, y) {
    const l = enabled();
    if (!l.length) return '<span class="muted">Turn on an inequality first.</span>';
    return `<span>(<b>${fmt(g.rn(x))}</b>, <b>${fmt(g.rn(y))}</b>)</span>` + l.map((o) => {
      const ok = o.q.satisfies(x, y);
      return `<span style="color:${o.item.color}">${ok ? "✓" : "✗"} ${o.item.expr.replace(/theta/g, "θ")}</span>`;
    }).join("") + (l.length > 1 ? `<span>${l.every((o) => o.q.satisfies(x, y)) ? "satisfies all" : "does not satisfy all"}</span>` : "");
  }

  const tools = {
    inter() {
      const l = enabled().filter((o) => o.q.form === "y");
      if (l.length < 2) { g.showInfo('<span class="muted">Needs two enabled inequalities of the form y … f(x) to intersect their boundary curves.</span>'); return; }
      const out = [];
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++)
        findIntersections(l[i].q.boundary, l[j].q.boundary, g.view.xMin, g.view.xMax).forEach((p) => out.push({ x: g.rn(p.x), y: g.rn(p.y), color: g.colors().fg }));
      ana = { marks: out.slice(0, 24), html: "<span>boundary intersections:</span>" + (out.length ? out.slice(0, 24).map((p) => `<span>(<b>${fmt(p.x)}</b>, <b>${fmt(p.y)}</b>)</span>`).join("") : '<span class="muted">none in view</span>') };
      test = null; g.showInfo(); g.schedule();
    },
    evalAt() {
      g.promptValues("Test a point", [{ key: "x", label: "x =" }, { key: "y", label: "y =" }], ({ x, y }) => {
        test = { x, y }; ana = { html: checkPoint(x, y), marks: [] }; g.showInfo(); g.schedule();
      });
    },
  };

  return {
    id: "inequality", label: "INEQUALITY", yLabel: "Ineq", equalScale: true,
    varToken: () => tok("x"),
    rows, tools, draw, arrow() { g.app.toast("Tap the graph to test a point"); },
    tap(p) { const x = g.unX(p.x), y = g.unY(p.y); test = { x, y }; ana = { html: checkPoint(x, y), marks: [] }; g.showInfo(); g.schedule(); },
    infoHtml() { return ana && ana.html ? ana.html : ""; },
    hint: "Tap the graph to test whether a point satisfies each inequality · dashed = strict (<, >), solid = inclusive (≤, ≥)",
    clear() { const had = !!(ana || test); ana = null; test = null; return had; },
    fit() { return null; },
    refresh() { compiled.clear(); rows.revalidateAll(); ana = null; },
    enabledCount: () => enabled().length,
    traceActive: () => false,
    focusFirst() { if (st.ineqs[0]) rows.focus(st.ineqs[0].id); },
    extraKeys: [["y", () => tok("y")], ["<", () => tok("<")], [">", () => tok(">")], ["≤", () => tok("<=", "≤")], ["≥", () => tok(">=", "≥")]],
    unavailable: {
      zero: "Zeros apply to a single curve y = f(x); an inequality describes a region. Use FUNCTION → Zeros on the boundary curve.",
      min: "Minima and maxima are properties of a function, not of a shaded region.",
      max: "Minima and maxima are properties of a function, not of a shaded region.",
      deriv: "Derivatives and tangent lines are not defined for a shaded region. Graph the boundary as a FUNCTION to use them.",
      integ: "Definite integrals are not available for INEQUALITY graphs. Graph the boundary as a FUNCTION to integrate it.",
    },
  };
}
