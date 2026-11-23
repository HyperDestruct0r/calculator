// Linear systems A·x = b with classification: unique / no solution / infinitely many.
// Entries that are exactly rational are solved with exact BigInt fractions; otherwise floating point with a
// relative tolerance (rows are scaled first, pivots below 1e-10 are treated as zero).
import { Fr } from "./polynomial.js";
import { toFractionParts } from "./realmath.js";

function toFr(v) {
  if (Number.isInteger(v)) return new Fr(BigInt(v));
  const f = toFractionParts(v, 1000000, 1e-15);
  return f && f.p / f.q === v ? new Fr(BigInt(f.p), BigInt(f.q)) : null;
}

const FLOAT = {
  zero: 0, one: 1, tol: 1e-10,
  add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b,
  isZero(x) { return Math.abs(x) <= this.tol; }, mag: Math.abs, num: (x) => x,
};
const EXACT = {
  zero: new Fr(0n), one: new Fr(1n),
  add: (a, b) => a.add(b), sub: (a, b) => a.sub(b), mul: (a, b) => a.mul(b), div: (a, b) => a.div(b),
  isZero: (x) => x.isZero(), mag: (x) => Math.abs(x.toNumber()), num: (x) => x.toNumber(),
};

/** Reduced row echelon form of the augmented matrix M (rows × (n+1)); returns {M, pivots} */
function rref(M, ops, n) {
  const rows = M.length;
  let r = 0;
  const pivots = [];
  for (let c = 0; c < n && r < rows; c++) {
    let best = -1, bm = -1;
    for (let i = r; i < rows; i++) { if (!ops.isZero(M[i][c]) && ops.mag(M[i][c]) > bm) { bm = ops.mag(M[i][c]); best = i; } }
    if (best < 0) continue;
    [M[r], M[best]] = [M[best], M[r]];
    const pv = M[r][c];
    M[r] = M[r].map((x) => ops.div(x, pv));
    for (let i = 0; i < rows; i++) {
      if (i === r || ops.isZero(M[i][c])) continue;
      const f = M[i][c];
      M[i] = M[i].map((x, k) => ops.sub(x, ops.mul(f, M[r][k])));
    }
    pivots.push(c); r++;
  }
  return { M, pivots };
}

/**
 * solveLinearSystem(A, b, names) ->
 *   {kind:"unique", values:[number], exact, fractions:[{p,q}|null]}
 *   {kind:"none"}
 *   {kind:"infinite", rank, free:[names], pivots:[{name, c, coefs:[...per free var]}], exact}
 */
export function solveLinearSystem(A, b, names) {
  const n = names.length;
  let exact = true;
  let M = A.map((row, i) => [...row, b[i]].map((v) => { const f = toFr(v); if (!f) exact = false; return f; }));
  let ops = EXACT;
  if (!exact) {
    ops = { ...FLOAT };
    M = A.map((row, i) => {
      const r = [...row, b[i]];
      const m = Math.max(...row.map(Math.abs), 1e-300);
      return r.map((v) => v / m); // scale each row by its largest coefficient
    });
  }
  const { M: R, pivots } = rref(M, ops, n);
  // inconsistent rows: all coefficients zero but rhs non-zero
  for (const row of R) {
    if (row.slice(0, n).every((x) => ops.isZero(x)) && !ops.isZero(row[n])) return { kind: "none" };
  }
  if (pivots.length === n) {
    const values = pivots.map((c, k) => ops.num(R[k][n]));
    const fractions = exact ? pivots.map((c, k) => ({ p: R[k][n].n, q: R[k][n].d })) : null;
    return { kind: "unique", values, exact, fractions };
  }
  const free = names.filter((_, j) => !pivots.includes(j));
  const rows = pivots.map((c, k) => ({
    name: names[c],
    c: ops.num(R[k][n]),
    coefs: free.map((fn) => -ops.num(R[k][names.indexOf(fn)]) + 0),
  }));
  return { kind: "infinite", rank: pivots.length, free, pivots: rows, exact };
}
