import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../src/finance.js';

const near = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} ≉ ${expected}`);

const loan = { n: 360, iPct: 6, PV: 200000, PMT: -1199.101050, FV: 0, PY: 12, CY: 12, begin: false, odd: 'CI' };

test('CMPD solves each TVM variable from the others', () => {
  near(F.solveTVM('PMT', loan), -1199.101050, 1e-6);
  near(F.solveTVM('n', loan), 360, 1e-4);
  near(F.solveTVM('I%', loan), 6, 1e-6);
  near(F.solveTVM('PV', loan), 200000, 1e-2);
  near(F.solveTVM('FV', loan), 0, 1e-2);
});

test('CMPD lump sum, annuity due, zero interest', () => {
  const v = { n: 10, iPct: 5, PV: -1000, PMT: 0, FV: 0, PY: 1, CY: 1, begin: false };
  near(F.solveTVM('FV', v), 1628.894627, 1e-6);
  near(F.solveTVM('PMT', { ...v, iPct: 0, PV: 1200 }), -120);
  const due = { n: 12, iPct: 12, PV: 0, PMT: -100, FV: 0, PY: 12, CY: 12, begin: true };
  near(F.solveTVM('FV', due), 1280.932804, 1e-6);
  near(F.periodRate(6, 12, 2), 1.03 ** (1 / 6) - 1, 1e-15);
});

test('CMPD odd period: simple interest on the fraction', () => {
  const v = { n: 2.5, iPct: 10, PV: -1000, PMT: 0, FV: 0, PY: 1, CY: 1, begin: false };
  near(F.solveTVM('FV', { ...v, odd: 'CI' }), 1000 * 1.1 ** 2.5, 1e-6);
  near(F.solveTVM('FV', { ...v, odd: 'SI' }), 1000 * 1.05 * 1.21, 1e-6);
  near(F.solveTVM('n', { ...v, odd: 'SI', FV: 1270.5 }), 2.5, 1e-6);
});

test('CMPD odd period: payments only over the whole periods', () => {
  const v = { n: 1.5, iPct: 10, PV: -1000, PMT: 100, FV: 0, PY: 1, CY: 1, begin: false, odd: 'CI' };
  const fv = F.solveTVM('FV', v);
  near(fv, 1000 * 1.1 ** 1.5 - 100, 1e-9); // 1053.689733
  // Solving n back from that FV lands on the same n.
  near(F.solveTVM('n', { ...v, FV: fv }), 1.5, 1e-9);
  near(F.solveTVM('I%', { ...v, FV: fv }), 10, 1e-7);
});

test('SMPL simple interest', () => {
  const r = F.simpleInterest({ Dys: 120, iPct: 7, PV: 10000, dn: 365 });
  near(r.SI, -230.1369863, 1e-7);
  near(r.SFV, -10230.1369863, 1e-7);
});

test('CASH: NPV, IRR, NFV, PBP', () => {
  const flows = [-1000, 300, 400, 500];
  near(F.npv(10, flows), -21.03681, 1e-5);
  near(F.irr(flows), 8.896, 1e-3);
  near(F.nfv(10, flows), -21.03681 * 1.331, 1e-4);
  near(F.pbp(0, [-1000, 400, 400, 400]), 2.5);
  assert.throws(() => F.pbp(10, flows));
});

test('AMRT first payment and balance after a year', () => {
  const r = F.amortize({ ...loan, PM1: 1, PM2: 12 });
  near(r.INT, -1000, 1e-9);
  near(r.PRN, -199.10105, 1e-9);
  near(r.BAL, -F.solveTVM('FV', { ...loan, n: 12 }), 1e-6);
  near(r.ΣINT + r.ΣPRN, 12 * loan.PMT, 1e-6);
});

test('CNVR and COST', () => {
  near(F.toEffective(12, 12), 12.68250301, 1e-8);
  near(F.toNominal(12, 12.68250301), 12, 1e-7);
  near(F.solveCost('Sel', { Cst: 100, Mrg: 20 }), 125);
  near(F.solveCost('Mrg', { Cst: 100, Sel: 125 }), 20);
});

test('DAYS', () => {
  const d1 = F.parseDate(1012026, 'MDY');
  const d2 = F.parseDate(12312026, 'MDY');
  assert.equal(F.daysBetween(d1, d2, 365), 364);
  assert.equal(F.daysBetween(d1, d2, 360), 360);
  assert.equal(F.encodeDate(F.addDays(d1, 364), 'MDY'), 12312026);
  assert.deepEqual(F.parseDate(31122026, 'DMY'), { y: 2026, m: 12, d: 31 });
  assert.throws(() => F.parseDate(2302026, 'MDY'));
  assert.deepEqual(F.addMonths({ y: 2026, m: 8, d: 31 }, -6), { y: 2026, m: 2, d: 28 });
});

test('DEPR: four methods, year 1 and the full schedule', () => {
  const base = { n: 6, PV: 1500000, FV: 0, j: 1, YR1: 12 };
  near(F.depreciation('SL', { ...base, iPct: 0 }).dep, 250000);
  near(F.depreciation('SL', { ...base, iPct: 0 }).RDV, 1250000);
  near(F.depreciation('FP', { ...base, iPct: 25 }).dep, 375000);
  near(F.depreciation('SYD', { ...base, iPct: 0 }).dep, (6 / 21) * 1500000, 1e-6);
  near(F.depreciation('DB', { ...base, iPct: 200 }).dep, 500000);
  // SYD with a partial first year (YR1=6): the last year gets the remaining 1/30.
  near(F.depreciation('SYD', { n: 5, iPct: 0, PV: 1000, FV: 0, j: 6, YR1: 6 }).dep, 1000 / 30, 1e-9);
  near(F.depreciation('SYD', { n: 3, iPct: 0, PV: 1200, FV: 0, j: 4, YR1: 6 }).dep, 100, 1e-9);
  // Partial first year: the whole cost is written off by year n+1.
  for (const m of ['SL', 'SYD', 'FP', 'DB']) {
    const r = F.depreciation(m, { n: 5, iPct: 30, PV: 10000, FV: 1000, j: 6, YR1: 4 });
    near(r.RDV, 0, 1e-6);
  }
});

test('BOND price and yield', () => {
  const term = { dateMode: false, n: 10, RDV: 100, CPN: 5, YLD: 5, M: 1 };
  near(F.bondPrice(term).PRC, -100, 1e-9);
  near(F.bondPrice({ ...term, YLD: 6 }).PRC, -92.63991, 1e-5);
  const date = {
    dateMode: true, d1: { y: 2026, m: 6, d: 15 }, d2: { y: 2030, m: 12, d: 15 },
    RDV: 100, CPN: 6, YLD: 6, M: 2, dn: 365,
  };
  const atCoupon = F.bondPrice(date);
  near(atCoupon.PRC, -100, 1e-9);
  near(atCoupon.INT, 0, 1e-12);
  const mid = { ...date, d1: { y: 2026, m: 9, d: 1 }, YLD: 7 };
  const p = F.bondPrice(mid);
  assert.ok(p.INT < 0 && p.PRC > -100);
  near(F.bondYield({ ...mid, PRC: p.PRC }), 7, 1e-7);
});

test('BEVN relations', () => {
  const v = { PRC: 100, VCU: 60, FC: 40000, PRF: 0, QBE: 0 };
  const q = F.solveFor((t) => F.BEVN_RELATIONS.BEVN({ ...v, QBE: t }, {}), 0);
  near(q, 1000);
  const fc = F.solveFor((t) => F.BEVN_RELATIONS.BEVN({ ...v, QBE: 1000, FC: t }, {}), 1);
  near(fc, 40000, 1e-6);
  const dol = F.solveFor((t) => F.BEVN_RELATIONS.DOL({ SAL: 1000, VC: 600, FC: 200, DOL: t }), 1);
  near(dol, 2);
});

test('STAT: one-variable, linear, quadratic, exponential', () => {
  const one = F.statistics([1, 2, 3, 4].map((x) => ({ x })), '1-VAR');
  near(one['x̄'], 2.5);
  near(one['xσn'], Math.sqrt(1.25));
  near(one['xσn-1'], Math.sqrt(5 / 3));
  // Large values close together keep their spread.
  const big = F.statistics([{ x: 1e9 }, { x: 1e9 + 1 }], '1-VAR');
  near(big['xσn'], 0.5, 1e-9);
  near(big['xσn-1'], Math.SQRT1_2, 1e-9);
  const freq = F.statistics([{ x: 1, f: 3 }, { x: 5, f: 1 }], '1-VAR');
  near(freq['x̄'], 2);
  const lin = F.statistics([{ x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 }], 'A+BX');
  near(lin.regA, 1);
  near(lin.regB, 2);
  near(lin.regR, 1);
  near(F.estimate('xhat', 9, 'A+BX', lin), 4);
  const quad = F.statistics([0, 1, 2, 3].map((x) => ({ x, y: 1 + 2 * x + 3 * x * x })), '_+CX²');
  near(quad.regA, 1, 1e-9);
  near(quad.regB, 2, 1e-9);
  near(quad.regC, 3, 1e-9);
  const exp = F.statistics([0, 1, 2].map((x) => ({ x, y: 2 * Math.exp(0.5 * x) })), 'e^X');
  near(exp.regA, 2, 1e-9);
  near(exp.regB, 0.5, 1e-9);
});
