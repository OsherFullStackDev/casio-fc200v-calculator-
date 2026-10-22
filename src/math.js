// Expression engine for the calculator line.
// Expressions are arrays of tokens (one token per key press). evaluate() parses
// them with Casio-style precedence:
//   functions/parentheses > postfix (x² x⁻¹ x! ° % ŷ…) > ^ > (−) > nPr nCr > ×÷ > +−

export class CalcError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind; // 'Syntax ERROR' | 'Math ERROR'
  }
}

export const syntaxError = () => new CalcError('Syntax ERROR');
export const mathError = () => new CalcError('Math ERROR');

// Tokens whose on-screen text differs from their identity.
export const TOKEN_TEXT = {
  nPr: 'P',
  nCr: 'C',
  regA: 'A',
  regB: 'B',
  regC: 'C',
  regR: 'r',
  statN: 'n',
  xhat: 'x̂',
  xhat1: 'x̂₁',
  xhat2: 'x̂₂',
  yhat: 'ŷ',
  deltaPct: 'Δ%',
};

export const tokenText = (t) => TOKEN_TEXT[t] ?? t;
export const tokensText = (tokens) => tokens.map(tokenText).join('');

export const VARIABLES = ['A', 'B', 'C', 'D', 'X', 'Y', 'M'];

// Statistics values that can be typed into an expression (from S-MENU).
export const STAT_VALUES = [
  'statN', 'x̄', 'xσn', 'xσn-1', 'ȳ', 'yσn', 'yσn-1', 'Σx', 'Σx²', 'Σy', 'Σy²', 'Σxy',
  'Σx³', 'Σx²y', 'Σx⁴', 'minX', 'maxX', 'minY', 'maxY', 'regA', 'regB', 'regC', 'regR',
];
export const STAT_POSTFIX = ['xhat', 'xhat1', 'xhat2', 'yhat'];

const ANGLE_TO_RAD = { Deg: Math.PI / 180, Rad: 1, Gra: Math.PI / 200 };

const snap = (r) => (Math.abs(r) < 1e-15 ? 0 : r);

function makeFuncs(ctx) {
  const unit = ANGLE_TO_RAD[ctx.angle ?? 'Deg'];
  const inv = (fn) => (x) => {
    if (Math.abs(x) > 1) throw mathError();
    return fn(x) / unit;
  };
  return {
    '√(': (x) => {
      if (x < 0) throw mathError();
      return Math.sqrt(x);
    },
    '∛(': Math.cbrt,
    'ln(': (x) => {
      if (x <= 0) throw mathError();
      return Math.log(x);
    },
    'log(': (x) => {
      if (x <= 0) throw mathError();
      return Math.log10(x);
    },
    'e^(': Math.exp,
    '10^(': (x) => 10 ** x,
    'sin(': (x) => snap(Math.sin(x * unit)),
    'cos(': (x) => snap(Math.cos(x * unit)),
    'tan(': (x) => {
      if (Math.abs(Math.cos(x * unit)) < 1e-15) throw mathError();
      return snap(Math.tan(x * unit));
    },
    'sin⁻¹(': inv(Math.asin),
    'cos⁻¹(': inv(Math.acos),
    'tan⁻¹(': (x) => Math.atan(x) / unit,
    'Abs(': Math.abs,
    'Int(': Math.trunc,
    'Intg(': Math.floor,
    'Frac(': (x) => x - Math.trunc(x),
    'Rnd(': (x) => (ctx.round ? ctx.round(x) : x),
  };
}

function factorial(x) {
  if (!Number.isInteger(x) || x < 0 || x > 69) throw mathError();
  let r = 1;
  for (let i = 2; i <= x; i++) r *= i;
  return r;
}

function checkPC(n, r) {
  if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0 || r > n) throw mathError();
}

function perm(n, r) {
  checkPC(n, r);
  let p = 1;
  for (let k = 0; k < r; k++) p *= n - k;
  return p;
}

function comb(n, r) {
  checkPC(n, r);
  let c = 1;
  for (let k = 1; k <= Math.min(r, n - r); k++) c = (c * (n - Math.min(r, n - r) + k)) / k;
  return Math.round(c);
}

function makePostfix(ctx) {
  const toUnit = (rad) => rad / ANGLE_TO_RAD[ctx.angle ?? 'Deg'];
  const post = {
    '²': (x) => x * x,
    '³': (x) => x * x * x,
    '⁻¹': (x) => {
      if (x === 0) throw mathError();
      return 1 / x;
    },
    '!': factorial,
    '%': (x) => x / 100,
    '°': (x) => toUnit(x * ANGLE_TO_RAD.Deg),
    'ʳ': (x) => toUnit(x),
    'ᵍ': (x) => toUnit(x * ANGLE_TO_RAD.Gra),
  };
  for (const t of STAT_POSTFIX) {
    post[t] = (x) => {
      if (!ctx.stat) throw syntaxError();
      return ctx.stat(t, x);
    };
  }
  return post;
}

// Groups digit, '.' and 'E' (×10ˣ) tokens into numbers.
function lex(tokens) {
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[0-9.]$/.test(t) || t === 'E') {
      let s = '';
      let sawE = false;
      while (i < tokens.length) {
        const c = tokens[i];
        if (/^[0-9.]$/.test(c)) s += c;
        else if (c === 'E' && !sawE) {
          sawE = true;
          s += 'e';
          if (tokens[i + 1] === '-' || tokens[i + 1] === '−') {
            s += '-';
            i++;
          }
        } else break;
        i++;
      }
      if (s.startsWith('e')) s = '1' + s;
      if (!/^(\d+\.?\d*|\.\d+)(e-?\d+)?$/.test(s)) throw syntaxError();
      out.push({ type: 'num', value: Number(s) });
      continue;
    }
    out.push({ type: 'tok', value: t });
    i++;
  }
  return out;
}

// ctx: { vars, angle: 'Deg'|'Rad'|'Gra', round(x), stat(name, arg?) }.
// A plain object of variables is accepted too.
export function evaluate(tokens, ctxOrVars = {}) {
  const ctx = ctxOrVars.vars ? ctxOrVars : { vars: ctxOrVars };
  const vars = ctx.vars;
  if (!tokens.length) throw syntaxError();

  // a,bΔ% — percentage change from a to b.
  if (tokens[tokens.length - 1] === 'deltaPct') {
    const body = tokens.slice(0, -1);
    const comma = topLevelComma(body);
    if (comma < 0) throw syntaxError();
    const a = evaluate(body.slice(0, comma), ctx);
    const b = evaluate(body.slice(comma + 1), ctx);
    if (a === 0) throw mathError();
    return clean(((b - a) / a) * 100);
  }

  const FUNCS = makeFuncs(ctx);
  const POSTFIX = makePostfix(ctx);
  const toks = lex(tokens);
  let pos = 0;
  const peek = () => toks[pos];
  const isTok = (v) => peek() && peek().type === 'tok' && peek().value === v;

  const startsPrimary = () => {
    const t = peek();
    if (!t) return false;
    if (t.type === 'num') return true;
    const v = t.value;
    return (
      v === '(' || v in FUNCS || v === 'Ans' || v === 'π' || v === 'e' ||
      VARIABLES.includes(v) || STAT_VALUES.includes(v)
    );
  };

  const closeParen = () => {
    // Casio auto-closes parentheses left open at the end of the line.
    if (isTok(')')) pos++;
    else if (peek()) throw syntaxError();
  };

  function primary() {
    const t = peek();
    if (!t) throw syntaxError();
    if (t.type === 'num') {
      pos++;
      return t.value;
    }
    const v = t.value;
    pos++;
    if (v === '(') {
      const r = expr();
      closeParen();
      return r;
    }
    if (v in FUNCS) {
      const arg = expr();
      closeParen();
      return FUNCS[v](arg);
    }
    if (v === 'π') return Math.PI;
    if (v === 'e') return Math.E;
    if (v === 'Ans' || VARIABLES.includes(v)) return vars[v] ?? 0;
    if (STAT_VALUES.includes(v)) {
      if (!ctx.stat) throw syntaxError();
      return ctx.stat(v);
    }
    throw syntaxError();
  }

  function postfix() {
    let x = primary();
    while (peek() && peek().type === 'tok' && peek().value in POSTFIX) {
      x = POSTFIX[peek().value](x);
      pos++;
    }
    return x;
  }

  function power() {
    const base = postfix();
    if (isTok('^(')) {
      pos++;
      const exp = expr();
      closeParen();
      const r = base ** exp;
      if (Number.isNaN(r)) throw mathError();
      return r;
    }
    return base;
  }

  function unary() {
    if (isTok('-')) {
      pos++;
      return -unary();
    }
    return power();
  }

  function permComb() {
    let x = unary();
    while (isTok('nPr') || isTok('nCr')) {
      const op = peek().value;
      pos++;
      const r = unary();
      x = op === 'nPr' ? perm(x, r) : comb(x, r);
    }
    return x;
  }

  function term() {
    let x = permComb();
    for (;;) {
      if (isTok('×')) {
        pos++;
        x *= permComb();
      } else if (isTok('÷')) {
        pos++;
        const d = permComb();
        if (d === 0) throw mathError();
        x /= d;
      } else if (startsPrimary()) {
        x *= permComb();
      } else return x;
    }
  }

  function expr() {
    let x = term();
    for (;;) {
      if (isTok('+')) {
        pos++;
        x += term();
      } else if (isTok('−')) {
        pos++;
        x -= term();
      } else return x;
    }
  }

  const result = expr();
  if (pos !== toks.length) throw syntaxError();
  return clean(result);
}

// Results carry 15 significant digits, like the calculator's internal
// precision; this also removes binary noise such as sin 30° = 0.49999….
export function clean(x) {
  if (!Number.isFinite(x)) throw mathError();
  return x === 0 ? 0 : Number(x.toPrecision(15));
}

function topLevelComma(tokens) {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.endsWith('(')) depth++;
    else if (t === ')') depth--;
    else if (t === ',' && depth === 0) return i;
  }
  return -1;
}

// ---------- number display ----------
// disp: { type: 'Norm', n: 1|2 } | { type: 'Fix', n: 0..9 } | { type: 'Sci', n: 0..9 }
export const DEFAULT_DISP = { type: 'Norm', n: 1 };

export function formatNumber(x, disp = DEFAULT_DISP, sig = 10) {
  if (!Number.isFinite(x)) return 'ERROR';
  if (Object.is(x, -0)) x = 0;
  if (disp.type === 'Fix' && Math.abs(x) < 1e10) {
    const s = x.toFixed(disp.n);
    return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
  }
  if (disp.type === 'Sci') return sci(x, Math.min(sig, disp.n || 10), true);
  if (x === 0) return '0';
  const r = Number(x.toPrecision(sig));
  const abs = Math.abs(r);
  const small = disp.n === 2 ? 1e-9 : 1e-2;
  if (abs >= 1e10 || abs < small) return sci(r, sig);
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)));
  return trimZeros(r.toFixed(Math.min(digits, 20)));
}

function sci(x, sig, keepZeros = false) {
  const [m, e] = x.toExponential(sig - 1).split('e');
  return `${keepZeros ? m : trimZeros(m)}E${Number(e)}`;
}

// The value as it is shown on screen; used by Rnd(.
export function roundToDisplay(x, disp) {
  if (disp.type === 'Norm') return Number(x.toPrecision(10));
  return Number(formatNumber(x, disp).replace('E', 'e'));
}

// Like formatNumber, but drops precision until the text fits in `width`.
export function fitNumber(x, width, disp = DEFAULT_DISP, separator = false) {
  let s = withSeparator(formatNumber(x, disp), separator);
  for (let sig = 9; s.length > width && sig >= 1; sig--) {
    s = formatNumber(x, disp.type === 'Fix' ? DEFAULT_DISP : disp, sig);
  }
  return s.length > width ? s.slice(0, width) : s;
}

function withSeparator(s, on) {
  if (!on || s.includes('E')) return s;
  const [int, frac] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

function trimZeros(s) {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
