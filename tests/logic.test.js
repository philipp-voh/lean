// Every example in BUILD-NOTES §5, plus the sample backup. Runs in any browser through tests/index.html.
import * as L from '../js/logic.js';
import { build, check } from '../js/backup.js';
import { VERSION } from '../js/config.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
export default tests;

export function eq(actual, expected, what = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what} expected ${e}, got ${a}`);
}
export const near = (actual, expected, digits = 2, what = '') => eq(+actual.toFixed(digits), expected, what);
export function ok(value, what = 'expected true') { if (!value) throw new Error(what); }

const MAN = { sex: 'male', age: 35, heightCm: 173, weightKg: 80, activity: 'medium', pace: 0.5 };
const WOMAN = { sex: 'female', age: 30, heightCm: 165, weightKg: 65, activity: 'low', pace: 1.0 };
const GOALS = [{ from: '2026-10-01', kcal: 2100, protein: 160, mode: 'calc', basis: null }];
const quick = (day, kcal, protein, time = '12:00', name = 'Meal') =>
  ({ id: `${day} ${time} ${name}`, day, time, name, kind: 'quick', items: [], kcalSet: kcal, proteinSet: protein });

/* ---------- Dates and numbers ---------- */

test('dayStr gives the local day', () => {
  eq(L.dayStr(new Date(2026, 10, 23, 23, 59)), '2026-11-23');
  eq(L.dayStr(new Date(2026, 0, 5, 0, 0)), '2026-01-05');
});
test('addDays and daysBetween cross clock changes, months and years', () => {
  eq(L.addDays('2026-10-24', 1), '2026-10-25');
  eq(L.addDays('2026-10-25', 1), '2026-10-26');
  eq(L.addDays('2026-03-29', 1), '2026-03-30');
  eq(L.addDays('2026-12-31', 1), '2027-01-01');
  eq(L.addDays('2026-11-23', -42), '2026-10-12');
  eq(L.daysBetween('2026-10-12', '2026-11-23'), 42);
  eq(L.daysBetween('2026-11-23', '2026-11-22'), -1);
});
test('parseNum takes comma or dot ("81,6" saves as 81.6)', () => {
  eq(L.parseNum('81,6'), 81.6);
  eq(L.parseNum('81.6'), 81.6);
  eq(L.parseNum(' 81 '), 81);
  eq(L.parseNum('1,240'), 1240);
  eq(L.parseNum('.5'), 0.5);
  eq(L.parseNum('13,5'), 13.5);
});
test('parseNum refuses what is not a number', () => {
  for (const s of ['', ' ', 'abc', '1,2,3', '-5', '1e3', '12a', null, undefined]) eq(L.parseNum(s), null, String(s));
});

/* ---------- Goals ---------- */

test('Sample man: 1,711 x 1.55 -> 2,650 - 550 = 2,100 kcal, 160 g', () => {
  const g = L.calcGoals(MAN);
  eq([g.burn, g.deficit, g.kcal, g.protein, g.pace, g.capped, g.notes], [2650, 550, 2100, 160, 0.5, false, []]);
});
test('Deficit: 0.1 -> 110, 0.5 -> 550, 1.0 -> 1,100, every 0.1 step', () => {
  const want = [110, 220, 330, 440, 550, 660, 770, 880, 990, 1100];
  want.forEach((d, i) => eq(L.calcGoals({ ...MAN, weightKg: 120, pace: (i + 1) / 10 }).deficit, d, `pace ${(i + 1) / 10}`));
});
test('Woman, 30, 165 cm, 65 kg, Low, 1.0 kg: 1,880 - 1,100 = 780 -> 1,200 kcal with the pace note', () => {
  const g = L.calcGoals(WOMAN);
  eq([g.burn, g.kcal, g.capped, g.pace], [1880, 1200, true, 0.6]);
  ok(g.notes.includes('Pace reduced to about 0.6 kg a week to stay at 1,200 kcal.'), g.notes.join(' | '));
});
test('Never calculated below the floor: 1,500 for men', () => {
  const g = L.calcGoals({ sex: 'male', age: 60, heightCm: 165, weightKg: 60, activity: 'low', pace: 1.0 });
  eq([g.burn, g.kcal, g.capped], [1840, 1500, true]);
});
test('A burn below the floor is the limit itself, never more', () => {
  const g = L.calcGoals({ sex: 'female', age: 80, heightCm: 150, weightKg: 45, activity: 'low', pace: 0.5 });
  eq([g.burn, g.kcal, g.pace], [1140, 1140, 0]);
});
test('Trend BMI under 18.5 means no deficit', () => {
  const g = L.calcGoals({ ...MAN, weightKg: 54 });
  eq([g.deficit, g.kcal === g.burn, g.pace], [0, true, 0]);
  ok(g.notes.some(n => n.includes('18.5')));
});
test('Pace above 1% of the weight a week gets a note', () => {
  ok(L.calcGoals({ ...MAN, pace: 0.9 }).notes.includes('Faster than 1% of your weight a week can cost muscle.'));
  eq(L.calcGoals({ ...MAN, pace: 0.8 }).notes, []);
});
test('Weight = trend weight, else the Setup weight; protein = round5(2.0 x kg)', () => {
  eq(L.calcGoals(MAN, 78.2).protein, 155);
  eq(L.calcGoals(MAN, 81.3).protein, 165);
  eq(L.calcGoals(MAN, null).protein, 160);
  eq(L.calcGoals(MAN, 78.2).burn, L.calcGoals({ ...MAN, weightKg: 78.2 }).burn);
});
test('Each day uses the goal record in force', () => {
  const goals = [GOALS[0], { from: '2026-11-15', kcal: 2000, protein: 155, mode: 'typed', basis: null }];
  eq(L.goalOn(goals, '2026-11-14'), { kcal: 2100, protein: 160 });
  eq(L.goalOn(goals, '2026-11-15'), { kcal: 2000, protein: 155 });
  eq(L.goalOn(goals, '2026-09-30'), null);
});

/* ---------- Totals and Lean days ---------- */

const granola = {
  day: '2026-11-23', time: '07:40', name: 'Granola', kcalSet: null, proteinSet: null, items: [
    { name: 'Granola', amount: 60, unit: 'g', per: { kcal: 4.5, protein: 0.1, carbs: 0.64, fat: 0.17 } },
    { name: 'Milk', amount: 200, unit: 'ml', per: { kcal: 0.47, protein: 0.034, carbs: 0.048, fat: 0.015 } },
    { name: 'Blueberries', amount: 40, unit: 'g', per: { kcal: 0.57, protein: 0.007, carbs: 0.12, fat: 0.003 } },
  ],
};
test('Totals = per-unit x amount, summed (387 kcal, 13 g)', () => {
  const t = L.mealTotals(granola);
  eq([Math.round(t.kcal), Math.round(t.protein), Math.round(t.carbs), Math.round(t.fat)], [387, 13, 53, 13]);
});
test('Per-unit values survive amount 0', () => {
  const item = { ...granola.items[0], amount: 0 };
  eq(L.itemTotals(item).kcal, 0);
  eq(L.itemTotals({ ...item, amount: 60 }).kcal, 270);
});
test('Typed totals override the items', () => {
  const t = L.mealTotals({ ...granola, kcalSet: 400, proteinSet: 20 });
  eq([t.kcal, t.protein], [400, 20]);
});
test('dayTotals sums one day and counts its meals', () => {
  const t = L.dayTotals([granola, quick('2026-11-23', 100, 5), quick('2026-11-22', 999, 99)], '2026-11-23');
  eq([Math.round(t.kcal), Math.round(t.protein), t.count], [487, 18, 2]);
});
test('Lean day = 1+ meal, round(kcal) <= limit, round(protein) >= ceil(0.9 x goal)', () => {
  const goal = { kcal: 2100, protein: 160 };
  const day = (kcal, protein, count = 1) => ({ kcal, protein, carbs: 0, fat: 0, count });
  ok(L.isLean(day(2100, 144), goal), 'exactly at both');
  ok(L.isLean(day(2100.4, 143.5), goal), 'rounding helps');
  ok(!L.isLean(day(2100.5, 150), goal), '2,101 is over');
  ok(!L.isLean(day(1800, 143.4), goal), '143 g is under 144');
  ok(!L.isLean(day(0, 0, 0), goal), 'no meals');
  ok(L.isLean(day(1800, 140), { kcal: 2100, protein: 155 }), 'ceil(139.5) = 140');
  ok(!L.isLean(day(1800, 150), null), 'no goal');
});

/* ---------- Day types and streak ---------- */

test('Day types: Lean, Steady under 90% protein, Logged over the limit, Missed', () => {
  const t = (kcal, protein, count = 1) => ({ kcal, protein, carbs: 0, fat: 0, count });
  const goal = { kcal: 2100, protein: 160 };
  eq([L.dayType(t(2100, 144), goal), L.dayType(t(1800, 143.4), goal), L.dayType(t(2100.5, 150), goal)], ['lean', 'steady', 'logged']);
  eq([L.dayType(t(0, 0, 0), goal), L.dayType(t(1800, 150), goal, true), L.dayType(undefined, goal)], ['miss', 'miss', 'miss']);
});

// One character per day from 1 Nov: L lean, S steady, X over the limit, - nothing logged, N lean meals marked Not tracked.
function run(pattern, today = L.addDays('2026-11-01', pattern.length)) {
  const meals = [], days = [];
  [...pattern].forEach((c, i) => {
    const d = L.addDays('2026-11-01', i);
    if (c === 'L' || c === 'N') meals.push(quick(d, 2000, 150));
    if (c === 'S') meals.push(quick(d, 2000, 100));
    if (c === 'X') meals.push(quick(d, 2500, 150));
    if (c === 'N') days.push({ day: d, mark: 'not-tracked', asked: true });
  });
  return L.streak({ meals, days, goals: GOALS, firstDay: '2026-11-01', today });
}
test('Every logged day adds to the streak, whatever its type', () => {
  const s = run('LSXL');
  eq([s.current, s.best], [4, 4]);
  eq(['01', '02', '03', '04'].map(d => s.marks[`2026-11-${d}`]), ['lean', 'steady', 'logged', 'lean']);
});
test('A Missed day ends the streak; best never resets', () => {
  const s = run('LLL-LL');
  eq([s.current, s.best, s.marks['2026-11-04']], [2, 3, 'miss']);
});
test('Not tracked is a Missed day', () => {
  const s = run('LLNL');
  eq([s.marks['2026-11-03'], s.current, s.best], ['miss', 1, 2]);
});
test('Today adds one as soon as it has a meal; an empty today never resets', () => {
  const args = { days: [], goals: GOALS, firstDay: '2026-11-01', today: '2026-11-02' };
  const y = quick('2026-11-01', 2000, 150);
  eq(L.streak({ ...args, meals: [y] }).current, 1, 'empty today');
  const s = L.streak({ ...args, meals: [y, quick('2026-11-02', 300, 20)] });
  eq([s.current, s.best, s.marks['2026-11-02']], [2, 2, 'today']);
});
test('Day one: no streak until the first meal; marks hold only today', () => {
  const args = { days: [], goals: GOALS, firstDay: '2026-11-23', today: '2026-11-23' };
  const s = L.streak({ ...args, meals: [] });
  eq([s.current, s.best, s.marks], [0, 0, { '2026-11-23': 'today' }]);
  eq(L.streak({ ...args, meals: [quick('2026-11-23', 400, 30)] }).current, 1);
});
test('A past-meal change recomputes from firstDay', () => {
  const meals = [quick('2026-11-01', 2000, 150), quick('2026-11-02', 2500, 150), quick('2026-11-03', 2000, 150)];
  const args = { days: [], goals: GOALS, firstDay: '2026-11-01', today: '2026-11-04' };
  eq(L.streak({ ...args, meals }).marks['2026-11-02'], 'logged');
  meals[1] = { ...meals[1], kcalSet: 1900 };
  eq(L.streak({ ...args, meals }).marks['2026-11-02'], 'lean');
  eq(L.streak({ ...args, meals: [meals[0], meals[2]] }).current, 1, 'deleted');
});
test('A goal change mid-streak changes the type, not the streak; meals before firstDay stay out', () => {
  const goals = [GOALS[0], { from: '2026-11-03', kcal: 1800, protein: 150, mode: 'typed', basis: null }];
  const meals = ['10-31', '11-01', '11-02', '11-03', '11-04'].map(d => quick(`2026-${d}`, 2000, 150));
  const s = L.streak({ meals, days: [], goals, firstDay: '2026-11-01', today: '2026-11-05' });
  eq([s.current, s.marks['2026-11-02'], s.marks['2026-11-03'], '2026-10-31' in s.marks], [4, 'lean', 'logged', false]);
});
test('Protein at 90%, in whole grams: the Lean line and the percent shown agree', () => {
  for (const protein of [155, 165, 175, 200]) {
    const goal = { kcal: 2100, protein }, min = L.proteinMin(goal);
    const t = p => ({ kcal: 2000, protein: p, carbs: 0, fat: 0, count: 1 });
    eq([L.dayType(t(min), goal), L.dayType(t(min - 1), goal)], ['lean', 'steady'], `${protein} g`);
    eq([Math.floor(min * 100 / protein) >= 90, Math.floor((min - 1) * 100 / protein) >= 90], [true, false], `${protein} g shown`);
  }
});

test('Creation times are local clock time, so the date never moves with the phone\'s time zone', () => {
  eq(L.localStamp(new Date(2026, 10, 17, 23, 30, 5)), '2026-11-17T23:30:05');
  eq(L.dayStr(new Date(L.localStamp(new Date(2026, 10, 17, 23, 30, 5)))), '2026-11-17');
});
test('A day counts only with a meal logged by midnight the next day; a later one still shows in its totals', () => {
  const at = (day, created) => ({ ...quick(day, 2000, 150), createdAt: created });
  const meals = [at('2026-11-01', '2026-11-01T12:00:00'), at('2026-11-02', '2026-11-03T08:00:00'), at('2026-11-03', '2026-11-05T08:00:00'),
    at('2026-11-04', '2026-11-04T19:00:00'), at('2026-11-05', '2026-11-05T13:00:00')];
  const s = L.streak({ meals, days: [], goals: GOALS, firstDay: '2026-11-01', today: '2026-11-06' });
  eq([s.marks['2026-11-02'], s.marks['2026-11-03'], s.current, s.best], ['lean', 'miss', 2, 2]);
  eq(L.lastDays({ meals, days: [], goals: GOALS, today: '2026-11-06', n: 5 }).tracked, 4);
  eq(L.series({ meals, days: [], goals: GOALS, from: '2026-11-01', today: '2026-11-06' }).map(p => p.kcal), [2000, 2000, null, 2000, 2000]);
  eq(L.dayTotals(meals, '2026-11-03').kcal, 2000, 'the late meal still shows on its day');
  // A day with a meal in time: its type uses all its meals, the late ones too.
  const mixed = [{ ...quick('2026-11-01', 500, 40), createdAt: '2026-11-01T08:00:00' }, { ...quick('2026-11-01', 1200, 110, '19:00'), createdAt: '2026-11-07T10:00:00' }];
  eq(L.streak({ meals: mixed, days: [], goals: GOALS, firstDay: '2026-11-01', today: '2026-11-08' }).marks['2026-11-01'], 'lean');
});

/* ---------- Calendar ---------- */

test('Month grid: Monday first, blanks before and after; February 2028 has 29 days', () => {
  const feb = L.monthDays('2028-02');
  eq([feb.length, feb[0], feb[1], feb[29], feb[30]], [35, null, '2028-02-01', '2028-02-29', null]);
  const aug = L.monthDays('2026-08');   // starts on a Saturday: 6 rows
  eq([aug.length, aug.indexOf('2026-08-01'), aug.at(-1)], [42, 5, null]);
  eq([L.addMonths('2026-12', 1), L.addMonths('2027-01', -1), L.addMonths('2026-11', -13)], ['2027-01', '2026-12', '2025-10']);
  eq([L.monthDays('2027-02').length, L.monthDays('2027-02')[0]], [28, '2027-02-01'], 'starts on a Monday: 4 rows');
  eq([L.monthDays('2026-11').indexOf('2026-11-01'), L.monthDays('2026-11').length], [6, 42], 'starts on a Sunday');
});

/* ---------- Weight ---------- */

test('Trend 81.98, then 81.0 three days after 81.8 -> 81.94, 81.87, 81.78', () => {
  eq(L.bridge(81.98, 81.8, 81.0, 3).map(t => +t.toFixed(2)), [81.94, 81.87, 81.78]);
});
test('The trend starts at the first weigh-in and moves a tenth of the way each day', () => {
  const t = L.trend([{ day: '2026-11-02', kg: 81 }, { day: '2026-11-01', kg: 80 }]);
  eq(t.map(x => x.day), ['2026-11-01', '2026-11-02']);
  eq(t[0].trend, 80);
  near(t[1].trend, 80.1);
});
test('Rate is hidden until 8 weigh-ins over 21 days', () => {
  const w = offs => offs.map(o => ({ day: L.addDays('2026-10-27', o), kg: 80 - o / 14 }));
  eq(L.rate(w([0, 3, 6, 9, 12, 15, 21]), '2026-11-23'), { perWeek: null, count: 7, spanDays: 21 });
  eq(L.rate(w([0, 3, 6, 9, 12, 15, 18, 20]), '2026-11-23').perWeek, null);
  const r = L.rate(w([0, 3, 6, 9, 12, 15, 18, 21]), '2026-11-23');
  near(r.perWeek, -0.5);
  eq([r.count, r.spanDays], [8, 21]);
});
test('Rate uses only weigh-ins dated today-27 to today', () => {
  const w = [{ day: '2026-10-26', kg: 90 }, ...[0, 3, 6, 9, 12, 15, 18, 21].map(o => ({ day: L.addDays('2026-10-27', o), kg: 80 }))];
  eq(L.rate(w, '2026-11-23'), { perWeek: 0, count: 8, spanDays: 21 });
});

/* ---------- Progress, Log again, morning ---------- */

test('Last days: closed days only; Missed days stay out of the averages', () => {
  const meals = [], days = [{ day: '2026-11-18', mark: 'not-tracked', asked: true }];
  for (let i = 16; i <= 22; i++) if (i !== 20) meals.push(quick(`2026-11-${i}`, i === 21 ? 2400 : 2000, i === 17 ? 100 : 150));
  meals.push(quick('2026-11-23', 5000, 0));   // today does not count
  const r = L.lastDays({ meals, days, goals: GOALS, today: '2026-11-23' });
  eq(r, { tracked: 5, lean: 3, steady: 1, logged: 1, reached: 4, avgKcal: 2080, avgProtein: 140 });
  eq(L.lastDays({ meals, days, goals: GOALS, today: '2026-11-23', n: 2 }),
    { tracked: 2, lean: 1, steady: 0, logged: 1, reached: 2, avgKcal: 2200, avgProtein: 150 });
});
test('Series: one point per closed day, gaps on Missed days, the goal of each day', () => {
  const goals = [...GOALS, { from: '2026-11-20', kcal: 2000, protein: 150, mode: 'typed', basis: null }];
  const meals = [quick('2026-11-18', 1900, 140), quick('2026-11-19', 2200, 160), quick('2026-11-21', 1800, 150), quick('2026-11-22', 999, 99)];
  const s = L.series({ meals, days: [{ day: '2026-11-21', mark: 'not-tracked', asked: true }], goals, from: '2026-11-18', today: '2026-11-22' });
  eq(s.map(p => p.day), ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']);
  eq(s.map(p => p.kcal), [1900, 2200, null, null]);
  eq(s.map(p => p.goal.kcal), [2100, 2100, 2000, 2000]);
});
test('Weekly: averages of the logged days per Monday week, on the middle day', () => {
  const pts = ['15', '16', '17', '18', '19', '20', '21', '22', '23'].map((d, i) =>
    ({ day: `2026-11-${d}`, kcal: i === 4 ? null : 1000 + i * 100, protein: i === 4 ? null : 100, goal: GOALS[0] }));
  const w = L.weekly(pts);
  eq(w.map(x => x.day), ['2026-11-15', '2026-11-19', '2026-11-23']);
  eq(w.map(x => x.kcal), [1000, 1400, 1800]);
});

function againMeals() {
  const m = [];
  for (const d of ['2026-11-18', '2026-11-19', '2026-11-20']) m.push(quick(d, 95, 16, '11:30', 'Skyr'));
  for (const d of ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']) m.push(quick(d, 120, 7, '11:40', 'Flat white'));
  for (const d of ['2026-11-21', '2026-11-22']) m.push(quick(d, 200, 20, '14:50', 'Protein bar'));
  m.push(quick('2026-11-22', 100, 17, '11:10', ' skyr  '));   // same name, newest: the template
  m.push(quick('2026-11-22', 690, 50, '19:30', 'Salmon, rice and greens'));   // not near 13:05
  m.push(quick('2026-10-20', 300, 30, '13:00', 'Old soup'));                // over 30 days ago
  m.push(quick('2026-11-22', 300, 30, '13:00', ''));                        // no name
  return m;
}
test('Log again: named meals of 30 days within 2 hours, most frequent first', () => {
  const r = L.logAgain({ meals: againMeals(), now: new Date(2026, 10, 23, 13, 5), today: '2026-11-23',
    totalsToday: { kcal: 0, protein: 0 }, goalToday: { kcal: 2100, protein: 160 } });
  eq(r.map(x => x.name), ['skyr', 'Flat white', 'Protein bar']);
  eq([r[0].kcal, r[0].protein, r[0].key], [100, 17, 'skyr']);
  ok(r[0].meal.day === '2026-11-22');
});
test('Log again: protein per 100 kcal first while protein is behind', () => {
  const r = L.logAgain({ meals: againMeals(), now: new Date(2026, 10, 23, 13, 5), today: '2026-11-23',
    totalsToday: { kcal: 860, protein: 51 }, goalToday: { kcal: 2100, protein: 160 } });
  eq(r.map(x => x.name), ['skyr', 'Protein bar', 'Flat white']);
});
test('Log again: top 8, and the time of day wraps at midnight', () => {
  const meals = Array.from({ length: 10 }, (_, i) => quick('2026-11-22', 100, 5, '23:45', `Snack ${i}`));
  eq(L.logAgain({ meals, now: new Date(2026, 10, 23, 0, 30), today: '2026-11-23' }).length, 8);
});
test('Morning summary: S1 when yesterday has nothing, under half the limit, or nothing from 17:00', () => {
  const base = { goals: GOALS, weights: [], firstDay: '2026-11-01', today: '2026-11-23', days: [] };
  const y = (...meals) => L.morning({ ...base, meals }).yesterday;
  const m = L.morning({ ...base, meals: [quick('2026-11-22', 640, 38, '19:00')] });
  eq([m.yesterday.reason, m.yesterday.incomplete, m.yesterday.asked, m.yesterday.type, m.trendKg, m.perWeek], ['low', true, false, 'steady', null, null]);
  eq(m.goalToday, { kcal: 2100, protein: 160 });
  eq([y().reason, y().type], ['none', 'miss']);
  eq(y(quick('2026-11-22', 1500, 150, '13:00')).reason, 'early');
  eq(y(quick('2026-11-22', 1500, 150, '13:00'), quick('2026-11-22', 600, 40, '17:00')).incomplete, false);
  eq(L.morning({ ...base, meals: [], days: [{ day: '2026-11-22', mark: 'light', asked: true }] }).yesterday.asked, true);
});

/* ---------- Check and save ---------- */

test('Steppers: 10 g (5 below 50), 25 ml (10 below 100), 1 piece (1/2 below 2)', () => {
  eq([L.stepFor('g', 60), L.stepFor('g', 50), L.stepFor('g', 45)], [10, 10, 5]);
  eq([L.stepFor('ml', 200), L.stepFor('ml', 100), L.stepFor('ml', 90)], [25, 25, 10]);
  eq([L.stepFor('piece', 3), L.stepFor('piece', 2), L.stepFor('piece', 1.5)], [1, 1, 0.5]);
});
test('Portions scale every amount and keep per-unit values', () => {
  const half = L.portion(granola.items, 0.5);
  eq(half.map(i => i.amount), [30, 100, 20]);
  eq(half[0].per, granola.items[0].per);
  eq(L.portion([{ amount: 3, unit: 'piece', per: {} }], 0.75)[0].amount, 2.25);
  eq(granola.items[0].amount, 60, 'original untouched');
});
test('Portions stop at 5,000 g or ml and 50 pieces, like the steppers', () => {
  eq(L.portion([{ amount: 30, unit: 'piece', per: {} }, { amount: 3000, unit: 'g', per: {} }], 2).map(i => i.amount), [50, 5000]);
});

/* ---------- Release ---------- */

test('Release: VERSION is the same in js/config.js and sw.js, or the update never installs', async () => {
  const sw = await (await fetch('../sw.js', { cache: 'no-store' })).text();
  eq(sw.match(/const VERSION = '([^']+)'/)?.[1], VERSION);
});

/* ---------- Backup and the sample data ---------- */

let sample;
const loadSample = async () => (sample ??= await (await fetch('./sample-backup.json', { cache: 'no-store' })).json());
const clone = x => structuredClone(x);

test('Sample backup passes the restore check', async () => {
  const r = check(await loadSample());
  ok(r.ok, r.error);
  eq(r.summary.text, `Backup from 23 Nov 2026: 43 days, ${r.data.meals.length} meals, 20 weigh-ins.`);
});
test('Sample: 14-day streak with today, best 22, all four day types', async () => {
  const d = await loadSample();
  const s = L.streak({ meals: d.meals, days: d.days, goals: d.goals, firstDay: d.settings.firstDay, today: '2026-11-23' });
  eq([s.current, s.best], [14, 22]);
  eq(['2026-10-29', '2026-11-03', '2026-11-07', '2026-11-09', '2026-11-21'].map(x => s.marks[x]), ['logged', 'miss', 'steady', 'miss', 'logged']);
});
test('Sample: Sunday 22 Nov is a Lean day of 1,960 kcal and 147 g', async () => {
  const d = await loadSample();
  const m = L.morning({ meals: d.meals, days: d.days, goals: d.goals, weights: d.weights, firstDay: d.settings.firstDay, today: '2026-11-23' });
  eq([Math.round(m.yesterday.totals.kcal), Math.round(m.yesterday.totals.protein), m.yesterday.totals.count], [1960, 147, 5]);
  eq([m.yesterday.type, m.yesterday.incomplete, m.streak.current], ['lean', false, 14]);
  ok(m.trendKg > 77.5 && m.trendKg < 79, `trend ${m.trendKg}`);
  ok(m.perWeek < -0.2 && m.perWeek > -0.7, `rate ${m.perWeek}`);
});
test('Sample: today 860 kcal, 51 g protein, carbs 98 g, fat 28 g; S1 on 24 Nov', async () => {
  const d = await loadSample();
  const t = L.dayTotals(d.meals, '2026-11-23');
  eq([t.kcal, t.protein, t.carbs, t.fat].map(Math.round), [860, 51, 98, 28]);
  const m = L.morning({ meals: d.meals, days: d.days, goals: d.goals, weights: d.weights, firstDay: d.settings.firstDay, today: '2026-11-24' });
  eq([m.yesterday.incomplete, m.yesterday.reason, m.yesterday.asked], [true, 'low', false]);
});
test('Sample: weigh-ins start at 80.0 kg on 12 Oct, with gaps', async () => {
  const d = await loadSample();
  eq([d.weights[0].day, d.weights[0].kg, d.weights.length], ['2026-10-12', 80, 20]);
  ok(L.daysBetween(d.weights[1].day, d.weights[2].day) > 1);
});
test('Backup file: right name, no key, quota or drafts', () => {
  const { text, filename } = build({
    settings: [{ name: 'apiKey', value: 'AIzaSECRET' }, { name: 'quota', value: {} }, { name: 'firstDay', value: '2026-10-12' }],
    meals: [], weights: [], days: [], goals: [],
  }, new Date(2026, 10, 23, 9, 0));
  eq(filename, 'lean-backup-2026-11-23.json');
  ok(!text.includes('AIzaSECRET') && !text.includes('quota') && !text.includes('drafts'));
  eq(JSON.parse(text).summary.days, 43);
});
test('Damaged and foreign files are refused with the reason', async () => {
  const d = clone(await loadSample());
  delete d.meals[213].day;
  eq(check(d).error, 'This backup is damaged (meal 214 has no date).');
  eq(check({ hello: 1 }).error, "This file isn't a Lean backup.");
  eq(check({ ...clone(sample), format: 2 }).error, 'This backup is from a newer Lean. Update Lean first.');
  const w = clone(sample);
  w.weights[2].kg = 400;
  eq(check(w).error, 'This backup is damaged (weigh-in 3 has a wrong weight).');
  const dup = clone(sample);
  dup.meals[5].id = dup.meals[4].id;
  eq(check(dup).error, 'This backup is damaged (meal 6 is a duplicate).');
});
test('A backup of anything the app can save restores', () => {
  const item = (amount, unit, kcal, protein = 0) => ({ name: 'Food', amount, unit, per: { kcal: kcal / (amount || 1), protein: protein / (amount || 1), carbs: 0, fat: 0 }, source: 'user', confidence: 'high' });
  const heavy = { ...MAN, weightKg: 300, heightCm: 230, age: 18, activity: 'high' };
  const light = { sex: 'female', age: 120, heightCm: 120, weightKg: 30, activity: 'low', pace: 0.1 };
  const goals = [heavy, light, { ...MAN, weightKg: 205 }].map((p, i) => ({ from: `2026-11-0${i + 1}`, ...L.calcGoals(p), mode: 'calc', basis: null }));
  const meals = [{
    id: 'm1', day: '2026-11-20', time: '12:00', name: '', kind: 'quick', kcalSet: null, proteinSet: null, hints: [], note: '', assumptions: null, photoCount: 0, model: null,
    items: [item(50, 'piece', 4000), item(0.25, 'piece', 1300, 50), { ...item(0.1, 'g', 5000, 500), amount: 0 },
      ...Array.from({ length: 60 }, () => item(5000, 'ml', 100))],
  }];
  const { text } = build({ settings: [{ name: 'firstDay', value: '2026-11-01' }], goals, meals, weights: [{ day: '2026-11-01', kg: 300, at: '2026-11-01T07:00:00Z' }], days: [] }, new Date(2026, 10, 23, 9, 0));
  const r = check(JSON.parse(text));
  ok(r.ok, r.error);
});
test('Restore keeps only known fields', async () => {
  const d = clone(await loadSample());
  d.meals[0].evil = '<img onerror=alert(1)>';
  d.settings.apiKey = 'AIzaSECRET';
  const r = check(d);
  ok(r.ok && !('evil' in r.data.meals[0]) && !JSON.stringify(r.data).includes('AIzaSECRET'));
});
