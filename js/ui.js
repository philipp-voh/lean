// Small view helpers: an escaping template tag, number and date formats, icons, toasts and sheets.

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

let toastTimer;
// One line at the bottom; an action such as Undo stays tappable for ms.
export function toast(text, { action, onAction, ms = 5000 } = {}) {
  const box = document.getElementById('toast');
  box.replaceChildren();
  const p = document.createElement('p');
  p.textContent = text;
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

export const sheet = id => document.getElementById(id)?.showModal();
export const close = id => document.getElementById(id)?.close();
