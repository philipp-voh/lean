// Small view helpers: an escaping template tag, number and date formats, icons, Pinto, toasts and sheets.

class Html {
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = v => String(v).replace(/[&<>"']/g, c => ESC[c]);
const piece = v => (v == null || v === false ? '' : v instanceof Html ? v.text : Array.isArray(v) ? v.map(piece).join('') : escape(v));

// Every value is escaped, AI text included; only other html results and raw() pass through.
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += piece(v) + strings[i + 1]; });
  return new Html(out);
}
export const raw = text => new Html(String(text));

/* ---------- Formats ---------- */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const asDate = day => new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));

export const fmt = {
  kcal: n => Math.round(n).toLocaleString('en-US'),
  g: n => `${Math.round(n)} g`,
  kg: n => `${(Math.round(n * 10) / 10).toFixed(1)} kg`,
  one: n => (Math.round(n * 10) / 10).toFixed(1),
  // Amounts keep up to one decimal: 1.5 pieces, 62.5 g
  amount: n => String(Math.round(n * 10) / 10),
  dayLong: day => { const d = asDate(day); return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; },
  dayShort: day => { const d = asDate(day); return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; },
  weekday: day => DAYS[asDate(day).getDay()],
  dayMonth: day => { const d = asDate(day); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; },
  month: month => `${MONTHS[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}`,
  signed: n => (n < 0 ? '−' : '+') + (Math.round(Math.abs(n) * 10) / 10).toFixed(1),
};

/* ---------- Icons, toasts, sheets ---------- */

export const icon = (name, cls = 'ic') => raw(`<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`);

/* ---------- Pinto, Lean's mascot: decoration only, hidden from VoiceOver; its moves are in app.css ---------- */

// The poses, true where a second image holds the marks around the figure (wave lines, sparkles, the thought bubble).
const POSES = { hello: true, lean: true, rest: false, strong1: false, strong2: false, strong3: true, big: true, think: true, proud: true, nod: true, peek: false };
const DOTS = raw('<svg class="pt-dots" viewBox="0 0 192 192" aria-hidden="true"><circle class="pt-dot pt-dot-1" cx="136.0" cy="48.7" r="2.9"/><circle class="pt-dot pt-dot-2" cx="145.2" cy="48.7" r="2.9"/><circle class="pt-dot pt-dot-3" cx="154.2" cy="48.7" r="2.9"/></svg>');

// On unless the Pinto switch in Settings is off.
export const pintoOn = settings => settings.pinto !== false;

// One pose; `play` adds the arrival and the pose's gesture. An unknown pose draws nothing.
export function pinto(pose, play = false) {
  if (!Object.hasOwn(POSES, pose)) return '';
  const cls = pose.startsWith('strong') ? 'strong' : pose;
  return html`<span class="pinto ${cls}${play ? ' play' : ''}" aria-hidden="true"><img class="pt-fig" src="art/pinto-${pose}.webp" alt="">${
    POSES[pose] ? html`<img class="pt-fx" src="art/pinto-${pose}-fx.webp" alt="">` : ''}${pose === 'think' ? DOTS : ''}</span>`;
}

// Pinto moves once per appearance: true only the first time a key (the place and the day) is asked,
// so the redraws after it keep Pinto still.
const seen = new Set();
export const firstTime = key => !seen.has(key) && !!seen.add(key);

let toastTimer;
// One line at the bottom; an action such as Undo stays tappable for ms. With `pinto`, Pinto comes first and always
// moves (the toast lives outside #app, so no redraw replays it), and a news `line` follows the text in semibold.
export function toast(text, { pinto: pose, line, action, onAction, ms = 5000 } = {}) {
  const box = document.getElementById('toast');
  box.replaceChildren();
  if (pose) box.insertAdjacentHTML('beforeend', String(pinto(pose, true)));
  const p = document.createElement('p');
  p.textContent = text;
  if (line) {
    const b = document.createElement('b');
    b.textContent = line;
    p.append(' ', b);
  }
  box.append(p);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-btn';
    b.textContent = action;
    b.addEventListener('click', () => { box.hidden = true; onAction?.(); }, { once: true });
    box.append(b);
  }
  box.dataset.at = location.hash;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, ms);
}

// Before a delete that matters: an iPhone-style sheet with the action in red and Cancel, which has the focus.
// Resolves true only for the action. It lives outside #app, so no redraw touches it.
export function ask(text, yes) {
  let d = document.getElementById('ask');
  if (!d) {
    d = document.createElement('dialog');
    Object.assign(d, { id: 'ask', className: 'sheet' });
    d.setAttribute('aria-labelledby', 'ask-t');
    d.addEventListener('click', e => { if (e.target === d) d.close(); });   // a tap on the dimmed backdrop
    document.body.append(d);
  }
  d.innerHTML = String(html`<div class="sheet-body"><p class="sheet-text" id="ask-t">${text}</p>
    <button class="btn danger block" type="button" data-ask="yes">${yes}</button><button class="btn secondary block" type="button" data-ask="no" autofocus>Cancel</button></div>`);
  return new Promise(resolve => {
    let yesTapped = false;
    d.querySelector('[data-ask=yes]').addEventListener('click', () => { yesTapped = true; d.close(); });
    d.querySelector('[data-ask=no]').addEventListener('click', () => d.close());
    d.addEventListener('close', () => resolve(yesTapped), { once: true });
    d.showModal();
  });
}

export const sheet = id => document.getElementById(id)?.showModal();
export const close = id => document.getElementById(id)?.close();
