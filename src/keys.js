// Physical key layout of the FC-200V. Each key has a primary action, an
// optional SHIFT function and an optional ALPHA letter, both printed above it.

const k = (id, label, action, extra = {}) => ({ id, label, action, ...extra });
const sh = (label, action) => ({ shift: { label, action } });

// Top block: two keys either side of the REPLAY pad, in two rows.
export const TOP_LEFT = [
  k('shift', 'SHIFT', 'shift', { cls: 'oval', above: 'SHIFT' }),
  k('alpha', 'ALPHA', 'alpha', { cls: 'oval', above: 'ALPHA', aboveCls: 'red' }),
  k('sc1', 'SHORT CUT 1', 'shortcut:1', { cls: 'cut', ...sh('FMEM 1', 'fmem:1') }),
  k('sc2', 'SHORT CUT 2', 'shortcut:2', { cls: 'cut', ...sh('FMEM 2', 'fmem:2') }),
];

export const PAD = [
  k('up', '▲', 'up'),
  k('left', '◀', 'left'),
  k('right', '▶', 'right'),
  k('down', '▼', 'down'),
];

export const TOP_RIGHT = [
  k('setup', 'SETUP', 'setup', { cls: 'oval', above: 'SETUP' }),
  k('on', 'ON', 'on', { cls: 'oval', above: 'ON' }),
  k('esc', 'ESC', 'esc', { cls: 'cut' }),
  k('solve', 'SOLVE', 'solve', { cls: 'solve' }),
];

export const MODE_KEYS = [
  k('smpl', 'SMPL', 'mode:SMPL', { cls: 'mode' }),
  k('cmpd', 'CMPD', 'mode:CMPD', { cls: 'mode' }),
  k('cash', 'CASH', 'mode:CASH', { cls: 'mode' }),
  k('amrt', 'AMRT', 'mode:AMRT', { cls: 'mode' }),
  k('comp', 'COMP', 'mode:COMP', { cls: 'mode' }),
  k('stat', 'STAT', 'mode:STAT', { cls: 'mode', ...sh('S-MENU', 'smenu') }),
  k('cnvr', 'CNVR', 'mode:CNVR', { cls: 'mode', alpha: 'A' }),
  k('cost', 'COST', 'mode:COST', { cls: 'mode', alpha: 'B' }),
  k('days', 'DAYS', 'mode:DAYS', { cls: 'mode', alpha: 'C' }),
  k('depr', 'DEPR', 'mode:DEPR', { cls: 'mode', alpha: 'D' }),
  k('bond', 'BOND', 'mode:BOND', { cls: 'mode' }),
  k('bevn', 'BEVN', 'mode:BEVN', { cls: 'mode' }),
  k('neg', '(−)', 'ins:-'),
  k('rcl', 'RCL', 'rcl', sh('STO', 'sto')),
  k('lp', '(', 'ins:(', sh('%', 'ins:%')),
  k('rp', ')', 'ins:)', { ...sh(',', 'ins:,'), alpha: 'X' }),
  k('ctlg', 'CTLG', 'ctlg', { ...sh('VARS', 'vars'), alpha: 'Y' }),
  k('mplus', 'M+', 'm+', { ...sh('M−', 'm-'), alpha: 'M' }),
];

export const NUMPAD = [
  k('7', '7', 'ins:7', { cls: 'num', ...sh('eˣ', 'ins:e^(') }),
  k('8', '8', 'ins:8', { cls: 'num', ...sh('ln', 'ins:ln(') }),
  k('9', '9', 'ins:9', { cls: 'num', ...sh('CLR', 'clr') }),
  k('del', 'DEL', 'del', { cls: 'red', ...sh('INS', 'insmode') }),
  k('ac', 'AC', 'ac', { cls: 'red', ...sh('OFF', 'off') }),
  k('4', '4', 'ins:4', { cls: 'num', ...sh('x²', 'ins:²') }),
  k('5', '5', 'ins:5', { cls: 'num', ...sh('√', 'ins:√(') }),
  k('6', '6', 'ins:6', { cls: 'num', ...sh('^', 'ins:^(') }),
  k('mul', '×', 'ins:×', { cls: 'num' }),
  k('div', '÷', 'ins:÷', { cls: 'num' }),
  k('1', '1', 'ins:1', { cls: 'num', ...sh('sin', 'ins:sin(') }),
  k('2', '2', 'ins:2', { cls: 'num', ...sh('cos', 'ins:cos(') }),
  k('3', '3', 'ins:3', { cls: 'num', ...sh('tan', 'ins:tan(') }),
  k('add', '+', 'ins:+', { cls: 'num' }),
  k('sub', '−', 'ins:−', { cls: 'num' }),
  k('0', '0', 'ins:0', { cls: 'num', ...sh('Rnd', 'ins:Rnd(') }),
  k('dot', '•', 'ins:.', { cls: 'num', ...sh('Δ%', 'ins:deltaPct') }),
  k('exp', '×10ˣ', 'ins:E', { cls: 'num', ...sh('π', 'ins:π'), alpha: 'e' }),
  k('ans', 'Ans', 'ins:Ans', { cls: 'num', ...sh('DRG▸', 'drg') }),
  k('exe', 'EXE', 'exe', { cls: 'num' }),
];

export const KEY_MAP = Object.fromEntries(
  [...TOP_LEFT, ...PAD, ...TOP_RIGHT, ...MODE_KEYS, ...NUMPAD].map((key) => [key.id, key]),
);
