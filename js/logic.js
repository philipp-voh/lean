// Lean's rules as pure functions. No DOM and no clock: callers pass `today` ('YYYY-MM-DD', local) and `now` (a Date).

const DAY_MS = 86400000;
const pad = n => String(n).padStart(2, '0');
// Date math in UTC, so clock changes never add or lose a day.
const utc = day => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
const round5 = n => Math.round(n / 5) * 5;
const round10 = n => Math.round(n / 10) * 10;
const fmt = n => Math.round(n).toLocaleString('en-US');

export const dayStr = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
// When a meal was logged, as clock time where it was logged and without a time zone: read anywhere, its date stays the same.
export const localStamp = date => `${dayStr(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
export const addDays = (day, n) => new Date(utc(day) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY_MS);
const weekday = day => (new Date(utc(day)).getUTCDay() + 6) % 7;   // Monday 0 … Sunday 6

// Months are 'YYYY-MM'.
export function addMonths(month, n) {
  const m = +month.slice(0, 4) * 12 + +month.slice(5, 7) - 1 + n;
  return `${Math.floor(m / 12)}-${pad(m % 12 + 1)}`;
}

// A Monday-first month grid: the month's days, with null for the blanks before the 1st and after the last day.
export function monthDays(month) {
  const cells = Array(weekday(`${month}-01`)).fill(null);
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

// "81,6" and "81.6" are the same; "1,240" with three digits after the comma is a thousands separator.
export function parseNum(text) {
  let s = String(text ?? '').trim().replace(/\s/g, '');
  if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
  s = s.replace(',', '.');
  return /^(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null;
}

/* ---------- Goals ---------- */

const ACTIVITY = { low: 1.375, medium: 1.55, high: 1.725 };

export function calcGoals(profile, trendKg) {
  const kg = trendKg ?? profile.weightKg;
  const male = profile.sex === 'male';
  const resting = 10 * kg + 6.25 * profile.heightCm - 5 * profile.age + (male ? 5 : -161);   // Mifflin-St Jeor
  const burn = round10(resting * ACTIVITY[profile.activity]);
  const floor = male ? 1500 : 1200;
  const thin = kg / (profile.heightCm / 100) ** 2 < 18.5;
  const planned = thin ? 0 : round10(profile.pace * 7700 / 7);
  const kcal = Math.max(burn - planned, Math.min(floor, burn));
  const capped = kcal > burn - planned;
  const pace = thin ? 0 : capped ? Math.round((burn - kcal) * 7 / 770) / 10 : profile.pace;
  const notes = [];
  if (thin) notes.push('Your BMI is under 18.5, so Lean plans no deficit.');
  if (capped) notes.push(`Pace reduced to about ${pace.toFixed(1)} kg a week to stay at ${fmt(kcal)} kcal.`);
  if (pace > 0.01 * kg) notes.push('Faster than 1% of your weight a week can cost muscle.');
  return { burn, deficit: burn - kcal, kcal, protein: round5(2 * kg), pace, capped, notes };
}

// Each goal change is a record from its day on; a day uses the latest record that started on or before it.
export function goalOn(goals, day) {
  let found = null;
  for (const g of goals) if (g.from <= day && (!found || g.from > found.from)) found = g;
  return found && { kcal: found.kcal, protein: found.protein };
}

/* ---------- Totals ---------- */

const zero = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
const add = (t, x) => { t.kcal += x.kcal; t.protein += x.protein; t.carbs += x.carbs; t.fat += x.fat; };

export function itemTotals(item) {
  const { per, amount } = item;
  return { kcal: per.kcal * amount, protein: per.protein * amount, carbs: per.carbs * amount, fat: per.fat * amount };
}

// Typed totals (the pencils) win over the sum of the items.
export function mealTotals(meal) {
  const t = zero();
  for (const item of meal.items ?? []) add(t, itemTotals(item));
  if (meal.kcalSet != null) t.kcal = meal.kcalSet;
  if (meal.proteinSet != null) t.protein = meal.proteinSet;
  return t;
}

export function dayTotals(meals, day) {
  const t = { ...zero(), count: 0, inTime: false };
  for (const m of meals) if (m.day === day) { add(t, mealTotals(m)); t.count++; t.inTime ||= logged(m); }
  return t;
}

// A day counts for its type and streak once one of its meals was logged by midnight the next day: a forgotten meal
// can be added the next morning, not a week later. The type then uses all the day's meals; a day with only later
// meals shows them in its totals but stays Missed. No creation time: it counts. Creation times are local clock time
// (localStamp), so travelling never re-judges a day; older times with a "Z" are read in the phone's time zone.
const logged = m => !m.createdAt || dayStr(new Date(m.createdAt)) <= addDays(m.day, 1);

function byDay(meals) {
  const map = new Map();
  for (const m of meals) {
    if (!map.has(m.day)) map.set(m.day, { ...zero(), count: 0, inTime: false });
    const t = map.get(m.day);
    add(t, mealTotals(m));
    t.count++;
    t.inTime ||= logged(m);
  }
  return map;
}

/* ---------- Day types and streak ---------- */

// The protein a Lean day needs: 90% of the goal, in whole grams.
export const proteinMin = goal => Math.ceil(goal.protein * 9 / 10);

// Lean, Steady (within the limit, less protein), Logged (over the limit) or Missed (nothing logged in time, or Not tracked).
export function dayType(totals, goal, notTracked = false) {
  if (notTracked || !totals?.count || totals.inTime === false) return 'miss';
  if (!goal || Math.round(totals.kcal) > goal.kcal) return 'logged';
  return Math.round(totals.protein) >= proteinMin(goal) ? 'lean' : 'steady';
}
export const isLean = (totals, goal) => dayType(totals, goal) === 'lean';

const offDays = days => new Set(days.filter(d => d.mark === 'not-tracked').map(d => d.day));

// Every tracked day (one with a meal logged in time) adds one, today as soon as it has a meal; a Missed day starts again from 0.
export function streak({ meals, days, goals, firstDay, today }) {
  const totals = byDay(meals), off = offDays(days), marks = {};
  let current = 0, best = 0;
  for (let d = firstDay && firstDay < today ? firstDay : today; d < today; d = addDays(d, 1)) {
    marks[d] = dayType(totals.get(d), goalOn(goals, d), off.has(d));
    current = marks[d] === 'miss' ? 0 : current + 1;
    best = Math.max(best, current);
  }
  marks[today] = 'today';
  if (totals.has(today) && !off.has(today)) best = Math.max(best, ++current);
  return { current, best, marks };
}

/* ---------- Weight ---------- */

// Hacker's Diet smoothing, bridging a gap of g days by a straight line from p to w. Returns the daily trend values.
export function bridge(t, p, w, g) {
  const out = [];
  for (let j = 1; j <= g; j++) {
    t += 0.1 * (p + (w - p) * j / g - t);
    out.push(t);
  }
  return out;
}

export function trend(weights) {
  const sorted = [...weights].sort((a, b) => (a.day < b.day ? -1 : 1));
  let t = null, prev = null;
  return sorted.map(w => {
    t = prev ? bridge(t, prev.kg, w.kg, daysBetween(prev.day, w.day)).at(-1) : w.kg;
    prev = w;
    return { day: w.day, kg: w.kg, trend: t };
  });
}

// Least-squares slope of the raw weigh-ins of the last 4 weeks, in kg a week.
export function rate(weights, today) {
  const from = addDays(today, -27);
  const pts = weights.filter(w => w.day >= from && w.day <= today).map(w => [daysBetween(from, w.day), w.kg]);
  const xs = pts.map(p => p[0]);
  const count = pts.length, spanDays = count ? Math.max(...xs) - Math.min(...xs) : 0;
  if (count < 8 || spanDays < 21) return { perWeek: null, count, spanDays };
  const mx = xs.reduce((s, x) => s + x, 0) / count, my = pts.reduce((s, p) => s + p[1], 0) / count;
  let num = 0, den = 0;
  for (const [x, y] of pts) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return { perWeek: 7 * num / den, count, spanDays };
}

/* ---------- Progress, Log again, morning ---------- */

// The n closed days before today; Missed days stay out of the averages. `reached`: tracked days with protein
// at 90% of the goal or more, whatever their calories.
export function lastDays({ meals, days, goals, today, n = 7 }) {
  const totals = byDay(meals), off = offDays(days);
  const r = { tracked: 0, lean: 0, steady: 0, logged: 0, reached: 0, avgKcal: null, avgProtein: null };
  let kcal = 0, protein = 0;
  for (let i = 1; i <= n; i++) {
    const d = addDays(today, -i), t = totals.get(d), goal = goalOn(goals, d), type = dayType(t, goal, off.has(d));
    if (type === 'miss') continue;
    r[type]++; r.tracked++; kcal += t.kcal; protein += t.protein;
    if (goal && Math.round(t.protein) >= proteinMin(goal)) r.reached++;
  }
  if (r.tracked) { r.avgKcal = Math.round(kcal / r.tracked); r.avgProtein = Math.round(protein / r.tracked); }
  return r;
}

// Calories and protein of each closed day from `from`, for the charts: null on Missed days, so they show as gaps.
export function series({ meals, days, goals, from, today }) {
  const totals = byDay(meals), off = offDays(days), out = [];
  for (let d = from; d < today; d = addDays(d, 1)) {
    const t = totals.get(d), counts = !!t && t.inTime && !off.has(d);
    out.push({ day: d, kcal: counts ? t.kcal : null, protein: counts ? t.protein : null, goal: goalOn(goals, d) });
  }
  return out;
}

// One point per Monday week: the averages of its tracked days, placed on its middle day.
export function weekly(points) {
  const weeks = [];
  for (const p of points) {
    if (!weeks.length || weekday(p.day) === 0) weeks.push([]);
    weeks.at(-1).push(p);
  }
  return weeks.map(w => {
    const on = w.filter(p => p.kcal != null);
    const avg = k => (on.length ? on.reduce((s, p) => s + p[k], 0) / on.length : null);
    return { day: w[Math.floor(w.length / 2)].day, kcal: avg('kcal'), protein: avg('protein'), goal: w.at(-1).goal };
  });
}

const minutes = hhmm => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

// Protein is behind while less of its goal is eaten than of the calorie limit.
export const proteinBehind = (totals, goal) => !!(goal && totals) && totals.protein / goal.protein < totals.kcal / goal.kcal;

// Named meals of the last 30 days, eaten within 2 hours of this time of day. Protein-rich first while protein is behind.
export function logAgain({ meals, now, today, totalsToday, goalToday }) {
  const from = addDays(today, -30), at = now.getHours() * 60 + now.getMinutes();
  const groups = new Map();
  for (const m of meals) {
    if (!m.name?.trim() || m.day < from || m.day > today) continue;
    const key = m.name.trim().toLowerCase().replace(/\s+/g, ' ');
    const g = groups.get(key) ?? { key, meal: m, near: 0 };
    if (m.day + m.time > g.meal.day + g.meal.time) g.meal = m;
    const diff = Math.abs(minutes(m.time) - at);
    if (Math.min(diff, 1440 - diff) <= 120) g.near++;
    groups.set(key, g);
  }
  const behind = proteinBehind(totalsToday, goalToday);
  const list = [...groups.values()].filter(g => g.near > 0).map(g => {
    const t = mealTotals(g.meal);
    return { key: g.key, name: g.meal.name.trim(), kcal: Math.round(t.kcal), protein: Math.round(t.protein), meal: g.meal, near: g.near };
  });
  const density = x => x.protein / Math.max(x.kcal, 1);
  list.sort(behind ? (a, b) => density(b) - density(a) || b.near - a.near : (a, b) => b.near - a.near || density(b) - density(a));
  return list.slice(0, 8).map(({ near, ...chip }) => chip);
}

// Why a day looks incomplete: nothing logged, under half the limit, or nothing from 17:00 on (a forgotten dinner).
function gap(meals, day, totals, goal) {
  if (!goal) return null;
  if (!totals.count) return 'none';
  if (totals.kcal < 0.5 * goal.kcal) return 'low';
  return meals.some(m => m.day === day && m.time >= '17:00') ? null : 'early';
}

export function morning({ meals, days, goals, weights, firstDay, today }) {
  const day = addDays(today, -1);
  const totals = dayTotals(meals, day), goal = goalOn(goals, day);
  const rec = days.find(d => d.day === day), reason = gap(meals, day, totals, goal);
  const last = trend(weights).at(-1);
  return {
    yesterday: {
      day, totals, goal,
      type: dayType(totals, goal, rec?.mark === 'not-tracked'),
      incomplete: !!reason, reason,
      asked: !!rec?.asked,
    },
    streak: streak({ meals, days, goals, firstDay, today }),
    trendKg: last ? last.trend : null,
    perWeek: rate(weights, today).perWeek,
    goalToday: goalOn(goals, today),
  };
}

/* ---------- Pinto: which pose and which line (drafts/mascot/HANDOFF.md, sections 4 and 5) ---------- */

// Days in a row up to `last` for which ok(type, totals, goal) holds; the first day is as far back as it looks.
function inARow({ meals, days, goals, firstDay, last, ok }) {
  const totals = byDay(meals), off = offDays(days);
  let n = 0;
  for (let d = last; firstDay && d >= firstDay; d = addDays(d, -1)) {
    const t = totals.get(d), goal = goalOn(goals, d);
    if (!ok(dayType(t, goal, off.has(d)), t, goal)) break;
    n++;
  }
  return n;
}

// The protein run: days in a row up to today with protein at or over the goal, in whole grams as Today's
// "Goal reached". A Missed day, a day under the goal or a day without one ends it.
export const proteinRun = ({ meals, days, goals, firstDay, today }) => inARow({ meals, days, goals, firstDay, last: today,
  ok: (type, t, goal) => type !== 'miss' && !!goal && Math.round(t.protein) >= goal.protein });

// Days in a row up to yesterday within the limit (Lean or Steady) and none under the calorie floor.
export const limitRun = ({ meals, days, goals, firstDay, today, floor }) => inARow({ meals, days, goals, firstDay, last: addDays(today, -1),
  ok: (type, t) => (type === 'lean' || type === 'steady') && Math.round(t.kcal) >= floor });

const MILESTONES = [365, 100, 30, 7];
const MILESTONE_LINES = { 7: 'One week in a row!', 30: '30 days in a row!', 100: '100 days in a row!', 365: 'A whole year in a row!' };
// The highest streak milestone a save reaches: at or above it after the save, below it before.
export const milestone = (before, after) => MILESTONES.find(m => before < m && after >= m) ?? null;

// Weight news for the morning: a new low of the trend (with an earlier weigh-in to beat, to 0.1 kg), else the trend
// down 0.2 kg or more this week, as Progress's Week chart counts it (its first weigh-in to the last). Only with a
// weigh-in in the last 7 days, and at most once every 7 days: `saidOn` is the day of the last such line, and that
// same day keeps it on redraws.
export function trendNews(weights, today, saidOn) {
  if (saidOn && saidOn !== today && daysBetween(saidOn, today) < 7) return null;
  const pts = trend(weights), last = pts.at(-1), from = addDays(today, -7);
  if (!last || last.day < from) return null;
  const r1 = n => Math.round(n * 10) / 10;
  if (pts.length > 1 && r1(last.trend) < r1(Math.min(...pts.slice(0, -1).map(p => p.trend)))) return 'New low on your trend.';
  const week = pts.filter(p => p.day >= from), down = week.length > 1 ? r1(week[0].trend - last.trend) : 0;
  return down >= 0.2 ? `Trend down ${down.toFixed(1)} kg this week.` : null;
}

// Pinto beside "Good morning". While Lean asks about yesterday (S1) it sits still and says nothing: resting if
// yesterday has nothing logged, else hello. Otherwise yesterday picks the pose: lean (a Lean day at or above the
// calorie floor), hello (a Lean day under the floor, or Steady), big (Logged) or rest (Missed). A line only after a
// Lean or Steady day at or above the floor: on day 3 or day 7 within the limit, else the weight news (`news`).
// `trend` says the line is the weight news, which is then remembered.
export function morningPinto({ ask, type, kcal, count, floor, run, news }) {
  if (ask) return { pose: count ? 'hello' : 'rest', line: null, still: true, trend: false };
  const fine = (type === 'lean' || type === 'steady') && Math.round(kcal) >= floor;
  const pose = type === 'lean' && fine ? 'lean' : type === 'logged' ? 'big' : type === 'miss' ? 'rest' : 'hello';
  const line = !fine ? null : run === 3 ? '3 days within your limit.' : run === 7 ? 'A week within your limit.' : news;
  return { pose, line: line ?? null, still: false, trend: !!line && line === news };
}

// Pinto in the toast after a new meal is saved (first match wins): a streak milestone; today's protein reaching its
// goal, the biceps sized by the protein run; today's first meal, with "Welcome back." after 2 or more days with
// nothing logged. Else null. `before` and `after` are the meals around the save, `day` the saved meal's day.
export function mealPinto({ before, after, days, goals, firstDay, today, day }) {
  const run = meals => streak({ meals, days, goals, firstDay, today }).current;
  const m = milestone(run(before), run(after));
  if (m) return { pose: 'proud', line: MILESTONE_LINES[m] };
  if (day !== today) return null;
  const goal = goalOn(goals, today), protein = meals => Math.round(dayTotals(meals, today).protein);
  if (goal && protein(before) < goal.protein && protein(after) >= goal.protein) {
    const n = proteinRun({ meals: after, days, goals, firstDay, today });
    return { pose: n >= 7 ? 'strong3' : n >= 3 ? 'strong2' : 'strong1', line: n >= 3 ? `Protein: ${n} days in a row.` : 'Protein goal met.' };
  }
  if (dayTotals(after, today).count !== 1) return null;
  const empty = d => !!firstDay && d >= firstDay && !dayTotals(after, d).count;
  return { pose: 'hello', line: empty(addDays(today, -1)) && empty(addDays(today, -2)) ? 'Welcome back.' : null };
}

// About 1 day in 4 Pinto peeks in, on Today or Progress, picked from the date (FNV-1a), so nothing is stored to
// choose it. From 2026 to 2045 that is a quarter of the days, never more than 2 in a row and never 7 days without.
export function peekDay(day) {
  let h = 2166136261;
  for (const c of day) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h >>>= 0;
  return h % 4 ? null : (h >>> 2) % 2 ? 'progress' : 'today';
}

/* ---------- Check and save ---------- */

// The step from this amount upwards: finer below 50 g, 100 ml and 2 pieces.
export function stepFor(unit, amount) {
  if (unit === 'piece') return amount < 2 ? 0.5 : 1;
  if (unit === 'ml') return amount < 100 ? 10 : 25;
  return amount < 50 ? 5 : 10;
}

// Amounts stay within what the steppers allow: 5,000 g or ml, 50 pieces.
export const MAX = { g: 5000, ml: 5000, piece: 50 };
export const portion = (items, factor) =>
  items.map(i => ({ ...i, amount: Math.min(MAX[i.unit] ?? 5000, Math.round(i.amount * factor * 100) / 100) }));
