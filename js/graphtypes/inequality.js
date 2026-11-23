// INEQUALITY graphs: y > x², y ≤ sin(x), x < 3, x²+y² ≤ 4, …
import { CalcError, parse, splitRelation, collectVars } from "../parser.js";
import { compileReal } from "../engine.js";
import { EPS } from "../realmath.js";

const FLIP = { "<": ">", ">": "<", "<=": ">=", ">=": "<=", "=": "=" };

/**
 * compileInequality("y>=x^2", {angle, vars}) ->
 *   { op, strict, form: "y"|"x"|"general", boundary(t)?, satisfies(x,y), F(x,y) }
 * form "y": the relation is  y OP g(x)  (after flipping if needed); "x": x OP g(y); otherwise F(x,y)=lhs−rhs.
 */
export function compileInequality(text, { angle = "rad", vars = {} } = {}) {
  const rel = splitRelation(text);
  if (!rel) throw new CalcError("Needs a relation: <, >, ≤, ≥ (or = for a curve), e.g.  y > x²");
  const o = { angle, vars, indep: ["x", "y"], xMessage: "x and y are the graph variables" };
  const Lf = compileReal(rel.lhs, o), Rf = compileReal(rel.rhs, o);
  const L = parse(rel.lhs), R = parse(rel.rhs);
  const lv = collectVars(L), rv = collectVars(R);
  let op = rel.op, form = "general", bnd = null;
  const isVar = (n, name) => n.t === "var" && n.name === name;
  if (isVar(L, "y") && !rv.has("y")) { form = "y"; bnd = compileReal(rel.rhs, { ...o, indep: ["x"] }); }
  else if (isVar(R, "y") && !lv.has("y")) { form = "y"; op = FLIP[op]; bnd = compileReal(rel.lhs, { ...o, indep: ["x"] }); }
  else if (isVar(L, "x") && !rv.has("x")) { form = "x"; bnd = compileReal(rel.rhs, { ...o, indep: ["y"] }); }
  else if (isVar(R, "x") && !lv.has("x")) { form = "x"; op = FLIP[op]; bnd = compileReal(rel.lhs, { ...o, indep: ["y"] }); }
  if (form !== "general" && bnd) {
    const other = form === "y" ? "y" : "x";
    // the boundary expression must not contain the dependent variable
    if (collectVars(parse(form === "y" ? (isVar(L, "y") ? rel.rhs : rel.lhs) : (isVar(L, "x") ? rel.rhs : rel.lhs))).has(other)) { form = "general"; bnd = null; }
  }
  const strict = op === "<" || op === ">";
  const F = (x, y) => Lf(x, y) - Rf(x, y);
  function satisfies(x, y) {
    const l = Lf(x, y), r = Rf(x, y);
    if (!Number.isFinite(l) || !Number.isFinite(r)) return false;
    const d = l - r, tol = 8 * EPS * (Math.abs(l) + Math.abs(r));
    switch (rel.op) {
      case "<": return d < -tol;
      case "<=": return d <= tol;
      case ">": return d > tol;
      case ">=": return d >= -tol;
      default: return Math.abs(d) <= tol;
    }
  }
  return { op: rel.op, normOp: op, strict, equality: rel.op === "=", form, boundary: bnd, F, satisfies, text };
}

/** For a "y" or "x" form: does the solution lie above/right of the boundary (true) or below/left (false)? */
export const regionIsAbove = (ineq) => ineq.normOp === ">" || ineq.normOp === ">=";

/** Mask of cells whose centre satisfies the inequality; view = {xMin,xMax,yMin,yMax}; row 0 is the top. */
export function sampleRegion(ineq, view, nx, ny) {
  const mask = new Uint8Array(nx * ny);
  const dx = (view.xMax - view.xMin) / nx, dy = (view.yMax - view.yMin) / ny;
  for (let j = 0; j < ny; j++) {
    const y = view.yMax - (j + 0.5) * dy;
    for (let i = 0; i < nx; i++) mask[j * nx + i] = ineq.satisfies(view.xMin + (i + 0.5) * dx, y) ? 1 : 0;
  }
  return mask;
}

/** Marching squares: segments [x1,y1,x2,y2] of the contour F(x,y)=0 in math coordinates. */
export function contourSegments(F, view, nx, ny) {
  const dx = (view.xMax - view.xMin) / nx, dy = (view.yMax - view.yMin) / ny;
  const vals = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) vals[j * (nx + 1) + i] = F(view.xMin + i * dx, view.yMax - j * dy);
  const segs = [];
  const lerp = (a, b, fa, fb) => a + (b - a) * (fa / (fa - fb));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const f00 = vals[j * (nx + 1) + i], f10 = vals[j * (nx + 1) + i + 1], f01 = vals[(j + 1) * (nx + 1) + i], f11 = vals[(j + 1) * (nx + 1) + i + 1];
    if (![f00, f10, f01, f11].every(Number.isFinite)) continue;
    // grid coordinates come from one formula so that neighbouring cells produce bit-identical shared endpoints
    const x0 = view.xMin + i * dx, x1 = view.xMin + (i + 1) * dx, y0 = view.yMax - j * dy, y1 = view.yMax - (j + 1) * dy; // y0 top, y1 bottom
    const pts = [];
    if ((f00 < 0) !== (f10 < 0)) pts.push([lerp(x0, x1, f00, f10), y0]);
    if ((f10 < 0) !== (f11 < 0)) pts.push([x1, lerp(y0, y1, f10, f11)]);
    if ((f01 < 0) !== (f11 < 0)) pts.push([lerp(x0, x1, f01, f11), y1]);
    if ((f00 < 0) !== (f01 < 0)) pts.push([x0, lerp(y0, y1, f00, f01)]);
    if (pts.length === 2) { if (pts[0][0] !== pts[1][0] || pts[0][1] !== pts[1][1]) segs.push([...pts[0], ...pts[1]]); } // skip zero-length segments (contour through a grid vertex)
    else if (pts.length === 4) { segs.push([...pts[0], ...pts[1]], [...pts[2], ...pts[3]]); }
  }
  return segs;
}

/** Join marching-squares segments (which share exact endpoints) into polylines [[x,y],…] so dashes run continuously. */
export function chainSegments(segs) {
  const key = (x, y) => x + "|" + y;
  const at = new Map();
  segs.forEach((s, i) => {
    for (const k of [key(s[0], s[1]), key(s[2], s[3])]) { if (!at.has(k)) at.set(k, []); at.get(k).push(i); }
  });
  const used = new Array(segs.length).fill(false);
  const out = [];
  const next = (x, y) => { const l = at.get(key(x, y)); return l ? l.find((i) => !used[i]) : undefined; };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const line = [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]];
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const end = dir === 0 ? line[line.length - 1] : line[0];
        const j = next(end[0], end[1]);
        if (j === undefined) break;
        used[j] = true;
        const s = segs[j];
        const other = s[0] === end[0] && s[1] === end[1] ? [s[2], s[3]] : [s[0], s[1]];
        if (dir === 0) line.push(other); else line.unshift(other);
      }
    }
    out.push(line);
  }
  return out;
}
