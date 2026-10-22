// Expression engine for the calculator line.
// Expressions are arrays of display tokens (what the user typed); evaluate()
// parses them with Casio-style precedence: postfix > power > negation > ×÷ > +−.

export class CalcError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind; // 'Syntax ERROR' | 'Math ERROR'
  }
}

export const syntaxError = () => new CalcError('Syntax ERROR');
export const mathError = () => new CalcError('Math ERROR');

const FUNCS = {
  '√(': Math.sqrt,
  '∛(': Math.cbrt,
  'ln(': Math.log,
  'log(': Math.log10,
  'e^(': Math.exp,
  '10^(': (x) => 10 ** x,
};

const POSTFIX = {
  '²': (x) => x * x,
  '³': (x) => x * x * x,
  '⁻¹': (x) => {
    if (x === 0) throw mathError();
    return 1 / x;
  },
  '!': factorial,
  '%': (x) => x / 100,
};

export const VARIABLES = ['A', 'B', 'C', 'D', 'M'];

function factorial(x) {
  if (!Number.isInteger(x) || x < 0 || x > 69) throw mathError();
  let r = 1;
  for (let i = 2; i <= x; i++) r *= i;
  return r;
}

// Splits display tokens into lexical tokens: numbers are assembled from digit,
// '.' and 'E' tokens; everything else passes through unchanged.
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

export function evaluate(tokens, vars = {}) {
  if (!tokens.length) throw syntaxError();
  const toks = lex(tokens);
  let pos = 0;
  const peek = () => toks[pos];
  const isTok = (v) => peek() && peek().type === 'tok' && peek().value === v;

  const startsPrimary = () => {
    const t = peek();
    if (!t) return false;
    if (t.type === 'num') return true;
    const v = t.value;
    return v === '(' || v in FUNCS || v === 'Ans' || VARIABLES.includes(v);
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
    if (v === '(') {
      pos++;
      const r = expr();
      closeParen();
      return r;
    }
    if (v in FUNCS) {
      pos++;
      const arg = expr();
      closeParen();
      return FUNCS[v](arg);
    }
    if (v === 'Ans' || VARIABLES.includes(v)) {
      pos++;
      return vars[v] ?? 0;
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
      return base ** exp;
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

  function term() {
    let x = unary();
    for (;;) {
      if (isTok('×')) {
        pos++;
        x *= unary();
      } else if (isTok('÷')) {
        pos++;
        const d = unary();
        if (d === 0) throw mathError();
        x /= d;
      } else if (startsPrimary()) {
        x *= unary();
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
  if (!Number.isFinite(result)) throw mathError();
  return result;
}

// Formats a number the way the display shows it: 10 significant digits,
// scientific notation outside 1e-9..1e10, or a fixed number of decimals.
export function formatNumber(x, fix = null, sig = 10) {
  if (!Number.isFinite(x)) return 'ERROR';
  if (Object.is(x, -0) || x === 0) return fix === null ? '0' : (0).toFixed(fix);
  if (fix !== null && Math.abs(x) < 1e10) {
    const s = x.toFixed(fix);
    return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
  }
  const r = Number(x.toPrecision(sig));
  const abs = Math.abs(r);
  if (abs >= 1e10 || abs < 1e-9) {
    const [m, e] = r.toExponential(sig - 1).split('e');
    return `${trimZeros(m)}E${Number(e)}`;
  }
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)));
  return trimZeros(r.toFixed(Math.min(digits, 20)));
}

// Like formatNumber, but drops precision until the text fits in `width`.
export function fitNumber(x, width, fix = null) {
  let s = formatNumber(x, fix);
  for (let sig = 9; s.length > width && sig >= 1; sig--) s = formatNumber(x, null, sig);
  return s.length > width ? s.slice(0, width) : s;
}

function trimZeros(s) {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
