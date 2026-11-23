// TABLE screen: value tables for functions (x), polar curves (θ), parametric curves (t) and sequences (n).
import { el } from "./dom.js";
import { Editor } from "./editor.js";
import { evaluate, compileGraph } from "./engine.js";
import { formatNumber, escapeHtml } from "./format.js";
import { compilePolar, polarToXY } from "./graphtypes/polar.js";
import { compileParametric } from "./graphtypes/parametric.js";
import { computeSequence } from "./graphtypes/sequence.js";

const MAX_ROWS = 1000;

export function createTableView(app) {
  const st = app.state;
  const root = el("section", "view tbl");
  root.innerHTML = `
    <div class="tbl-controls">
      <div class="tbl-fn"><label class="muted" for="tblFn">Source</label><select id="tblFn"></select></div>
      <div class="fld"><label data-l="start">Start x</label><div data-f="start"></div></div>
      <div class="fld"><label data-l="end">End x</label><div data-f="end"></div></div>
      <div class="fld"><label data-l="step">Step Δx</label><div data-f="step"></div></div>
    </div>
    <div class="tbl-msg"></div>
    <div class="tbl-scroll"><table class="vals"></table></div>`;
  const select = root.querySelector("#tblFn");
  const msg = root.querySelector(".tbl-msg");
  const table = root.querySelector("table");
  const controls = root.querySelector(".tbl-controls");
  const order = ["start", "end", "step"];
  const eds = {};
  let timer = null;

  order.forEach((key) => {
    const ed = new Editor({
      placeholder: key, onFocus: () => app.setActive(ed),
      onChange: () => { st.table[key] = ed.text(); app.save(); clearTimeout(timer); timer = setTimeout(render, 120); },
    });
    ed.attach(root.querySelector(`[data-f="${key}"]`));
    ed.setText(st.table[key] ?? "", { silent: true });
    ed.key = key;
    eds[key] = ed;
  });

  const kindOf = (v) => (v === "all" || /^\d+$/.test(v) ? "function" : v.split(":")[0]);
  const VAR = { function: "x", polar: "θ", param: "t", seq: "n" };

  function fillSelect() {
    const cur = String(st.table.fn);
    const L = (kind, prefix, arr, name) => arr.length
      ? `<optgroup label="${name}"><option value="${prefix}all">All enabled</option>` + arr.map((f, i) => `<option value="${prefix}${f.id}">${escapeHtml(optLabel(kind, f, i))}${f.on ? "" : "  (off)"}</option>`).join("") + "</optgroup>" : "";
    select.innerHTML = `<optgroup label="Functions y = f(x)"><option value="all">All enabled functions</option>` +
      st.funcs.map((f, i) => `<option value="${f.id}">Y${i + 1} = ${escapeHtml(f.expr || "(empty)")}${f.on ? "" : "  (off)"}</option>`).join("") + "</optgroup>" +
      L("polar", "polar:", st.polars, "Polar r = f(θ)") + L("param", "param:", st.params, "Parametric") + L("seq", "seq:", st.seqs, "Sequences u(n)");
    select.value = [...select.options].some((o) => o.value === cur) ? cur : "all";
    st.table.fn = select.value;
    const k = kindOf(select.value), v = VAR[k];
    root.querySelector('[data-l="start"]').textContent = `Start ${v}`;
    root.querySelector('[data-l="end"]').textContent = `End ${v}`;
    root.querySelector('[data-l="step"]').textContent = `Step Δ${v}`;
    controls.classList.toggle("seqmode", k === "seq");
  }
  const optLabel = (kind, f, i) => kind === "polar" ? `r${i + 1} = ${f.expr || "(empty)"}` : kind === "param" ? `T${i + 1}: x=${f.x || "?"}, y=${f.y || "?"}` : `u${i + 1}(n) = ${f.expr || "(empty)"}`;
  select.addEventListener("change", () => { st.table.fn = select.value; app.save(); fillSelect(); render(); select.blur(); });

  function param(key, label) {
    const ed = eds[key];
    let bad = false, v = NaN;
    try {
      v = evaluate(ed.text() || "x", { ...app.evalOpts(), complex: false });
      if (typeof v !== "number") throw new Error("must be a single number");
    } catch (e) { bad = true; msg.textContent = `${label}: ${e.message.replace(/^x has no value.*/, "enter a number")}`; }
    ed.el.classList.toggle("bad", bad);
    return bad ? null : v;
  }

  const opts = () => ({ angle: st.settings.angle, vars: st.vars });
  const fmt = (v) => (Number.isFinite(v) ? formatNumber(v, st.settings) : null);
  const cell = (v) => { const t = fmt(v); return t === null ? '<td class="na">undefined</td>' : `<td>${t}</td>`; };

  function render() {
    msg.className = "tbl-msg";
    const sel = String(st.table.fn), kind = kindOf(sel);
    const pick = (arr, prefix) => { const idv = sel.slice(prefix.length); return arr.map((f, i) => ({ f, i })).filter(({ f }) => (idv === "all" ? f.on : String(f.id) === idv)); };

    if (kind === "seq") {
      const entries = pick(st.seqs, "seq:").filter(({ f }) => f.expr.trim());
      if (!entries.length) { msg.textContent = "No enabled sequences. Add one in GRAPH → SEQ."; table.innerHTML = ""; return; }
      let nMin = 1, nMax = 20;
      try {
        const g = (k, d) => { const t = (st.gset.seq[k] || "").trim(); return t ? evaluate(t, opts()) : d; };
        nMin = g("nMin", 1); nMax = g("nMax", 20);
      } catch (e) { msg.classList.add("bad"); msg.textContent = "n range: " + e.message; table.innerHTML = ""; return; }
      const results = entries.map(({ f, i }) => ({ f, i, r: computeSequence(f, { nMin, nMax, ...opts() }) }));
      const errs = results.filter((q) => q.r.error);
      msg.textContent = `n = ${nMin} … ${nMax} (set in GRAPH → SEQ)` + (errs.length ? " · " + errs.map((q) => `u${q.i + 1}: ${q.r.error}`).join(" · ") : "");
      if (errs.length) msg.classList.add("bad");
      const ns = []; for (let n = nMin; n <= Math.min(nMax, nMin + MAX_ROWS - 1); n++) ns.push(n);
      let html = "<thead><tr><th>n</th>" + results.map(({ f, i }) => `<th><span class="dot" style="background:${f.color}"></span>u${i + 1}</th>`).join("") + "</tr></thead><tbody>";
      for (const n of ns) html += `<tr><td>${n}</td>` + results.map(({ r }) => { const t = r.terms.find((q) => q.n === n); return t ? cell(t.value) : '<td class="na">—</td>'; }).join("") + "</tr>";
      table.innerHTML = html + "</tbody>";
      return;
    }

    const a = param("start", "Start"), b = param("end", "End"), s = param("step", "Step");
    if (a === null || b === null || s === null) { msg.classList.add("bad"); table.innerHTML = ""; return; }
    if (s === 0 || (b - a) / s < 0) { msg.classList.add("bad"); msg.textContent = "Step must move from Start toward End (and not be 0)."; table.innerHTML = ""; return; }

    let cols = []; // {head, color, f(x) -> number}
    let head = VAR[kind];
    if (kind === "function") {
      const entries = st.funcs.map((f, i) => ({ f, i })).filter(({ f }) => f.expr.trim() && (sel === "all" ? f.on : String(f.id) === sel));
      if (!entries.length) { msg.textContent = sel === "all" ? "No enabled functions. Turn one on or add one in GRAPH." : "That function is empty."; table.innerHTML = ""; return; }
      entries.forEach(({ f, i }) => { let fn; try { fn = compileGraph(f.expr, opts()); } catch { fn = () => NaN; } cols.push({ head: `Y${i + 1}`, color: f.color, fn: (x) => [fn(x)] }); });
    } else if (kind === "polar") {
      const entries = pick(st.polars, "polar:").filter(({ f }) => f.expr.trim());
      if (!entries.length) { msg.textContent = "No enabled polar curves. Add one in GRAPH → POLAR."; table.innerHTML = ""; return; }
      entries.forEach(({ f, i }) => {
        let fn; try { fn = compilePolar(f.expr, opts()); } catch { fn = () => NaN; }
        cols.push({ head: [`r${i + 1}`, `x${i + 1}`, `y${i + 1}`], color: f.color, fn: (t) => { const r = fn(t); const [x, y] = Number.isFinite(r) ? polarToXY(r, t, st.settings.angle) : [NaN, NaN]; return [r, x, y]; } });
      });
    } else {
      const entries = pick(st.params, "param:").filter(({ f }) => f.x.trim() && f.y.trim());
      if (!entries.length) { msg.textContent = "No enabled parametric curves. Add one in GRAPH → PARAM."; table.innerHTML = ""; return; }
      entries.forEach(({ f, i }) => {
        let c; try { c = compileParametric(f.x, f.y, opts()); } catch { c = { fx: () => NaN, fy: () => NaN }; }
        cols.push({ head: [`x${i + 1}`, `y${i + 1}`], color: f.color, fn: (t) => [c.fx(t), c.fy(t)] });
      });
    }
    let n = Math.floor((b - a) / s * (1 + 1e-12) + 1e-9) + 1;
    const capped = n > MAX_ROWS;
    if (capped) n = MAX_ROWS;
    msg.textContent = capped ? `Showing the first ${MAX_ROWS} rows.` : `${n} row${n === 1 ? "" : "s"}`;
    let html = `<thead><tr><th>${head}</th>` + cols.map((c) => [].concat(c.head).map((h) => `<th><span class="dot" style="background:${c.color}"></span>${h}</th>`).join("")).join("") + "</tr></thead><tbody>";
    for (let k = 0; k < n; k++) {
      const x = Number((a + k * s).toPrecision(12));
      html += `<tr><td>${fmt(x)}</td>` + cols.map((c) => c.fn(x).map(cell).join("")).join("") + "</tr>";
    }
    table.innerHTML = html + "</tbody>";
  }

  return {
    el: root,
    show() { fillSelect(); if (!app.active || !Object.values(eds).includes(app.active)) app.setActive(eds.start); render(); },
    refresh() { fillSelect(); render(); },
    defaultEditor() { return eds.start; },
    enter(ed) {
      const i = order.indexOf(ed.key);
      render();
      if (i < order.length - 1) app.setActive(eds[order[i + 1]]);
    },
    arrow(dir, ed) {
      if (!ed) return;
      const i = order.indexOf(ed.key);
      const j = dir === "down" ? Math.min(i + 1, 2) : dir === "up" ? Math.max(i - 1, 0) : i;
      app.setActive(eds[order[j]]);
    },
  };
}
