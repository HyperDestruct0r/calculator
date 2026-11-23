// POLAR graphs: r = f(θ). θ is expressed in the calculator's angle unit (DEG or RAD); geometry is done in radians.
import { compileReal } from "../engine.js";
import { parameterValues } from "./curve.js";
import { trigSet, sinR, cosR } from "../realmath.js";

const unitToRad = (angle) => (angle === "deg" ? Math.PI / 180 : 1);

/** Compile r(θ). Both θ and t are accepted as the variable. Returns fn(θ) -> r (NaN if undefined). */
export function compilePolar(expr, { angle = "rad", vars = {} } = {}) {
  return compileReal(expr, { angle, vars, indep: ["theta"], alias: { t: "theta" }, xMessage: "x is not available in POLAR — use θ" });
}
/** Convert (r, θ in angle units) to Cartesian. */
export function polarToXY(r, theta, angle = "rad") {
  const tr = trigSet(angle); // exact at quarter turns, so (r, π) is (−r, 0) and not (−r, 1.2e-16 r)
  return [r * tr.cos(theta) + 0, r * tr.sin(theta) + 0]; // + 0 turns -0 into 0
}
/** Sample r(θ) over [min,max]. Returns {thetas, rs, xs, ys, capped}. */
export function samplePolar(fn, { min, max, step, angle = "rad" }) {
  const { values, capped } = parameterValues(min, max, step);
  const rs = values.map((t) => fn(t));
  const xs = [], ys = [];
  values.forEach((t, i) => {
    if (!Number.isFinite(rs[i])) { xs.push(NaN); ys.push(NaN); return; }
    const [x, y] = polarToXY(rs[i], t, angle);
    xs.push(x); ys.push(y);
  });
  return { thetas: values, rs, xs, ys, capped };
}
/** The polar curve as x(φ), y(φ) in radians, for differentiation. */
export function polarAsParametric(fn, angle = "rad") {
  const u = 1 / unitToRad(angle);
  return { fx: (p) => fn(p * u) * cosR(p), fy: (p) => fn(p * u) * sinR(p), toParam: (theta) => theta * unitToRad(angle) };
}
