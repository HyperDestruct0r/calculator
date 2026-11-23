// PARAMETRIC graphs: x = f(t), y = g(t).
import { compileReal } from "../engine.js";
import { parameterValues } from "./curve.js";

export function compileParametric(xExpr, yExpr, { angle = "rad", vars = {} } = {}) {
  const o = { angle, vars, indep: ["t"], xMessage: "x is not available in PARAMETRIC — use t" };
  return { fx: compileReal(xExpr, o), fy: compileReal(yExpr, o) };
}
export function sampleParametric({ fx, fy }, { min, max, step }) {
  const { values, capped } = parameterValues(min, max, step);
  const xs = values.map((t) => fx(t)), ys = values.map((t) => fy(t));
  return { ts: values, xs, ys, capped };
}
