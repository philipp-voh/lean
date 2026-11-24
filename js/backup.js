// The backup file is the only real backup. It never holds the key, the free-limit state, drafts or photos.
import { VERSION } from './config.js';
import * as db from './db.js';
import { MAX, dayStr, daysBetween } from './logic.js';

const FORMAT = 1;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
// Settings come as the store's records [{name, value}] or as an object of values.
const settingsOf = s => (Array.isArray(s) ? Object.fromEntries(s.map(r => [r.name, r.value])) : s ?? {});

export function build(data, now) {
  const s = settingsOf(data.settings);
  const to = dayStr(now), from = s.firstDay ?? to;
  const content = {
    app: 'Lean', format: FORMAT, createdAt: now.toISOString(), appVersion: VERSION,
    summary: { from, to, days: daysBetween(from, to) + 1, meals: data.meals.length, weights: data.weights.length },
    settings: { profile: s.profile ?? null, firstDay: s.firstDay ?? null },
    goals: data.goals, meals: data.meals, weights: data.weights, days: data.days,
  };
  return { text: JSON.stringify(content), filename: `lean-backup-${to}.json` };
}

// The share sheet lets the owner pick Save to Files, iCloud Drive. A download only where sharing files isn't possible.
export async function save(data, now) {
  const { text, filename } = build(data, now);
  const file = new File([text], filename, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e.name === 'NotAllowedError') return 'needs-tap';   // sharing needs a tap within the last 5 seconds
      const cancelled = e.name === 'AbortError';
      throw Object.assign(new Error(cancelled ? 'Backup not saved.' : "Lean couldn't share the backup."), { kind: cancelled ? 'cancelled' : 'share' });
    }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'downloaded';
}

export async function read(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { return bad("This file isn't a Lean backup."); }
  return check(data);
}

/* ---------- Checking a backup: on any doubt say why and change nothing ---------- */

const bad = error => ({ ok: false, error, data: null, summary: null });
class Damage extends Error {}
const need = (ok, why) => { if (!ok) throw new Damage(why); };

const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) &&
  new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const isTime = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isText = (v, max) => typeof v === 'string' && v.length <= max;
const isStamp = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const text = (v, max) => (isText(v, max) ? v : '');
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

function item(i, at) {
  need(i && typeof i === 'object' && isText(i.name, 200) && i.name.trim(), `${at} has no name`);
  need(['g', 'ml', 'piece'].includes(i.unit), `${at} has an unknown unit`);
  need(isNum(i.amount, 0, MAX[i.unit]), `${at} has a wrong amount`);
  // Per-unit values have no upper limit: a small amount typed with its total, such as ¼ pizza, gives large ones.
  const p = i.per;
  need(p && ['kcal', 'protein', 'carbs', 'fat'].every(k => isNum(p[k], 0, Infinity)), `${at} has wrong values`);
  return {
    name: i.name, amount: i.amount, unit: i.unit,
    per: { kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat },
    source: oneOf(i.source, ['label', 'estimate', 'user'], 'estimate'),
    confidence: oneOf(i.confidence, ['low', 'medium', 'high'], 'medium'),
  };
}

function meal(m, n) {
  const at = `meal ${n}`;
  need(m && typeof m === 'object', `${at} is empty`);
  need(isText(m.id, 100) && m.id, `${at} has no id`);
  need(isDay(m.day), `${at} has no date`);
  need(isTime(m.time), `${at} has no time`);
  need(isText(m.name, 200), `${at} has no name`);
  need(['photo', 'text', 'quick', 'again'].includes(m.kind), `${at} has an unknown kind`);
  need(Array.isArray(m.items), `${at} has no list of items`);
  need(m.kcalSet == null || isNum(m.kcalSet, 0, 20000), `${at} has a wrong calorie total`);
  need(m.proteinSet == null || isNum(m.proteinSet, 0, 2000), `${at} has a wrong protein total`);
  const stamp = `${m.day}T${m.time}:00`;
  return {
    id: m.id, day: m.day, time: m.time, name: m.name, kind: m.kind,
    items: m.items.map((i, k) => item(i, `${at}, item ${k + 1}`)),
    kcalSet: m.kcalSet ?? null, proteinSet: m.proteinSet ?? null,
    hints: Array.isArray(m.hints) ? m.hints.filter(h => isText(h, 100)) : [],
    note: text(m.note, 1000), assumptions: isText(m.assumptions, 1000) ? m.assumptions : null,
    photoCount: Number.isInteger(m.photoCount) && m.photoCount >= 0 && m.photoCount <= 4 ? m.photoCount : 0,
    model: isText(m.model, 100) ? m.model : null,
    createdAt: isStamp(m.createdAt) ? m.createdAt : stamp, updatedAt: isStamp(m.updatedAt) ? m.updatedAt : stamp,
  };
}

function weight(w, n) {
  need(w && isDay(w.day), `weigh-in ${n} has no date`);
  need(isNum(w.kg, 30, 300), `weigh-in ${n} has a wrong weight`);
  return { day: w.day, kg: Math.round(w.kg * 10) / 10, at: isStamp(w.at) ? w.at : `${w.day}T07:00:00` };
}

function day(d, n) {
  need(d && isDay(d.day), `day ${n} has no date`);
  need([undefined, null, 'light', 'not-tracked'].includes(d.mark), `day ${n} has an unknown mark`);
  return { day: d.day, mark: d.mark ?? null, asked: d.asked === true };
}

function goal(g, n) {
  need(g && isDay(g.from), `goal ${n} has no start date`);
  // As wide as calculated goals go (2 g per kg up to 300 kg), not only typed ones.
  need(isNum(g.kcal, 300, 10000), `goal ${n} has a wrong calorie limit`);
  need(isNum(g.protein, 30, 600), `goal ${n} has a wrong protein goal`);
  return { from: g.from, kcal: g.kcal, protein: g.protein, mode: oneOf(g.mode, ['calc', 'typed'], 'typed'), basis: g.basis ?? null };
}

function profile(p) {
  if (p == null) return null;
  need(['male', 'female'].includes(p.sex) && isNum(p.age, 18, 120) && isNum(p.heightCm, 120, 230) &&
    isNum(p.weightKg, 30, 300) && ['low', 'medium', 'high'].includes(p.activity) && isNum(p.pace, 0, 1), 'the profile is incomplete');
  return { sex: p.sex, age: p.age, heightCm: p.heightCm, weightKg: p.weightKg, activity: p.activity, pace: p.pace };
}

function list(value, name, fn, key) {
  need(Array.isArray(value), `the ${name} list is missing`);
  const out = value.map((v, i) => fn(v, i + 1));
  const seen = new Set();
  out.forEach((v, i) => { need(!seen.has(v[key]), `${name.replace(/s$/, '')} ${i + 1} is a duplicate`); seen.add(v[key]); });
  return out;
}

function summarize(d) {
  const created = new Date(d.createdAt);
  const to = dayStr(created), from = d.settings.firstDay ?? to;
  const days = Math.max(1, daysBetween(from, to) + 1);
  const when = `${created.getDate()} ${MONTHS[created.getMonth()]} ${created.getFullYear()}`;
  return {
    createdAt: d.createdAt, from, to, days, meals: d.meals.length, weights: d.weights.length,
    text: `Backup from ${when}: ${plural(days, 'day')}, ${plural(d.meals.length, 'meal')}, ${plural(d.weights.length, 'weigh-in')}.`,
  };
}

// Returns {ok, error, data, summary}; data is a clean copy holding only known fields.
export function check(data) {
  if (data?.app !== 'Lean' || !Number.isInteger(data.format) || data.format < 1) return bad("This file isn't a Lean backup.");
  if (data.format > FORMAT) return bad('This backup is from a newer Lean. Update Lean first.');
  // Older formats convert here, step by step, once there are any.
  try {
    need(isStamp(data.createdAt), 'it has no creation date');
    need(data.settings && typeof data.settings === 'object', 'the settings are missing');
    need(data.settings.firstDay == null || isDay(data.settings.firstDay), 'the first day is wrong');
    const clean = {
      app: 'Lean', format: FORMAT, createdAt: data.createdAt, appVersion: text(data.appVersion, 20),
      settings: { profile: profile(data.settings.profile), firstDay: data.settings.firstDay ?? null },
      goals: list(data.goals, 'goals', goal, 'from'),
      meals: list(data.meals, 'meals', meal, 'id'),
      weights: list(data.weights, 'weigh-ins', weight, 'day'),
      days: list(data.days, 'days', day, 'day'),
    };
    return { ok: true, error: null, data: clean, summary: summarize(clean) };
  } catch (e) {
    if (e instanceof Damage) return bad(`This backup is damaged (${e.message}).`);
    throw e;
  }
}

// Replaces meals, weights, days, goals and settings in one transaction. Keeps the key (and its free-limit state).
export async function restore(data) {
  const checked = check(data);
  if (!checked.ok) throw Object.assign(new Error(checked.error), { kind: 'damaged' });
  const d = checked.data;
  const [key, quota, photoIds] = await Promise.all([db.get('settings', 'apiKey'), db.get('settings', 'quota'), db.keys('photos')]);
  const ids = new Set(d.meals.map(m => m.id));
  await db.write(t => {
    for (const store of ['meals', 'weights', 'days', 'goals', 'settings']) t.clear(store);
    for (const m of d.meals) t.put('meals', m);
    for (const w of d.weights) t.put('weights', w);
    for (const x of d.days) t.put('days', x);
    for (const g of d.goals) t.put('goals', g);
    if (d.settings.profile) t.put('settings', { name: 'profile', value: d.settings.profile });
    if (d.settings.firstDay) t.put('settings', { name: 'firstDay', value: d.settings.firstDay });
    t.put('settings', { name: 'lastBackupAt', value: d.createdAt });
    if (key) t.put('settings', key);
    if (quota) t.put('settings', quota);
    for (const id of photoIds) if (!ids.has(id)) t.del('photos', id);
  });
  return { meals: d.meals.length, weights: d.weights.length, text: `Restored ${plural(d.meals.length, 'meal')}.` };
}
