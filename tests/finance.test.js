import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../src/finance.js';

const near = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} ≉ ${expected}`);

const loan = { n: 360, iPct: 6, PV: 200000, PMT: -1199.101050, FV: 0, PY: 12, CY: 12, begin: false };

test('CMPD solves each TVM variable from the others', () => {
  near(F.solveTVM('PMT', loan), -1199.101050, 1e-6);
  near(F.solveTVM('n', loan), 360, 1e-4);
  near(F.solveTVM('I%', loan), 6, 1e-6);
  near(F.solveTVM('PV', loan), 200000, 1e-2);
  near(F.solveTVM('FV', loan), 0, 1e-2);
});

test('CMPD lump sum growth and zero interest', () => {
  const v = { n: 10, iPct: 5, PV: -1000, PMT: 0, FV: 0, PY: 1, CY: 1, begin: false };
  near(F.solveTVM('FV', v), 1628.894627, 1e-6);
  near(F.solveTVM('PMT', { ...v, iPct: 0, PV: 1200 }), -120);
});

test('CMPD annuity due and differing P/Y, C/Y', () => {
  const v = { n: 12, iPct: 12, PV: 0, PMT: -100, FV: 0, PY: 12, CY: 12, begin: true };
  near(F.solveTVM('FV', v), 1280.932804, 1e-6);
  // Monthly payments, interest compounded semi-annually.
  near(F.periodRate(6, 12, 2), 1.03 ** (1 / 6) - 1, 1e-15);
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
  const v = { ...loan, PM1: 1, PM2: 12 };
  const r = F.amortize(v);
  near(r.INT, -1000, 1e-9);
  near(r.PRN, -199.10105, 1e-9);
  near(r.BAL, -F.solveTVM('FV', { ...loan, n: 12 }), 1e-6);
  near(r.ΣINT + r.ΣPRN, 12 * loan.PMT, 1e-6);
});

test('CNVR nominal ↔ effective', () => {
  near(F.toEffective(12, 12), 12.68250301, 1e-8);
  near(F.toNominal(12, 12.68250301), 12, 1e-7);
});

test('COST', () => {
  near(F.solveCost('Sel', { Cst: 100, Mrg: 20 }), 125);
  near(F.solveCost('Mrg', { Cst: 100, Sel: 125 }), 20);
  near(F.solveCost('Cst', { Sel: 125, Mrg: 20 }), 100);
});

test('DAYS', () => {
  const d1 = F.parseDate(1012026, 'MDY');
  const d2 = F.parseDate(12312026, 'MDY');
  assert.equal(F.daysBetween(d1, d2, 365), 364);
  assert.equal(F.daysBetween(d1, d2, 360), 360);
  assert.equal(F.encodeDate(F.addDays(d1, 364), 'MDY'), 12312026);
  assert.deepEqual(F.parseDate(31122026, 'DMY'), { y: 2026, m: 12, d: 31 });
  assert.throws(() => F.parseDate(2302026, 'MDY')); // Feb 30
});

test('STAT one- and two-variable', () => {
  const one = F.statistics([1, 2, 3, 4].map((x) => ({ x })), false);
  near(one['x̄'], 2.5);
  near(one['σx'], Math.sqrt(1.25));
  near(one.sx, Math.sqrt(5 / 3));
  const two = F.statistics([{ x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 }], true);
  near(two.A, 1);
  near(two.B, 2);
  near(two.r, 1);
});
