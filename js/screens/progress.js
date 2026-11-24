// D1 Progress: the last 7 days with the streak, then one range (Week, 4 weeks, All) for the weight chart and the
// calories and protein charts. S7 Log weight and the How Lean days work sheet. The day marks and the 7-day strip are
// shared with Today, the calendar and the morning summary. Pinto nods at a weigh-in and, on rare days, peeks in
// here or on Today.
import { addDays, dayStr, daysBetween, goalOn, lastDays, parseNum, peekDay, proteinMin, rate, series, streak, trend, weekly } from '../logic.js';
import { close, firstTime, fmt, html, icon, pinto, pintoOn, sheet, toast } from '../ui.js';

// A rare peek (logic.js peekDay): the first plain open of its screen that day shows it for that visit, once a day
// even after a restart. Never while a toast is up: the return from a save has Pinto in the toast already.
// state.ui.peek holds the screen and the day, so a screen left open past midnight drops it at the next redraw.
export function peek(state, ctx, screen, ready = true) {
  const today = ctx.today(), s = state.settings;
  const show = ready && pintoOn(s) && peekDay(today) === screen && s.peekShownFor !== today && document.getElementById('toast').hidden;
  state.ui.peek = show ? `${screen} ${today}` : null;
  if (show) ctx.save('settings', { name: 'peekShownFor', value: today }).catch(() => {});
}

export function enter(state, params, ctx) { peek(state, ctx, 'progress'); }

/* ---------- Day marks: one look per day type on every screen ---------- */

export const TYPE = {
  lean: { name: 'Lean day', short: 'Lean', says: 'Within your limit, protein at 90% or more', icon: 'check-bold' },
  steady: { name: 'Steady day', short: 'Steady', says: 'Within your limit, protein under 90%' },
  logged: { name: 'Logged day', short: 'Logged', says: 'Over your limit; the streak goes on' },
  miss: { name: 'Missed day', short: 'Missed', says: 'Nothing logged', icon: 'dash' },
  today: { name: 'today' },
  none: { name: 'before you started' },
};
// A day marked Not tracked has no mark of its own: it is a Missed day.
export const NOT_TRACKED = { name: 'Not tracked', says: 'Counts as a Missed day: left out of averages, and the streak starts again' };
// A day whose meals were all added more than a day after it ended.
export const LATE = 'Added more than a day later, so it counts as missed';
export const mark = type => html`<span class="mk ${type}" aria-hidden="true">${TYPE[type].icon ? icon(TYPE[type].icon) : ''}</span>`;
// The four day types with their marks: the calendar's legend, and on Progress with the count of each.
export const legend = counts => html`<ul class="legend">${['lean', 'steady', 'logged', 'miss'].map(t => html`
  <li>${mark(t)}${counts ? `${counts[t]} ` : ''}${TYPE[t].short}</li>`)}</ul>`;

// Seven days up to `last`, one mark each, then the streak.
export function week(st, last) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(last, i - 6)), type = d => st.marks[d] ?? 'none';
  const badge = st.current > 0
    ? html`<span class="streak">${icon('flame')}<span><b>${st.current}</b><small>day streak</small></span></span>`
    : html`<span class="streak none">${icon('flame')}<small>${st.best > 0 ? 'New streak starts today' : 'No streak yet'}</small></span>`;
  return html`<div class="week">${days.map(d => html`
    <span class="d"><span class="dl" aria-hidden="true">${fmt.weekday(d)[0]}</span>${mark(type(d))}
      <span class="sr">${fmt.weekday(d)} ${+d.slice(8)}, ${TYPE[type(d)].name}</span></span>`)}${badge}</div>`;
}

/* ---------- Charts: one date axis per range, from `from` on the left to today on the right; never two y axes ---------- */

const RANGE = { week: ['Week', 7, 'in the last week'], month: ['4 weeks', 28, 'in the last 4 weeks'], all: ['All'] };
const W = 350, L = 58, R = 8;
const axis = (from, today) => {
  const span = Math.max(1, daysBetween(from, today));
  return day => (L + daysBetween(from, day) / span * (W - L - R)).toFixed(1);
};
const dates = (from, H) => html`<text class="ch-text" x="${L}" y="${H - 6}">${fmt.dayShort(from).slice(4)}</text>
  <text class="ch-text" x="${W - R}" y="${H - 6}" text-anchor="end">Today</text>`;

// Weigh-ins as dots, the trend as a line that starts at the left edge (where the line from the last weigh-in before
// the range crosses it) and stays flat after the last one. At least 2 kg of height, so daily swings don't look dramatic.
function weightChart(points, shown, from, today, label) {
  const H = 112, T = 10, B = 24, x = axis(from, today);
  const before = points.filter(p => p.day < from).at(-1), last = points.at(-1);
  const edge = before && { day: from, trend: before.trend + (shown[0].trend - before.trend) * daysBetween(before.day, from) / daysBetween(before.day, shown[0].day) };
  const line = edge ? [edge, ...shown] : shown;
  const vals = [...line.map(p => p.trend), ...shown.map(p => p.kg)];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 2) { lo = (lo + hi) / 2 - 1; hi = lo + 2; }
  lo = Math.floor(lo - 0.2); hi = Math.ceil(hi + 0.2);
  const step = hi - lo > 10 ? 5 : hi - lo > 3 ? 2 : 1;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const y = v => (T + (hi - v) / (hi - lo) * (H - T - B)).toFixed(1);
  const grid = [];
  for (let v = lo; v <= hi; v += step) grid.push(html`<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ch-text" x="${L - 6}" y="${+y(v) + 4}" text-anchor="end">${v}</text>`);
  const trendLine = [...line.map(p => `${x(p.day)},${y(p.trend)}`), `${x(today)},${y(last.trend)}`].join(' ');
  return html`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight in kg ${label}: ${shown.length} ${shown.length === 1 ? 'weigh-in' : 'weigh-ins'} as dots, the trend as a line from ${fmt.one(line[0].trend)} to ${fmt.one(last.trend)}">
    ${grid}${dates(from, H)}
    ${shown.map(p => html`<circle class="ch-dot" cx="${x(p.day)}" cy="${y(p.kg)}" r="3"/>`)}
    <polyline class="ch-line" points="${trendLine}"/>
    <circle class="ch-end" cx="${x(today)}" cy="${y(last.trend)}" r="4.5"/></svg>`;
}

// Calories or protein per closed day, from zero, with the goal as a dashed line that steps where it changed.
// Missed days are gaps, never zero; `daily` holds every day (for the goal), `pts` what is plotted (days or weeks).
function panel(key, daily, pts, from, today, { H, dates: withDates, cls, sentence }) {
  const T = 8, B = withDates ? 24 : 6, x = axis(from, today);
  const vals = [...pts.map(p => p[key]), ...daily.map(p => p.goal?.[key])].filter(v => v != null);
  const top = Math.max(1, ...vals) * 1.15;
  const y = v => (T + (1 - v / top) * (H - T - B)).toFixed(1);
  const runs = [[]];
  for (const p of pts) {
    if (p[key] == null) { if (runs.at(-1).length) runs.push([]); continue; }
    runs.at(-1).push(`${x(p.day)},${y(p[key])}`);
  }
  let goal = '', g;
  for (const p of daily) {
    const v = p.goal?.[key];
    if (v == null || v === g) continue;
    goal += goal ? `H${x(p.day)}V${y(v)}` : `M${x(p.day)} ${y(v)}`;
    g = v;
  }
  const r = pts.length > 31 ? 2 : 3.5;
  return html`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${sentence}">
    <line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
    <text class="ch-text" x="${L - 6}" y="${+y(0) + 4}" text-anchor="end">0</text>
    ${g != null ? html`<path class="ch-goal" d="${goal}H${x(today)}"/><text class="ch-text" x="${L - 6}" y="${+y(g) + 4}" text-anchor="end">${fmt.kcal(g)}</text>` : ''}
    ${withDates ? dates(from, H) : ''}
    ${runs.filter(run => run.length > 1).map(run => html`<polyline class="ch-l ${cls}" points="${run.join(' ')}"/>`)}
    ${pts.filter(p => p[key] != null).map(p => html`<circle class="ch-p ${cls}" cx="${x(p.day)}" cy="${y(p[key])}" r="${r}"/>`)}</svg>`;
}

/* ---------- The screen ---------- */

export function view(state) {
  const today = dayStr(new Date());
  const { meals, days, goals, weights, settings } = state;
  const first = settings.firstDay ?? today;
  const points = trend(weights), last = points.at(-1);
  const r = rate(weights, today);
  const st = streak({ meals, days, goals, firstDay: first, today });
  const l7 = lastDays({ meals, days, goals, today });
  const floor = settings.profile?.sex === 'female' ? 1200 : 1500;
  const notices = [];
  if (last && r.perWeek != null && -r.perWeek > 0.01 * last.trend) notices.push("You're losing more than 1% of your weight a week. That can cost muscle; eating a little more slows it down.");
  if (l7.tracked >= 4 && l7.avgKcal < floor) notices.push(`Your 7-day average is under ${fmt.kcal(floor)} kcal. Very low days can cost muscle.`);

  // The range: the 7 or 28 days before today, or everything since the first day or the first weigh-in.
  const range = RANGE[state.ui.range] ? state.ui.range : 'week';
  const from = range === 'all' ? [first, points[0]?.day].filter(Boolean).sort()[0] : addDays(today, -RANGE[range][1]);
  const label = range === 'all' ? `since ${fmt.dayShort(from).slice(4)}` : RANGE[range][2];
  const shown = points.filter(p => p.day >= from);
  const start = from < first ? first : from;
  const ld = lastDays({ meals, days, goals, today, n: daysBetween(start, today) });
  const daily = series({ meals, days, goals, from, today });
  const pts = range === 'all' && daily.length > 91 ? weekly(daily) : daily;
  const g = goalOn(goals, addDays(today, -1)) ?? goalOn(goals, today);
  const weeks = pts !== daily ? ', as weekly averages' : '';
  const count = { lean: ld.lean, steady: ld.steady, logged: ld.logged, miss: daysBetween(start, today) - ld.tracked };
  // The counts cover the closed days only, so their heading names them: "from 17 to 23 Nov".
  const end = addDays(today, -1), dm = d => fmt.dayShort(d).slice(4);
  const counted = range === 'all' ? label : start.slice(0, 7) === end.slice(0, 7) ? `from ${+start.slice(8)} to ${dm(end)}` : `from ${dm(start)} to ${dm(end)}`;

  return html`
  <nav class="nav bar"><button class="text-btn" data-action="go" data-to="#/today" data-replace>${icon('left')}Today</button><span class="title">Progress</span><span></span></nav>
  <div class="screen">
    <h1 class="sr" tabindex="-1">Progress</h1>
    ${notices.map(n => html`<div class="notice" role="status">${icon('info')}<p class="n-s">${n}</p></div>`)}
    <section class="pg-sec" aria-labelledby="p-l">
      <div class="pg-hrow"><h2 class="pg-h" id="p-l">Last 7 days</h2><button class="link" data-action="leanInfo">${icon('info', 'ic sm')}How they work</button></div>
      ${week(st, today)}
    </section>
    <div class="seg pg-range" role="radiogroup" aria-label="Range for the charts">${Object.entries(RANGE).map(([k, [l]]) => html`
      <button role="radio" aria-checked="${k === range}" data-action="range" data-v="${k}">${l}</button>`)}</div>
    <section class="pg-sec" aria-labelledby="p-w"><h2 class="pg-h" id="p-w">Weight, kg${state.ui.peek === `progress ${today}` ? pinto('peek', firstTime(`p ${today}`)) : ''}</h2>
      ${last ? html`
      <div class="pg-bigline"><span class="pg-big">${fmt.one(last.trend)}<span class="sr"> kg</span></span><span class="pg-unit">trend</span>
        ${r.perWeek != null ? html`<span class="pg-rate">${fmt.signed(r.perWeek)}<span class="sr"> kg</span> a week</span>` : ''}</div>
      ${points.length > 1 && shown.length ? html`<div class="pg-chart">${weightChart(points, shown, from, today, label)}</div>
      <div class="pg-foot"><ul class="clegend"><li><span class="cdot"></span>Weigh-ins</li><li><span class="cline"></span>Trend</li></ul>
        <span>${fmt.signed(last.trend - shown[0].trend)} kg since ${fmt.dayShort(shown[0].day).slice(4)}</span></div>` : ''}
      ${points.length > 1 && !shown.length ? html`<p class="pg-note">No weigh-ins ${label}.</p>` : ''}
      <p class="pg-note">${r.perWeek == null ? `Rate after 3 weeks of weigh-ins (${Math.min(r.count, 8)} of 8 so far). ` : ''}Last weigh-in ${fmt.dayShort(last.day)}, ${fmt.kg(last.kg)}.</p>` : html`
      <p class="pg-note">No weigh-ins yet. Weigh in the morning before breakfast; Lean smooths out the daily ups and downs.</p>`}
    </section>
    ${ld.tracked ? html`
    <section class="pg-sec" aria-labelledby="p-k">
      <div class="pg-hrow tight"><h2 class="pg-h" id="p-k">Calories, kcal</h2><span class="pg-avg"><b>${fmt.kcal(ld.avgKcal)}</b> a day</span></div>
      <div class="pg-chart">${panel('kcal', daily, pts, from, today, { H: 86, cls: 'kc',
        sentence: `Calories per day ${label}${weeks}: ${fmt.kcal(ld.avgKcal)} kcal a day on average; ${ld.lean + ld.steady} of ${ld.tracked} tracked days within the limit${g ? ` of ${fmt.kcal(g.kcal)}` : ''}.` })}</div>
    </section>
    <section class="pg-sec" aria-labelledby="p-p">
      <div class="pg-hrow tight"><h2 class="pg-h" id="p-p">Protein, g</h2><span class="pg-avg p"><b>${ld.avgProtein}</b> a day</span></div>
      <div class="pg-chart">${panel('protein', daily, pts, from, today, { H: 104, dates: true, cls: 'pr',
        sentence: `Protein per day ${label}${weeks}: ${ld.avgProtein} g a day on average; ${ld.reached} of ${ld.tracked} tracked days at 90% of the goal${g ? ` of ${g.protein} g` : ''} or more.` })}</div>
    </section>
    <section class="pg-sec" aria-labelledby="p-d"><h2 class="pg-h" id="p-d">Days ${counted}</h2>${legend(count)}</section>` : html`
    <section class="pg-sec" aria-labelledby="p-k"><h2 class="pg-h" id="p-k">Calories and protein</h2>
      <p class="pg-note">No tracked days ${label} yet. The charts add today once it's over.</p>
    </section>`}
  </div>
  <div class="dock"><button class="btn primary grow" data-action="logWeight">${icon('scale')}Log weight</button></div>
  ${weightSheet()}${leanSheet(state, st)}`;
}

/* ---------- S7 Log weight: filled in place when it opens, so typing never redraws ---------- */

export const weightSheet = () => html`
  <dialog class="sheet" id="weight" aria-labelledby="w-t"><div class="sheet-body">
    <div class="sheet-nav"><button class="text-btn" data-action="closeSheet" data-sheet="weight">Cancel</button><h2 id="w-t">Log weight</h2>
      <button class="btn primary sm" data-action="saveWeight">Save weight</button></div>
    <label class="wt-l" for="w-in">Weight</label>
    <div class="wt">
      <button class="round" data-action="wStep" data-v="-0.1" aria-label="0.1 kg less">${icon('minus')}</button>
      <span class="wt-box"><input class="wt-in" id="w-in" inputmode="decimal" autocomplete="off" aria-describedby="w-err" data-input="wType"><small>kg</small></span>
      <button class="round" data-action="wStep" data-v="0.1" aria-label="0.1 kg more">${icon('plus')}</button>
    </div>
    <p class="err" id="w-err" role="alert" hidden>${icon('alert')}<span data-out="werr"></span></p>
    <p class="wt-last" data-out="wlast"></p>
    <div class="date-row"><label for="w-date">Date</label><input class="date-in" id="w-date" type="date" data-change="wDate"></div>
    <p class="hint-line">${icon('info')}<span>Weigh in the morning before breakfast, so the days compare fairly.</span></p>
    <button class="link danger-link" data-action="deleteWeight" hidden>${icon('trash', 'ic sm')}Delete this weigh-in</button>
  </div></dialog>`;

let confirmJump = null;
const $ = sel => document.querySelector(sel);
const before = (weights, day) => weights.filter(w => w.day < day).sort((a, b) => (a.day < b.day ? 1 : -1))[0];

function fillWeight(state, day) {
  const on = state.weights.find(w => w.day === day), prev = before(state.weights, day);
  const start = on ?? prev ?? state.weights.slice().sort((a, b) => (a.day < b.day ? 1 : -1))[0];
  const kg = start?.kg ?? state.settings.profile?.weightKg;
  $('#w-in').value = kg ? fmt.one(kg) : '';
  $('[data-out="wlast"]').textContent = on ? `Your weigh-in on this day, ${fmt.kg(on.kg)}` :
    start ? `Started from ${fmt.dayShort(start.day)}, ${fmt.kg(start.kg)}` : '';
  $('[data-action="deleteWeight"]').hidden = !on;
  $('#w-err').hidden = true;
  confirmJump = null;
}

function weightError(text) {
  $('[data-out="werr"]').textContent = text;
  $('#w-err').hidden = !text;
  $('#w-in').setAttribute('aria-invalid', !!text);
}

/* ---------- How Lean days work ---------- */

function leanSheet(state, st) {
  const g = goalOn(state.goals, dayStr(new Date()));
  return html`
  <dialog class="sheet" id="leandays" aria-labelledby="ld-t"><div class="sheet-body">
    <div class="sheet-head"><h2 id="ld-t">How Lean days work</h2><button class="icon-btn" data-action="closeSheet" data-sheet="leandays" aria-label="Close">${icon('x')}</button></div>
    <div class="two-num">
      <div><p class="gl">Current streak</p><p class="pg-big">${icon('flame')}${st.current}<small>days</small></p></div>
      <div><p class="gl">Your best</p><p class="pg-big">${st.best}<small>days</small></p></div>
    </div>
    <ul class="rules">
      <li>${mark('lean')}<p><b>Lean day:</b> ${g ? html`calories at or under ${fmt.kcal(g.kcal)} and at least <span class="p">${proteinMin(g)} g</span> protein, which is 90% of your goal`
        : 'calories at or under your limit and protein at 90% of your goal or more'}.</p></li>
      <li>${mark('steady')}<p><b>Steady day:</b> within your limit, with less protein.</p></li>
      <li>${mark('logged')}<p><b>Logged day:</b> over your limit.</p></li>
      <li>${mark('miss')}<p><b>Missed day:</b> nothing logged by midnight the next day, or marked Not tracked.</p></li>
      <li><span class="mk plain" aria-hidden="true">${icon('flame')}</span><p><b>The streak</b> counts every day you log a meal, whatever its type. Today counts from your first meal; a Missed day starts a new streak.</p></li>
      <li><span class="mk plain" aria-hidden="true">${icon('refresh')}</span><p><b>Forgot a meal?</b> Add it by midnight the next day and the day still counts.</p></li>
    </ul>
  </div></dialog>`;
}

export const actions = {
  leanInfo() { sheet('leandays'); },

  // The range lives in memory only: Lean opens on Week again after a restart.
  range(el, e, ctx) { ctx.state.ui.range = el.dataset.v; ctx.refresh(); },

  logWeight(el, e, ctx) {
    const day = ctx.today();
    $('#w-date').value = day;
    $('#w-date').max = day;
    fillWeight(ctx.state, day);
    sheet('weight');
  },

  wStep(el) {
    const now = parseNum($('#w-in').value) ?? 80;
    $('#w-in').value = fmt.one(Math.min(300, Math.max(30, now + Number(el.dataset.v))));
    weightError('');
  },

  wType() { weightError(''); confirmJump = null; },

  wDate(el, e, ctx) {
    if (!el.value || el.value > ctx.today()) el.value = ctx.today();
    fillWeight(ctx.state, el.value);
  },

  async saveWeight(el, e, ctx) {
    const kg = parseNum($('#w-in').value), day = $('#w-date').value;
    if (kg == null || kg < 30 || kg > 300) { weightError('Enter a weight between 30 and 300 kg.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > ctx.today()) { weightError('Pick today or an earlier day.'); return; }
    const value = Math.round(kg * 10) / 10, prev = before(ctx.state.weights, day);
    // A jump over 3 kg is more often a typo than a change: ask once.
    if (prev && Math.abs(value - prev.kg) > 3 && confirmJump !== `${day}:${value}`) {
      confirmJump = `${day}:${value}`;
      weightError(`That's ${fmt.kg(Math.abs(value - prev.kg))} from ${fmt.dayShort(prev.day)}. Tap Save weight again if it's right.`);
      return;
    }
    await ctx.save('weights', { day, kg: value, at: ctx.now().toISOString() });
    close('weight');
    ctx.refresh();
    toast(`Weight saved: ${fmt.kg(value)}.`, pintoOn(ctx.state.settings) ? { pinto: 'nod' } : {});
  },

  async deleteWeight(el, e, ctx) {
    const day = $('#w-date').value, rec = ctx.state.weights.find(w => w.day === day);
    if (!rec) return;
    await ctx.remove('weights', day);
    close('weight');
    ctx.refresh();
    toast('Weigh-in deleted.', { action: 'Undo', onAction: () => ctx.save('weights', rec).then(ctx.refresh) });
  },
};
