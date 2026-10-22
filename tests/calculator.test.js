import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, press, render } from '../src/calculator.js';
import { evaluate, formatNumber } from '../src/math.js';

const keys = (state, seq) => {
  for (const k of seq.split(' ')) press(state, k);
  return render(state);
};
const lines = (view) => view.lines.map((l) => l.trimEnd());
const result = (state) => lines(render(state))[3].trim();

test('expression engine', () => {
  assert.equal(evaluate(['2', '+', '3', '×', '4']), 14);
  assert.equal(evaluate(['-', '2', '²']), -4);
  assert.equal(evaluate(['2', '(', '3', '+', '1']), 8);
  assert.equal(evaluate(['1', 'E', '-', '3']), 0.001);
  assert.equal(evaluate(['2', '^(', '1', '0', ')']), 1024);
  assert.equal(evaluate(['5', 'nCr', '2']), 10);
  assert.equal(evaluate(['5', 'nPr', '2']), 20);
  assert.equal(evaluate(['1', '6', '0', ',', '2', '0', '0', 'deltaPct']), 25);
  assert.equal(evaluate(['sin(', '3', '0'], { vars: {}, angle: 'Deg' }), 0.5);
  assert.ok(Math.abs(evaluate(['cos(', 'π'], { vars: {}, angle: 'Rad' }) + 1) < 1e-15);
  assert.ok(Math.abs(evaluate(['9', '0', '°'], { vars: {}, angle: 'Rad' }) - Math.PI / 2) < 1e-14);
  assert.throws(() => evaluate(['1', '÷', '0']), /Math ERROR/);
  assert.throws(() => evaluate(['×', '2']), /Syntax ERROR/);
});

test('number formatting (Norm1 default, Fix, Sci, Norm2)', () => {
  assert.equal(formatNumber(1 / 3), '0.3333333333');
  assert.equal(formatNumber(-1199.1010503), '-1199.10105');
  assert.equal(formatNumber(0.005), '5E-3');
  assert.equal(formatNumber(0.005, { type: 'Norm', n: 2 }), '0.005');
  assert.equal(formatNumber(2.5, { type: 'Fix', n: 2 }), '2.50');
  assert.equal(formatNumber(1234.5, { type: 'Sci', n: 3 }), '1.23E3');
});

test('COMP: evaluate, Ans chaining, cursor editing, REPLAY', () => {
  const s = createState();
  let v = keys(s, '2 add 3 mul 4 exe');
  assert.deepEqual(lines(v), ['2+3×4', '', '', '              14']);
  keys(s, 'div 2 exe');
  assert.equal(result(s), '7');
  // Edit the previous line: ◀ goes to the end, ◀◀ then DEL removes "×".
  keys(s, 'ac 1 add 2 mul 3 left del exe'); // cursor after ×, DEL removes it: 1+23
  assert.equal(result(s), '24');
  keys(s, 'up up');
  assert.deepEqual(s.comp.edit.tokens, ['Ans', '÷', '2']);
  keys(s, 'exe');
  assert.equal(result(s), '12');
});

test('INS toggles overwrite', () => {
  const s = createState();
  keys(s, '1 2 3 left left shift del 9 exe');
  assert.equal(result(s), '193');
});

test('SHIFT functions on the number keys', () => {
  const s = createState();
  keys(s, 'shift 1 3 0 exe'); // sin(30
  assert.equal(result(s), '0.5');
  keys(s, '3 shift 4 exe'); // 3²
  assert.equal(result(s), '9');
  keys(s, '1 6 0 shift rp 2 0 0 shift dot exe'); // 160,200Δ%
  assert.equal(result(s), '25');
  keys(s, 'shift exp exe'); // π
  assert.equal(result(s), '3.141592654');
});

test('errors are shown and dismissed', () => {
  const s = createState();
  assert.equal(keys(s, '1 div 0 exe').error, 'Math ERROR');
  assert.equal(keys(s, 'ac').error, null);
});

test('STO, RCL, M+ and VARS', () => {
  const s = createState();
  keys(s, '5 shift rcl cnvr'); // 5 → A
  assert.equal(s.vars.A, 5);
  keys(s, 'ac rcl cnvr mul 2 exe');
  assert.equal(result(s), '10');
  keys(s, 'mplus mplus');
  assert.equal(s.vars.M, 20);
  assert.ok(render(s).indicators.M);
});

test('STO menu with confirmation, VARS inserts a financial variable', () => {
  const s = createState();
  keys(s, '7 exe shift rcl down exe'); // STO → B: → confirm
  assert.equal(lines(render(s))[0].trim(), 'Store?');
  keys(s, 'exe');
  assert.equal(s.vars.B, 7);
  s.vars.PV = 250;
  keys(s, 'ac shift ctlg 3 mul 2 exe'); // VARS → 3:PV
  assert.equal(result(s), '500');
});

test('CTLG inserts a function', () => {
  const s = createState();
  keys(s, 'ctlg 1 neg 7 exe'); // Abs(-7
  assert.equal(result(s), '7');
});

test('CMPD: enter values and SOLVE for PMT', () => {
  const s = createState();
  keys(s, 'cmpd down down down down down down 1 2 exe 1 2 exe'); // P/Y, C/Y = 12
  keys(s, 'up up up up up up 3 6 0 exe 6 exe 2 0 0 0 0 0 exe');
  const v = keys(s, 'solve');
  assert.equal(s.vars.PMT.toFixed(6), '-1199.101050');
  assert.ok(lines(v).some((l) => l.startsWith('PMT=') && l.endsWith('-1199.10105')));
  assert.ok(v.indicators.Disp);
});

test('CASH: edit flows and solve NPV / IRR', () => {
  const s = createState();
  keys(s, 'cash 1 0 exe exe sub 1 0 0 0 exe 3 0 0 exe 4 0 0 exe 5 0 0 exe esc');
  assert.deepEqual(s.cash, [-1000, 300, 400, 500]);
  const v = keys(s, 'down solve');
  assert.equal(s.vars.NPV.toFixed(5), '-21.03681');
  assert.equal(s.screen, 'result'); // EXE returns to the input screen
  assert.equal(lines(v)[0], 'NPV=-21.03681443');
  keys(s, 'exe down solve exe');
  assert.equal(s.vars.IRR.toFixed(3), '8.896');
  // IRR is stored in I% too, so NPV at that rate is zero.
  assert.equal(s.vars['I%'], s.vars.IRR);
  keys(s, 'up solve');
  assert.ok(Math.abs(s.vars.NPV) < 1e-9);
});

test('DAYS between two dates', () => {
  const s = createState();
  const v = keys(s, 'days down 0 1 0 1 2 0 2 6 exe 1 2 3 1 2 0 2 6 exe solve');
  assert.equal(s.vars.Dys, 364);
  assert.equal(lines(v)[1], 'd1=   01/01/2026');
});

test('DEPR shows RDV after solving', () => {
  const s = createState();
  const v = keys(s, 'depr 6 exe exe 1 5 0 0 0 0 0 exe exe exe exe solve');
  assert.equal(s.vars.SL, 250000);
  assert.deepEqual(lines(v).slice(0, 2), ['SL=       250000', 'RDV=     1250000']);
});

test('BOND: price in Term mode', () => {
  const s = createState();
  keys(s, 'setup down down down down exe 2 esc'); // Bond Date → 2:Term
  const v = keys(s, 'bond down 1 0 exe exe 5 exe down 5 exe up solve');
  assert.ok(Math.abs(s.vars.PRC + 100) < 1e-9);
  assert.deepEqual(lines(v).map((l) => l.split('=')[0]).slice(0, 3), ['PRC', 'INT', 'CST']);
});

test('BEVN: choose sub-mode, solve QBE', () => {
  const s = createState();
  keys(s, 'bevn 1 down 1 0 0 exe 6 0 exe 4 0 0 0 0 exe exe solve');
  assert.equal(s.vars.bQBE, 1000);
  keys(s, 'bevn 3'); // DOL
  assert.deepEqual(lines(render(s))[0], 'SAL=           0');
});

test('STAT: data, S-MENU statistics and regression', () => {
  const s = createState();
  keys(s, 'stat 2 1 exe 2 exe 3 exe right up up up 3 exe 5 exe 7 exe');
  assert.deepEqual(s.stat.data.map((r) => [r.x, r.y]), [[1, 3], [2, 5], [3, 7]]);
  keys(s, 'shift stat 5 2 exe'); // Var → x̄
  assert.equal(result(s), '2');
  keys(s, 'ac 4 shift stat 6 5 exe'); // 4ŷ
  assert.equal(result(s), '9');
});

test('COST solves the selling price', () => {
  const s = createState();
  keys(s, 'cost 1 0 0 exe down 2 0 exe up solve');
  assert.equal(s.vars.SEL, 125);
});

test('SHORTCUT stores a mode screen, FMEM stores a function', () => {
  const s = createState();
  keys(s, 'cmpd down 4 8 exe up shift rcl 8 exe'); // STO → Shortcut1
  keys(s, 'comp sc1');
  assert.equal(s.mode, 'CMPD');
  assert.equal(s.cursor, 1);
  assert.equal(s.vars.n, 48);
  // FMEM: pick Abs( from CTLG, store it, recall it with SHIFT SHORT CUT 1.
  keys(s, 'comp ctlg 1 shift rcl down down down down down down down down down exe exe');
  assert.equal(s.fmem[1], 'Abs(');
  keys(s, 'ac shift sc1 neg 4 exe');
  assert.equal(result(s), '4');
});

test('CLR clears memory; SETUP Fix; power off/on', () => {
  const s = createState();
  keys(s, '5 shift rcl cnvr shift 9 2 exe ac');
  assert.equal(s.vars.A, 0);
  keys(s, 'setup down down down down down down down down down down exe 0 esc 1 div 3 exe');
  assert.equal(s.setup.display, 'Fix0');
  assert.equal(result(s), '0');
  keys(s, 'shift ac');
  assert.ok(render(s).off);
  keys(s, '5 on');
  assert.ok(!render(s).off);
});

test('SETUP choices are numbered like the real unit', () => {
  const s = createState();
  keys(s, 'setup exe 1'); // Payment → 1:Begin
  assert.equal(s.setup.payment, 'Begin');
  assert.equal(s.screen, 'setup');
  keys(s, 'down exe 1'); // Date Mode → 1:360
  assert.equal(s.setup.dateMode, '360');
  keys(s, 'down down down down down down down down down exe 2 esc'); // Fix → 2
  assert.equal(s.setup.display, 'Fix2');
  // The Set row opens the settings for this mode only: Payment and dn.
  keys(s, 'cmpd exe');
  assert.deepEqual(s.setupItems.map((i) => i.label), ['Payment', 'dn']);
  keys(s, 'exe 2 esc');
  assert.equal(s.setup.payment, 'End');
  assert.equal(s.screen, 'main');
});

test('SMPL ALL:Solve shows SI and SFV', () => {
  const s = createState();
  const v = keys(s, 'smpl down 1 2 0 exe 5 exe 1 0 0 0 0 exe down down solve');
  assert.equal(lines(v)[0], 'SI= -164.3835616');
  assert.equal(lines(v)[1], 'SFV=-10164.38356');
  assert.equal(s.vars.Ans, s.vars.SI);
});
