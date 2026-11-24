// Morning summary, on the first open of a day: yesterday, the weight trend and today's goals. S1 asks once
// when yesterday looks incomplete: nothing logged, under half the limit, or nothing from 17:00 on.
// Pinto sits beside "Good morning", with a news line in a bubble under it.
import { dayStr, limitRun, morning, morningPinto, trendNews } from '../logic.js';
import { firstTime, fmt, html, icon, pinto, pintoOn } from '../ui.js';
import { newDraft } from './add.js';
import { NOT_TRACKED, TYPE, mark, week } from './progress.js';
import { goalsBlock } from './today.js';

export function enter(state, params, ctx) {
  const today = ctx.today();
  if (state.settings.summaryShownFor !== today) ctx.save('settings', { name: 'summaryShownFor', value: today }).catch(() => {});
  remember(state, ctx);
}

const ASK = {
  none: ['Nothing logged yesterday', 'Forgot to log? Add it now and the day counts.'],
  low: ['Did you log everything?', 'Less than half your limit is logged.'],
  early: ['Did you log everything?', 'Nothing is logged after 17:00.'],
};

// What the summary shows: the morning's numbers, whether S1 asks, and Pinto's pose and line (null when Pinto is off).
function read(state, today) {
  const s = state.settings;
  const m = morning({ meals: state.meals, days: state.days, goals: state.goals, weights: state.weights, firstDay: s.firstDay, today });
  const y = m.yesterday, rec = state.days.find(d => d.day === y.day);
  // A meal of yesterday still waiting for its estimate or a check is not a forgotten one: Today lists it.
  const pending = state.drafts.some(d => d.day === y.day && d.status !== 'editing');
  const ask = y.incomplete && !y.asked && !rec?.mark && !pending;
  // The calorie floor, read from the profile as Progress does: Pinto never cheers a day under it.
  const floor = s.profile?.sex === 'female' ? 1200 : 1500;
  const pt = pintoOn(s) ? morningPinto({
    ask, type: y.type, kcal: y.totals.kcal, count: y.totals.count, floor,
    run: limitRun({ meals: state.meals, days: state.days, goals: state.goals, firstDay: s.firstDay, today, floor }),
    news: trendNews(state.weights, today, s.trendSaidOn),
  }) : null;
  return { m, y, rec, ask, pt };
}

// A weight-news line, once shown, is remembered, so the next one waits 7 days.
function remember(state, ctx) {
  const today = ctx.today();
  if (read(state, today).pt?.trend && state.settings.trendSaidOn !== today) {
    ctx.save('settings', { name: 'trendSaidOn', value: today }).catch(() => {});
  }
}

export function view(state) {
  const today = dayStr(new Date());
  const { m, y, rec, ask, pt } = read(state, today);
  const notTracked = rec?.mark === 'not-tracked';
  const [title, says] = ask ? ASK[y.reason] : notTracked ? [NOT_TRACKED.name, NOT_TRACKED.says] : [TYPE[y.type].name, TYPE[y.type].says];
  const g = m.goalToday;
  return html`
  <div class="screen">
    <div class="pt-greet top-gap"><div><h1 class="h-page" tabindex="-1">Good morning</h1><p class="sub">${fmt.dayLong(today)}</p></div>${
      // Pinto arrives on the first draw of the morning only; still on S1, and still after its answer redraws.
      pt ? pinto(pt.pose, firstTime(`m ${today}`) && !pt.still) : ''}</div>
    ${pt?.line ? html`<p class="pt-say">${pt.line}</p>` : ''}
    <section class="section" aria-labelledby="m-y"><h2 id="m-y">Yesterday</h2>
      <div class="verdict">${ask ? html`<span class="vm">${icon('info')}</span>` : mark(y.type)}<div><p class="v-t">${title}</p><p class="v-s">${says}</p></div></div>
      ${goalsBlock(y.totals, y.goal, true)}</section>
    <section class="section" aria-labelledby="m-w"><h2 id="m-w">Last 7 days</h2>${week(m.streak, y.day)}</section>
    <section class="section" aria-label="Weight and today">
      <div class="rows-end">
        <div class="kvrow"><span>Weight trend</span><span class="v">${m.trendKg != null ? html`${fmt.kg(m.trendKg)}${m.perWeek != null ? html`<small>${fmt.signed(m.perWeek)} kg a week</small>` : ''}` : html`<small>No weigh-ins yet</small>`}</span></div>
        <div class="kvrow"><span>Today's calorie limit</span><span class="v">${g ? `${fmt.kcal(g.kcal)} kcal` : '–'}</span></div>
        <div class="kvrow"><span>Today's protein goal</span><span class="v p">${g ? `${g.protein} g` : '–'}</span></div>
      </div>
    </section>
  </div>
  ${ask ? html`<div class="dock plain stack">
    <button class="btn primary block" data-action="forgotten" data-day="${y.day}">${icon('plus')}Add a forgotten meal</button>
    ${y.totals.count ? html`<button class="btn secondary block" data-action="mark" data-day="${y.day}" data-v="light">Yes, all logged</button>`
      : html`<button class="btn secondary block" data-action="go" data-to="#/today" data-replace>Start today</button>`}
  </div>` : html`<div class="dock plain"><button class="btn primary grow" data-action="go" data-to="#/today" data-replace>Start today</button></div>`}`;
}

export const actions = {
  // "Yes, all logged" is stored as the mark 'light', as in version 1.0, so backups need no change.
  async mark(el, e, ctx) {
    await ctx.save('days', { day: el.dataset.day, mark: el.dataset.v, asked: true });
    remember(ctx.state, ctx);
    ctx.refresh();
  },

  async forgotten(el, e, ctx) {
    const day = el.dataset.day, rec = ctx.state.days.find(d => d.day === day);
    await ctx.save('days', { day, mark: rec?.mark ?? null, asked: true });
    const d = await newDraft(ctx, { day, kind: 'text' });
    ctx.go(`#/describe/${d.id}`, { replace: true });
  },
};
