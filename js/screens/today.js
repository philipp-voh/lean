// C1 Today, C4 a past day, S2 first day. Notices: update ready and the backup reminder; waiting meals are rows
// (on Today also those of earlier days). The date opens the month calendar. Pinto rests on an empty Today,
// peeks in on rare days, and comes with the toast of a new meal.
import * as db from '../db.js';
import { addDays, addMonths, dayStr, dayTotals, daysBetween, goalOn, localStamp, logAgain, mealPinto, mealTotals, monthDays, streak } from '../logic.js';
import { close, firstTime, fmt, html, icon, pinto, pintoOn, sheet, toast } from '../ui.js';
import { addPhotos, dayRoute, hhmm, newDraft } from './add.js';
import { backupNow } from './settings.js';
import * as progress from './progress.js';

// The peek on Today waits for a meal, so it never shows beside the resting Pinto of an empty day.
export function enter(state, { day }, ctx) {
  progress.peek(state, ctx, 'today', day === ctx.today() && state.meals.some(m => m.day === day));
}

/* ---------- Shared with the morning summary ---------- */

// Today: eaten "/ limit" and what is left. A past day: eaten, "of limit" and how far under or over.
export function goalsBlock(totals, goal, past) {
  const k = Math.round(totals.kcal), p = Math.round(totals.protein);
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  const cal = !goal ? '' : past
    ? html`of ${fmt.kcal(goal.kcal)} kcal · <b>${fmt.kcal(Math.abs(goal.kcal - k))}</b>&nbsp;${k <= goal.kcal ? 'under' : 'over'}`
    : k <= goal.kcal ? html`<b>${fmt.kcal(goal.kcal - k)} kcal</b> left` : html`<b>${fmt.kcal(k - goal.kcal)} kcal</b> over`;
  const prot = !goal ? '' : past
    ? html`of ${goal.protein}&nbsp;g · <b>${Math.floor(p * 100 / goal.protein)}%</b>`
    : p < goal.protein ? html`<b>${goal.protein - p}&nbsp;g</b> to go` : html`<b>Goal</b> reached`;
  return html`
  <div class="goals">
    <div class="goal"><p class="gl">Calories</p><p class="gn">${fmt.kcal(k)}${goal && !past ? html`<small class="of">/&nbsp;${fmt.kcal(goal.kcal)} kcal</small>` : html`<small>kcal</small>`}</p>
      ${goal ? html`<div class="gbar" role="img" aria-label="${fmt.kcal(k)} of ${fmt.kcal(goal.kcal)} kcal"><span data-pct="${pct(k, goal.kcal)}"></span></div>` : ''}
      <p class="gs">${cal}</p></div>
    <div class="goal prot"><p class="gl">Protein</p><p class="gn">${p}${goal && !past ? html`<small class="of">/&nbsp;${goal.protein}&nbsp;g</small>` : html`<small>g</small>`}</p>
      ${goal ? html`<div class="gbar" role="img" aria-label="${p} of ${goal.protein} g protein"><span data-pct="${pct(p, goal.protein)}"></span></div>` : ''}
      <p class="gs">${prot}</p></div>
  </div>`;
}

// Pinto for the toast of a new meal, from the meals before the save and now (logic.js mealPinto); {} when off.
export function mealToast(ctx, before, day) {
  const s = ctx.state;
  if (!pintoOn(s.settings)) return {};
  const pt = mealPinto({ before, after: s.meals, days: s.days, goals: s.goals, firstDay: s.settings.firstDay, today: ctx.today(), day });
  return pt ? { pinto: pt.pose, line: pt.line } : {};
}

// One tap logs a meal again now; Undo for 5 seconds. From a saved meal's screen, `route` is Today: Lean moves there
// once the meal is saved, with the toast in the same step, as finish() does (so the return never starts the peek).
export async function logAgainMeal(ctx, src, route) {
  const now = ctx.now(), at = now.toISOString(), before = ctx.state.meals;
  const meal = { ...structuredClone(src), id: crypto.randomUUID(), day: ctx.today(), time: hhmm(now), kind: 'again', createdAt: localStamp(now), updatedAt: at };
  delete meal.photosUntil;   // the copy gets the small photo only
  const photo = src.photoCount ? await db.get('photos', src.id).catch(() => null) : null;
  if (!photo) meal.photoCount = 0;
  await ctx.write(w => { w.put('meals', meal); if (photo) w.put('photos', { ...photo, mealId: meal.id }); });
  if (route) ctx.go(route, { replace: true }); else ctx.refresh();
  toast(`${meal.name || 'Meal'} logged.`, {
    action: 'Undo',
    onAction: () => ctx.write(w => { w.del('meals', meal.id); w.del('photos', meal.id); }).then(ctx.refresh),
    ...mealToast(ctx, before, meal.day),
  });
}

/* ---------- Rows ---------- */

const META = { photo: m => (m.photoCount ? `${m.photoCount} ${m.photoCount === 1 ? 'photo' : 'photos'}` : 'No photos'), text: () => 'Described', quick: () => 'Typed numbers', again: () => 'Logged again' };

const thumb = m => (m.photoCount ? html`<img class="thumb" data-photo="${m.id}" alt="">` : html`<span class="thumb blank">${icon(m.kind === 'text' ? 'text' : 'meal')}</span>`);

function mealRow(m) {
  const t = mealTotals(m);
  return html`<li><button class="row" data-action="go" data-to="#/meal/${m.id}">${thumb(m)}
    <span class="row-main"><span class="name">${m.name || 'Quick add'}</span><span class="meta">${m.time} · ${META[m.kind]?.(m) ?? ''}</span></span>
    <span class="kcal">${fmt.kcal(t.kcal)} kcal<small>${Math.round(t.protein)} g<span class="sr"> protein</span></small></span></button></li>`;
}

function draftRow(d, running, day) {
  const label = running ? 'Estimating…' : { waiting: 'Waiting to estimate', estimating: 'Waiting to estimate', ready: 'Ready to check', failed: "Couldn't estimate" }[d.status] ?? 'Not estimated yet';
  const what = d.photos.length ? `${d.photos.length} ${d.photos.length === 1 ? 'photo' : 'photos'}` : d.kind === 'quick' ? 'Typed numbers' : 'Described';
  return html`<li><button class="row" data-action="openDraft" data-id="${d.id}">
    ${d.photos.length ? html`<img class="thumb" data-draft="${d.id}" data-index="0" alt="">` : html`<span class="thumb blank">${icon('text')}</span>`}
    <span class="row-main"><span class="name">${label}</span><span class="meta">${d.day === day ? '' : `${fmt.dayShort(d.day)}, `}${d.time} · ${what}</span></span>
    <span class="wait">${icon(d.status === 'ready' ? 'right' : 'clock')}<span class="sr">No numbers yet</span></span></button></li>`;
}

/* ---------- Streak: a simple badge here; the morning summary shows the week, Progress the details ---------- */

const streakBadge = n => (n > 0 ? html`<button class="streak-badge" data-action="go" data-to="#/progress" aria-label="${n}-day streak. Progress">${icon('flame')}<span><b>${n}</b>-day streak</span></button>` : '');

/* ---------- The screen ---------- */

export function view(state, { day }) {
  const today = dayStr(new Date()), past = day !== today;
  const { meals, days, goals, settings } = state;
  const first = settings.firstDay;
  const goal = goalOn(goals, day), totals = dayTotals(meals, day);
  const st = streak({ meals, days, goals, firstDay: first, today });
  // Today also shows meals of earlier days that still wait for an estimate or a check, so none is forgotten.
  const drafts = state.drafts.filter(d => (d.day === day && (d.status !== 'editing' || d.photos.length || d.text.trim())) ||
    (!past && d.day < day && d.status !== 'editing'));
  // A meal reopened for changes is listed as its draft (same id) until it is saved again or the changes are discarded;
  // behind a draft that isn't listed (emptied and not estimated) the meal stays listed, so it can still be opened.
  const shown = new Set(drafts.map(d => d.id));
  const list = meals.filter(m => m.day === day && !shown.has(m.id));
  // One list in time order, drafts of earlier days first.
  const rows = [...drafts, ...list].sort((a, b) => (a.day + a.time < b.day + b.time ? -1 : 1))
    .map(x => ('status' in x ? draftRow(x, !!state.running[x.id], day) : mealRow(x)));
  const atStart = !first || day <= first;
  const prev = html`<button class="icon-btn" data-action="go" data-to="#/day/${addDays(day, -1)}" data-replace aria-label="Previous day, ${fmt.dayLong(addDays(day, -1))}"${atStart ? html` aria-disabled="true" disabled` : ''}>${icon('left')}</button>`;
  return past ? pastDay(state, { day, today, goal, totals, st, rows, prev }) : html`
  <div class="screen">
    <header class="top"><div><h1 tabindex="-1">Today</h1>${dateBtn(day, fmt.dayLong(day))}</div>
      <div class="tools">${prev}
        <button class="icon-btn" data-action="go" data-to="#/progress" aria-label="Progress">${icon('chart')}</button>
        <button class="icon-btn" data-action="go" data-to="#/settings" aria-label="Settings">${icon('sliders')}</button></div></header>
    ${notices(state, today)}
    ${streakBadge(st.current)}
    ${goalsBlock(totals, goal, false)}
    ${subline(totals)}
    ${again(state, today, totals, goal)}
    <section class="section" aria-labelledby="t-meals"><h2 id="t-meals">Meals${state.ui.peek === `today ${today}` ? pinto('peek', firstTime(`p ${today}`)) : ''}</h2>
      ${rows.length ? html`<ul class="rows">${rows}</ul>` : html`
      <div class="empty">${pintoOn(settings) ? pinto('rest', firstTime(`e ${today}`)) : html`<span class="badge">${icon('meal')}</span>`}<h2>No meals yet</h2><p>Take a photo below, upload one or describe the meal.</p></div>
      ${day === first ? html`<div class="tip">${icon('info')}<p><b>Tip:</b> photograph the pack or the nutrition label too. Lean then reads the exact values instead of estimating.</p></div>` : ''}`}
    </section>
  </div>
  <div class="dock">
    <button class="btn secondary sq" data-action="describe" aria-label="Describe a meal">${icon('text')}</button>
    <label class="btn secondary sq">${icon('image')}<input class="sr" type="file" accept="image/*" multiple data-change="takePhoto" aria-label="Choose photos from library"></label>
    <label class="btn primary grow">${icon('camera')}Take photo<input class="sr" type="file" accept="image/*" capture="environment" data-change="takePhoto"></label>
  </div>
  ${progress.weightSheet()}${calSheet()}`;
}

function notices(state, today) {
  const s = state.settings;
  const since = s.lastBackupAt ? dayStr(new Date(s.lastBackupAt)) : s.firstDay;
  const age = since ? daysBetween(since, today) : 0;
  return html`
    ${state.updateReady ? html`<div class="notice" role="status">${icon('refresh')}<p class="n-s">Update ready</p><button class="link" data-action="update">Reload</button></div>` : ''}
    ${age > 7 ? html`<div class="notice" role="status">${icon('backup')}<p class="n-s">${s.lastBackupAt ? `Last backup ${age} days ago` : 'No backup yet'}</p>
      <button class="link" data-action="backupNow">${state.ui.backupTap ? 'Save backup' : 'Back up now'}</button></div>` : ''}`;
}

function subline(totals) {
  // The weight trend is on Progress and the morning summary; a short label keeps this one line, as in herb-20.
  return html`<p class="subline"><span>Carbs&nbsp;${fmt.g(totals.carbs)} · Fat&nbsp;${fmt.g(totals.fat)}</span>
    <button class="link" data-action="logWeight">Log weight${icon('right', 'ic sm')}</button></p>`;
}

// The chips come protein-rich first while protein is behind (logic.js logAgain), without a label saying so.
function again(state, today, totals, goal) {
  const chips = logAgain({ meals: state.meals, now: new Date(), today, totalsToday: totals, goalToday: goal });
  if (!chips.length) return '';
  return html`<section class="section" aria-labelledby="t-again"><h2 id="t-again">Log again</h2>
    <div class="chips scroll">${chips.map(c => html`<button class="chip" data-action="again" data-id="${c.meal.id}">${icon('plus')}${c.name}
      <span class="k">${fmt.kcal(c.kcal)} kcal · <span class="kp">${c.protein} g<span class="sr"> protein</span></span></span></button>`)}</div></section>`;
}

function pastDay(state, { day, today, goal, totals, st, rows, prev }) {
  const rec = state.days.find(d => d.day === day);
  const notTracked = rec?.mark === 'not-tracked';
  const mark = st.marks[day];
  const yesterday = addDays(today, -1) === day;
  // A Missed day with meals: they were all added more than a day after it ended.
  const verdict = notTracked ? ['miss', progress.NOT_TRACKED.name, progress.NOT_TRACKED.says]
    : mark === 'miss' && totals.count ? ['miss', progress.TYPE.miss.name, progress.LATE]
    : progress.TYPE[mark]?.says ? [mark, progress.TYPE[mark].name, progress.TYPE[mark].says] : null;
  const next = addDays(day, 1);
  return html`
  <div class="screen">
    <header class="top"><div><h1 tabindex="-1">${fmt.weekday(day)}</h1>${dateBtn(day, `${fmt.dayMonth(day)}${yesterday ? ', yesterday' : ''}`)}</div>
      <div class="tools">${prev}<button class="icon-btn" data-action="go" data-to="${dayRoute(next, today)}" data-replace aria-label="Next day, ${fmt.dayLong(next)}">${icon('right')}</button></div></header>
    ${verdict ? html`<div class="verdict">${progress.mark(verdict[0])}<div><p class="v-t">${verdict[1]}</p><p class="v-s">${verdict[2]}</p></div></div>` : ''}
    ${goalsBlock(totals, goal, true)}
    <p class="macros">Carbs&nbsp;${fmt.g(totals.carbs)} · Fat&nbsp;${fmt.g(totals.fat)}</p>
    <section class="section" aria-labelledby="t-meals"><h2 id="t-meals">Meals</h2>
      ${rows.length ? html`<ul class="rows">${rows}</ul>` : html`<p class="intro">Nothing logged on this day.</p>`}
    </section>
    <button class="link" data-action="notTracked" data-day="${day}">${notTracked ? 'Count this day again' : 'Mark as not tracked'}</button>
  </div>
  <div class="dock"><button class="btn primary grow" data-action="forgotten" data-day="${day}">${icon('plus')}Add a forgotten meal</button></div>
  ${progress.weightSheet()}${calSheet()}`;
}

/* ---------- Calendar: a month sheet from the date, filled in place, so moving between months never redraws the screen ---------- */

const dateBtn = (day, text) => html`<button class="date-btn" data-action="calendar" data-day="${day}">${text}${icon('calendar', 'ic sm')}<span class="sr">, calendar</span></button>`;

const calSheet = () => html`
  <dialog class="sheet" id="cal" aria-labelledby="cal-t"><div class="sheet-body">
    <div class="sheet-head"><h2 id="cal-t" aria-live="polite"></h2>
      <div class="tools"><button class="icon-btn" data-action="calMove" data-v="-1" aria-label="Previous month">${icon('left')}</button>
        <button class="icon-btn" data-action="calMove" data-v="1" aria-label="Next month">${icon('right')}</button>
        <button class="icon-btn" data-action="closeSheet" data-sheet="cal" aria-label="Close">${icon('x')}</button></div></div>
    <div class="cal-head" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(l => html`<span>${l}</span>`)}</div>
    <div class="cal-grid" id="cal-grid"></div>
    ${progress.legend()}
    <button class="btn secondary block" data-action="calDay" data-day="today">Today</button>
  </div></dialog>`;

let cal = { open: null, month: null };   // the day behind the sheet and the month shown

// Months from the first day's to this one. Days before the first day and after today are plain numbers.
function fillCal(state, month) {
  const today = dayStr(new Date()), first = state.settings.firstDay ?? today;
  const { marks } = streak({ meals: state.meals, days: state.days, goals: state.goals, firstDay: first, today });
  cal.month = month;
  document.getElementById('cal-t').textContent = fmt.month(month);
  const [prev, next] = document.querySelectorAll('#cal [data-action="calMove"]');
  prev.setAttribute('aria-disabled', String(month <= first.slice(0, 7)));
  next.setAttribute('aria-disabled', String(month >= today.slice(0, 7)));
  document.getElementById('cal-grid').innerHTML = String(html`${monthDays(month).map(d => {
    if (!d) return html`<span></span>`;
    if (d < first || d > today) return html`<span class="cd off" aria-hidden="true">${+d.slice(8)}</span>`;
    return html`<button class="mk cd ${marks[d]}${d === cal.open ? ' on' : ''}" data-action="calDay" data-day="${d}"${d === cal.open ? html` aria-current="page"` : ''}
      aria-label="${fmt.dayLong(d)}, ${progress.TYPE[marks[d]].name}">${+d.slice(8)}</button>`;
  })}`);
}

/* ---------- Actions ---------- */

export const actions = {
  ...progress.actions,
  backupNow,

  calendar(el, e, ctx) {
    cal = { open: el.dataset.day, month: null };
    fillCal(ctx.state, el.dataset.day.slice(0, 7));
    sheet('cal');
  },

  calMove(el, e, ctx) {
    if (el.getAttribute('aria-disabled') !== 'true') fillCal(ctx.state, addMonths(cal.month, +el.dataset.v));
  },

  calDay(el, e, ctx) {
    const today = ctx.today(), day = el.dataset.day === 'today' ? today : el.dataset.day;
    close('cal');
    if (day !== cal.open) ctx.go(dayRoute(day, today), { replace: true });
  },

  async takePhoto(el, e, ctx) {
    const files = [...(el.files ?? [])];
    el.value = '';
    if (!files.length) return;
    const d = await newDraft(ctx, { day: ctx.today(), kind: 'photo' });
    ctx.go(`#/add/${d.id}`);
    await addPhotos(ctx, d, files);
  },

  async describe(el, e, ctx) {
    const d = await newDraft(ctx, { day: ctx.today(), kind: 'text' });
    ctx.go(`#/describe/${d.id}`);
  },

  async forgotten(el, e, ctx) {
    const d = await newDraft(ctx, { day: el.dataset.day, kind: 'text' });
    ctx.go(`#/describe/${d.id}`);
  },

  openDraft(el, e, ctx) {
    const d = ctx.state.drafts.find(x => x.id === el.dataset.id);
    if (!d) return;
    const editing = d.status === 'editing' && d.kind !== 'quick';
    ctx.go(editing ? `#/${d.kind === 'text' ? 'describe' : 'add'}/${d.id}` : `#/check/${d.id}`);
  },

  again(el, e, ctx) {
    const src = ctx.state.meals.find(m => m.id === el.dataset.id);
    if (src) return logAgainMeal(ctx, src);
  },

  async notTracked(el, e, ctx) {
    const day = el.dataset.day, rec = ctx.state.days.find(d => d.day === day);
    const mark = rec?.mark === 'not-tracked' ? null : 'not-tracked';
    await ctx.save('days', { day, mark, asked: rec?.asked ?? false });
    ctx.refresh();
  },

  // Reload only from Today, so no meal is open mid-entry.
  async update() {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.waiting) reg.waiting.postMessage('skip'); else location.reload();
  },
};
