// TABLE screen: value table for one function (or all enabled functions).
import { el } from "./dom.js";
import { Editor } from "./editor.js";
import { evaluate, compileGraph } from "./engine.js";
import { formatNumber, escapeHtml } from "./format.js";

const MAX_ROWS = 1000;

export function createTableView(app) {
  const st = app.state;
  const root = el("section", "view tbl");
  root.innerHTML = `
    <div class="tbl-controls">
      <div class="tbl-fn"><label class="muted" for="tblFn">Function</label><select id="tblFn"></select></div>
      <div class="fld"><label>Start x</label><div data-f="start"></div></div>
      <div class="fld"><label>End x</label><div data-f="end"></div></div>
      <div class="fld"><label>Step Δx</label><div data-f="step"></div></div>
    </div>
    <div class="tbl-msg"></div>
    <div class="tbl-scroll"><table class="vals"></table></div>`;
  const select = root.querySelector("#tblFn");
  const msg = root.querySelector(".tbl-msg");
  const table = root.querySelector("table");
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

  function fillSelect() {
    const cur = String(st.table.fn);
    select.innerHTML = `<option value="all">All enabled functions</option>` +
      st.funcs.map((f, i) => `<option value="${f.id}">Y${i + 1} = ${escapeHtml(f.expr || "(empty)")}${f.on ? "" : "  (off)"}</option>`).join("");
    select.value = [...select.options].some((o) => o.value === cur) ? cur : "all";
    st.table.fn = select.value;
  }
  select.addEventListener("change", () => { st.table.fn = select.value; app.save(); render(); select.blur(); });

  function param(key, label) {
    const ed = eds[key];
    let bad = false, v = NaN;
    try {
      v = evaluate(ed.text() || "x", app.evalOpts());
      if (typeof v !== "number") throw new Error("must be a single number");
    } catch (e) { bad = true; msg.textContent = `${label}: ${e.message.replace(/^x has no value.*/, "enter a number")}`; }
    ed.el.classList.toggle("bad", bad);
    return bad ? null : v;
  }

  function render() {
    msg.className = "tbl-msg";
    const a = param("start", "Start"), b = param("end", "End"), s = param("step", "Step");
    if (a === null || b === null || s === null) { msg.classList.add("bad"); table.innerHTML = ""; return; }
    if (s === 0 || (b - a) / s < 0) { msg.classList.add("bad"); msg.textContent = "Step must move from Start toward End (and not be 0)."; table.innerHTML = ""; return; }
    const entries = st.funcs.map((f, i) => ({ f, i })).filter(({ f }) => f.expr.trim() &&
      (st.table.fn === "all" ? f.on : String(f.id) === String(st.table.fn)));
    if (!entries.length) {
      msg.textContent = st.table.fn === "all" ? "No enabled functions. Turn one on or add one in GRAPH → Y=." : "That function is empty.";
      table.innerHTML = ""; return;
    }
    const fns = entries.map(({ f, i }) => {
      try { return { f, i, fn: compileGraph(f.expr, { angle: st.settings.angle }) }; } catch { return { f, i, fn: () => NaN }; }
    });
    let n = Math.floor((b - a) / s * (1 + 1e-12) + 1e-9) + 1;
    const capped = n > MAX_ROWS;
    if (capped) n = MAX_ROWS;
    msg.textContent = capped ? `Showing the first ${MAX_ROWS} rows.` : `${n} row${n === 1 ? "" : "s"}`;
    const fmt = (v) => formatNumber(v, st.settings);
    let html = "<thead><tr><th>x</th>" + fns.map(({ f, i }) => `<th><span class="dot" style="background:${f.color}"></span>Y${i + 1}</th>`).join("") + "</tr></thead><tbody>";
    for (let k = 0; k < n; k++) {
      const x = Number((a + k * s).toPrecision(12));
      html += `<tr><td>${fmt(x)}</td>` + fns.map(({ fn }) => {
        const y = fn(x);
        return Number.isFinite(y) ? `<td>${fmt(y)}</td>` : '<td class="na">undefined</td>';
      }).join("") + "</tr>";
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
