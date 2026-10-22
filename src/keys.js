// Physical key layout. Each key has a primary action, an optional SHIFT
// function (printed above it in orange) and an optional ALPHA letter (red).

const k = (id, label, action, extra = {}) => ({ id, label, action, ...extra });
const sh = (label, action) => ({ shift: { label, action } });

export const UPPER_LEFT = [
  k('shift', 'SHIFT', 'shift', { cls: 'shift' }),
  k('alpha', 'ALPHA', 'alpha', { cls: 'alpha' }),
  k('solve', 'SOLVE', 'solve', { cls: 'fn' }),
  k('esc', 'ESC', 'esc', { cls: 'fn' }),
];

export const PAD = [
  k('up', '▲', 'up'),
  k('left', '◀', 'left'),
  k('right', '▶', 'right'),
  k('down', '▼', 'down'),
];

export const UPPER_RIGHT = [
  k('setup', 'SETUP', 'setup', { cls: 'fn', ...sh('CLR', 'clr') }),
  k('on', 'ON', 'on', { cls: 'fn' }),
  k('comp', 'COMP', 'mode:COMP', { cls: 'mode wide' }),
];

export const FINANCE = [
  k('smpl', 'SMPL', 'mode:SMPL', { cls: 'mode' }),
  k('cmpd', 'CMPD', 'mode:CMPD', { cls: 'mode' }),
  k('cash', 'CASH', 'mode:CASH', { cls: 'mode' }),
  k('amrt', 'AMRT', 'mode:AMRT', { cls: 'mode' }),
  k('cnvr', 'CNVR', 'mode:CNVR', { cls: 'mode' }),
  k('cost', 'COST', 'mode:COST', { cls: 'mode' }),
  k('days', 'DAYS', 'mode:DAYS', { cls: 'mode' }),
  k('stat', 'STAT', 'mode:STAT', { cls: 'mode' }),
  k('rcl', 'RCL', 'rcl', sh('STO', 'sto')),
  k('mplus', 'M+', 'm+', { ...sh('M−', 'm-'), alpha: 'M' }),
];

export const SCIENTIFIC = [
  k('inv', 'x⁻¹', 'ins:⁻¹', sh('x!', 'ins:!')),
  k('sqrt', '√', 'ins:√(', sh('∛', 'ins:∛(')),
  k('sq', 'x²', 'ins:²', sh('x³', 'ins:³')),
  k('pow', '^', 'ins:^('),
  k('ln', 'ln', 'ins:ln(', sh('eˣ', 'ins:e^(')),
  k('neg', '(−)', 'ins:-', { alpha: 'A' }),
  k('pct', '%', 'ins:%', { alpha: 'B' }),
  k('lp', '(', 'ins:(', { alpha: 'C' }),
  k('rp', ')', 'ins:)', { alpha: 'D' }),
  k('log', 'log', 'ins:log(', sh('10ˣ', 'ins:10^(')),
];

export const NUMPAD = [
  k('7', '7', 'ins:7', { cls: 'num' }),
  k('8', '8', 'ins:8', { cls: 'num' }),
  k('9', '9', 'ins:9', { cls: 'num' }),
  k('del', 'DEL', 'del', { cls: 'red' }),
  k('ac', 'AC', 'ac', { cls: 'red', ...sh('OFF', 'off') }),
  k('4', '4', 'ins:4', { cls: 'num' }),
  k('5', '5', 'ins:5', { cls: 'num' }),
  k('6', '6', 'ins:6', { cls: 'num' }),
  k('mul', '×', 'ins:×', { cls: 'num' }),
  k('div', '÷', 'ins:÷', { cls: 'num' }),
  k('1', '1', 'ins:1', { cls: 'num' }),
  k('2', '2', 'ins:2', { cls: 'num' }),
  k('3', '3', 'ins:3', { cls: 'num' }),
  k('add', '+', 'ins:+', { cls: 'num' }),
  k('sub', '−', 'ins:−', { cls: 'num' }),
  k('0', '0', 'ins:0', { cls: 'num' }),
  k('dot', '.', 'ins:.', { cls: 'num' }),
  k('exp', 'EXP', 'ins:E', { cls: 'num' }),
  k('ans', 'Ans', 'ins:Ans', { cls: 'num' }),
  k('exe', 'EXE', 'exe', { cls: 'num exe' }),
];

export const KEY_MAP = Object.fromEntries(
  [...UPPER_LEFT, ...PAD, ...UPPER_RIGHT, ...FINANCE, ...SCIENTIFIC, ...NUMPAD].map((key) => [
    key.id,
    key,
  ]),
);
