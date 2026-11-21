// SETTINGS screen.
import { el } from "./dom.js";
import { DEFAULT_SETTINGS, wipe, storageAvailable } from "./store.js";

const GROUPS = [
  { title: "Calculation", rows: [
    { key: "angle", label: "Angle unit", opts: [["rad", "Radians"], ["deg", "Degrees"]] },
    { key: "frac", label: "Result style", sub: "Show exact fractions when a result is rational", opts: [["frac", "Fraction"], ["dec", "Decimal"]] },
    { key: "mixed", label: "Fraction form", opts: [[false, "Improper"], [true, "Mixed"]] },
    { key: "notation", label: "Number format", opts: [["normal", "Normal"], ["sci", "Scientific"], ["eng", "Engineering"]] },
    { key: "digits", label: "Decimal places", type: "select", opts: [["float", "Float (auto)"], ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [n, String(n)])] },
  ] },
  { title: "Appearance", rows: [
    { key: "theme", label: "Theme", opts: [["dark", "Dark"], ["light", "Light"], ["auto", "System"]] },
  ] },
  { title: "Graph", rows: [
    { key: "grid", label: "Grid lines", opts: [[true, "On"], [false, "Off"]] },
    { key: "axisLabels", label: "Axis numbers", opts: [[true, "On"], [false, "Off"]] },
    { key: "lineWidth", label: "Line thickness", opts: [[1.5, "Thin"], [2.5, "Normal"], [4, "Thick"]] },
    { key: "equalScale", label: "Equal axis scale", sub: "Keeps circles round when you reset or resize", opts: [[true, "On"], [false, "Off"]] },
    { key: "showCoords", label: "Cursor coordinates", opts: [[true, "On"], [false, "Off"]] },
  ] },
];

export function createSettingsView(app) {
  const st = app.state;
  const root = el("section", "view sett");

  function render() {
    const s = st.settings;
    let html = "";
    for (const g of GROUPS) {
      html += `<div class="set-group"><h3>${g.title}</h3>`;
      for (const r of g.rows) {
        html += `<div class="set-row"><span class="lbl">${r.label}${r.sub ? `<span class="sub">${r.sub}</span>` : ""}</span>`;
        if (r.type === "select") {
          html += `<select data-key="${r.key}" aria-label="${r.label}">` +
            r.opts.map(([v, l]) => `<option value="${v}"${String(s[r.key]) === String(v) ? " selected" : ""}>${l}</option>`).join("") + "</select>";
        } else {
          html += '<span class="seg">' + r.opts.map(([v, l]) =>
            `<button type="button" class="lcd-btn${s[r.key] === v ? " on" : ""}" data-key="${r.key}" data-val="${v}">${l}</button>`).join("") + "</span>";
        }
        html += "</div>";
      }
      html += "</div>";
    }
    const sw = "serviceWorker" in navigator;
    const offline = !sw ? "not supported here" : navigator.serviceWorker.controller ? "ready — works without internet" : "will be ready after the first full load";
    html += `<div class="set-group"><h3>App</h3>
      ${app.canInstall() ? '<div class="set-row"><span class="lbl">Install as an app</span><button type="button" class="lcd-btn on" data-act="install">Install</button></div>' : ""}
      <div class="set-row"><span class="lbl">Offline mode<span class="sub">${offline}</span></span></div>
      <div class="set-row"><span class="lbl">Saved data<span class="sub">${storageAvailable() ? "History, memory, functions and settings are stored on this device." : "Storage is blocked — nothing will persist."}</span></span></div>
      <div class="set-row"><span class="lbl">Reset settings</span><button type="button" class="lcd-btn" data-act="reset-settings">Reset</button></div>
      <div class="set-row"><span class="lbl">Erase all data<span class="sub">History, memory, functions and settings</span></span><button type="button" class="lcd-btn danger" data-act="erase">Erase</button></div>
    </div><div class="about">Graphing Calculator 2.0 · shortcuts: press <b>?</b> in the status bar</div>`;
    root.innerHTML = html;
  }

  function set(key, raw) {
    const cur = DEFAULT_SETTINGS[key];
    let v = raw;
    if (typeof cur === "boolean") v = raw === "true" || raw === true;
    else if (typeof cur === "number") v = Number(raw);
    else if (key === "digits") v = raw === "float" ? "float" : Number(raw);
    st.settings[key] = v;
    app.applySettings(key);
  }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.key) set(b.dataset.key, b.dataset.val);
    else if (b.dataset.act === "install") app.install();
    else if (b.dataset.act === "reset-settings") { Object.assign(st.settings, DEFAULT_SETTINGS); app.applySettings(); }
    else if (b.dataset.act === "erase" && confirm("Erase all history, memory, functions and settings on this device?")) { wipe(); location.reload(); }
  });
  root.addEventListener("change", (e) => { if (e.target.matches("select[data-key]")) set(e.target.dataset.key, e.target.value); });

  return { el: root, show: render, refresh: render };
}
