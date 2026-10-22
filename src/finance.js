// Financial formulas, following the definitions in the FC-200V manual.
// Sign convention: money received is positive, money paid out is negative.

import { mathError } from './math.js';

const finite = (x) => {
  if (!Number.isFinite(x)) throw mathError();
  return x;
};

// ---------- root finding ----------
// Newton's method with a bracketing fallback; throws if no root is found.
export function findRoot(f, guess, lo, hi) {
  let x = guess;
  for (let k = 0; k < 80; k++) {
    const y = f(x);
    if (!Number.isFinite(y)) break;
    if (Math.abs(y) < 1e-11 * Math.max(1, Math.abs(x))) return x;
    const h = Math.max(1e-7, Math.abs(x) * 1e-7);
    const d = (f(x + h) - f(x - h)) / (2 * h);
    if (!Number.isFinite(d) || d === 0) break;
    const next = x - y / d;
    if (!Number.isFinite(next) || next <= lo || next >= hi) break;
    if (Math.abs(next - x) < 1e-14 * Math.max(1, Math.abs(x))) return next;
    x = next;
  }
  // Scan for a sign change, then bisect.
  const steps = 4000;
  let a = lo + 1e-9;
  let fa = f(a);
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    // Denser sampling near the low end of the range, where real values live.
    const b = lo + (hi - lo) * t * t * t;
    const fb = f(b);
    if (Number.isFinite(fa) && Number.isFinite(fb) && Math.sign(fa) !== Math.sign(fb)) {
      return bisect(f, a, b, fa);
    }
    a = b;
    fa = fb;
  }
  throw mathError();
}

function bisect(f, a, b, fa) {
  for (let k = 0; k < 200; k++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fm === 0 || (b - a) / 2 < 1e-15 * Math.max(1, Math.abs(m))) return m;
    if (Math.sign(fm) === Math.sign(fa)) {
      a = m;
      fa = fm;
    } else b = m;
  }
  return (a + b) / 2;
}

// Solves residual(x) = 0 for one unknown starting near `guess`; used for the
// relations that have no closed form for every variable (BEVN and friends).
export function solveFor(residual, guess = 1) {
  const x0 = Number.isFinite(guess) && guess !== 0 ? guess : 1;
  let x = x0;
  for (let k = 0; k < 100; k++) {
    const y = residual(x);
    if (!Number.isFinite(y)) break;
    const h = Math.max(1e-6, Math.abs(x) * 1e-7);
    const d = (residual(x + h) - residual(x - h)) / (2 * h);
    if (!Number.isFinite(d) || d === 0) break;
    const next = x - y / d;
    if (Math.abs(next - x) <= 1e-12 * Math.max(1, Math.abs(x))) {
      if (Math.abs(residual(next)) < 1e-6 * Math.max(1, Math.abs(next))) return finite(next);
      break;
    }
    x = next;
  }
  if (Number.isFinite(x) && Math.abs(residual(x)) < 1e-6 * Math.max(1, Math.abs(x))) return x;
  throw mathError();
}

// ---------- SMPL: simple interest ----------
export function simpleInterest({ Dys, iPct, PV, dn }) {
  const siPrime = (Dys / dn) * PV * (iPct / 100);
  return { SI: finite(-siPrime), SFV: finite(-(PV + siPrime)) };
}

// ---------- CMPD: compound interest / time value of money ----------
// Effective interest rate per payment period.
export function periodRate(iPct, PY, CY) {
  if (PY <= 0 || CY <= 0) throw mathError();
  if (PY === CY) return iPct / 100 / PY;
  return (1 + iPct / 100 / CY) ** (CY / PY) - 1;
}

export function annualRate(i, PY, CY) {
  if (PY === CY) return i * PY * 100;
  return CY * ((1 + i) ** (PY / CY) - 1) * 100;
}

// Growth factors for n periods. A fractional n is an "odd period": its
// fraction earns compound (CI) or simple (SI) interest per the dn setting.
function growth(i, n, odd) {
  const whole = Math.trunc(n);
  const frac = n - whole;
  if (odd === 'SI' && frac !== 0) {
    return { gamma: 1 + i * frac, g: (1 + i) ** whole };
  }
  return { gamma: 1, g: (1 + i) ** n };
}

// Residual of PV·γ·(1+i)^n + PMT·(1+i·S)·((1+i)^n − 1)/i + FV = 0.
export function tvmResidual(i, { n, PV, PMT, FV, begin, odd }) {
  if (Math.abs(i) < 1e-12) return PV + PMT * n + FV;
  const { gamma, g } = growth(i, n, odd);
  return PV * gamma * g + (PMT * (1 + i * (begin ? 1 : 0)) * (g - 1)) / i + FV;
}

export function solveTVM(target, v) {
  const { n, iPct, PV, PMT, FV, PY, CY, begin, odd } = v;
  if (target === 'I%') {
    const i = findRoot((r) => tvmResidual(r, v), 0.01, -0.9999, 100);
    return finite(annualRate(i, PY, CY));
  }
  const i = periodRate(iPct, PY, CY);
  const S = begin ? 1 : 0;

  if (Math.abs(i) < 1e-12) {
    switch (target) {
      case 'PV': return finite(-(PMT * n + FV));
      case 'FV': return finite(-(PV + PMT * n));
      case 'PMT':
        if (n === 0) throw mathError();
        return finite(-(PV + FV) / n);
      case 'n':
        if (PMT === 0) throw mathError();
        return finite(-(PV + FV) / PMT);
    }
  }

  const { gamma, g } = growth(i, n, odd);
  const annuity = ((1 + i * S) * (g - 1)) / i;
  switch (target) {
    case 'PV': return finite(-(PMT * annuity + FV) / (gamma * g));
    case 'FV': return finite(-(PV * gamma * g + PMT * annuity));
    case 'PMT':
      if (annuity === 0) throw mathError();
      return finite(-(PV * gamma * g + FV) / annuity);
    case 'n': {
      const c = (PMT * (1 + i * S)) / i;
      const x = (c - FV) / (PV + c);
      if (!(x > 0)) throw mathError();
      const nCI = Math.log(x) / Math.log(1 + i);
      if (odd !== 'SI' || Number.isInteger(nCI)) return finite(nCI);
      return solveFor((t) => tvmResidual(i, { ...v, n: t }), nCI);
    }
  }
  throw mathError();
}

// ---------- CASH: discounted cash flow ----------
export function npv(iPct, flows) {
  if (!flows.length) throw mathError();
  const i = iPct / 100;
  return finite(flows.reduce((s, cf, k) => s + cf / (1 + i) ** k, 0));
}

export function nfv(iPct, flows) {
  return finite(npv(iPct, flows) * (1 + iPct / 100) ** (flows.length - 1));
}

export function irr(flows) {
  if (flows.length < 2) throw mathError();
  const f = (r) => flows.reduce((s, cf, k) => s + cf / (1 + r) ** k, 0);
  return finite(findRoot(f, 0.1, -0.9999, 1000) * 100);
}

// Discounted payback period, interpolated within the period it turns positive.
export function pbp(iPct, flows) {
  if (!flows.length) throw mathError();
  const i = iPct / 100;
  let cum = 0;
  for (let k = 0; k < flows.length; k++) {
    const d = flows[k] / (1 + i) ** k;
    if (k > 0 && cum < 0 && cum + d >= 0) return finite(k - 1 + -cum / d);
    cum += d;
  }
  if (cum >= 0 && flows[0] >= 0) return 0;
  throw mathError();
}

// ---------- AMRT: amortization ----------
export function amortize({ PM1, PM2, n, iPct, PV, PMT, PY, CY, begin }) {
  if (!Number.isInteger(PM1) || !Number.isInteger(PM2) || PM1 < 1 || PM2 < PM1) {
    throw mathError();
  }
  if (n > 0 && PM2 > Math.ceil(n)) throw mathError();
  const i = periodRate(iPct, PY, CY);
  let bal = PV;
  let INT = 0;
  let PRN = 0;
  let sumInt = 0;
  let sumPrn = 0;
  for (let k = 1; k <= PM2; k++) {
    const int = begin && k === 1 ? 0 : -bal * i;
    const prn = PMT - int;
    bal += prn;
    if (k === PM1) {
      INT = int;
      PRN = prn;
    }
    if (k >= PM1) {
      sumInt += int;
      sumPrn += prn;
    }
  }
  return {
    BAL: finite(bal),
    INT: finite(INT),
    PRN: finite(PRN),
    ΣINT: finite(sumInt),
    ΣPRN: finite(sumPrn),
  };
}

// ---------- CNVR: nominal ↔ effective rate ----------
export function toEffective(n, aprPct) {
  if (n <= 0) throw mathError();
  return finite(((1 + aprPct / 100 / n) ** n - 1) * 100);
}

export function toNominal(n, effPct) {
  if (n <= 0) throw mathError();
  return finite(n * ((1 + effPct / 100) ** (1 / n) - 1) * 100);
}

// ---------- COST: cost / sell / margin ----------
export function solveCost(target, { Cst, Sel, Mrg }) {
  switch (target) {
    case 'Cst': return finite(Sel * (1 - Mrg / 100));
    case 'Sel':
      if (Mrg === 100) throw mathError();
      return finite(Cst / (1 - Mrg / 100));
    case 'Mrg':
      if (Sel === 0) throw mathError();
      return finite((1 - Cst / Sel) * 100);
  }
  throw mathError();
}

// ---------- dates ----------
// Dates are stored as 8-digit numbers: MMDDYYYY or DDMMYYYY by date input mode.
export function parseDate(num, dateInput) {
  if (!Number.isInteger(num) || num < 0) throw mathError();
  const s = String(num).padStart(8, '0');
  if (s.length !== 8) throw mathError();
  const a = Number(s.slice(0, 2));
  const b = Number(s.slice(2, 4));
  const y = Number(s.slice(4));
  const [m, d] = dateInput === 'DMY' ? [b, a] : [a, b];
  const t = new Date(Date.UTC(y, m - 1, d));
  if (y < 1901 || y > 2099 || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) {
    throw mathError();
  }
  return { y, m, d };
}

export function encodeDate({ y, m, d }, dateInput) {
  const p = (x) => String(x).padStart(2, '0');
  return Number(dateInput === 'DMY' ? `${p(d)}${p(m)}${y}` : `${p(m)}${p(d)}${y}`);
}

export function formatDate(num) {
  const s = String(num).padStart(8, '0');
  return `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4)}`;
}

const dayNumber = ({ y, m, d }) => Date.UTC(y, m - 1, d) / 86400000;

export function daysBetween(d1, d2, dn) {
  if (dn === 365) return dayNumber(d2) - dayNumber(d1);
  // 30/360 (US) day count.
  let D1 = d1.d;
  let D2 = d2.d;
  if (D1 === 31) D1 = 30;
  if (D2 === 31 && D1 === 30) D2 = 30;
  return 360 * (d2.y - d1.y) + 30 * (d2.m - d1.m) + (D2 - D1);
}

export function addDays(date, days) {
  if (!Number.isInteger(days)) throw mathError();
  const t = new Date((dayNumber(date) + days) * 86400000);
  const r = { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  if (r.y < 1901 || r.y > 2099) throw mathError();
  return r;
}

// Same day-of-month `months` later (or earlier), clamped to the month's end.
export function addMonths({ y, m, d }, months) {
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return { y: ny, m: nm, d: Math.min(d, last) };
}

const before = (a, b) => dayNumber(a) < dayNumber(b);

// ---------- DEPR: depreciation ----------
// Returns the depreciation for year j and the remaining depreciable value.
export function depreciation(method, { n, iPct, PV, FV, j, YR1 }) {
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(j) || j < 1) throw mathError();
  if (!Number.isInteger(YR1) || YR1 < 1 || YR1 > 12) throw mathError();
  const lastYear = YR1 === 12 ? n : n + 1;
  if (j > lastYear) throw mathError();
  const base = PV - FV;
  const r = iPct / 100;
  const first = YR1 / 12;

  let rdv = base;
  let dep = 0;
  for (let k = 1; k <= j; k++) {
    switch (method) {
      case 'SL':
        if (k === 1) dep = (base / n) * first;
        else if (k === n + 1) dep = (base / n) * (1 - first);
        else dep = base / n;
        break;
      case 'FP':
        if (k === 1) dep = PV * r * first;
        else if (YR1 !== 12 && k === lastYear) dep = rdv;
        else dep = (rdv + FV) * r;
        break;
      case 'DB':
        if (k === 1) dep = ((PV * r) / n) * first;
        else if (YR1 !== 12 && k === lastYear) dep = rdv;
        else dep = ((rdv + FV) * r) / n;
        break;
      case 'SYD': {
        const Z = (n * (n + 1)) / 2;
        if (YR1 === 12) {
          dep = ((n - k + 1) / Z) * base;
        } else {
          const dep1 = (n / Z) * first * base;
          if (k === 1) dep = dep1;
          else {
            const np = n - first;
            const whole = Math.trunc(np);
            const Zp = ((whole + 1) * (whole + 2 * (np - whole))) / 2;
            dep = ((np - k + 2) / Zp) * (base - dep1);
          }
        }
        break;
      }
      default:
        throw mathError();
    }
    rdv -= dep;
  }
  return { dep: finite(dep), RDV: finite(Math.abs(rdv) < 1e-9 * Math.abs(base) ? 0 : rdv) };
}

// ---------- BOND ----------
// Price per 100 of face value. Date mode uses settlement d1 and maturity d2;
// Term mode uses n coupon payments. M = coupons per year (1 or 2).
export function bondPrice({ dateMode, d1, d2, n, RDV, CPN, YLD, M, dn }) {
  const R = YLD / 100 / M;
  const C = CPN / M;
  if (!dateMode) {
    if (!(n > 0)) throw mathError();
    const disc = (1 + R) ** -n;
    const annuity = Math.abs(R) < 1e-12 ? n : (1 - disc) / R;
    const PRC = -RDV * disc - C * annuity;
    return { PRC: finite(PRC), INT: 0, CST: finite(PRC) };
  }
  if (!before(d1, d2)) throw mathError();
  // Walk back from maturity to the coupon dates around the settlement date.
  const step = 12 / M;
  let N = 0;
  let next = d2;
  let prev = addMonths(d2, -step);
  while (before(d1, prev)) {
    next = prev;
    prev = addMonths(d2, -step * (N + 2));
    N++;
  }
  N++; // coupons from `next` through maturity
  const A = daysBetween(prev, d1, dn);
  const D = daysBetween(prev, next, dn);
  const B = D - A;
  let PRC;
  if (N === 1) {
    PRC = -(RDV + C) / (1 + (B / D) * R) + (A / D) * C;
  } else {
    PRC = -RDV / (1 + R) ** (N - 1 + B / D);
    for (let k = 1; k <= N; k++) PRC -= C / (1 + R) ** (k - 1 + B / D);
    PRC += (A / D) * C;
  }
  const INT = -(A / D) * C;
  return { PRC: finite(PRC), INT: finite(INT), CST: finite(PRC + INT) };
}

export function bondYield(v) {
  const target = -Math.abs(v.PRC);
  const f = (y) => bondPrice({ ...v, YLD: y }).PRC - target;
  return finite(findRoot(f, 5, -99 * v.M, 10000));
}

// ---------- BEVN: break-even and leverage ----------
// Each relation is written as residual = 0 so any variable can be solved.
export const BEVN_RELATIONS = {
  BEVN: (v, { ratio, sales }) => {
    const q = sales ? v.SBE / v.PRC : v.QBE;
    const profit = ratio ? (v['r%'] / 100) * v.PRC * q : v.PRF;
    return q * (v.PRC - v.VCU) - v.FC - profit;
  },
  MOS: (v) => v.MOS * v.SAL - (v.SAL - v.SBE),
  DOL: (v) => v.DOL * (v.SAL - v.VC - v.FC) - (v.SAL - v.VC),
  DFL: (v) => v.DFL * (v.EBIT - v.ITR) - v.EBIT,
  DCL: (v) => v.DCL * (v.SAL - v.VC - v.FC - v.ITR) - (v.SAL - v.VC),
  'QTY:SAL': (v) => v.SAL - v.PRC * v.QTY,
  'QTY:VC': (v) => v.VC - v.VCU * v.QTY,
};

// ---------- STAT ----------
export const REG_TYPES = ['1-VAR', 'A+BX', '_+CX²', 'ln X', 'e^X', 'A·B^X', 'A·X^B', '1/X'];

const ln = (v) => {
  if (!(v > 0)) throw mathError();
  return Math.log(v);
};

// Transforms (x, y) so every regression type is a linear fit on (u, w).
const LINEARIZE = {
  'A+BX': [(x) => x, (y) => y],
  'ln X': [ln, (y) => y],
  'e^X': [(x) => x, ln],
  'A·B^X': [(x) => x, ln],
  'A·X^B': [ln, ln],
  '1/X': [
    (x) => {
      if (x === 0) throw mathError();
      return 1 / x;
    },
    (y) => y,
  ],
};

// data: [{ x, y, f }] with frequency f (1 when FREQ is off).
export function statistics(data, type) {
  const rows = data.filter((r) => (r.f ?? 1) !== 0);
  if (rows.some((r) => (r.f ?? 1) < 0)) throw mathError();
  const n = rows.reduce((s, r) => s + (r.f ?? 1), 0);
  if (!n) throw mathError();
  const S = (fn) => rows.reduce((s, r) => s + (r.f ?? 1) * fn(r), 0);
  const sx = S((r) => r.x);
  const sx2 = S((r) => r.x * r.x);
  const mean = sx / n;
  const varX = Math.max(0, sx2 / n - mean * mean);
  const out = {
    statN: n,
    'x̄': mean,
    'Σx': sx,
    'Σx²': sx2,
    'xσn': Math.sqrt(varX),
    'xσn-1': n > 1 ? Math.sqrt((varX * n) / (n - 1)) : NaN,
    minX: Math.min(...rows.map((r) => r.x)),
    maxX: Math.max(...rows.map((r) => r.x)),
  };
  if (type === '1-VAR') return out;

  const sy = S((r) => r.y);
  const sy2 = S((r) => r.y * r.y);
  const my = sy / n;
  const varY = Math.max(0, sy2 / n - my * my);
  Object.assign(out, {
    'ȳ': my,
    'Σy': sy,
    'Σy²': sy2,
    'Σxy': S((r) => r.x * r.y),
    'Σx³': S((r) => r.x ** 3),
    'Σx²y': S((r) => r.x * r.x * r.y),
    'Σx⁴': S((r) => r.x ** 4),
    'yσn': Math.sqrt(varY),
    'yσn-1': n > 1 ? Math.sqrt((varY * n) / (n - 1)) : NaN,
    minY: Math.min(...rows.map((r) => r.y)),
    maxY: Math.max(...rows.map((r) => r.y)),
  });

  if (type === '_+CX²') {
    // Least squares for y = A + Bx + Cx².
    const Sxx = out['Σx²'] - (sx * sx) / n;
    const Sxy = out['Σxy'] - (sx * sy) / n;
    const Sxx2 = out['Σx³'] - (sx * out['Σx²']) / n;
    const Sx2x2 = out['Σx⁴'] - (out['Σx²'] ** 2) / n;
    const Sx2y = out['Σx²y'] - (out['Σx²'] * sy) / n;
    const det = Sxx * Sx2x2 - Sxx2 * Sxx2;
    const B = (Sxy * Sx2x2 - Sx2y * Sxx2) / det;
    const C = (Sx2y * Sxx - Sxy * Sxx2) / det;
    const A = my - B * mean - C * (out['Σx²'] / n);
    return Object.assign(out, { regA: A, regB: B, regC: C });
  }

  const [fu, fw] = LINEARIZE[type];
  const pts = rows.map((r) => ({ u: fu(r.x), w: fw(r.y), f: r.f ?? 1 }));
  const T = (fn) => pts.reduce((s, p) => s + p.f * fn(p), 0);
  const su = T((p) => p.u);
  const sw = T((p) => p.w);
  const Suu = T((p) => p.u * p.u) - (su * su) / n;
  const Sww = T((p) => p.w * p.w) - (sw * sw) / n;
  const Suw = T((p) => p.u * p.w) - (su * sw) / n;
  const b = Suu === 0 ? NaN : Suw / Suu;
  const a = sw / n - b * (su / n);
  const r = Suu === 0 || Sww === 0 ? NaN : Suw / Math.sqrt(Suu * Sww);
  let A = a;
  let B = b;
  if (type === 'e^X' || type === 'A·X^B') A = Math.exp(a);
  if (type === 'A·B^X') {
    A = Math.exp(a);
    B = Math.exp(b);
  }
  return Object.assign(out, { regA: A, regB: B, regR: r });
}

// ŷ and x̂ for the fitted model.
export function estimate(kind, x, type, s) {
  const { regA: A, regB: B, regC: C } = s;
  const check = (v) => finite(v);
  if (kind === 'yhat') {
    switch (type) {
      case 'A+BX': return check(A + B * x);
      case '_+CX²': return check(A + B * x + C * x * x);
      case 'ln X': return check(A + B * ln(x));
      case 'e^X': return check(A * Math.exp(B * x));
      case 'A·B^X': return check(A * B ** x);
      case 'A·X^B': return check(A * x ** B);
      case '1/X':
        if (x === 0) throw mathError();
        return check(A + B / x);
    }
  }
  if (type === '_+CX²') {
    if (kind === 'xhat') throw mathError();
    const disc = B * B - 4 * C * (A - x);
    if (disc < 0 || C === 0) throw mathError();
    const sign = kind === 'xhat1' ? 1 : -1;
    return check((-B + sign * Math.sqrt(disc)) / (2 * C));
  }
  if (kind !== 'xhat') throw mathError();
  switch (type) {
    case 'A+BX': return check((x - A) / B);
    case 'ln X': return check(Math.exp((x - A) / B));
    case 'e^X': return check(ln(x / A) / B);
    case 'A·B^X': return check(ln(x / A) / ln(B));
    case 'A·X^B': return check((x / A) ** (1 / B));
    case '1/X':
      if (x === A) throw mathError();
      return check(B / (x - A));
  }
  throw mathError();
}
