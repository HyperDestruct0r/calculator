// CALC screen: transcript of previous calculations + live expression editor.
import { el } from "./dom.js";
import { Editor, textToTokens, textToDisplay } from "./editor.js";
import { evaluate, compile } from "./engine.js";
import { escapeHtml, numberToEntryText } from "./format.js";

export function createCalcView(app) {
  const st = app.state;
  const root = el("section", "view calc");
  root.innerHTML = `<div class="transcript" aria-label="Previous calculations"></div>
    <div class="entry"><div class="mono" id="calcEd"></div></div>
    <div class="preview res" aria-live="polite"></div>`;
  const transcript = root.querySelector(".transcript");
  const msg = root.querySelector(".preview");
  let recallIdx = -1, recalling = false;

  const ed = new Editor({
    autoAns: true, placeholder: "Enter an expression",
    onChange: () => {
      if (!recalling) recallIdx = -1;
      st.draft = ed.text(); app.save();
      updatePreview();
    },
    onFocus: () => app.setActive(ed),
  });
  ed.attach(root.querySelector("#calcEd"));
  ed.setText(st.draft, { silent: true });

  function updatePreview() {
    msg.className = "preview res";
    const text = ed.text();
    if (!text.trim()) { msg.textContent = ""; return; }
    try { msg.innerHTML = "= " + app.fmt(evaluate(text, app.evalOpts())).html; } catch { msg.textContent = ""; }
  }

  function showError(e) {
    let uses = false;
    try { uses = compile(ed.text()).usesX; } catch { /* syntax error */ }
    msg.className = "err";
    msg.innerHTML = `<span>${escapeHtml(e.message || "Error")}</span>` +
      (uses ? '<button type="button" class="lcd-btn" data-plot>Plot in Y=</button>' : "");
  }
  msg.addEventListener("click", (e) => { if (e.target.closest("[data-plot]")) app.plotExpression(ed.text()); });

  function renderTranscript() {
    const items = st.history.slice(0, 40);
    if (!items.length) {
      transcript.innerHTML = '<div class="empty-note">Type an expression and press ENTER.<br>Tap 2nd for secondary functions.</div>';
      return;
    }
    transcript.innerHTML = items.slice().reverse().map((h, k) => {
      const i = items.length - 1 - k;
      const f = app.fmt(h.value);
      return `<div class="t-item" data-i="${i}"><div class="t-expr mono">${escapeHtml(textToDisplay(h.expr))}</div>` +
        `<div class="t-res res">${f.html}${f.altText ? `<span class="alt">≈ ${escapeHtml(f.altText)}</span>` : ""}</div></div>`;
    }).join("");
    transcript.scrollTop = transcript.scrollHeight;
  }
  transcript.addEventListener("click", (e) => {
    const item = e.target.closest(".t-item");
    if (!item) return;
    const h = st.history[Number(item.dataset.i)];
    if (!h) return;
    if (e.target.closest(".t-res")) ed.insert(textToTokens(numberToEntryText(h.value)));
    else ed.insert(textToTokens(h.expr));
    app.setActive(ed);
  });

  function commit(text, value) {
    st.history.unshift({ expr: text, value, angle: st.settings.angle, t: Date.now() });
    if (st.history.length > 200) st.history.length = 200;
    st.ans = value;
    ed.setText("");
    msg.textContent = "";
    renderTranscript();
    app.save();
  }

  return {
    el: root, editor: ed,
    show() { app.setActive(ed); renderTranscript(); updatePreview(); },
    refresh() { renderTranscript(); updatePreview(); },
    enter({ shift = false } = {}) {
      const text = ed.text();
      if (!text.trim()) return;
      if (shift) { app.plotExpression(text); return; }
      try { commit(text, evaluate(text, app.evalOpts())); }
      catch (e) { showError(e); }
    },
    clearAll() { ed.clear(); msg.textContent = ""; recallIdx = -1; },
    escape() { if (!ed.isEmpty()) { this.clearAll(); return true; } return false; },
    arrow(dir) {
      const h = st.history;
      if (!h.length) return;
      recallIdx = dir === "up" ? Math.min(recallIdx + 1, h.length - 1) : recallIdx - 1;
      recalling = true;
      if (recallIdx < 0) { recallIdx = -1; ed.setText(""); } else ed.setText(h[recallIdx].expr);
      recalling = false;
    },
    setExpression(text) { ed.setText(text); recallIdx = -1; msg.textContent = ""; app.setActive(ed); },
    insertText(text) { ed.insert(textToTokens(text)); },
    lastExpression() { return st.history[0]?.expr || ""; },
  };
}
