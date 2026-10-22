import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState, press, render } from '../src/calculator.js';
import { evaluate, formatNumber } from '../src/math.js';

const keys = (state, seq) => {
  for (const k of seq.split(' ')) press(state, k);
  return render(state);
};
const lines = (view) => view.lines.map((l) => l.trimEnd());

test('expression precedence and Casio quirks', () => {
  assert.equal(evaluate(['2', '+', '3', '×', '4']), 14);
  assert.equal(evaluate(['-', '2', '²']), -4);
  assert.equal(evaluate(['2', '(', '3', '+', '1']), 8); // implicit ×, auto-closed )
  assert.equal(evaluate(['1', 'E', '-', '3']), 0.001);
  assert.equal(evaluate(['2', '^(', '1', '0', ')']), 1024);
  assert.throws(() => evaluate(['1', '÷', '0']), /Math ERROR/);
  assert.throws(() => evaluate(['×', '2']), /Syntax ERROR/);
});

test('number formatting', () => {
  assert.equal(formatNumber(1 / 3), '0.3333333333');
  assert.equal(formatNumber(-1199.1010503), '-1199.10105');
  assert.equal(formatNumber(12345678901), '1.23456789E10');
  assert.equal(formatNumber(2.5, 2), '2.50');
});

test('COMP: evaluate, chain with Ans, clear', () => {
  const s = createState();
  let v = keys(s, '2 add 3 mul 4 exe');
  assert.deepEqual(lines(v), ['2+3×4', '', '', '              14']);
  v = keys(s, 'div 2 exe');
  assert.equal(lines(v)[0], 'Ans÷2');
  assert.equal(lines(v)[3].trim(), '7');
  v = keys(s, 'ac');
  assert.deepEqual(v.cursor, { line: 0, col: 0 });
});

test('COMP: errors are shown and dismissed', () => {
  const s = createState();
  let v = keys(s, '1 div 0 exe');
  assert.equal(v.error, 'Math ERROR');
  v = keys(s, 'ac');
  assert.equal(v.error, null);
});

test('STO, RCL and M+', () => {
  const s = createState();
  keys(s, '5 shift rcl neg'); // 5 → A
  assert.equal(s.vars.A, 5);
  const v = keys(s, 'ac rcl neg mul 2 exe');
  assert.equal(lines(v)[3].trim(), '10');
  keys(s, 'mplus mplus');
  assert.equal(s.vars.M, 20);
  assert.ok(render(s).indicators.M);
});

test('CMPD: enter values and SOLVE for PMT', () => {
  const s = createState();
  keys(s, 'cmpd down 3 6 0 exe 6 exe 2 0 0 0 0 0 exe');
  assert.equal(s.vars.n, 360);
  assert.equal(s.vars.PV, 200000);
  const v = keys(s, 'solve'); // cursor is now on PMT
  assert.equal(s.vars.PMT.toFixed(6), '-1199.101050');
  assert.ok(lines(v).some((l) => l.startsWith('PMT=') && l.endsWith('-1199.10105')));
});

test('CMPD: leading minus means negative, Set toggles Begin', () => {
  const s = createState();
  keys(s, 'cmpd exe');
  assert.equal(s.setup.payment, 'Begin');
  assert.ok(render(s).indicators.BGN);
  keys(s, 'down down down sub 5 0 exe');
  assert.equal(s.vars.PV, -50);
});

test('CASH: edit flows and solve NPV / IRR', () => {
  const s = createState();
  keys(s, 'cash 1 0 exe exe sub 1 0 0 0 exe 3 0 0 exe 4 0 0 exe 5 0 0 exe esc');
  assert.deepEqual(s.cash, [-1000, 300, 400, 500]);
  keys(s, 'down solve');
  assert.equal(s.vars.NPV.toFixed(5), '-21.03681');
  keys(s, 'down solve');
  assert.equal(s.vars.IRR.toFixed(3), '8.896');
});

test('DAYS between two dates', () => {
  const s = createState();
  const v = keys(s, 'days down 0 1 0 1 2 0 2 6 exe 1 2 3 1 2 0 2 6 exe solve');
  assert.equal(s.vars.Dys, 364);
  assert.equal(lines(v)[1], 'd1=   01/01/2026');
});

test('COST solves selling price', () => {
  const s = createState();
  keys(s, 'cost 1 0 0 exe down 2 0 exe up solve');
  assert.equal(s.vars.Sel, 125);
});

test('STAT editor and results', () => {
  const s = createState();
  keys(s, 'stat 2 1 exe 3 exe 2 exe 5 exe 3 exe 7 exe solve');
  assert.equal(s.screen, 'statResults');
  assert.equal(s.statResults.B, 2);
  assert.equal(s.statResults.A, 1);
});

test('SETUP Fix changes display and power off/on', () => {
  const s = createState();
  keys(s, 'setup down down down right right esc 1 div 3 exe');
  assert.equal(lines(render(s))[3].trim(), '0.3');
  keys(s, 'shift ac');
  assert.ok(render(s).off);
  keys(s, '5');
  assert.ok(render(s).off);
  keys(s, 'on');
  assert.ok(!render(s).off);
});
