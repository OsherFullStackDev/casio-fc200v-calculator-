// The calculator as a state machine: press(state, keyId) mutates the state,
// render(state) turns it into the 4×16 display. No DOM access here, so the
// whole behaviour is testable in Node.

import {
  evaluate, fitNumber, roundToDisplay, tokensText, clean, CalcError, mathError, DEFAULT_DISP,
} from './math.js';
import * as F from './finance.js';
import { KEY_MAP } from './keys.js';

export const W = 16; // display columns
export const H = 4; // display lines

const segmenter = new Intl.Segmenter();
const chars = (s) => [...segmenter.segment(s)].map((g) => g.segment);
const len = (s) => chars(s).length;
const padL = (s, w) => ' '.repeat(Math.max(0, w - len(s))) + s;
const padR = (s, w) => s + ' '.repeat(Math.max(0, w - len(s)));

// ---------- SETUP ----------
const DISPLAY_OPTIONS = [
  'Norm1', 'Norm2',
  ...Array.from({ length: 10 }, (_, i) => `Fix${i}`),
  ...Array.from({ length: 10 }, (_, i) => `Sci${i}`),
];

export const SETUP_ITEMS = [
  { key: 'payment', label: 'Payment', options: ['End', 'Begin'] },
  { key: 'dateMode', label: 'Date Mode', options: ['365', '360'] },
  { key: 'odd', label: 'dn', options: ['CI', 'SI'] },
  { key: 'periods', label: 'Periods/Y', options: ['Annu', 'Semi'] },
  { key: 'bondDate', label: 'Bond Date', options: ['Date', 'Term'] },
  { key: 'dateInput', label: 'Date Input', options: ['MDY', 'DMY'] },
  { key: 'prfRatio', label: 'PRF/Ratio', options: ['PRF', 'r'] },
  { key: 'bEven', label: 'B-Even', options: ['Quantity', 'Sales'] },
  { key: 'angle', label: 'Angle', options: ['Deg', 'Rad', 'Gra'] },
  { key: 'display', label: 'Display', options: DISPLAY_OPTIONS },
  { key: 'statFreq', label: 'STAT', options: ['Off', 'On'] },
  { key: 'sep', label: 'Digit Sep.', options: ['Off', 'On'] },
  { key: 'contrast', label: 'Contrast', options: ['-3', '-2', '-1', '0', '1', '2', '3'] },
];

const DEFAULT_SETUP = Object.fromEntries(SETUP_ITEMS.map((s) => [s.key, s.options[0]]));
DEFAULT_SETUP.contrast = '0';

export function dispOf(setup) {
  const m = /^(Norm|Fix|Sci)(\d)$/.exec(setup.display);
  return m ? { type: m[1], n: Number(m[2]) } : DEFAULT_DISP;
}

// ---------- mode definitions ----------
const set = (setting) => ({ k: 'Set', type: 'set', setting });
const inp = (k, label, extra) => ({ k, label: label ?? k, type: 'in', ...extra });
const both = (k, label, extra) => ({ k, label: label ?? k, type: 'both', ...extra });
const out = (k, label) => ({ k, label: label ?? k, type: 'out' });
const res = (k, label) => ({ k, label: label ?? k, type: 'res' }); // shown after a solve

const BEVN_SUBS = ['BEVN', 'MOS', 'DOL', 'DFL', 'DCL', 'CONV'];

export function itemsFor(state) {
  const s = state.setup;
  switch (state.mode) {
    case 'SMPL':
      return [set('dateMode'), inp('Dys'), inp('I%'), inp('PV'), out('SI'), out('SFV')];
    case 'CMPD':
      return [set('payment'), both('n'), both('I%'), both('PV'), both('PMT'), both('FV'), inp('P/Y'), inp('C/Y')];
    case 'CASH':
      return [inp('I%'), { k: 'Csh', type: 'editor' }, out('NPV'), out('IRR'), out('PBP'), out('NFV')];
    case 'AMRT':
      return [
        set('payment'), inp('PM1'), inp('PM2'), inp('n'), inp('I%'), inp('PV'), inp('PMT'), inp('FV'),
        inp('P/Y'), inp('C/Y'), out('BAL'), out('INT'), out('PRN'), out('ΣINT'), out('ΣPRN'),
      ];
    case 'CNVR':
      return [inp('cn', 'n'), inp('I%'), out('EFF'), out('APR')];
    case 'COST':
      return [both('Cst'), both('Sel'), both('Mrg')];
    case 'DAYS':
      return [set('dateMode'), both('d1', 'd1', { date: true }), both('d2', 'd2', { date: true }), both('Dys')];
    case 'DEPR':
      return [
        inp('Dn', 'n'), inp('DI%', 'I%'), inp('DPV', 'PV'), inp('DFV', 'FV'), inp('j'), inp('YR1'),
        out('SL'), out('FP'), out('SYD'), out('DB'), res('dRDV', 'RDV'),
      ];
    case 'BOND':
      return [
        set('periods'),
        ...(s.bondDate === 'Date'
          ? [inp('bd1', 'd1', { date: true }), inp('bd2', 'd2', { date: true })]
          : [inp('Bn', 'n')]),
        inp('bRDV', 'RDV'), inp('CPN'), both('PRC'), both('YLD'), res('bINT', 'INT'), res('CST'),
      ];
    case 'BEVN':
      return bevnItems(state);
  }
  return [];
}

function bevnItems(state) {
  const s = state.setup;
  const b = (label) => both(`b${label}`, label);
  switch (state.bevnSub) {
    case 'BEVN':
      return [
        b('PRC'), b('VCU'), b('FC'), s.prfRatio === 'PRF' ? b('PRF') : b('r%'),
        s.bEven === 'Quantity' ? b('QBE') : b('SBE'),
      ];
    case 'MOS':
      return [b('SAL'), b('SBE'), b('MOS')];
    case 'DOL':
      return [b('SAL'), b('VC'), b('FC'), b('DOL')];
    case 'DFL':
      return [b('EBIT'), b('ITR'), b('DFL')];
    case 'DCL':
      return [b('SAL'), b('VC'), b('FC'), b('ITR'), b('DCL')];
    case 'CONV':
      return [b('QTY'), b('SAL'), b('PRC'), b('VC'), b('VCU')];
  }
  return [];
}

const DEFAULT_VARS = {
  n: 0, 'I%': 0, PV: 0, PMT: 0, FV: 0, 'P/Y': 12, 'C/Y': 12,
  Dys: 0, PM1: 1, PM2: 1, cn: 0, Cst: 0, Sel: 0, Mrg: 0,
  d1: 1012026, d2: 1012026,
  Dn: 0, 'DI%': 0, DPV: 0, DFV: 0, j: 1, YR1: 12,
  bd1: 1012026, bd2: 1012027, Bn: 0, bRDV: 100, CPN: 0, PRC: 0, YLD: 0,
  bPRC: 0, bVCU: 0, bFC: 0, bPRF: 0, 'br%': 0, bQBE: 0, bSBE: 0, bSAL: 0, bMOS: 0,
  bVC: 0, bDOL: 0, bEBIT: 0, bITR: 0, bDFL: 0, bDCL: 0, bQTY: 0,
  A: 0, B: 0, C: 0, D: 0, X: 0, Y: 0, M: 0, Ans: 0,
};

const MEMORY_VARS = ['A', 'B', 'C', 'D', 'X', 'Y', 'M'];
const BINARY_OR_POSTFIX = new Set([
  '+', '−', '×', '÷', '^(', '²', '³', '⁻¹', '!', '%', '°', 'ʳ', 'ᵍ', 'nPr', 'nCr',
  'xhat', 'xhat1', 'xhat2', 'yhat',
]);

// ---------- state ----------
const emptyCalc = () => ({ edit: { tokens: [], pos: 0 }, resultShown: false, history: [], hist: -1 });

export function createState(saved = {}) {
  const modes = ['COMP', 'STAT', 'SMPL', 'CMPD', 'CASH', 'AMRT', 'CNVR', 'COST', 'DAYS', 'DEPR', 'BOND', 'BEVN'];
  const mode = modes.includes(saved.mode) ? saved.mode : 'COMP';
  const state = {
    off: false,
    mode,
    bevnSub: BEVN_SUBS.includes(saved.bevnSub) ? saved.bevnSub : 'BEVN',
    screen: 'main',
    shift: false,
    alpha: false,
    pending: null, // 'STO' | 'RCL'
    error: null,
    message: null,
    overwrite: false,
    setup: { ...DEFAULT_SETUP, ...saved.setup },
    vars: { ...DEFAULT_VARS, ...saved.vars },
    solved: [],
    disp: false,
    cursor: 0,
    top: 0,
    edit: null, // field being typed in a list screen
    comp: emptyCalc(),
    cash: Array.isArray(saved.cash) ? saved.cash.slice() : [],
    cashRow: 0,
    cashTop: 0,
    stat: {
      type: F.REG_TYPES.includes(saved.stat?.type) ? saved.stat.type : '1-VAR',
      data: Array.isArray(saved.stat?.data) ? saved.stat.data.map((r) => ({ y: 0, f: 1, ...r })) : [],
      row: 0,
      col: 0,
      top: 0,
    },
    fmem: { 1: null, 2: null, ...saved.fmem },
    stack: [], // screens to return to from menus
  };
  if (mode === 'STAT') state.screen = 'statEditor';
  return state;
}

export function snapshot(state) {
  return {
    mode: state.mode,
    bevnSub: state.bevnSub,
    setup: state.setup,
    vars: state.vars,
    cash: state.cash,
    stat: { type: state.stat.type, data: state.stat.data },
    fmem: state.fmem,
  };
}

// ---------- key handling ----------
export function press(state, id) {
  const key = KEY_MAP[id];
  if (!key) return state;

  if (state.off) {
    if (key.action === 'on') {
      state.off = false;
      clearDisplay(state);
    }
    return state;
  }

  if (state.pending) {
    const op = state.pending;
    state.pending = null;
    if (key.alpha && MEMORY_VARS.includes(key.alpha)) {
      state.shift = state.alpha = false;
      memoryOp(state, op, key.alpha);
      return state;
    }
  }

  let action = key.action;
  if (state.alpha && key.alpha) action = `ins:${key.alpha}`;
  else if (state.shift && key.shift) action = key.shift.action;
  runAction(state, action);
  return state;
}

function runAction(state, action) {
  if (action === 'shift') {
    state.shift = !state.shift;
    state.alpha = false;
    return;
  }
  if (action === 'alpha') {
    state.alpha = !state.alpha;
    state.shift = false;
    return;
  }
  state.shift = state.alpha = false;

  if (state.message) {
    // Any key dismisses a message screen.
    state.message = null;
    if (action !== 'off' && !action.startsWith('mode:')) return;
  }
  if (action === 'off') {
    state.off = true;
    return;
  }
  if (action.startsWith('mode:')) {
    switchMode(state, action.slice(5));
    return;
  }
  if (state.error) {
    if (['ac', 'on', 'esc', 'left', 'right', 'del', 'exe'].includes(action)) state.error = null;
    return;
  }
  if (action === 'on') {
    clearDisplay(state);
    return;
  }

  switch (action) {
    case 'setup':
      if (state.screen !== 'setup') openScreen(state, 'setup');
      state.setupCursor = 0;
      state.setupTop = 0;
      return;
    case 'clr':
      openMenu(state, [
        { text: '1:Setup', run: () => confirm(state, 'Clear Setup?', () => clearSetup(state), 'Clear Setup!') },
        { text: '2:Memory', run: () => confirm(state, 'Clear Memory?', () => clearMemory(state), 'Clear Memory!') },
        { text: '3:All', run: () => confirm(state, 'Clear All?', () => { clearSetup(state); clearMemory(state); }, 'Clear All!') },
      ], 'Clear?');
      return;
    case 'sto':
    case 'rcl':
      state.pending = action.toUpperCase();
      return;
    case 'm+':
    case 'm-': {
      const v = currentValue(state);
      if (v !== null) state.vars.M += action === 'm+' ? v : -v;
      return;
    }
    case 'insmode':
      state.overwrite = !state.overwrite;
      return;
    case 'ctlg':
      openMenu(state, CATALOG.map(([text, token], i) => ({
        text: `${i + 1}:${text}`,
        run: () => runAction(state, `ins:${token}`),
      })), null, true);
      return;
    case 'vars':
      openScreen(state, 'vars');
      state.varsCursor = 0;
      state.varsTop = 0;
      return;
    case 'drg':
      openMenu(state, [
        { text: '1:°', run: () => runAction(state, 'ins:°') },
        { text: '2:r', run: () => runAction(state, 'ins:ʳ') },
        { text: '3:g', run: () => runAction(state, 'ins:ᵍ') },
      ], null, true);
      return;
    case 'smenu':
      if (state.mode === 'STAT' && ['statEditor', 'statCalc'].includes(state.screen)) openStatMenu(state);
      return;
  }
  if (action.startsWith('fmem:')) {
    const slot = action.slice(5);
    state.fmem[slot] = {
      mode: state.mode,
      bevnSub: state.bevnSub,
      cursor: state.cursor,
      tokens: state.mode === 'COMP' && state.comp.edit.tokens.length ? [...state.comp.edit.tokens] : null,
    };
    state.message = `FMEM${slot} Stored`;
    return;
  }
  if (action.startsWith('shortcut:')) {
    const f = state.fmem[action.slice(9)];
    if (!f) return;
    switchMode(state, f.mode, f.bevnSub);
    if (state.screen === 'main' && state.mode !== 'COMP') {
      state.cursor = Math.min(f.cursor, itemsFor(state).length - 1);
      scrollTo(state, 'top', state.cursor);
    }
    if (f.tokens) state.comp.edit = { tokens: [...f.tokens], pos: f.tokens.length };
    return;
  }

  const handler = {
    main: state.mode === 'COMP' ? calcKey : listKey,
    setup: setupKey,
    menu: menuKey,
    confirm: confirmKey,
    vars: varsKey,
    cashEditor: cashKey,
    statEditor: statEditorKey,
    statCalc: calcKey,
  }[state.screen];
  handler(state, action);
}

const CATALOG = [
  ['Abs(', 'Abs('], ['Int(', 'Int('], ['Intg(', 'Intg('], ['Frac(', 'Frac('],
  ['x⁻¹', '⁻¹'], ['x!', '!'], ['x³', '³'], ['∛(', '∛('], ['log(', 'log('], ['10^(', '10^('],
  ['sin⁻¹(', 'sin⁻¹('], ['cos⁻¹(', 'cos⁻¹('], ['tan⁻¹(', 'tan⁻¹('], ['nPr', 'nPr'], ['nCr', 'nCr'],
];

function fail(state, e) {
  state.error = e instanceof CalcError ? e.kind : 'Math ERROR';
}

function ctx(state) {
  const disp = dispOf(state.setup);
  return {
    vars: state.vars,
    angle: state.setup.angle,
    round: (x) => roundToDisplay(x, disp),
    stat: (name, arg) => statValue(state, name, arg),
  };
}

function statValue(state, name, arg) {
  if (state.mode !== 'STAT') throw mathError();
  const { type, data } = state.stat;
  const s = F.statistics(data, type);
  if (arg !== undefined) {
    if (type === '1-VAR') throw mathError();
    return F.estimate(name, arg, type, s);
  }
  const v = s[name];
  if (v === undefined || !Number.isFinite(v)) throw mathError();
  return v;
}

function clearDisplay(state) {
  state.error = null;
  state.edit = null;
  state.pending = null;
  state.message = null;
  if (state.screen === 'main' && state.mode === 'COMP') {
    state.comp.edit = { tokens: [], pos: 0 };
    state.comp.resultShown = false;
  }
}

function switchMode(state, mode, bevnSub) {
  state.mode = mode;
  state.screen = 'main';
  state.stack = [];
  state.cursor = 0;
  state.top = 0;
  state.edit = null;
  state.error = null;
  state.pending = null;
  state.message = null;
  state.solved = [];
  state.disp = false;
  if (mode === 'COMP') {
    state.comp.edit = { tokens: [], pos: 0 };
    state.comp.resultShown = false;
  }
  if (mode === 'STAT') {
    state.screen = 'statEditor'; // where ESC from the type menu returns to
    openMenu(state, F.REG_TYPES.map((t, i) => ({
      text: `${i + 1}:${t}`,
      run: () => {
        state.stat.type = t;
        state.stat.col = 0;
        state.screen = 'statEditor';
        state.stack = [];
      },
    })), null);
    state.menu.cursor = F.REG_TYPES.indexOf(state.stat.type);
    scrollTo(state.menu, 'top', state.menu.cursor);
  }
  if (mode === 'BEVN') {
    if (bevnSub) state.bevnSub = bevnSub;
    else {
      openMenu(state, BEVN_SUBS.map((s, i) => ({
        text: `${i + 1}:${s === 'CONV' ? 'QUANTITY CNV' : s}`,
        run: () => {
          state.bevnSub = s;
          state.screen = 'main';
          state.stack = [];
          state.cursor = 0;
          state.top = 0;
        },
      })), null);
      state.menu.cursor = BEVN_SUBS.indexOf(state.bevnSub);
      scrollTo(state.menu, 'top', state.menu.cursor);
    }
  }
}

function openScreen(state, screen) {
  state.stack.push(state.screen);
  state.screen = screen;
}

function back(state) {
  state.screen = state.stack.pop() ?? 'main';
}

// A numbered menu. `insertBack` menus return to the previous screen before
// running the choice, so an inserted token lands where the user was typing.
function openMenu(state, items, title, insertBack = false) {
  openScreen(state, 'menu');
  state.menu = { items, title, cursor: 0, top: 0, insertBack };
}

function confirm(state, text, run, done) {
  state.screen = 'confirm';
  state.confirm = { text, run, done };
}

function clearSetup(state) {
  state.setup = { ...DEFAULT_SETUP };
}

function clearMemory(state) {
  state.vars = { ...DEFAULT_VARS };
  state.cash = [];
  state.stat.data = [];
  state.fmem = { 1: null, 2: null };
  state.solved = [];
}

// Value that STO / M+ act on: the evaluated calculation line, the selected field, or Ans.
function currentValue(state) {
  try {
    if (isCalcScreen(state)) {
      const c = state.comp;
      if (c.edit.tokens.length && !c.resultShown) execute(state);
      return state.error ? null : state.vars.Ans;
    }
    if (state.screen === 'main') {
      const item = itemsFor(state)[state.cursor];
      if (state.edit?.tokens.length) commitInput(state, item);
      const v = state.vars[item.k];
      const shown = item.type === 'in' || item.type === 'both' || state.solved.includes(item.k);
      if (typeof v === 'number' && !item.date && shown) return v;
    }
    return state.vars.Ans;
  } catch (e) {
    fail(state, e);
    return null;
  }
}

function memoryOp(state, op, letter) {
  if (op === 'RCL') {
    runAction(state, `ins:${letter}`);
    return;
  }
  const v = currentValue(state);
  if (v !== null) state.vars[letter] = v;
}

const isCalcScreen = (state) =>
  (state.screen === 'main' && state.mode === 'COMP') || state.screen === 'statCalc';

// ---------- line editing (shared by every input) ----------
function insertToken(state, edit, t) {
  if (!edit.tokens.length && t === '−') t = '-'; // a leading minus means negative
  if (state.overwrite && edit.pos < edit.tokens.length) edit.tokens[edit.pos] = t;
  else edit.tokens.splice(edit.pos, 0, t);
  edit.pos++;
}

function deleteToken(edit) {
  if (edit.pos > 0) {
    edit.tokens.splice(edit.pos - 1, 1);
    edit.pos--;
  } else edit.tokens.splice(0, 1);
}

function moveInEdit(edit, d) {
  edit.pos = Math.max(0, Math.min(edit.tokens.length, edit.pos + d));
}

// ---------- COMP and the STAT calculation screen ----------
function execute(state) {
  const c = state.comp;
  try {
    state.vars.Ans = evaluate(c.edit.tokens, ctx(state));
    c.resultShown = true;
    const last = c.history[c.history.length - 1];
    if (!last || last.join('\u0000') !== c.edit.tokens.join('\u0000')) {
      c.history.push([...c.edit.tokens]);
      if (c.history.length > 30) c.history.shift();
    }
    c.hist = -1;
  } catch (e) {
    fail(state, e);
    c.edit.pos = c.edit.tokens.length;
  }
}

function calcKey(state, action) {
  const c = state.comp;
  if (action.startsWith('ins:')) {
    const t = action.slice(4);
    if (c.resultShown) {
      c.edit = BINARY_OR_POSTFIX.has(t) ? { tokens: ['Ans'], pos: 1 } : { tokens: [], pos: 0 };
      c.resultShown = false;
    }
    insertToken(state, c.edit, t);
    return;
  }
  switch (action) {
    case 'exe':
      if (c.edit.tokens.length) execute(state);
      return;
    case 'del':
      if (c.resultShown) {
        c.resultShown = false;
        c.edit.pos = c.edit.tokens.length;
      } else deleteToken(c.edit);
      return;
    case 'ac':
      c.edit = { tokens: [], pos: 0 };
      c.resultShown = false;
      c.hist = -1;
      return;
    case 'esc':
      if (state.screen === 'statCalc') state.screen = 'statEditor';
      return;
    case 'left':
    case 'right':
      if (c.resultShown) {
        c.resultShown = false;
        c.edit.pos = action === 'left' ? c.edit.tokens.length : 0;
      } else moveInEdit(c.edit, action === 'left' ? -1 : 1);
      return;
    case 'up':
    case 'down': {
      // REPLAY: step through earlier calculations.
      if (!c.history.length) return;
      let h = c.hist === -1 ? c.history.length : c.hist;
      h += action === 'up' ? -1 : 1;
      if (h < 0) h = 0;
      if (h >= c.history.length) {
        c.hist = -1;
        return;
      }
      c.hist = h;
      c.edit = { tokens: [...c.history[h]], pos: c.history[h].length };
      c.resultShown = false;
    }
  }
}

// ---------- list modes ----------
function scrollTo(obj, field, idx, visible = H) {
  obj[field] ??= 0;
  if (idx < obj[field]) obj[field] = idx;
  if (idx >= obj[field] + visible) obj[field] = idx - visible + 1;
}

function moveCursor(state, delta) {
  const items = itemsFor(state);
  let c = state.cursor;
  // Result-only rows (RDV, INT, CST) are not stops for the cursor until solved.
  do c += delta;
  while (c >= 0 && c < items.length && items[c].type === 'res' && !state.solved.includes(items[c].k));
  if (c < 0 || c >= items.length) return;
  state.cursor = c;
  state.disp = false;
  scrollTo(state, 'top', state.cursor);
}

function listKey(state, action) {
  const items = itemsFor(state);
  if (state.cursor >= items.length) state.cursor = 0;
  const item = items[state.cursor];
  const editable = item.type === 'in' || item.type === 'both';

  if (action.startsWith('ins:')) {
    if (!editable) return;
    state.edit ??= { tokens: [], pos: 0 };
    state.disp = false;
    insertToken(state, state.edit, action.slice(4));
    return;
  }
  switch (action) {
    case 'del':
      if (state.edit) deleteToken(state.edit);
      return;
    case 'left':
    case 'right':
      if (state.edit) moveInEdit(state.edit, action === 'left' ? -1 : 1);
      return;
    case 'ac':
      state.edit = null;
      return;
    case 'esc':
      if (state.edit) state.edit = null;
      else if (state.mode === 'BEVN') switchMode(state, 'BEVN');
      return;
    case 'up':
    case 'down':
      state.edit = null;
      moveCursor(state, action === 'up' ? -1 : 1);
      return;
    case 'exe':
      if (state.edit) {
        try {
          commitInput(state, item);
          moveCursor(state, 1);
        } catch (e) {
          fail(state, e);
        }
      } else if (item.type === 'set') {
        openOptions(state, SETUP_ITEMS.find((x) => x.key === item.setting));
      } else if (item.type === 'editor') {
        openScreen(state, 'cashEditor');
        state.cashRow = 0;
        state.cashTop = 0;
      } else if (item.type === 'out') {
        solveItem(state, item);
      } else {
        moveCursor(state, 1);
      }
      return;
    case 'solve':
      state.edit = null;
      if (item.type === 'out' || item.type === 'both') solveItem(state, item);
      return;
  }
}

function commitInput(state, item) {
  const v = evaluate(state.edit.tokens, ctx(state));
  if (item.date) F.parseDate(v, state.setup.dateInput);
  state.vars[item.k] = v;
  state.edit = null;
  state.solved = [];
}

function solveItem(state, item) {
  try {
    const results = compute(state, item.k);
    for (const k of Object.keys(results)) results[k] = clean(results[k]);
    Object.assign(state.vars, results);
    if (!item.date) state.vars.Ans = results[item.k];
    const keys = Object.keys(results);
    state.solved = item.type === 'out' ? [...new Set([...state.solved, ...keys])] : keys.filter((k) => k !== item.k);
    state.disp = true;
  } catch (e) {
    fail(state, e);
  }
}

function tvm(state) {
  const v = state.vars;
  return {
    n: v.n, iPct: v['I%'], PV: v.PV, PMT: v.PMT, FV: v.FV, PY: v['P/Y'], CY: v['C/Y'],
    begin: state.setup.payment === 'Begin', odd: state.setup.odd,
  };
}

// Returns { key: value } for the solved variable plus any companion results.
export function compute(state, key) {
  const v = state.vars;
  const s = state.setup;
  const dn = Number(s.dateMode);
  switch (state.mode) {
    case 'SMPL':
      return { [key]: F.simpleInterest({ Dys: v.Dys, iPct: v['I%'], PV: v.PV, dn })[key] };
    case 'CMPD':
      return { [key]: F.solveTVM(key, tvm(state)) };
    case 'CASH': {
      if (key === 'IRR') {
        // Like the real unit, the IRR also becomes the current I%.
        const rate = F.irr(state.cash);
        return { IRR: rate, 'I%': rate };
      }
      const fn = { NPV: F.npv, PBP: F.pbp, NFV: F.nfv }[key];
      return { [key]: fn(v['I%'], state.cash) };
    }
    case 'AMRT':
      return { [key]: F.amortize({ ...tvm(state), PM1: v.PM1, PM2: v.PM2 })[key] };
    case 'CNVR':
      return { [key]: key === 'EFF' ? F.toEffective(v.cn, v['I%']) : F.toNominal(v.cn, v['I%']) };
    case 'COST':
      return { [key]: F.solveCost(key, v) };
    case 'DAYS': {
      const di = s.dateInput;
      if (key === 'Dys') return { Dys: F.daysBetween(F.parseDate(v.d1, di), F.parseDate(v.d2, di), dn) };
      if (dn !== 365) throw mathError();
      if (key === 'd1') return { d1: F.encodeDate(F.addDays(F.parseDate(v.d2, di), -v.Dys), di) };
      return { d2: F.encodeDate(F.addDays(F.parseDate(v.d1, di), v.Dys), di) };
    }
    case 'DEPR': {
      const r = F.depreciation(key, { n: v.Dn, iPct: v['DI%'], PV: v.DPV, FV: v.DFV, j: v.j, YR1: v.YR1 });
      return { [key]: r.dep, dRDV: r.RDV };
    }
    case 'BOND': {
      const dateMode = s.bondDate === 'Date';
      const args = {
        dateMode,
        d1: dateMode ? F.parseDate(v.bd1, s.dateInput) : null,
        d2: dateMode ? F.parseDate(v.bd2, s.dateInput) : null,
        n: v.Bn, RDV: v.bRDV, CPN: v.CPN, PRC: v.PRC, YLD: v.YLD,
        M: s.periods === 'Annu' ? 1 : 2, dn,
      };
      const YLD = key === 'YLD' ? F.bondYield(args) : v.YLD;
      const p = F.bondPrice({ ...args, YLD });
      return key === 'YLD' ? { YLD, bINT: p.INT, CST: p.PRC + p.INT } : { PRC: p.PRC, bINT: p.INT, CST: p.CST };
    }
    case 'BEVN':
      return solveBevn(state, key);
  }
  throw mathError();
}

function solveBevn(state, key) {
  const items = bevnItems(state);
  const label = items.find((i) => i.k === key).label;
  const vals = Object.fromEntries(items.map((i) => [i.label, state.vars[i.k]]));
  let rel = state.bevnSub;
  if (rel === 'CONV') {
    rel = ['VC', 'VCU'].includes(label) || (label === 'QTY' && vals.PRC === 0) ? 'QTY:VC' : 'QTY:SAL';
  }
  const opts = { ratio: state.setup.prfRatio === 'r', sales: state.setup.bEven === 'Sales' };
  const fn = F.BEVN_RELATIONS[rel];
  const x = F.solveFor((t) => fn({ ...vals, [label]: t }, opts), vals[label]);
  return { [key]: x };
}

// ---------- SETUP ----------
function cycleSetting(state, item, dir) {
  const opts = item.options;
  const idx = opts.indexOf(state.setup[item.key]);
  applySetting(state, item, opts[(Math.max(0, idx) + dir + opts.length) % opts.length]);
}

function applySetting(state, item, next) {
  if (item.key === 'dateInput') {
    // Keep stored dates meaning the same day after the order changes.
    for (const d of ['d1', 'd2', 'bd1', 'bd2']) {
      try {
        state.vars[d] = F.encodeDate(F.parseDate(state.vars[d], state.setup.dateInput), next);
      } catch {
        /* leave invalid dates as they are */
      }
    }
  }
  state.setup[item.key] = next;
  state.solved = [];
  state.disp = false;
}

function setupKey(state, action) {
  const item = SETUP_ITEMS[state.setupCursor];
  switch (action) {
    case 'up':
    case 'down':
      state.setupCursor = Math.max(0, Math.min(SETUP_ITEMS.length - 1, state.setupCursor + (action === 'up' ? -1 : 1)));
      scrollTo(state, 'setupTop', state.setupCursor);
      return;
    case 'exe':
      openOptions(state, item);
      return;
    case 'right':
      cycleSetting(state, item, 1);
      return;
    case 'left':
      cycleSetting(state, item, -1);
      return;
    case 'esc':
    case 'ac':
      back(state);
  }
}

// The numbered choice list the real unit shows for a setting, e.g.
// "1:Begin 2:End". Display asks Fix/Sci/Norm first, then the digit count.
function openOptions(state, item) {
  if (item.key === 'contrast') return; // adjusted with ◀▶ only
  const origin = state.screen;
  const depth = state.stack.length;
  const done = (value) => () => {
    applySetting(state, item, value);
    state.stack.length = depth;
    state.screen = origin;
  };
  if (item.key === 'display') {
    const digits = (type, from, to) => () =>
      openMenu(
        state,
        Array.from({ length: to - from + 1 }, (_, i) => ({
          text: `${from + i}`,
          digit: from + i,
          run: done(`${type}${from + i}`),
        })),
        `${type} ${from}~${to}?`,
      );
    openMenu(state, [
      { text: '1:Fix', run: digits('Fix', 0, 9) },
      { text: '2:Sci', run: digits('Sci', 0, 9) },
      { text: '3:Norm', run: digits('Norm', 1, 2) },
    ], null);
    return;
  }
  const order = item.key === 'payment' ? ['Begin', 'End'] : item.options;
  openMenu(state, order.map((opt, i) => ({ text: `${i + 1}:${opt}`, run: done(opt) })), null);
  state.menu.cursor = Math.max(0, order.indexOf(state.setup[item.key]));
}

// ---------- menus ----------
function menuKey(state, action) {
  const m = state.menu;
  const choose = (idx) => {
    const item = m.items[idx];
    if (!item) return;
    if (m.insertBack) back(state);
    item.run();
  };
  if (/^ins:[0-9]$/.test(action)) {
    const d = Number(action.slice(4));
    // Digit menus (Fix 0~9) pick by value, the rest by position.
    const byDigit = m.items.findIndex((it) => it.digit === d);
    return choose(m.items.some((it) => it.digit !== undefined) ? byDigit : d - 1);
  }
  switch (action) {
    case 'up':
    case 'down': {
      const visible = m.title ? H - 1 : H;
      m.cursor = Math.max(0, Math.min(m.items.length - 1, m.cursor + (action === 'up' ? -1 : 1)));
      scrollTo(m, 'top', m.cursor, visible);
      return;
    }
    case 'exe':
      return choose(m.cursor);
    case 'esc':
    case 'ac':
      if (state.stack.length) back(state);
  }
}

function confirmKey(state, action) {
  if (action === 'exe') {
    const { run, done } = state.confirm;
    run();
    state.message = done;
  }
  if (['exe', 'esc', 'ac'].includes(action)) {
    state.screen = state.mode === 'STAT' ? 'statEditor' : 'main';
    state.stack = [];
    state.edit = null;
  }
}

function varsKey(state, action) {
  switch (action) {
    case 'up':
    case 'down':
      state.varsCursor = Math.max(0, Math.min(MEMORY_VARS.length, state.varsCursor + (action === 'up' ? -1 : 1)));
      scrollTo(state, 'varsTop', state.varsCursor);
      return;
    case 'esc':
    case 'ac':
      back(state);
  }
}

// ---------- CASH data editor ----------
function cashKey(state, action) {
  if (action.startsWith('ins:')) {
    state.edit ??= { tokens: [], pos: 0 };
    insertToken(state, state.edit, action.slice(4));
    return;
  }
  switch (action) {
    case 'exe':
      if (!state.edit) return moveCash(state, 1);
      try {
        state.cash[state.cashRow] = evaluate(state.edit.tokens, ctx(state));
        state.edit = null;
        state.solved = [];
        moveCash(state, 1);
      } catch (e) {
        fail(state, e);
      }
      return;
    case 'del':
      if (state.edit) deleteToken(state.edit);
      else if (state.cashRow < state.cash.length) {
        state.cash.splice(state.cashRow, 1);
        state.solved = [];
      }
      return;
    case 'left':
    case 'right':
      if (state.edit) moveInEdit(state.edit, action === 'left' ? -1 : 1);
      return;
    case 'ac':
      state.edit = null;
      return;
    case 'esc':
      if (state.edit) state.edit = null;
      else back(state);
      return;
    case 'up':
    case 'down':
      state.edit = null;
      moveCash(state, action === 'up' ? -1 : 1);
  }
}

function moveCash(state, d) {
  state.cashRow = Math.max(0, Math.min(state.cash.length, state.cashRow + d));
  scrollTo(state, 'cashTop', state.cashRow);
}

// ---------- STAT ----------
export const statCols = (state) => [
  'x',
  ...(state.stat.type === '1-VAR' ? [] : ['y']),
  ...(state.setup.statFreq === 'On' ? ['f'] : []),
];

function statEditorKey(state, action) {
  const st = state.stat;
  const cols = statCols(state);
  st.col = Math.min(st.col, cols.length - 1);
  if (action.startsWith('ins:')) {
    state.edit ??= { tokens: [], pos: 0 };
    insertToken(state, state.edit, action.slice(4));
    return;
  }
  const move = (d) => {
    st.row = Math.max(0, Math.min(st.data.length, st.row + d));
    scrollTo(st, 'top', st.row, H - 1);
  };
  switch (action) {
    case 'exe':
      if (!state.edit) return move(1);
      try {
        const v = evaluate(state.edit.tokens, ctx(state));
        if (st.row === st.data.length) st.data.push({ x: 0, y: 0, f: 1 });
        st.data[st.row][cols[st.col]] = v;
        state.edit = null;
        move(1);
      } catch (e) {
        fail(state, e);
      }
      return;
    case 'del':
      if (state.edit) deleteToken(state.edit);
      else if (st.row < st.data.length) st.data.splice(st.row, 1);
      return;
    case 'ac':
      // AC leaves the editor for the calculation screen, as on the real unit.
      if (state.edit) state.edit = null;
      else {
        state.screen = 'statCalc';
        state.comp.edit = { tokens: [], pos: 0 };
        state.comp.resultShown = false;
      }
      return;
    case 'esc':
      state.edit = null;
      return;
    case 'up':
    case 'down':
      state.edit = null;
      return move(action === 'up' ? -1 : 1);
    case 'left':
    case 'right':
      if (state.edit) return moveInEdit(state.edit, action === 'left' ? -1 : 1);
      st.col = Math.max(0, Math.min(cols.length - 1, st.col + (action === 'left' ? -1 : 1)));
  }
}

function openStatMenu(state) {
  const st = state.stat;
  const paired = st.type !== '1-VAR';
  const quad = st.type === '_+CX²';
  const insertAll = (tokens) => () => {
    state.screen = 'statCalc';
    state.stack = [];
    for (const t of tokens) runAction(state, `ins:${t}`);
  };
  const sub = (entries) => () => {
    openMenu(state, entries.map(([text, token], i) => ({ text: `${i + 1}:${text}`, run: insertAll([token]) })), null);
  };
  const items = [
    { text: '1:Type', run: () => switchMode(state, 'STAT') },
    {
      text: '2:Data',
      run: () => {
        state.screen = 'statEditor';
        state.stack = [];
      },
    },
    {
      text: '3:Edit',
      run: () => openMenu(state, [
        {
          text: '1:Ins',
          run: () => {
            st.data.splice(st.row, 0, { x: 0, y: 0, f: 1 });
            state.screen = 'statEditor';
            state.stack = [];
          },
        },
        {
          text: '2:Del-A',
          run: () => confirm(state, 'Delete All?', () => { st.data = []; st.row = 0; }, 'Deleted'),
        },
      ], null),
    },
    {
      text: '4:Sum',
      run: sub(paired
        ? [['Σx²', 'Σx²'], ['Σx', 'Σx'], ['Σy²', 'Σy²'], ['Σy', 'Σy'], ['Σxy', 'Σxy'], ['Σx³', 'Σx³'], ['Σx²y', 'Σx²y'], ['Σx⁴', 'Σx⁴']]
        : [['Σx²', 'Σx²'], ['Σx', 'Σx']]),
    },
    {
      text: '5:Var',
      run: sub([
        ['n', 'statN'], ['x̄', 'x̄'], ['xσn', 'xσn'], ['xσn-1', 'xσn-1'],
        ...(paired ? [['ȳ', 'ȳ'], ['yσn', 'yσn'], ['yσn-1', 'yσn-1']] : []),
      ]),
    },
    ...(paired
      ? [{
          text: '6:Reg',
          run: sub(quad
            ? [['A', 'regA'], ['B', 'regB'], ['C', 'regC'], ['x̂₁', 'xhat1'], ['x̂₂', 'xhat2'], ['ŷ', 'yhat']]
            : [['A', 'regA'], ['B', 'regB'], ['r', 'regR'], ['x̂', 'xhat'], ['ŷ', 'yhat']]),
        }]
      : []),
    {
      text: `${paired ? 7 : 6}:MinMax`,
      run: sub([['minX', 'minX'], ['maxX', 'maxX'], ...(paired ? [['minY', 'minY'], ['maxY', 'maxY']] : [])]),
    },
  ];
  openMenu(state, items, null);
}

// ---------- rendering ----------
function valueText(state, item, width) {
  const v = state.vars[item.k];
  if (item.date) return F.formatDate(v);
  return fitNumber(v, width, dispOf(state.setup), state.setup.sep === 'On');
}

// One line showing `prefix` followed by an input being edited, scrolled so
// the cursor stays visible.
function inputLine(prefix, edit) {
  const before = chars(tokensText(edit.tokens.slice(0, edit.pos)));
  const after = chars(tokensText(edit.tokens.slice(edit.pos)));
  const all = [...before, ...after];
  const room = W - len(prefix);
  const start = Math.max(0, before.length - room + 1);
  const shown = all.slice(start, start + room).join('');
  return { text: prefix + shown, cursor: len(prefix) + before.length - start };
}

export function render(state) {
  const view = {
    off: state.off,
    lines: ['', '', '', ''],
    highlight: null,
    cursor: null,
    overwrite: state.overwrite,
    error: null,
    contrast: Number(state.setup.contrast),
  };
  if (state.off) return view;
  const s = state.setup;
  view.indicators = {
    S: state.shift,
    A: state.alpha,
    M: state.vars.M !== 0,
    STO: state.pending === 'STO',
    RCL: state.pending === 'RCL',
    STAT: s.statFreq === 'On',
    360: s.dateMode === '360',
    SI: s.odd === 'SI',
    DMY: s.dateInput === 'DMY',
    D: s.angle === 'Deg',
    R: s.angle === 'Rad',
    G: s.angle === 'Gra',
    FIX: s.display.startsWith('Fix'),
    SCI: s.display.startsWith('Sci'),
    up: false,
    down: false,
    Disp: state.disp && state.screen === 'main',
  };

  if (state.error) {
    view.error = state.error;
    view.lines = [state.error, '[AC] :Cancel', '[◀][▶]:Goto', ''];
  } else if (state.message) {
    view.lines = ['', state.message, '', ''];
  } else {
    const renderers = {
      main: state.mode === 'COMP' ? renderCalc : renderList,
      setup: renderSetup,
      menu: renderMenu,
      confirm: () => {
        view.lines = [state.confirm.text, '', '[EXE] :Yes', '[ESC] :Cancel'];
      },
      vars: renderVars,
      cashEditor: renderCash,
      statEditor: renderStatEditor,
      statCalc: renderCalc,
    };
    renderers[state.screen](state, view);
  }
  view.lines = view.lines.map((l) => padR(l, W));
  return view;
}

function scrolledList(view, count, top, lineFor, firstLine = 0) {
  const visible = H - firstLine;
  for (let r = 0; r < visible; r++) {
    const idx = top + r;
    if (idx >= count) break;
    const { text, cursor, highlight } = lineFor(idx);
    view.lines[firstLine + r] = text;
    if (cursor !== undefined) view.cursor = { line: firstLine + r, col: cursor };
    if (highlight) view.highlight = { line: firstLine + r, from: 0, to: W };
  }
  view.indicators.up = top > 0;
  view.indicators.down = top + visible < count;
}

function renderCalc(state, view) {
  const c = state.comp;
  const before = chars(tokensText(c.edit.tokens.slice(0, c.edit.pos)));
  const all = [...before, ...chars(tokensText(c.edit.tokens.slice(c.edit.pos)))];
  if (c.resultShown) {
    for (let r = 0; r < 3; r++) view.lines[r] = all.slice(r * W, (r + 1) * W).join('');
    view.lines[3] = padL(fitNumber(state.vars.Ans, W, dispOf(state.setup), state.setup.sep === 'On'), W);
    return;
  }
  // Editing: scroll by whole lines so the cursor stays visible.
  const cursorLine = Math.floor(before.length / W);
  const firstLine = Math.max(0, cursorLine - 2);
  for (let r = 0; r < 3; r++) {
    const start = (firstLine + r) * W;
    view.lines[r] = all.slice(start, start + W).join('');
  }
  view.cursor = { line: cursorLine - firstLine, col: before.length % W };
  view.indicators.up = firstLine > 0;
  view.indicators.down = all.length > (firstLine + 3) * W;
}

function renderList(state, view) {
  const items = itemsFor(state);
  const visible = items.filter((it) => it.type !== 'res' || state.solved.includes(it.k));
  const pos = (idx) => visible.indexOf(items[idx]);
  // Translate cursor/top from item indexes to visible-row indexes.
  const cur = pos(state.cursor);
  const view0 = { top: Math.min(state.top, Math.max(0, visible.length - 1)) };
  scrollTo(view0, 'top', cur);
  state.top = view0.top;
  scrolledList(view, visible.length, view0.top, (idx) => {
    const item = visible[idx];
    const selected = idx === cur;
    if (item.type === 'set') return { text: `Set:${state.setup[item.setting]}`, highlight: selected };
    if (item.type === 'editor') return { text: 'Csh=D.Editor x', highlight: selected };
    if (selected && state.edit) return inputLine(`${item.label}=`, state.edit);
    if (item.type === 'out' && !state.solved.includes(item.k)) {
      return { text: `${item.label}:Solve`, highlight: selected };
    }
    const prefix = `${item.label}=`;
    const w = W - len(prefix);
    return { text: prefix + padL(valueText(state, item, w), w), highlight: selected };
  });
}

function renderSetup(state, view) {
  scrolledList(view, SETUP_ITEMS.length, state.setupTop, (idx) => {
    const item = SETUP_ITEMS[idx];
    return {
      text: `${item.label}:${state.setup[item.key]}`,
      highlight: idx === state.setupCursor,
    };
  });
}

function renderMenu(state, view) {
  const m = state.menu;
  const first = m.title ? 1 : 0;
  if (m.title) view.lines[0] = m.title;
  scrolledList(view, m.items.length, m.top, (idx) => ({ text: m.items[idx].text, highlight: idx === m.cursor }), first);
}

function renderVars(state, view) {
  const names = [...MEMORY_VARS, 'Ans'];
  scrolledList(view, names.length, state.varsTop, (idx) => {
    const prefix = `${names[idx]}=`;
    const w = W - len(prefix);
    return {
      text: prefix + padL(fitNumber(state.vars[names[idx]], w, dispOf(state.setup)), w),
      highlight: idx === state.varsCursor,
    };
  });
}

function renderCash(state, view) {
  const rows = state.cash.length + 1;
  scrolledList(view, rows, state.cashTop, (idx) => {
    const prefix = `CF${idx}=`;
    const selected = idx === state.cashRow;
    if (selected && state.edit) return inputLine(prefix, state.edit);
    const w = W - len(prefix);
    const v = idx < state.cash.length ? fitNumber(state.cash[idx], w, dispOf(state.setup)) : '';
    return { text: prefix + padL(v, w), highlight: selected };
  });
}

const CELL_WIDTHS = { 1: [13], 2: [6, 6], 3: [4, 4, 4] };

function renderStatEditor(state, view) {
  const st = state.stat;
  const cols = statCols(state);
  const widths = CELL_WIDTHS[cols.length];
  const lead = cols.length < 3 ? ' ' : '';
  const header = { x: 'X', y: 'Y', f: 'FREQ' };
  view.lines[0] = '  ' + lead + cols.map((c, i) => padL(header[c], widths[i])).join(' ');
  const top = st.top ?? 0;
  for (let r = 0; r < H - 1; r++) {
    const idx = top + r;
    if (idx > st.data.length) break;
    let line = padL(String(idx + 1).slice(-2), 2) + lead;
    cols.forEach((col, c) => {
      if (c > 0) line += ' ';
      const start = len(line);
      const w = widths[c];
      if (idx === st.row && c === st.col && state.edit) {
        const before = chars(tokensText(state.edit.tokens.slice(0, state.edit.pos)));
        const all = [...before, ...chars(tokensText(state.edit.tokens.slice(state.edit.pos)))];
        const from = Math.max(0, before.length - w + 1);
        line += padR(all.slice(from, from + w).join(''), w);
        view.cursor = { line: r + 1, col: start + before.length - from };
      } else {
        const v = st.data[idx]?.[col];
        line += padL(v === undefined ? '' : fitNumber(v, w, dispOf(state.setup)), w);
        if (idx === st.row && c === st.col) view.highlight = { line: r + 1, from: start, to: start + w };
      }
    });
    view.lines[r + 1] = line;
  }
  view.indicators.up = top > 0;
  view.indicators.down = top + H - 1 < st.data.length + 1;
}
