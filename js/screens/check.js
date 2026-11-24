// B3 Check and save with S4 estimating, S5 free limit reached and the other messages, manual entry
// ("Type the numbers"), and S6 a saved meal (Save, Log again, Move, Delete with Undo on Today).
import * as db from '../db.js';
import { MAX, dayStr, itemTotals, localStamp, mealTotals, parseNum, portion, stepFor } from '../logic.js';
import { usedUp } from '../ai.js';
import { thumb } from '../photos.js';
import { close, fmt, html, icon, sheet, toast } from '../ui.js';
import { dayRoute, gone, hhmm, spinner } from './add.js';
import { logAgainMeal } from './today.js';

const PORTIONS = [[0.5, '½', 'Half'], [0.75, '¾', 'Three quarters'], [1, 'All', 'All'], [1.5, '1½', 'One and a half'], [2, '2×', 'Double']];
const UNIT = { g: 'g', ml: 'ml', piece: 'piece' };

let params = {};
let saved = null;       // S6: an edited copy of the saved meal, kept until Save
let pencil = null;      // 'kcal' or 'protein' while a total is being typed
let itemAt = null;      // the item open in the item sheet: an index or 'new'
let changed = false;    // S6: the copy differs from the saved meal, so leaving discards it (the bar says Cancel)

export function enter(state, p) {
  params = p;
  pencil = null;
  itemAt = null;
  changed = false;
  const m = p.mealId && state.meals.find(x => x.id === p.mealId);
  saved = m ? { ...structuredClone(m), factor: 1 } : null;
}

const draftOf = state => state.drafts.find(d => d.id === params.id);

// The AI's items carry totals for the amount; Lean keeps values per unit, so amounts can change.
function fromResult(r) {
  const items = r.items.map(i => ({
    name: i.name, amount: i.amount, unit: i.unit, source: i.source, confidence: i.confidence,
    per: { kcal: i.kcal / i.amount, protein: i.protein / i.amount, carbs: i.carbs / i.amount, fat: i.fat / i.amount },
  }));
  return { name: r.dish, items, factor: 1, kcalSet: null, proteinSet: null, correction: '' };
}

// What is being checked: a draft's edits (saved with the draft) or the saved meal's copy.
function workOf(state) {
  if (params.mealId) return saved;
  const d = draftOf(state);
  if (!d) return null;
  // A short description becomes the name, so what was typed before the free limit ran out isn't lost.
  if (d.kind === 'quick') return (d.edits ??= { name: d.text.trim().length <= 60 ? d.text.trim() : '', kcal: '', protein: '', carbs: '', fat: '' });
  return d.result ? (d.edits ??= fromResult(d.result)) : null;
}

// A draft saves each change; a saved meal's copy only marks itself changed until Save.
const keep = ctx => { changed = true; const d = draftOf(ctx.state); if (d) return ctx.save('drafts', d); };
const keepSoon = ctx => { const d = draftOf(ctx.state); if (d) ctx.saveSoon('drafts', d); };

/* ---------- View ---------- */

export function view(state) {
  if (params.mealId) return saved ? review(state, saved, null) : gone();
  const d = draftOf(state);
  if (!d) return gone();
  // The spinner only while a call really runs: a stored 'estimating' (the app was killed) is a waiting meal.
  if (state.running[d.id]) return estimating(state, d);
  if (d.kind === 'quick') return manual(state, d);
  if (d.status === 'ready' && d.result) return review(state, workOf(state), d);
  return problem(state, d);   // failed, waiting, or not estimated yet
}

const photosOf = d => html`<div class="est-photos">${d.photos.map((p, i) => html`<img data-draft="${d.id}" data-index="${i}" alt="Photo ${i + 1}">`)}</div>`;
const backTo = d => `#/${d.kind === 'text' ? 'describe' : 'add'}/${d.id}`;

function estimating(state, d) {
  const slow = state.running[d.id]?.slow;
  const row = html`<li class="sk-row"><div class="sk-top"><span class="skel w46 h16"></span><span class="skel w52 h16"></span><span class="skel w30 h16"></span></div>
    <div class="sk-bottom"><span class="skel w38 h12"></span><span class="skel sk-step"></span></div></li>`;
  return html`
  <nav class="nav bar"><button class="text-btn" data-action="cancel">Cancel</button><span class="title">Check and save</span><span></span></nav>
  <div class="screen">
    <h1 class="sr" tabindex="-1">Estimating</h1>
    ${d.photos.length ? photosOf(d) : html`<p class="quote">${d.text}</p>`}
    <p class="est-line" role="status">${spinner}<span>Estimating<small>${slow ? 'Taking longer than usual' : 'Usually 5 to 10 seconds'}</small></span></p>
    <div aria-hidden="true">
      <div class="sk-tot"><span class="skel sk-k"></span><span class="skel sk-p"></span></div>
      <span class="skel sk-m"></span>
      <ul class="rows sk-rows">${[row, row, row]}</ul>
    </div>
  </div>`;
}

// Every message keeps the draft: what happened, then what to do next.
function problem(state, d) {
  const waiting = ['waiting', 'estimating'].includes(d.status);
  // A daily-limit message only holds while the limit does.
  const e = d.error?.kind === 'daily' && !usedUp(d.kind, state.settings.quota, new Date()) ? null : d.error;
  const kept = d.photos.length ? 'Your photos are kept.' : 'Your text is kept.';
  let title, text, primary;
  if (!e || waiting) {
    title = waiting ? 'Waiting to estimate' : 'Not estimated yet';
    // Waiting for the connection, for the free limit to reset, or simply for the next time Lean opens.
    const until = d.error?.kind === 'daily' ? Object.values(state.settings.quota ?? {}).filter(t => new Date(t) > new Date()).sort()[0] : null;
    const why = !navigator.onLine ? "Lean estimates this meal once you're back online."
      : until ? `Lean estimates this meal once the free estimates reset at ${hhmm(new Date(until))}.` : 'Lean tries again the next time you open it.';
    text = waiting ? `${why} ${kept}` : kept;
    primary = 'retry';
  } else {
    const [first, ...rest] = e.message.split(/(?<=\.)\s+/);
    title = first.replace(/\.$/, '');
    text = [...rest, kept].join(' ');
    primary = ['daily', 'blocked', 'gone'].includes(e.kind) ? 'manual' : ['key', 'leaked'].includes(e.kind) ? 'key' : 'retry';
  }
  const btn = {
    retry: html`<button class="btn primary block" data-action="retry">${icon('refresh')}Try again</button>`,
    manual: html`<button class="btn primary block" data-action="manual">Type the numbers</button>`,
    key: html`<button class="btn primary block" data-action="changeKey">Check the key</button>`,
  };
  return html`
  <nav class="nav bar"><button class="text-btn" data-action="go" data-to="${backTo(d)}" data-replace>${icon('left')}${d.photos.length ? 'Photos' : 'Text'}</button><span class="title">Check and save</span><span></span></nav>
  <div class="screen">
    <h1 class="sr" tabindex="-1">${title}</h1>
    ${d.photos.length ? photosOf(d) : html`<p class="quote">${d.text}</p>`}
    <div class="alert" role="alert">${icon(e?.kind === 'daily' ? 'clock' : waiting ? (navigator.onLine ? 'clock' : 'offline') : 'alert')}<div>
      <p class="alert-t">${title}</p><p class="alert-s">${text}</p>
      ${e?.link ? html`<a class="link" href="${e.link}" target="_blank" rel="noopener noreferrer">Open Google${icon('external', 'ic sm')}</a>` : ''}</div></div>
    <div class="choice">
      ${btn[primary]}
      ${primary !== 'manual' ? html`<button class="btn secondary block" data-action="manual">Type the numbers</button>` : ''}
      <button class="btn secondary block" data-action="later">Save for later</button>
    </div>
  </div>`;
}

function itemRow(it, i) {
  const t = itemTotals(it);
  const src = it.source === 'label'
    ? `From label · ${it.unit === 'piece' ? `${fmt.kcal(it.per.kcal)} kcal each` : `${fmt.kcal(it.per.kcal * 100)} kcal per 100 ${it.unit}`}`
    : it.source === 'user' ? 'Set by you' : it.confidence === 'low' ? 'Estimated, unsure' : 'Estimated';
  const amt = `${fmt.amount(it.amount)} ${it.unit === 'piece' ? (it.amount === 1 ? 'piece' : 'pieces') : it.unit}`;
  return html`<li class="item">
    <div class="item-top"><button class="name item-name" data-action="openItem" data-index="${i}" aria-label="${it.name}, edit">${it.name}</button><span class="spacer"></span>
      <span class="ik">${fmt.kcal(t.kcal)}<span class="sr"> kcal</span></span><span class="ip">${Math.round(t.protein)} g<span class="sr"> protein</span></span></div>
    <div class="item-bottom"><p class="src${it.source === 'label' ? ' label' : ''}">${src}</p>
      <div class="stepper"><button data-action="step" data-index="${i}" data-v="-1" aria-label="Less ${it.name}, ${amt}">${icon('minus')}</button>
        <span class="amt">${amt}</span>
        <button data-action="step" data-index="${i}" data-v="1" aria-label="More ${it.name}, ${amt}">${icon('plus')}</button></div></div></li>`;
}

function total(work, key, value, label, unit) {
  const open = pencil === key;
  const shown = key === 'kcal' ? fmt.kcal(value) : String(Math.round(value));
  return html`<div class="tl${key === 'protein' ? ' prot' : ''}">
    ${open ? html`<input class="num num-edit" id="t-${key}" inputmode="numeric" autocomplete="off" value="${work[`${key}Set`] ?? Math.round(value)}"
      data-input="setTotal" data-v="${key}" aria-label="${label} for this meal">` : html`<span class="num" data-out="${key}">${shown}</span>`}
    <span class="unit">${unit}</span>
    ${open ? '' : html`<button class="icon-btn" data-action="pencil" data-v="${key}" aria-label="Type the ${label.toLowerCase()}">${icon('pencil')}</button>`}</div>`;
}

function review(state, work, d) {
  const today = dayStr(new Date());
  const meal = d ? null : work;
  const t = mealTotals(work), labels = work.items.filter(i => i.source === 'label').length;
  const day = d ? d.day : meal.day, time = d ? d.time : meal.time, count = d ? d.photos.length : meal.photoCount;
  const minis = d ? d.photos.map((p, i) => html`<img class="mini" data-draft="${d.id}" data-index="${i}" alt="">`)
    : count ? html`<img class="mini" data-photo="${meal.id}" alt="">` : '';
  const facts = [day === today ? (meal ? `Today, ${time}` : null) : `${fmt.dayShort(day)}, ${time}`,
    count ? `${count} ${count === 1 ? 'photo' : 'photos'}` : d?.kind === 'text' || meal?.kind === 'text' ? 'Described' : null,
    labels ? `${labels} ${labels === 1 ? 'label' : 'labels'} read` : null].filter(Boolean).join(' · ');
  const set = work.kcalSet != null || work.proteinSet != null;
  return html`
  <nav class="nav bar">
    ${d ? html`<button class="text-btn" data-action="back">${icon('left')}${d.photos.length ? 'Photos' : 'Text'}</button>`
      : html`<button class="text-btn" data-action="go" data-to="${dayRoute(day, today)}" data-replace>${changed ? 'Cancel' : html`${icon('left')}${day === today ? 'Today' : fmt.weekday(day)}`}</button>`}
    <span class="title">${d ? 'Check and save' : 'Meal'}</span>
    <button class="btn primary sm" data-action="save">Save</button>
  </nav>
  <div class="screen">
    <h1 class="dish" tabindex="-1">${work.name || (work.kind === 'quick' ? 'Quick add' : 'Meal')}</h1>
    ${facts || minis ? html`<div class="srcline">${minis}<span class="sub">${facts}</span></div>` : ''}
    <div class="totals">${total(work, 'kcal', t.kcal, 'Calories', 'kcal')}${total(work, 'protein', t.protein, 'Protein', 'g protein')}</div>
    <p class="macros" data-out="macros">Carbs&nbsp;${fmt.g(t.carbs)} · Fat&nbsp;${fmt.g(t.fat)}</p>
    <p class="set-by-you" data-out="setNote"${set ? '' : ' hidden'}>You set this total. The items no longer change it.
      <button class="link inline" data-action="unset">Use the items</button></p>
    <div class="portion-row"><p class="seg-label" id="c-eaten">Eaten</p>
      <div class="seg" role="radiogroup" aria-labelledby="c-eaten">${PORTIONS.map(([v, l, a]) => html`
        <button role="radio" aria-checked="${work.factor === v}" aria-label="${a}" data-action="portion" data-v="${v}">${l}</button>`)}</div></div>
    <ul class="rows items">${work.items.map(itemRow)}</ul>
    <button class="link" data-action="openItem" data-index="new">${icon('plus')}Add item</button>
    ${work.assumptions ?? d?.result?.assumptions ? html`<p class="assume">${work.assumptions ?? d.result.assumptions}</p>` : ''}
    ${d?.lighterNote ? html`<p class="fine">${d.lighterNote}</p>` : ''}
    <p class="field-err" role="alert" data-out="why"></p>
    ${d ? html`
    <label class="field-label" for="c-note">Anything to correct?</label>
    <div class="note-row"><input class="input" id="c-note" value="${work.correction ?? ''}" maxlength="300" autocomplete="off" placeholder="It was oat milk" data-input="correction">
      <button class="btn secondary" data-action="reEstimate">${icon('refresh')}Re-estimate</button></div>
    <div class="kv"><label for="c-time">${day === today ? 'Time' : `${fmt.dayShort(day)}, time`}</label><input class="date-in" id="c-time" type="time" value="${time}" data-change="time"></div>` : html`
    <ul class="actions">
      <li><button class="act" data-action="logAgain">${icon('plus')}Log again</button></li>
      <li><button class="act" data-action="openMove">${icon('calendar')}Move to another day or time</button></li>
    </ul>
    <ul class="actions gap-s"><li><button class="act danger" data-action="delete">${icon('trash')}Delete</button></li></ul>`}
  </div>
  ${itemSheet(work)}${meal ? moveSheet(meal, today, state.settings.firstDay) : ''}`;
}

function itemSheet(work) {
  const it = itemAt === 'new' ? { name: '', amount: 100, unit: 'g', per: { kcal: 0, protein: 0, carbs: 0, fat: 0 } } : work.items[itemAt];
  if (!it) return '';
  const t = itemTotals(it), r = n => String(Math.round(n * 10) / 10);
  const field = (id, label, value, mode = 'decimal', unit = '') => html`
    <label><span class="fl">${label}</span><span class="num-in"><input id="${id}" value="${value}" inputmode="${mode}" autocomplete="off">${unit ? html`<span class="u">${unit}</span>` : ''}</span></label>`;
  return html`
  <dialog class="sheet" id="item" aria-labelledby="it-t"><div class="sheet-body">
    <div class="sheet-nav"><button class="text-btn" data-action="closeSheet" data-sheet="item">Cancel</button><h2 id="it-t">${itemAt === 'new' ? 'Add item' : 'Item'}</h2>
      <button class="btn primary sm" data-action="saveItem">Save item</button></div>
    <p class="err" role="alert" data-out="itemErr" hidden></p>
    <label class="fl" for="it-name">Name</label><input class="input full" id="it-name" value="${it.name}" maxlength="60" autocomplete="off" placeholder="Olive oil">
    <div class="duo gap">${field('it-amount', 'Amount', r(it.amount))}
      <div><span class="fl" id="it-unit-l">Unit</span><div class="seg" role="radiogroup" aria-labelledby="it-unit-l">${Object.keys(UNIT).map(u => html`
        <button role="radio" aria-checked="${it.unit === u}" data-action="unit" data-v="${u}">${u}</button>`)}</div></div></div>
    <p class="fine gap">For the whole amount:</p>
    <div class="quad">${field('it-kcal', 'Calories', Math.round(t.kcal), 'numeric', 'kcal')}${field('it-protein', 'Protein', r(t.protein), 'decimal', 'g')}${field('it-carbs', 'Carbs', r(t.carbs), 'decimal', 'g')}${field('it-fat', 'Fat', r(t.fat), 'decimal', 'g')}</div>
    ${itemAt === 'new' ? '' : html`<button class="link danger-link" data-action="removeItem">${icon('trash', 'ic sm')}Remove item</button>`}
  </div></dialog>`;
}

const moveSheet = (meal, today, first) => html`
  <dialog class="sheet" id="move" aria-labelledby="mv-t"><div class="sheet-body">
    <div class="sheet-nav"><button class="text-btn" data-action="closeSheet" data-sheet="move">Cancel</button><h2 id="mv-t">Move meal</h2>
      <button class="btn primary sm" data-action="move">Move</button></div>
    <div class="date-row"><label for="mv-day">Day</label><input class="date-in" id="mv-day" type="date" value="${meal.day}" min="${first}" max="${today}"></div>
    <div class="date-row"><label for="mv-time">Time</label><input class="date-in" id="mv-time" type="time" value="${meal.time}"></div>
    <p class="err" id="mv-err" role="alert" hidden>${icon('alert')}<span data-out="mverr"></span></p>
  </div></dialog>`;
const moveError = text => {
  const box = document.getElementById('mv-err');
  if (!box) return;
  box.querySelector('[data-out="mverr"]').textContent = text;
  box.hidden = !text;
};

function manual(state, d) {
  const w = workOf(state), today = dayStr(new Date());
  const num = (field, label, big) => html`<label${field === 'protein' ? html` class="prot"` : ''}><span class="fl2">${label}${big ? '' : html` <span>(optional)</span>`}</span>
    <span class="${big ? 'bigin' : 'num-in'}"><input value="${w[field]}" inputmode="${field === 'kcal' ? 'numeric' : 'decimal'}" autocomplete="off" data-input="quick" data-field="${field}">
    <span class="u">${field === 'kcal' ? 'kcal' : 'g'}</span></span></label>`;
  return html`
  <nav class="nav bar"><button class="text-btn" data-action="back">Cancel</button><span class="title">Type the numbers</span>
    <button class="btn primary sm" data-action="saveQuick">Save</button></nav>
  <div class="screen">
    <h1 class="sr" tabindex="-1">Type the numbers</h1>
    <p class="intro">No AI, and nothing leaves this phone. Type in the numbers you know.</p>
    ${d.photos.length ? photosOf(d) : ''}
    <label class="fl2 gap" for="q-name">Name <span>(optional)</span></label>
    <input class="input full" id="q-name" value="${w.name}" maxlength="60" autocomplete="off" placeholder="Protein shake" data-input="quick" data-field="name">
    <div class="big2">${num('kcal', 'Calories', true)}${num('protein', 'Protein', true)}</div>
    <div class="small2">${num('carbs', 'Carbs', false)}${num('fat', 'Fat', false)}</div>
    <p class="field-err" role="alert" data-out="why"></p>
    <div class="kv"><label for="q-time">${d.day === today ? 'Time' : `${fmt.dayShort(d.day)}, time`}</label><input class="date-in" id="q-time" type="time" value="${d.time}" data-change="time"></div>
  </div>`;
}

/* ---------- Actions ---------- */

const say = text => { const el = document.querySelector('[data-out="why"]'); if (el) el.textContent = text; };
const round1 = n => Math.round(n * 10) / 10;

function update(work) {
  const t = mealTotals(work);
  const set = (name, text) => { const el = document.querySelector(`[data-out="${name}"]`); if (el) el.textContent = text; };
  set('kcal', fmt.kcal(t.kcal));
  set('protein', String(Math.round(t.protein)));
  document.querySelector('[data-out="setNote"]').hidden = work.kcalSet == null && work.proteinSet == null;
}

async function finish(ctx, meal, photo, draftId) {
  await ctx.write(w => {
    w.put('meals', meal);
    if (photo) w.put('photos', photo);
    if (draftId) w.del('drafts', draftId);
  });
  ctx.go(dayRoute(meal.day, ctx.today()), { replace: true });
  toast(meal.day === ctx.today() ? 'Saved to today.' : `Saved to ${fmt.dayShort(meal.day)}.`);
}

export const actions = {
  pencil(el, e, ctx) {
    pencil = el.dataset.v;
    ctx.refresh();
    const input = document.getElementById(`t-${pencil}`);
    input.focus();
    input.select();
  },

  setTotal(el, e, ctx) {
    const work = workOf(ctx.state), v = parseNum(el.value), key = el.dataset.v;
    const max = key === 'kcal' ? 10000 : 1000;
    work[`${key}Set`] = v != null && v <= max ? Math.round(v) : null;
    update(work);
    keepSoon(ctx);
    if (saved && !changed) { changed = true; ctx.refresh(); }   // drawn once the field loses focus: the bar then says Cancel
  },

  async unset(el, e, ctx) {
    const work = workOf(ctx.state);
    work.kcalSet = work.proteinSet = null;
    pencil = null;
    await keep(ctx);
    ctx.refresh();
  },

  async portion(el, e, ctx) {
    const work = workOf(ctx.state), f = Number(el.dataset.v);
    // Amounts change relative to the portion shown, so ½ then All gives back the first amounts.
    work.items = portion(work.items, f / work.factor);
    work.factor = f;
    await keep(ctx);
    ctx.refresh();
  },

  async step(el, e, ctx) {
    const work = workOf(ctx.state), it = work.items[+el.dataset.index];
    const up = el.dataset.v === '1';
    const next = up ? it.amount + stepFor(it.unit, it.amount) : it.amount - stepFor(it.unit, Math.max(0, it.amount - 1e-9));
    it.amount = round1(Math.min(MAX[it.unit], Math.max(0, next)));
    await keep(ctx);
    ctx.refresh();
  },

  async openItem(el, e, ctx) {
    itemAt = el.dataset.index === 'new' ? 'new' : +el.dataset.index;
    ctx.refresh();
    sheet('item');
  },

  unit(el) {
    for (const b of el.parentElement.children) b.setAttribute('aria-checked', b === el);
  },

  async saveItem(el, e, ctx) {
    const work = workOf(ctx.state);
    const val = id => parseNum(document.getElementById(id).value);
    const opt = id => (document.getElementById(id).value.trim() ? val(id) : 0);   // empty is 0, unreadable is refused
    const name = document.getElementById('it-name').value.trim().slice(0, 60);
    const unit = document.querySelector('#item [aria-checked="true"]')?.dataset.v ?? 'g';
    const typedAmount = val('it-amount'), amount = typedAmount == null ? null : round1(typedAmount);
    const kcal = val('it-kcal'), protein = opt('it-protein'), carbs = opt('it-carbs'), fat = opt('it-fat');
    const err = document.querySelector('[data-out="itemErr"]');
    const why = !name ? 'Give the item a name.'
      : amount == null || amount > MAX[unit] || (itemAt === 'new' && amount <= 0) ? `Enter an amount up to ${fmt.kcal(MAX[unit])} ${unit === 'piece' ? 'pieces' : unit}.`
      : kcal == null || kcal > 5000 ? 'Enter the calories, up to 5,000 kcal.'
      : [protein, carbs, fat].some(v => v == null || v > 500) ? 'Protein, carbs and fat are numbers up to 500 g.' : null;
    if (why) { err.textContent = why; err.hidden = false; return; }
    const old = itemAt === 'new' ? null : work.items[itemAt];
    // Only the amount changed: the values per unit stay. At amount 0 they stay too, so stepping up brings them back.
    const t = old && itemTotals(old);
    const same = old && unit === old.unit && Math.round(t.kcal) === kcal && [['protein', protein], ['carbs', carbs], ['fat', fat]].every(([k, v]) => round1(t[k]) === v);
    const per = same || amount <= 0 ? old.per : { kcal: kcal / amount, protein: protein / amount, carbs: carbs / amount, fat: fat / amount };
    const item = same ? { ...old, name, amount } : { name, amount, unit, per, source: 'user', confidence: 'high' };
    if (old) work.items[itemAt] = item; else work.items.push(item);
    close('item');
    itemAt = null;
    await keep(ctx);
    ctx.refresh();
  },

  async removeItem(el, e, ctx) {
    workOf(ctx.state).items.splice(itemAt, 1);
    close('item');
    itemAt = null;
    await keep(ctx);
    ctx.refresh();
  },

  correction(el, e, ctx) { workOf(ctx.state).correction = el.value; say(''); keepSoon(ctx); },

  async time(el, e, ctx) {
    const d = draftOf(ctx.state);
    if (/^\d{2}:\d{2}$/.test(el.value)) { d.time = el.value; await ctx.save('drafts', d); } else el.value = d.time;
  },

  quick(el, e, ctx) { workOf(ctx.state)[el.dataset.field] = el.value; say(''); keepSoon(ctx); },

  async reEstimate(el, e, ctx) {
    const work = workOf(ctx.state), d = draftOf(ctx.state);
    if (!work.correction?.trim()) { say('Type what to correct first, such as it was oat milk.'); return; }
    const items = work.items.map(i => ({ name: i.name, amount: i.amount, unit: i.unit, ...itemTotals(i) }));
    await keep(ctx);
    ctx.estimate(d.id, { correction: work.correction.trim(), items });
    ctx.refresh();
  },

  async retry(el, e, ctx) { ctx.estimate(draftOf(ctx.state).id); ctx.refresh(); },

  async cancel(el, e, ctx) {
    const d = draftOf(ctx.state), run = ctx.state.running[d.id];
    if (run) run.cancelled = true;
    delete ctx.state.running[d.id];
    d.status = d.result ? 'ready' : 'editing';
    await ctx.save('drafts', d);
    ctx.go(d.result ? `#/check/${d.id}` : backTo(d), { replace: true });
  },

  async manual(el, e, ctx) {
    const d = draftOf(ctx.state);
    Object.assign(d, { kind: 'quick', status: 'ready', error: null, edits: null });
    await ctx.save('drafts', d);
    ctx.refresh();
  },

  // From typed numbers back to the photos or text; from the estimate back to editing.
  async back(el, e, ctx) {
    const d = draftOf(ctx.state);
    if (d.kind === 'quick') {
      Object.assign(d, { kind: d.photos.length ? 'photo' : 'text', status: 'editing', edits: null, result: null });
      await ctx.save('drafts', d);
    }
    ctx.go(backTo(d), { replace: true });
  },

  async later(el, e, ctx) {
    const d = draftOf(ctx.state);
    d.status = 'waiting';
    await ctx.save('drafts', d);
    ctx.go(dayRoute(d.day, ctx.today()), { replace: true });
  },

  changeKey(el, e, ctx) { ctx.state.ui.keyFrom = `#/check/${params.id}`; ctx.go('#/key'); },

  async save(el, e, ctx) {
    const work = workOf(ctx.state), d = draftOf(ctx.state);
    if (!work.items.length && work.kcalSet == null) { say('Add an item or type the calories.'); return; }
    const now = ctx.now().toISOString();
    const { factor, correction, ...fields } = work;
    if (!d) {
      await finish(ctx, { ...fields, updatedAt: now }, null, null);
      return;
    }
    const meal = {
      id: d.id, day: d.day, time: d.time, name: (work.name || work.items[0]?.name || 'Meal').slice(0, 60), kind: d.kind,
      items: work.items, kcalSet: work.kcalSet, proteinSet: work.proteinSet, hints: d.hints,
      note: d.kind === 'text' ? d.text : d.note, assumptions: d.result?.assumptions ?? null,
      photoCount: d.photos.length, model: d.model ?? null, createdAt: d.createdAt ?? localStamp(ctx.now()), updatedAt: now,
    };
    const photo = d.photos.length ? { mealId: d.id, ...(await thumb(d.photos[0])) } : null;
    await finish(ctx, meal, photo, d.id);
  },

  async saveQuick(el, e, ctx) {
    const d = draftOf(ctx.state), w = workOf(ctx.state);
    const n = f => (String(w[f]).trim() ? parseNum(w[f]) : 0);
    const kcal = String(w.kcal).trim() ? parseNum(w.kcal) : null, protein = String(w.protein).trim() ? parseNum(w.protein) : null;
    const carbs = n('carbs'), fat = n('fat');
    const why = kcal == null || kcal > 5000 ? 'Enter the calories, up to 5,000 kcal.'
      : protein == null || protein > 500 ? 'Enter the protein, up to 500 g.'
      : [protein, carbs, fat].some(v => v == null || v > 500) ? 'Protein, carbs and fat are numbers up to 500 g.' : null;
    if (why) { say(why); return; }
    // Unnamed entries keep an empty name, so Log again never offers them as one meal.
    const now = ctx.now().toISOString(), name = String(w.name).trim().slice(0, 60);
    const meal = {
      id: d.id, day: d.day, time: d.time, name, kind: 'quick',
      items: [{ name: name || 'Quick add', amount: 1, unit: 'piece', per: { kcal: Math.round(kcal), protein: round1(protein), carbs: round1(carbs), fat: round1(fat) }, source: 'user', confidence: 'high' }],
      kcalSet: null, proteinSet: null, hints: d.hints, note: d.note || d.text, assumptions: null,
      photoCount: d.photos.length, model: null, createdAt: d.createdAt ?? localStamp(ctx.now()), updatedAt: now,
    };
    const photo = d.photos.length ? { mealId: d.id, ...(await thumb(d.photos[0])) } : null;
    await finish(ctx, meal, photo, d.id);
  },

  // Logs what is on screen, edits included; the saved meal itself stays as it is.
  logAgain(el, e, ctx) {
    const { factor, correction, ...copy } = saved;
    if (!copy.items.length && copy.kcalSet == null) { say('Add an item or type the calories.'); return; }
    ctx.go('#/today', { replace: true });
    return logAgainMeal(ctx, copy);
  },

  openMove() { moveError(''); sheet('move'); },

  async move(el, e, ctx) {
    const day = document.getElementById('mv-day').value, time = document.getElementById('mv-time').value;
    const first = ctx.state.settings.firstDay;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > ctx.today() || day < first || !/^\d{2}:\d{2}$/.test(time)) {
      moveError(`Pick a day from ${fmt.dayShort(first)} to today, and a time.`);
      return;
    }
    close('move');
    const { factor, correction, ...fields } = saved;
    await finish(ctx, { ...fields, day, time, updatedAt: ctx.now().toISOString() }, null, null);
  },

  async delete(el, e, ctx) {
    const meal = ctx.state.meals.find(m => m.id === params.mealId);
    const photo = meal.photoCount ? await db.get('photos', meal.id).catch(() => null) : null;
    await ctx.write(w => { w.del('meals', meal.id); w.del('photos', meal.id); });
    ctx.go(dayRoute(meal.day, ctx.today()), { replace: true });
    toast('Meal deleted.', {
      action: 'Undo',
      onAction: () => ctx.write(w => { w.put('meals', meal); if (photo) w.put('photos', photo); }).then(ctx.refresh),
    });
  },
};
