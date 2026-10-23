import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/math.js';
import { irr } from '../src/finance.js';

const near = (actual, expected, eps = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

test('COMP: Δ% follows FC-200V manual E-30', () => {
  near(evaluate(['4', '6', '−', '4', '0', 'deltaPct']), 15);
  near(evaluate(['3', '0', '0', '+', '5', '0', '0', 'deltaPct']), 160);
  // Keep the previous explicit-comma interface working.
  near(evaluate(['4', '0', ',', '4', '6', 'deltaPct']), 15);
  assert.throws(() => evaluate(['4', '6', '−', '0', 'deltaPct']), /Math ERROR/);
});

test('CASH: IRR is the valid solution nearest to zero', () => {
  // NPV = 100 - 240/(1+r) + 135/(1+r)^2, roots -10% and +50%.
  // The previous asymmetric scan incorrectly returned +50%.
  near(irr([100, -240, 135]), -10);
  near(irr([-1000, 1100]), 10);
  near(irr([-1000, 1000]), 0);
  assert.throws(() => irr([-1000, 100]), /Math ERROR/);
  assert.throws(() => irr([0, 0]), /Math ERROR/);
});
