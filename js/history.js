// HISTORY screen: persistent log with reuse / replay.
import { el } from "./dom.js";
import { textToDisplay, textToTokens } from "./editor.js";
import { evaluate } from "./engine.js";
import { escapeHtml, numberToEntryText } from "./format.js";

export function createHistoryView(app) {
  const st = app.state;
  const root = el("section", "view hist");
  root.innerHTML = `<div class="bar"><h2>History</h2><button type="button" class="lcd-btn danger" data-clear>Clear history</button></div><div class="list" style="display:grid;gap:8px"></div>`;
  const list = root.querySelector(".list");
  const TRIG = /sin|cos|tan/;

  function render() {
    if (!st.history.length) { list.innerHTML = '<div class="empty-note">No calculations yet. Results you evaluate in CALC are saved here.</div>'; return; }
    list.innerHTML = st.history.map((h, i) => {
      const f = app.fmt(h.value);
      const when = h.t ? new Date(h.t).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "";
      return `<div class="h-item" data-i="${i}">
        <div class="h-expr mono">${escapeHtml(textToDisplay(h.expr))}</div>
        <div class="h-res res">${f.html}${f.altText ? `<span class="alt">≈ ${escapeHtml(f.altText)}</span>` : ""}</div>
        <div class="h-meta"><span>${when}${TRIG.test(h.expr) ? ` · ${h.angle === "deg" ? "DEG" : "RAD"}` : ""}</span>
          <span class="acts"><button type="button" class="lcd-btn" data-act="replay" title="Re-evaluate with current settings">↻ Replay</button>
          <button type="button" class="lcd-btn" data-act="result" title="Insert the result into CALC">Use result</button></span></div>
      </div>`;
    }).join("");
  }

  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-clear]")) {
      if (st.history.length && confirm("Clear all calculation history?")) { st.history = []; app.save(); render(); app.views.calc.refresh(); }
      return;
    }
    const item = e.target.closest(".h-item");
    if (!item) return;
    const h = st.history[Number(item.dataset.i)];
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "result") {
      app.setMode("calc"); app.views.calc.insertText(numberToEntryText(h.value));
    } else if (act === "replay") {
      try {
        const value = evaluate(h.expr, app.evalOpts());
        st.history.unshift({ expr: h.expr, value, angle: st.settings.angle, t: Date.now() });
        st.ans = value; app.save();
        app.setMode("calc");
      } catch (err) { app.toast(err.message); }
    } else {
      app.setMode("calc"); app.views.calc.setExpression(h.expr);
    }
  });

  return { el: root, show: render, refresh: render };
}
