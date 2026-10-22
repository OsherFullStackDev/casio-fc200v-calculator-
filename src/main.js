// DOM wiring: builds the keyboard, forwards presses to the state machine and
// paints the LCD after every key.

import { createState, press, render, snapshot, W } from './calculator.js';
import { TOP_LEFT, PAD, TOP_RIGHT, MODE_KEYS, NUMPAD } from './keys.js';

const STORAGE_KEY = 'fc200v-state';

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

const span = (cls, text) => {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
};

function onPress(btn, id) {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hit(id);
  });
  btn.addEventListener('keydown', (e) => {
    // Keyboard users activating the focused button.
    if (e.key === ' ') {
      e.preventDefault();
      hit(id);
    }
  });
  buttons.set(id, btn);
}

function buildKey(key) {
  const wrap = document.createElement('div');
  wrap.className = `key-wrap ${key.cls ?? ''}`;
  const legend = document.createElement('div');
  legend.className = 'legend';
  if (key.above) legend.append(span(`above ${key.aboveCls ?? ''}`, key.above));
  if (key.shift) legend.append(span('sh', key.shift.label));
  if (key.alpha) legend.append(span('al', key.alpha));
  if (key.shift && !key.alpha) legend.classList.add('center');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'key';
  btn.setAttribute('aria-label', key.label);
  // Oval keys carry no text: their name is printed on the body above them.
  if (key.label.startsWith('SHORT CUT')) {
    // Printed on two lines, as on the key itself.
    btn.append('SHORT', document.createElement('br'), key.label.slice(6));
  } else if (!key.above) {
    btn.textContent = key.label;
  }
  onPress(btn, key.id);
  wrap.append(legend, btn);
  return wrap;
}

function buildPadKey(key) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `pad-key pad-${key.id}`;
  btn.textContent = key.label;
  btn.setAttribute('aria-label', key.id);
  onPress(btn, key.id);
  return btn;
}

const mount = (id, keys, build = buildKey) => document.getElementById(id).append(...keys.map(build));
mount('top-left', TOP_LEFT);
mount('top-right', TOP_RIGHT);
mount('modes', MODE_KEYS);
mount('numpad', NUMPAD);
const pad = document.getElementById('pad');
pad.append(...PAD.map(buildPadKey), span('replay', 'REPLAY'));

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

const INDICATORS = ['S', 'A', 'M', 'STO', 'RCL', 'STAT', '360', 'SI', 'DMY', 'D', 'R', 'G', 'FIX', 'SCI'];

function paint() {
  const view = render(state);
  lcd.classList.toggle('off', view.off);
  lcd.style.setProperty('--contrast', view.contrast ?? 0);
  linesEl.replaceChildren();
  indicatorsEl.replaceChildren();
  if (view.off) return;

  const ind = view.indicators;
  for (const name of INDICATORS) {
    indicatorsEl.append(span(`${ind[name] ? 'on' : ''} ${name === 'S' ? 'ind-s' : ''}`, name));
  }
  const arrows = document.createElement('span');
  arrows.className = 'arrows';
  arrows.append(span(ind.down ? 'on' : '', '▼'), span(ind.up ? 'on' : '', '▲'));
  indicatorsEl.append(arrows, span(ind.Disp ? 'on disp' : 'disp', 'Disp'));

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
      if (view.cursor && view.cursor.line === r && view.cursor.col === c) {
        cell.className = view.overwrite ? 'cursor block' : 'cursor';
      }
      line.append(cell);
    });
    linesEl.append(line);
  });
}

// ---------- physical keyboard ----------
const KEYBOARD = {
  Enter: 'exe', '=': 'exe', Backspace: 'del', Delete: 'ac', Escape: 'esc',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  '+': 'add', '-': 'sub', '*': 'mul', x: 'mul', '/': 'div',
  '(': 'lp', ')': 'rp', '.': 'dot', e: 'exp', s: 'solve',
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
