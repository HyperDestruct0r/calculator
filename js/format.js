// Number / result formatting (decimal, scientific, engineering, fractions, mixed numbers).
import { toFractionParts } from "./realmath.js";
import { isComplex } from "./complex.js";

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
/** Plain-text form of a complex number: "3+4i" (rect) or "5(cos 53.13° + i sin 53.13°)" (polar). */
export function formatComplex(z, s = {}, mode = s.complex) {
  const mag = Math.hypot(z.re, z.im);
  // parts that are below double-precision noise relative to |z| are display noise, not information
  const re = Math.abs(z.re) < 1e-14 * mag ? 0 : z.re, im = Math.abs(z.im) < 1e-14 * mag ? 0 : z.im;
  if (im === 0) return formatNumber(re, s);
  if (mode === "polar") {
    const deg = s.angle === "deg";
    const th = Math.atan2(im, re) * (deg ? 180 / Math.PI : 1);
    const t = formatNumber(th, { ...s, digits: s.digits }) + (deg ? "°" : "");
    return `${formatNumber(mag, s)}(cos ${t} + i sin ${t})`;
  }
  const a = Math.abs(im), body = a === 1 ? "i" : formatNumber(a, s) + "i";
  if (re === 0) return (im < 0 ? "−" : "") + body;
  return `${formatNumber(re, s)} ${im < 0 ? "−" : "+"} ${body}`;
}

export function formatValue(v, s = {}) {
  if (isComplex(v)) { const t = formatComplex(v, s); return { text: t, html: escapeHtml(t), altText: "" }; }
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
  const num = (x) => String(Number(x.toPrecision(15))).replace("e", "E"); // "E" is what the editor expects for ×10ⁿ
  if (isComplex(v)) return `(${num(v.re)}${v.im < 0 ? "-" : "+"}${num(Math.abs(v.im))}i)`;
  const t = num(v);
  return v < 0 ? `(${t})` : t;
}
