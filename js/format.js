// Number / result formatting (decimal, scientific, engineering, fractions, mixed numbers).
import { toFractionParts } from "./engine.js";

function trimZeros(s) {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function sciParts(v, mantDigits, eng) {
  let [m, e] = v.toExponential(Math.max(0, Math.min(mantDigits, 20))).split("e");
  let exp = Number(e);
  let mant = Number(m);
  if (eng) {
    const shift = ((exp % 3) + 3) % 3;
    exp -= shift;
    mant = Number((mant * Math.pow(10, shift)).toPrecision(15));
  }
  return { mant, exp };
}

/** Format a plain number according to settings {notation, digits}. */
export function formatNumber(v, s = {}) {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "undefined" : v > 0 ? "∞" : "-∞";
  if (v === 0) return Object.is(v, -0) ? "0" : s.digits > 0 ? (0).toFixed(Number(s.digits)) : "0";
  const notation = s.notation || "normal";
  const fixed = s.digits === undefined || s.digits === "float" ? null : Number(s.digits);
  const abs = Math.abs(v);
  const asSci = (eng) => {
    const { mant, exp } = sciParts(v, fixed === null ? 9 : fixed, eng);
    const body = fixed === null ? trimZeros(String(mant)) : mant.toFixed(fixed);
    return `${body}E${exp}`;
  };
  if (notation === "sci") return asSci(false);
  if (notation === "eng") return asSci(true);
  if (abs >= 1e10 || abs < 1e-3) return asSci(false);
  if (fixed !== null) return v.toFixed(fixed);
  return trimZeros(Number(v.toPrecision(10)).toString());
}

/** Fraction info for a number, or null. */
export function fractionOf(v) {
  if (!Number.isFinite(v) || Number.isInteger(v)) return null;
  return toFractionParts(v);
}

function fracText(f, mixed) {
  if (mixed && Math.abs(f.p) > f.q) {
    const whole = Math.trunc(f.p / f.q), rem = Math.abs(f.p) - Math.abs(whole) * f.q;
    return `${whole} ${rem}/${f.q}`;
  }
  return `${f.p}/${f.q}`;
}
function fracHtml(f, mixed) {
  const esc = (n) => String(n);
  const stack = (n, d) => `<span class="frac"><span class="num">${esc(n)}</span><span class="den">${esc(d)}</span></span>`;
  if (mixed && Math.abs(f.p) > f.q) {
    const whole = Math.trunc(f.p / f.q), rem = Math.abs(f.p) - Math.abs(whole) * f.q;
    return `<span class="mixed">${whole}${stack(rem, f.q)}</span>`;
  }
  return stack(f.p, f.q);
}

/**
 * Format a value (number or list) for display.
 * returns { text, html, altText } — text is plain; html may contain a stacked fraction.
 * altText is the other representation (decimal when fraction is primary, and vice versa).
 */
export function formatValue(v, s = {}) {
  if (Array.isArray(v)) {
    const parts = v.map((n) => formatValue(n, { ...s, frac: "dec" }).text);
    const t = "{" + parts.join(", ") + "}";
    return { text: t, html: escapeHtml(t), altText: "" };
  }
  const dec = formatNumber(v, s);
  const f = fractionOf(v);
  if (f) {
    const ft = fracText(f, !!s.mixed);
    if (s.frac === "frac") return { text: ft, html: fracHtml(f, !!s.mixed), altText: dec };
    return { text: dec, html: escapeHtml(dec), altText: ft };
  }
  return { text: dec, html: escapeHtml(dec), altText: "" };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Text that can be re-entered into the editor (full precision). */
export function numberToEntryText(v) {
  if (Array.isArray(v)) return "{" + v.map(numberToEntryText).join(",") + "}";
  let t = String(Number(v.toPrecision(15)));
  return v < 0 ? `(${t})` : t;
}
