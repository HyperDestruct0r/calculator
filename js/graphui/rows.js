// Generic editable row list used by every graph type (Y=, r=, x(t)/y(t), inequalities, u(n)).
// Each row: colour swatch · on/off label · one or more token editors · remove button · validation message.
import { el } from "../dom.js";
import { Editor } from "../editor.js";
import { PALETTE } from "../store.js";

/**
 * spec: {
 *   items(): array in the state, max, fields: [{key, ph, label?}],
 *   label(i): row label e.g. "Y1=", make(id, color): new item, validate(item): [{key,msg}], onEdit(item)
 * }
 */
export function createRows(g, spec) {
  const { app } = g;
  const editors = new Map(); // `${id}:${key}`
  let activeId = null, activeKey = null, selId = null;
  let listEl = null;

  const items = () => spec.items();
  const byId = (id) => items().find((f) => f.id === id);
  const indexOf = (id) => items().findIndex((f) => f.id === id);
  const ek = (id, key) => `${id}:${key}`;

  function editorFor(item, field) {
    const k = ek(item.id, field.key);
    let ed = editors.get(k);
    if (!ed) {
      ed = new Editor({
        placeholder: field.ph || "",
        onFocus: () => focus(item.id, field.key),
        onChange: () => {
          item[field.key] = ed.text();
          if (spec.onEdit) spec.onEdit(item, field.key);
          validate(item);
          app.save(); g.schedule();
        },
      });
      ed.setText(item[field.key] || "", { silent: true });
      editors.set(k, ed);
    }
    return ed;
  }

  function validate(item) {
    if (!listEl) return;
    const row = listEl.querySelector(`.y-row[data-id="${item.id}"]`);
    if (!row) return;
    const errs = spec.validate ? spec.validate(item) : [];
    row.querySelectorAll(".ed").forEach((e) => e.classList.remove("bad"));
    errs.forEach((er) => row.querySelector(`.edf[data-k="${er.key}"] .ed, .edf[data-k="${er.key}"]`)?.classList.add("bad"));
    const m = row.querySelector(".msg");
    m.hidden = !errs.length;
    m.textContent = errs.length ? errs[0].msg : "";
  }

  function nextColor() {
    const used = new Set(items().map((f) => f.color));
    return PALETTE.find((c) => !used.has(c)) || PALETTE[items().length % PALETTE.length];
  }

  function render(host) {
    if (host) listEl = host;
    if (!listEl) return;
    listEl.innerHTML = "";
    items().forEach((f, i) => {
      const row = el("div", "y-row" + (f.id === selId ? " sel" : "") + (spec.fields.length > 1 ? " multi" : ""));
      row.dataset.id = f.id;
      const lab = spec.label(i, f);
      row.innerHTML = `<button type="button" class="swatch" title="Change color" aria-label="Change color of ${lab}" style="background:${f.color}"></button>
        <button type="button" class="lab${f.on ? " on" : ""}" title="Turn ${lab} on or off" aria-pressed="${f.on}">${lab}</button>
        <div class="edhost">${spec.fields.map((fl) => `<div class="fline">${fl.label ? `<span class="fl">${fl.label}</span>` : ""}<div class="edf" data-k="${fl.key}"></div></div>`).join("")}</div>
        <button type="button" class="x" title="Remove" aria-label="Remove ${lab}">✕</button>
        <div class="msg" hidden></div>`;
      spec.fields.forEach((fl) => {
        const ed = editorFor(f, fl);
        ed.attach(row.querySelector(`.edf[data-k="${fl.key}"]`));
        ed.setFocused(f.id === activeId && fl.key === activeKey);
      });
      listEl.appendChild(row);
      validate(f);
    });
  }

  function focus(id, key) {
    const f = byId(id);
    if (!f) return null;
    key = key || (activeId === id && activeKey) || spec.fields[0].key;
    activeId = id; activeKey = key; selId = id;
    editors.forEach((e, k) => e.setFocused(k === ek(id, key)));
    const ed = editors.get(ek(id, key)) || editorFor(f, spec.fields.find((q) => q.key === key));
    app.setActive(ed);
    listEl && listEl.querySelectorAll(".y-row").forEach((r) => r.classList.toggle("sel", Number(r.dataset.id) === selId));
    return ed;
  }
  function blur() {
    if (activeId === null) return;
    activeId = null; activeKey = null;
    editors.forEach((e) => e.setFocused(false));
    app.setActive(null);
  }
  function add(init = {}) {
    if (items().length >= spec.max) { app.toast(`Up to ${spec.max} entries`); return null; }
    const f = spec.make(app.state.nextId++, nextColor());
    Object.assign(f, init);
    items().push(f);
    render();
    focus(f.id);
    app.save(); g.schedule();
    return f;
  }
  function remove(id) {
    const i = indexOf(id);
    if (i < 0) return;
    items().splice(i, 1);
    spec.fields.forEach((fl) => editors.delete(ek(id, fl.key)));
    if (selId === id) selId = null;
    const wasActive = activeId === id;
    if (wasActive) { activeId = null; activeKey = null; }
    render();
    const nb = items()[Math.min(i, items().length - 1)];
    if (wasActive) { if (nb) focus(nb.id); else app.setActive(null); }
    if (spec.onRemove) spec.onRemove(id);
    app.save(); g.schedule();
  }

  /** move focus between fields (up/down) */
  function moveFocus(dir) {
    const list = items();
    if (!list.length) return;
    const flat = [];
    list.forEach((f) => spec.fields.forEach((fl) => flat.push([f.id, fl.key])));
    let i = flat.findIndex(([id, k]) => id === activeId && k === activeKey);
    i = i < 0 ? 0 : Math.max(0, Math.min(flat.length - 1, i + (dir === "down" ? 1 : -1)));
    focus(flat[i][0], flat[i][1]);
  }
  /** ENTER: next field; after the last one start a new row (if the last row is not empty) */
  function enter() {
    const list = items();
    const i = indexOf(activeId);
    if (i < 0) return;
    const fi = spec.fields.findIndex((fl) => fl.key === activeKey);
    if (fi < spec.fields.length - 1) { focus(activeId, spec.fields[fi + 1].key); return; }
    if (list[i + 1]) focus(list[i + 1].id, spec.fields[0].key);
    else if (spec.fields.some((fl) => (list[i][fl.key] || "").trim())) add();
  }

  // clicks inside the list
  function onClick(e) {
    const row = e.target.closest(".y-row");
    if (!row) return;
    const f = byId(Number(row.dataset.id));
    if (!f) return;
    if (e.target.closest(".swatch")) {
      const k = PALETTE.indexOf(f.color);
      const used = new Set(items().filter((o) => o !== f).map((o) => o.color));
      let c = f.color;
      for (let step = 1; step <= PALETTE.length; step++) { const cand = PALETTE[(k + step + PALETTE.length) % PALETTE.length]; if (!used.has(cand)) { c = cand; break; } }
      f.color = c;
      row.querySelector(".swatch").style.background = c;
      if (spec.onToggle) spec.onToggle(f);
      app.save(); g.schedule();
    } else if (e.target.closest(".lab")) {
      f.on = !f.on;
      const b = e.target.closest(".lab");
      b.classList.toggle("on", f.on); b.setAttribute("aria-pressed", String(f.on));
      if (spec.onToggle) spec.onToggle(f);
      app.save(); g.schedule();
    } else if (e.target.closest(".x")) remove(f.id);
  }

  return {
    render, focus, blur, add, remove, enter, moveFocus, onClick, validate,
    items, byId, indexOf,
    get selId() { return selId; }, set selId(v) { selId = v; listEl && listEl.querySelectorAll(".y-row").forEach((r) => r.classList.toggle("sel", Number(r.dataset.id) === selId)); },
    get activeId() { return activeId; },
    activeEditor() { return editors.get(ek(activeId, activeKey)) || null; },
    setText(id, key, text) { const ed = editors.get(ek(id, key)); if (ed) ed.setText(text, { silent: true }); },
    revalidateAll() { items().forEach(validate); },
  };
}

/** Small panel of text inputs (θ range, t range, n range). Values live in `store[key]` as expression text. */
export function createFieldsPanel(g, { title, fields, store, validate, onChange }) {
  const root = el("div", "fpanel");
  root.innerHTML = `<div class="fp-title">${title}</div><div class="fp-fields">${fields.map((f) => `<label>${f.label}<input type="text" data-k="${f.key}" inputmode="text" autocomplete="off" spellcheck="false"></label>`).join("")}</div><div class="fp-msg" hidden></div>`;
  const msg = root.querySelector(".fp-msg");
  const inputs = {};
  root.querySelectorAll("input").forEach((inp) => {
    inputs[inp.dataset.k] = inp;
    inp.addEventListener("input", () => {
      store[inp.dataset.k] = inp.value;
      check();
      if (onChange) onChange();
      g.app.save(); g.schedule();
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
  });
  function check() {
    const err = validate ? validate() : null;
    msg.hidden = !err; msg.textContent = err || "";
    root.classList.toggle("bad", !!err);
  }
  function refresh() {
    fields.forEach((f) => {
      const ph = typeof f.ph === "function" ? f.ph() : f.ph;
      inputs[f.key].placeholder = ph || "";
      if (document.activeElement !== inputs[f.key]) inputs[f.key].value = store[f.key] ?? "";
    });
    check();
  }
  refresh();
  return { el: root, refresh };
}
