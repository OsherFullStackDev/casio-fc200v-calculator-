// Financial formulas, following the definitions in the FC-100V manual.
// Sign convention: money received is positive, money paid out is negative.

import { mathError } from './math.js';

const finite = (x) => {
  if (!Number.isFinite(x)) throw mathError();
  return x;
};

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

// Residual of PV·(1+i)^n + PMT·(1+i·S)·((1+i)^n − 1)/i + FV = 0.
export function tvmResidual(i, { n, PV, PMT, FV, begin }) {
  if (Math.abs(i) < 1e-12) return PV + PMT * n + FV;
  const g = (1 + i) ** n;
  return PV * g + (PMT * (1 + i * (begin ? 1 : 0)) * (g - 1)) / i + FV;
}

export function solveTVM(target, v) {
  const { n, iPct, PV, PMT, FV, PY, CY, begin } = v;
  if (target === 'I%') return solveRate(v);
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

  const beta = (1 + i) ** -n;
  const alpha = ((1 + i * S) * (1 - beta)) / i;
  switch (target) {
    case 'PV': return finite(-alpha * PMT - beta * FV);
    case 'FV': return finite(-(PV + alpha * PMT) / beta);
    case 'PMT':
      if (alpha === 0) throw mathError();
      return finite(-(PV + beta * FV) / alpha);
    case 'n': {
      const c = (PMT * (1 + i * S)) / i;
      const x = (c - FV) / (PV + c);
      if (!(x > 0)) throw mathError();
      return finite(Math.log(x) / Math.log(1 + i));
    }
  }
  throw mathError();
}

function solveRate(v) {
  const f = (i) => tvmResidual(i, v);
  const i = findRoot(f, 0.01, -0.9999, 100);
  return finite(annualRate(i, v.PY, v.CY));
}

// Newton's method with a bracketing fallback; throws if no root is found.
export function findRoot(f, guess, lo, hi) {
  let x = guess;
  for (let k = 0; k < 60; k++) {
    const y = f(x);
    if (!Number.isFinite(y)) break;
    if (Math.abs(y) < 1e-10) return x;
    const h = Math.max(1e-7, Math.abs(x) * 1e-7);
    const d = (f(x + h) - f(x - h)) / (2 * h);
    if (!Number.isFinite(d) || d === 0) break;
    const next = x - y / d;
    if (!Number.isFinite(next) || next <= lo || next >= hi) break;
    if (Math.abs(next - x) < 1e-14) return next;
    x = next;
  }
  // Scan for a sign change, then bisect.
  const steps = 2000;
  let a = lo + 1e-9;
  let fa = f(a);
  for (let k = 1; k <= steps; k++) {
    // Denser sampling near zero, where real-world rates live.
    const t = k / steps;
    const b = lo + (hi - lo) * t * t;
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
    if (fm === 0 || (b - a) / 2 < 1e-15) return m;
    if (Math.sign(fm) === Math.sign(fa)) {
      a = m;
      fa = fm;
    } else b = m;
  }
  return (a + b) / 2;
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

// ---------- DAYS: day count between dates ----------
// Dates are stored as 8-digit numbers: MMDDYYYY or DDMMYYYY by date mode.
export function parseDate(num, dateMode) {
  if (!Number.isInteger(num) || num < 0) throw mathError();
  const s = String(num).padStart(8, '0');
  if (s.length !== 8) throw mathError();
  const a = Number(s.slice(0, 2));
  const b = Number(s.slice(2, 4));
  const y = Number(s.slice(4));
  const [m, d] = dateMode === 'DMY' ? [b, a] : [a, b];
  const t = Date.UTC(y, m - 1, d);
  const check = new Date(t);
  if (y < 1901 || y > 2099 || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw mathError();
  }
  return { y, m, d };
}

export function encodeDate({ y, m, d }, dateMode) {
  const p = (x) => String(x).padStart(2, '0');
  return Number(dateMode === 'DMY' ? `${p(d)}${p(m)}${y}` : `${p(m)}${p(d)}${y}`);
}

export function formatDate(num, dateMode) {
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

// ---------- STAT ----------
export function statistics(data, paired) {
  const n = data.length;
  if (!n) throw mathError();
  const xs = data.map((r) => r.x);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const sx = sum(xs);
  const sx2 = sum(xs.map((v) => v * v));
  const mx = sx / n;
  const varX = sx2 / n - mx * mx;
  const out = {
    n,
    'x̄': mx,
    'Σx': sx,
    'Σx²': sx2,
    'σx': Math.sqrt(Math.max(0, varX)),
    'sx': n > 1 ? Math.sqrt(Math.max(0, (varX * n) / (n - 1))) : NaN,
    'minX': Math.min(...xs),
    'maxX': Math.max(...xs),
  };
  if (!paired) return out;

  const ys = data.map((r) => r.y);
  const sy = sum(ys);
  const sy2 = sum(ys.map((v) => v * v));
  const sxy = sum(data.map((r) => r.x * r.y));
  const my = sy / n;
  const varY = sy2 / n - my * my;
  const sxxN = sx2 - (sx * sx) / n;
  const syyN = sy2 - (sy * sy) / n;
  const sxyN = sxy - (sx * sy) / n;
  const B = sxxN === 0 ? NaN : sxyN / sxxN;
  return Object.assign(out, {
    'ȳ': my,
    'Σy': sy,
    'Σy²': sy2,
    'Σxy': sxy,
    'σy': Math.sqrt(Math.max(0, varY)),
    'sy': n > 1 ? Math.sqrt(Math.max(0, (varY * n) / (n - 1))) : NaN,
    'minY': Math.min(...ys),
    'maxY': Math.max(...ys),
    A: my - B * mx,
    B,
    r: sxxN === 0 || syyN === 0 ? NaN : sxyN / Math.sqrt(sxxN * syyN),
  });
}
