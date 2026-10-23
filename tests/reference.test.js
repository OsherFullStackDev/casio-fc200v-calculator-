// Compares the formulas with values computed independently of this code:
// numpy-financial (TVM, NPV, IRR), Python's calendar (DAYS), a 50-digit loan
// simulation (AMRT) and the manual's formulas rewritten in Python (the rest).
// Regenerate with tools/make_reference.py and tools/make_amrt_reference.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as F from '../src/finance.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/reference.json', import.meta.url)));
const date = ([y, m, d]) => ({ y, m, d });

function run(c) {
  switch (c.kind) {
    case 'tvm': return [[`CMPD ${c.target}`, F.solveTVM(c.target, c.v), c.expect]];
    case 'npv': return [['NPV', F.npv(c.i, c.flows), c.expect]];
    case 'nfv': return [['NFV', F.nfv(c.i, c.flows), c.expect]];
    case 'irr': return [['IRR', F.irr(c.flows), c.expect]];
    case 'days': return [['DAYS', F.daysBetween(date(c.d1), date(c.d2), 365), c.expect]];
    case 'smpl': {
      const r = F.simpleInterest(c.v);
      return [['SI', r.SI, c.expect.SI], ['SFV', r.SFV, c.expect.SFV]];
    }
    case 'cnvr': return [['EFF', F.toEffective(c.n, c.apr), c.eff], ['APR', F.toNominal(c.n, c.eff), c.apr]];
    case 'cost': return ['CST', 'SEL', 'MRG'].map((k) => [k, F.solveCost(k, c), c[k]]);
    case 'depr': {
      const r = F.depreciation(c.m, c.v);
      return [[c.m, r.dep, c.expect.dep], [`${c.m} RDV`, r.RDV, c.expect.RDV]];
    }
    case 'bondterm':
      return [['PRC', F.bondPrice(c.v).PRC, c.expect], ['YLD', F.bondYield({ ...c.v, PRC: c.expect }), c.v.YLD]];
    case 'amrt': {
      // Measured against the loan size: 1e-9 of PV is far below a cent.
      const r = F.amortize(c.v);
      return Object.keys(c.expect).map((k) => [`AMRT ${k}`, r[k] / c.v.PV, c.expect[k] / c.v.PV]);
    }
  }
  throw new Error(`unknown case ${c.kind}`);
}

test(`matches ${cases.length} independently computed values`, () => {
  const bad = [];
  for (const c of cases) {
    for (const [name, got, want] of run(c)) {
      if (!(Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)))) bad.push({ name, got, want });
    }
  }
  assert.deepEqual(bad.slice(0, 5), []);
});
