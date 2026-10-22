// The calculator as a state machine: press(state, keyId) mutates the state,
// render(state) turns it into the 4×16 display. No DOM access here, so the
// whole behaviour is testable in Node.

import { evaluate, fitNumber, CalcError, mathError } from './math.js';
import * as F from './finance.js';
import { KEY_MAP } from './keys.js';

export const W = 16; // display columns
export const H = 4; // display lines

// ---------- mode definitions ----------
const set = (setting) => ({ k: 'Set', type: 'set', setting });
const inp = (k, extra) => ({ k, type: 'in', ...extra });
const both = (k, extra) => ({ k, type: 'both', ...extra });
const out = (k) => ({ k, type: 'out' });

export const MODES = {
  SMPL: [set('dn'), inp('Dys'), inp('I%'), inp('PV'), out('SI'), out('SFV')],
  CMPD: [set('payment'), both('n'), both('I%'), both('PV'), both('PMT'), both('FV'), inp('P/Y'), inp('C/Y')],
  CASH: [inp('I%'), { k: 'Csh', type: 'editor' }, out('NPV'), out('IRR'), out('PBP'), out('NFV')],
  AMRT: [
    set('payment'), inp('PM1'), inp('PM2'), inp('n'), inp('I%'), inp('PV'), inp('PMT'), inp('FV'),
    inp('P/Y'), inp('C/Y'), out('BAL'), out('INT'), out('PRN'), out('ΣINT'), out('ΣPRN'),
  ],
  CNVR: [inp('cn', { label: 'n' }), inp('I%'), out('EFF'), out('APR')],
  COST: [both('Cst'), both('Sel'), both('Mrg')],
  DAYS: [set('dn'), both('d1', { date: true }), both('d2', { date: true }), both('Dys')],
};

export const SETUP_ITEMS = [
  { key: 'payment', label: 'Payment', options: ['End', 'Begin'] },
  { key: 'dateMode', label: 'Date Mode', options: ['MDY', 'DMY'] },
  { key: 'dn', label: 'dn', options: [365, 360] },
  { key: 'fix', label: 'Disp', options: [null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
];

const STAT_TYPES = ['1-VAR', 'A+BX'];

const DEFAULT_VARS = {
  n: 0, 'I%': 0, PV: 0, PMT: 0, FV: 0, 'P/Y': 12, 'C/Y': 12,
  Dys: 0, PM1: 1, PM2: 1, cn: 0, Cst: 0, Sel: 0, Mrg: 0,
  d1: 1012026, d2: 1012026, A: 0, B: 0, C: 0, D: 0, M: 0, Ans: 0,
};

const DEFAULT_SETUP = { payment: 'End', dateMode: 'MDY', dn: 365, fix: null };

const BINARY_OR_POSTFIX = new Set(['+', '−', '×', '÷', '^(', '²', '³', '⁻¹', '!', '%']);

// ---------- state ----------
export function createState(saved = {}) {
  return {
    off: false,
    mode: saved.mode && (saved.mode === 'COMP' || saved.mode === 'STAT' || MODES[saved.mode]) ? saved.mode : 'COMP',
    screen: saved.mode === 'STAT' ? 'statType' : 'main',
    prevScreen: 'main',
    shift: false,
    alpha: false,
    pending: null, // 'STO' | 'RCL'
    error: null,
    setup: { ...DEFAULT_SETUP, ...saved.setup },
    vars: { ...DEFAULT_VARS, ...saved.vars },
    solved: [],
    cursor: 0,
    top: 0,
    input: null, // tokens being typed into a field
    comp: { tokens: [], resultShown: false },
    cash: Array.isArray(saved.cash) ? saved.cash.slice() : [],
    stat: {
      type: STAT_TYPES.includes(saved.stat?.type) ? saved.stat.type : '1-VAR',
      data: Array.isArray(saved.stat?.data) ? saved.stat.data.map((r) => ({ ...r })) : [],
      row: 0,
      col: 0,
    },
  };
}

export function snapshot(state) {
  return {
    mode: state.mode,
    setup: state.setup,
    vars: state.vars,
    cash: state.cash,
    stat: { type: state.stat.type, data: state.stat.data },
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
    if (key.alpha) {
      state.shift = state.alpha = false;
      memoryOp(state, op, key.alpha);
      return state;
    }
  }

  let action = key.action;
  if (state.alpha && key.alpha) action = `ins:${key.alpha}`;
  else if (state.shift && key.shift) action = key.shift.action;
  return runAction(state, action);
}

function runAction(state, action) {
  state.message = null;
  if (action === 'shift') {
    state.shift = !state.shift;
    state.alpha = false;
    return state;
  }
  if (action === 'alpha') {
    state.alpha = !state.alpha;
    state.shift = false;
    return state;
  }
  state.shift = state.alpha = false;

  if (action === 'off') {
    state.off = true;
    return state;
  }
  if (action.startsWith('mode:')) {
    switchMode(state, action.slice(5));
    return state;
  }
  if (state.error) {
    if (['ac', 'on', 'esc', 'left', 'right', 'del', 'exe'].includes(action)) state.error = null;
    return state;
  }
  if (action === 'on') {
    clearDisplay(state);
    return state;
  }
  if (action === 'setup' || action === 'clr') {
    if (state.screen !== 'setup' && state.screen !== 'clr') state.prevScreen = state.screen;
    state.screen = action === 'setup' ? 'setup' : 'clr';
    state.setupCursor = 0;
    state.setupTop = 0;
    state.input = null;
    return state;
  }
  if (action === 'sto' || action === 'rcl') {
    state.pending = action.toUpperCase();
    return state;
  }
  if (action === 'm+' || action === 'm-') {
    const v = currentValue(state);
    if (v !== null) state.vars.M += action === 'm+' ? v : -v;
    return state;
  }

  const handler = {
    main: state.mode === 'COMP' ? compKey : listKey,
    setup: setupKey,
    clr: clrKey,
    cashEditor: cashKey,
    statType: statTypeKey,
    statEditor: statEditorKey,
    statResults: statResultsKey,
  }[state.screen];
  handler(state, action);
  return state;
}

function fail(state, e) {
  if (e instanceof CalcError) state.error = e.kind;
  else state.error = 'Math ERROR';
}

function clearDisplay(state) {
  state.error = null;
  state.input = null;
  state.pending = null;
  if (state.mode === 'COMP') state.comp = { tokens: [], resultShown: false };
}

function switchMode(state, mode) {
  state.mode = mode;
  state.screen = mode === 'STAT' ? 'statType' : 'main';
  state.cursor = 0;
  state.top = 0;
  state.input = null;
  state.error = null;
  state.pending = null;
  state.solved = [];
  if (mode === 'COMP') state.comp = { tokens: [], resultShown: false };
}

// Value that STO / M+ act on: the evaluated COMP line, the selected field, or Ans.
function currentValue(state) {
  try {
    if (state.screen === 'main' && state.mode === 'COMP') {
      const c = state.comp;
      if (c.tokens.length && !c.resultShown) {
        state.vars.Ans = evaluate(c.tokens, state.vars);
        c.resultShown = true;
      }
      return state.vars.Ans;
    }
    if (state.screen === 'main') {
      const item = MODES[state.mode][state.cursor];
      if (state.input?.length) commitInput(state, item);
      const v = state.vars[item.k];
      if (typeof v === 'number' && !item.date && (item.type !== 'out' || state.solved.includes(item.k))) return v;
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

// Shared token insertion for every input field.
function pushToken(tokens, t) {
  if (!tokens.length && t === '−') t = '-'; // leading minus means negative
  tokens.push(t);
}

// ---------- COMP ----------
function compKey(state, action) {
  const c = state.comp;
  if (action.startsWith('ins:')) {
    const t = action.slice(4);
    if (c.resultShown) {
      c.tokens = BINARY_OR_POSTFIX.has(t) ? ['Ans'] : [];
      c.resultShown = false;
    }
    pushToken(c.tokens, t);
    return;
  }
  switch (action) {
    case 'exe':
    case 'solve':
      if (!c.tokens.length) return;
      try {
        state.vars.Ans = evaluate(c.tokens, state.vars);
        c.resultShown = true;
      } catch (e) {
        fail(state, e);
      }
      return;
    case 'del':
      if (c.resultShown) c.resultShown = false;
      else c.tokens.pop();
      return;
    case 'ac':
    case 'esc':
      state.comp = { tokens: [], resultShown: false };
      return;
    case 'left':
    case 'right':
    case 'up':
      c.resultShown = false;
      return;
  }
}

// ---------- list modes (SMPL, CMPD, CASH, AMRT, CNVR, COST, DAYS) ----------
function moveCursor(state, delta, count) {
  state.cursor = Math.max(0, Math.min(count - 1, state.cursor + delta));
  scrollTo(state, 'top', state.cursor);
}

function scrollTo(state, field, idx, visible = H) {
  if (idx < state[field]) state[field] = idx;
  if (idx >= state[field] + visible) state[field] = idx - visible + 1;
}

function listKey(state, action) {
  const items = MODES[state.mode];
  const item = items[state.cursor];
  const editable = item.type === 'in' || item.type === 'both';

  if (action.startsWith('ins:')) {
    if (!editable) return;
    state.input ??= [];
    pushToken(state.input, action.slice(4));
    return;
  }
  switch (action) {
    case 'del':
      state.input?.pop();
      return;
    case 'ac':
    case 'esc':
      state.input = null;
      return;
    case 'up':
    case 'down':
      state.input = null;
      moveCursor(state, action === 'up' ? -1 : 1, items.length);
      return;
    case 'exe':
      if (state.input) {
        try {
          commitInput(state, item);
          moveCursor(state, 1, items.length);
        } catch (e) {
          fail(state, e);
        }
      } else if (item.type === 'set') {
        const s = SETUP_ITEMS.find((x) => x.key === item.setting);
        cycleSetting(state, s, 1);
      } else if (item.type === 'editor') {
        state.screen = 'cashEditor';
        state.cashRow = 0;
        state.cashTop = 0;
      } else if (item.type === 'out') {
        solveItem(state, item);
      } else {
        moveCursor(state, 1, items.length);
      }
      return;
    case 'solve':
      state.input = null;
      if (item.type === 'out' || item.type === 'both') solveItem(state, item);
      return;
  }
}

function commitInput(state, item) {
  const v = evaluate(state.input, state.vars);
  if (item.date) F.parseDate(v, state.setup.dateMode);
  state.vars[item.k] = v;
  state.input = null;
  state.solved = [];
}

function solveItem(state, item) {
  try {
    const v = compute(state, item.k);
    state.vars[item.k] = v;
    if (!item.date) state.vars.Ans = v;
    state.solved = item.type === 'out' ? [...state.solved, item.k] : [];
  } catch (e) {
    fail(state, e);
  }
}

function tvm(state) {
  const v = state.vars;
  return {
    n: v.n, iPct: v['I%'], PV: v.PV, PMT: v.PMT, FV: v.FV,
    PY: v['P/Y'], CY: v['C/Y'], begin: state.setup.payment === 'Begin',
  };
}

export function compute(state, key) {
  const v = state.vars;
  const dn = state.setup.dn;
  switch (state.mode) {
    case 'SMPL':
      return F.simpleInterest({ Dys: v.Dys, iPct: v['I%'], PV: v.PV, dn })[key];
    case 'CMPD':
      return F.solveTVM(key, tvm(state));
    case 'CASH':
      if (key === 'NPV') return F.npv(v['I%'], state.cash);
      if (key === 'IRR') return F.irr(state.cash);
      if (key === 'PBP') return F.pbp(v['I%'], state.cash);
      if (key === 'NFV') return F.nfv(v['I%'], state.cash);
      break;
    case 'AMRT':
      return F.amortize({ ...tvm(state), PM1: v.PM1, PM2: v.PM2 })[key];
    case 'CNVR':
      return key === 'EFF' ? F.toEffective(v.cn, v['I%']) : F.toNominal(v.cn, v['I%']);
    case 'COST':
      return F.solveCost(key, v);
    case 'DAYS': {
      const mode = state.setup.dateMode;
      if (key === 'Dys') {
        return F.daysBetween(F.parseDate(v.d1, mode), F.parseDate(v.d2, mode), dn);
      }
      if (dn !== 365) throw mathError();
      if (key === 'd1') return F.encodeDate(F.addDays(F.parseDate(v.d2, mode), -v.Dys), mode);
      return F.encodeDate(F.addDays(F.parseDate(v.d1, mode), v.Dys), mode);
    }
  }
  throw mathError();
}

// ---------- SETUP / CLR ----------
function cycleSetting(state, item, dir) {
  const opts = item.options;
  const idx = opts.indexOf(state.setup[item.key]);
  const next = opts[(idx + dir + opts.length) % opts.length];
  if (item.key === 'dateMode') {
    // Keep stored dates meaning the same day after the order changes.
    for (const d of ['d1', 'd2']) {
      try {
        state.vars[d] = F.encodeDate(F.parseDate(state.vars[d], state.setup.dateMode), next);
      } catch {
        /* leave invalid dates as they are */
      }
    }
  }
  state.setup[item.key] = next;
  state.solved = [];
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
    case 'right':
      cycleSetting(state, item, 1);
      return;
    case 'left':
      cycleSetting(state, item, -1);
      return;
    case 'esc':
    case 'ac':
      state.screen = state.prevScreen;
      return;
  }
}

function clrKey(state, action) {
  if (action === 'exe') {
    state.vars = { ...DEFAULT_VARS };
    state.setup = { ...DEFAULT_SETUP };
    state.cash = [];
    state.stat = { type: '1-VAR', data: [], row: 0, col: 0 };
    switchMode(state, 'COMP');
    state.message = 'Clear All!';
  } else if (action === 'esc' || action === 'ac') {
    state.screen = state.prevScreen;
  }
}

// ---------- CASH data editor ----------
// The row after the last flow appends a new one.
function cashKey(state, action) {
  if (action.startsWith('ins:')) {
    state.input ??= [];
    pushToken(state.input, action.slice(4));
    return;
  }
  switch (action) {
    case 'exe':
      if (state.input) {
        try {
          const v = evaluate(state.input, state.vars);
          state.cash[state.cashRow] = v;
          state.input = null;
          state.solved = [];
          moveCash(state, 1);
        } catch (e) {
          fail(state, e);
        }
      } else moveCash(state, 1);
      return;
    case 'del':
      if (state.input) state.input.pop();
      else if (state.cashRow < state.cash.length) {
        state.cash.splice(state.cashRow, 1);
        state.solved = [];
      }
      return;
    case 'ac':
      state.input = null;
      return;
    case 'esc':
      if (state.input) state.input = null;
      else state.screen = 'main';
      return;
    case 'up':
    case 'down':
      state.input = null;
      moveCash(state, action === 'up' ? -1 : 1);
      return;
  }
}

function moveCash(state, d) {
  state.cashRow = Math.max(0, Math.min(state.cash.length, state.cashRow + d));
  scrollTo(state, 'cashTop', state.cashRow);
}

// ---------- STAT ----------
function statTypeKey(state, action) {
  const st = state.stat;
  state.statTypeCursor ??= STAT_TYPES.indexOf(st.type);
  const choose = (idx) => {
    st.type = STAT_TYPES[idx];
    st.row = 0;
    st.col = 0;
    state.statTop = 0;
    state.screen = 'statEditor';
  };
  switch (action) {
    case 'up':
    case 'down':
      state.statTypeCursor = action === 'up' ? 0 : 1;
      return;
    case 'ins:1':
      return choose(0);
    case 'ins:2':
      return choose(1);
    case 'exe':
      return choose(state.statTypeCursor);
  }
}

const statCols = (st) => (st.type === '1-VAR' ? ['x'] : ['x', 'y']);

function statEditorKey(state, action) {
  const st = state.stat;
  const cols = statCols(st);
  if (action.startsWith('ins:')) {
    state.input ??= [];
    pushToken(state.input, action.slice(4));
    return;
  }
  const move = (d) => {
    st.row = Math.max(0, Math.min(st.data.length, st.row + d));
    scrollTo(state, 'statTop', st.row, H - 1);
  };
  switch (action) {
    case 'exe':
      if (!state.input) return move(1);
      try {
        const v = evaluate(state.input, state.vars);
        if (st.row === st.data.length) st.data.push({ x: 0, y: 0 });
        st.data[st.row][cols[st.col]] = v;
        state.input = null;
        if (st.col === cols.length - 1) {
          st.col = 0;
          move(1);
        } else st.col++;
      } catch (e) {
        fail(state, e);
      }
      return;
    case 'del':
      if (state.input) state.input.pop();
      else if (st.row < st.data.length) st.data.splice(st.row, 1);
      return;
    case 'ac':
      state.input = null;
      return;
    case 'esc':
      if (state.input) state.input = null;
      else {
        state.screen = 'statType';
        state.statTypeCursor = STAT_TYPES.indexOf(st.type);
      }
      return;
    case 'up':
    case 'down':
      state.input = null;
      return move(action === 'up' ? -1 : 1);
    case 'left':
    case 'right':
      state.input = null;
      st.col = Math.max(0, Math.min(cols.length - 1, st.col + (action === 'left' ? -1 : 1)));
      return;
    case 'solve':
      state.input = null;
      try {
        state.statResults = F.statistics(st.data, st.type !== '1-VAR');
        state.resultCursor = 0;
        state.resultTop = 0;
        state.screen = 'statResults';
      } catch (e) {
        fail(state, e);
      }
      return;
  }
}

function statResultsKey(state, action) {
  const keys = Object.keys(state.statResults);
  switch (action) {
    case 'up':
    case 'down':
      state.resultCursor = Math.max(0, Math.min(keys.length - 1, state.resultCursor + (action === 'up' ? -1 : 1)));
      scrollTo(state, 'resultTop', state.resultCursor);
      return;
    case 'exe': {
      const v = state.statResults[keys[state.resultCursor]];
      if (Number.isFinite(v)) state.vars.Ans = v;
      return;
    }
    case 'esc':
    case 'ac':
      state.screen = 'statEditor';
      return;
  }
}

// ---------- rendering ----------
// Visible width, ignoring combining marks (x̄ is "x" + U+0304).
const vlen = (s) => [...s.replace(/[̀-ͯ]/g, '')].length;
const padL = (s, w) => ' '.repeat(Math.max(0, w - vlen(s))) + s;
const padR = (s, w) => s + ' '.repeat(Math.max(0, w - vlen(s)));

const settingText = (setup, key) => {
  const v = setup[key];
  if (key === 'fix') return v === null ? 'Norm' : `Fix${v}`;
  return String(v);
};

function valueText(state, item, width) {
  const v = state.vars[item.k];
  if (item.date) return F.formatDate(v, state.setup.dateMode);
  return fitNumber(v, width, state.setup.fix);
}

// Line showing `prefix` followed by the input being typed, with a cursor.
function inputLine(prefix, tokens) {
  const text = tokens.join('');
  const avail = W - vlen(prefix) - 1;
  const shown = [...text].slice(-avail).join('');
  return { text: prefix + shown, cursor: vlen(prefix) + vlen(shown) };
}

export function render(state) {
  const view = { off: state.off, lines: ['', '', '', ''], highlight: null, cursor: null, error: null };
  if (state.off) return view;
  view.indicators = {
    S: state.shift,
    A: state.alpha,
    M: state.vars.M !== 0,
    STO: state.pending === 'STO',
    RCL: state.pending === 'RCL',
    BGN: state.setup.payment === 'Begin',
    FIX: state.setup.fix !== null,
    up: false,
    down: false,
    mode: state.mode,
  };

  if (state.error) {
    view.error = state.error;
    view.lines = [state.error, '', '[AC] :Cancel', '[◀][▶]:Goto'];
    return view;
  }
  if (state.message) {
    view.lines = ['', state.message, '', ''].map((l) => padR(l, W));
    return view;
  }

  const renderers = {
    main: state.mode === 'COMP' ? renderComp : renderList,
    setup: renderSetup,
    clr: () => {
      view.lines = ['Clear All?', '', '[EXE] :Yes', '[ESC] :Cancel'];
    },
    cashEditor: renderCash,
    statType: renderStatType,
    statEditor: renderStatEditor,
    statResults: renderStatResults,
  };
  renderers[state.screen](state, view);
  view.lines = view.lines.map((l) => padR(l, W));
  return view;
}

function scrolledList(view, count, top, lineFor) {
  for (let r = 0; r < H; r++) {
    const idx = top + r;
    if (idx >= count) break;
    const { text, cursor, highlight } = lineFor(idx);
    view.lines[r] = text;
    if (cursor !== undefined) view.cursor = { line: r, col: cursor };
    if (highlight) view.highlight = { line: r, from: 0, to: W };
  }
  view.indicators.up = top > 0;
  view.indicators.down = top + H < count;
}

function renderComp(state, view) {
  const c = state.comp;
  const text = c.tokens.join('');
  const chars = [...text];
  if (c.resultShown) {
    for (let r = 0; r < 3; r++) view.lines[r] = chars.slice(r * W, (r + 1) * W).join('');
    view.lines[3] = padL(fitNumber(state.vars.Ans, W, state.setup.fix), W);
    return;
  }
  // Editing: keep the cursor visible, scrolling by whole lines.
  const total = chars.length + 1;
  const firstLine = Math.max(0, Math.ceil(total / W) - 3);
  for (let r = 0; r < 3; r++) {
    const start = (firstLine + r) * W;
    view.lines[r] = chars.slice(start, start + W).join('');
  }
  const pos = chars.length - firstLine * W;
  view.cursor = { line: Math.floor(pos / W), col: pos % W };
}

function renderList(state, view) {
  const items = MODES[state.mode];
  scrolledList(view, items.length, state.top, (idx) => {
    const item = items[idx];
    const selected = idx === state.cursor;
    const label = item.label ?? item.k;
    if (item.type === 'set') return { text: `Set:${settingText(state.setup, item.setting)}`, highlight: selected };
    if (item.type === 'editor') return { text: 'Csh=D.Editor x', highlight: selected };
    if (selected && state.input) return inputLine(`${label}=`, state.input);
    if (item.type === 'out' && !state.solved.includes(item.k)) {
      return { text: `${label}:Solve`, highlight: selected };
    }
    const prefix = `${label}=`;
    const w = W - vlen(prefix);
    return { text: prefix + padL(valueText(state, item, w), w), highlight: selected };
  });
}

function renderSetup(state, view) {
  scrolledList(view, SETUP_ITEMS.length, state.setupTop, (idx) => {
    const item = SETUP_ITEMS[idx];
    return {
      text: `${padR(item.label, 10)}:${settingText(state.setup, item.key)}`,
      highlight: idx === state.setupCursor,
    };
  });
}

function renderCash(state, view) {
  const rows = state.cash.length + 1;
  scrolledList(view, rows, state.cashTop, (idx) => {
    const prefix = `CF${idx}=`;
    const selected = idx === state.cashRow;
    if (selected && state.input) return inputLine(prefix, state.input);
    const w = W - vlen(prefix);
    const v = idx < state.cash.length ? fitNumber(state.cash[idx], w, state.setup.fix) : '';
    return { text: prefix + padL(v, w), highlight: selected };
  });
}

function renderStatType(state, view) {
  const cur = state.statTypeCursor ?? STAT_TYPES.indexOf(state.stat.type);
  view.lines = ['Select Type', '1:1-VAR', '2:A+BX', ''];
  view.highlight = { line: cur + 1, from: 0, to: W };
}

function renderStatEditor(state, view) {
  const st = state.stat;
  const cols = statCols(st);
  const cellW = cols.length === 1 ? 13 : 6;
  view.lines[0] = cols.length === 1 ? `   ${padL('X', cellW)}` : `   ${padL('X', cellW)} ${padL('Y', cellW)}`;
  const top = state.statTop ?? 0;
  for (let r = 0; r < H - 1; r++) {
    const idx = top + r;
    if (idx > st.data.length) break;
    let line = padL(String(idx + 1), 2) + ' ';
    cols.forEach((col, c) => {
      const start = vlen(line);
      let cell;
      if (idx === st.row && c === st.col && state.input) {
        const text = [...state.input.join('')].slice(-(cellW - 1)).join('');
        cell = padR(text, cellW);
        view.cursor = { line: r + 1, col: start + vlen(text) };
      } else {
        const v = st.data[idx]?.[col];
        cell = padL(v === undefined ? '' : fitNumber(v, cellW, state.setup.fix), cellW);
        if (idx === st.row && c === st.col) view.highlight = { line: r + 1, from: start, to: start + cellW };
      }
      line += cell + (c < cols.length - 1 ? ' ' : '');
    });
    view.lines[r + 1] = line;
  }
  view.indicators.up = top > 0;
  view.indicators.down = top + H - 1 < st.data.length + 1;
}

function renderStatResults(state, view) {
  const res = state.statResults;
  const keys = Object.keys(res);
  scrolledList(view, keys.length, state.resultTop, (idx) => {
    const prefix = `${keys[idx]}=`;
    const w = W - vlen(prefix);
    return { text: prefix + padL(fitNumber(res[keys[idx]], w, state.setup.fix), w), highlight: idx === state.resultCursor };
  });
}
