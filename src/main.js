// DOM wiring: builds the keyboard, forwards presses to the state machine and
// paints the LCD after every key.

import { createState, press, render, snapshot, W } from './calculator.js';
import { UPPER_LEFT, PAD, UPPER_RIGHT, FINANCE, SCIENTIFIC, NUMPAD } from './keys.js';

const STORAGE_KEY = 'fc100v-state';

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot(state)));
  } catch {
    /* storage unavailable: the calculator still works, it just forgets */
  }
}

const state = createState(load());
const buttons = new Map();

function buildKey(key) {
  const wrap = document.createElement('div');
  wrap.className = `key-wrap ${key.cls ?? ''}`;
  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = `<span class="sh">${key.shift?.label ?? ''}</span><span class="al">${key.alpha ?? ''}</span>`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'key';
  btn.textContent = key.label;
  btn.setAttribute('aria-label', key.label);
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hit(key.id);
  });
  btn.addEventListener('keydown', (e) => {
    // Keyboard users activating the focused button.
    if (e.key === ' ') {
      e.preventDefault();
      hit(key.id);
    }
  });
  buttons.set(key.id, btn);
  wrap.append(legend, btn);
  return wrap;
}

function buildPadKey(key) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `pad-key pad-${key.id}`;
  btn.textContent = key.label;
  btn.setAttribute('aria-label', key.id);
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hit(key.id);
  });
  buttons.set(key.id, btn);
  return btn;
}

const mount = (id, keys, build = buildKey) => document.getElementById(id).append(...keys.map(build));
mount('upper-left', UPPER_LEFT);
mount('pad', PAD, buildPadKey);
mount('upper-right', UPPER_RIGHT);
mount('finance', FINANCE);
mount('scientific', SCIENTIFIC);
mount('numpad', NUMPAD);

function hit(id) {
  press(state, id);
  paint();
  save(state);
  const btn = buttons.get(id);
  if (btn) {
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 110);
  }
  if (navigator.vibrate) navigator.vibrate(4);
}

// ---------- LCD ----------
const segmenter = new Intl.Segmenter();
const graphemes = (s) => [...segmenter.segment(s)].map((g) => g.segment);
const linesEl = document.getElementById('lines');
const indicatorsEl = document.getElementById('indicators');
const lcd = document.getElementById('lcd');

function paint() {
  const view = render(state);
  lcd.classList.toggle('off', view.off);
  linesEl.replaceChildren();
  indicatorsEl.replaceChildren();
  if (view.off) return;

  const ind = view.indicators;
  for (const [name, on] of [
    ['S', ind.S], ['A', ind.A], ['M', ind.M], ['STO', ind.STO], ['RCL', ind.RCL],
    ['BGN', ind.BGN], ['FIX', ind.FIX],
  ]) {
    const el = document.createElement('span');
    el.textContent = name;
    el.className = on ? 'on' : '';
    indicatorsEl.append(el);
  }
  const arrows = document.createElement('span');
  arrows.className = 'arrows';
  arrows.textContent = `${ind.up ? '▲' : ' '}${ind.down ? '▼' : ' '}`;
  const mode = document.createElement('span');
  mode.className = 'mode-name on';
  mode.textContent = ind.mode;
  indicatorsEl.append(arrows, mode);

  view.lines.forEach((text, r) => {
    const line = document.createElement('div');
    line.className = 'line';
    const chars = graphemes(text);
    while (chars.length < W) chars.push(' ');
    chars.slice(0, W).forEach((ch, c) => {
      const cell = document.createElement('span');
      cell.textContent = ch;
      const h = view.highlight;
      if (h && h.line === r && c >= h.from && c < h.to) cell.className = 'inv';
      if (view.cursor && view.cursor.line === r && view.cursor.col === c) cell.className = 'cursor';
      line.append(cell);
    });
    linesEl.append(line);
  });
}

// ---------- physical keyboard ----------
const KEYBOARD = {
  Enter: 'exe', '=': 'exe', Backspace: 'del', Delete: 'ac', Escape: 'esc',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  '+': 'add', '-': 'sub', '*': 'mul', x: 'mul', '/': 'div', '^': 'pow',
  '(': 'lp', ')': 'rp', '.': 'dot', ',': 'dot', '%': 'pct', e: 'exp', s: 'solve',
};
for (let d = 0; d <= 9; d++) KEYBOARD[d] = String(d);

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.getElementById('help').open) return;
  const id = KEYBOARD[e.key];
  if (!id) return;
  e.preventDefault();
  hit(id);
});

// ---------- help ----------
const help = document.getElementById('help');
document.getElementById('help-btn').addEventListener('click', () => help.showModal());
help.addEventListener('click', (e) => {
  if (e.target === help) help.close();
});

paint();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
