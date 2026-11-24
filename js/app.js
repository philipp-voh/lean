// Lean's shell: state in memory, the router, the start sequence, waiting meals, updates and midnight.
//
// Screens export view(state, params), actions and, optionally, enter(state, params, ctx) for the moment a route opens.
// Besides the contract's ctx, screens get ctx.saveSoon (typing: saved after 500 ms), ctx.estimate(draftId, previous)
// and ctx.load() (re-reads everything after a restore).
import * as db from './db.js';
import { dayStr } from './logic.js';
import { estimate, usedUp } from './ai.js';
import { close, html, icon, toast } from './ui.js';
import * as setup from './screens/setup.js';
import * as summary from './screens/summary.js';
import * as today from './screens/today.js';
import * as add from './screens/add.js';
import * as check from './screens/check.js';
import * as progress from './screens/progress.js';
import * as settings from './screens/settings.js';

const SCREENS = { setup, summary, today, add, check, progress, settings };
const KEYS = { meals: 'id', drafts: 'id', weights: 'day', days: 'day', goals: 'from' };
const AWAY_MS = 10 * 60 * 1000;

const state = {
  meals: [], weights: [], days: [], goals: [], drafts: [], settings: {},
  ui: {},            // passing screen flags, never saved
  running: {},       // estimates in flight, by draft id
  updateReady: false,
};

/* ---------- Saving: IndexedDB first, then memory, so "saved" is only shown once it is on disk ---------- */

function apply(store, value, key) {
  if (store === 'photos') return;
  if (store === 'settings') {
    if (value) state.settings[value.name] = value.value; else delete state.settings[key];
    return;
  }
  const k = KEYS[store], id = value ? value[k] : key;
  state[store] = state[store].filter(r => r[k] !== id);
  if (value) state[store].push(value);
}

async function guard(promise) {
  try { return await promise; }
  catch (e) {
    toast(e.kind === 'full' ? e.message : "Lean couldn't save this change. Try again.");
    throw e;
  }
}

const pending = new Map();   // typing: store:key -> {timer, run}
const idOf = (store, key) => `${store}:${key}`;

// A newer write or a delete wins over a save still waiting, so a saved meal's draft never comes back.
function drop(store, key) {
  const id = idOf(store, key);
  clearTimeout(pending.get(id)?.timer);
  pending.delete(id);
}

function saveSoon(store, value) {
  const id = idOf(store, value[KEYS[store] ?? 'name']);
  clearTimeout(pending.get(id)?.timer);
  const run = () => { pending.delete(id); return ctx.save(store, value).catch(() => {}); };
  pending.set(id, { timer: setTimeout(run, 500), run });
}

function flush() {
  for (const p of [...pending.values()]) { clearTimeout(p.timer); p.run(); }
}

const ctx = {
  state,
  go,
  refresh: () => render(),
  now: () => new Date(),
  today: () => dayStr(new Date()),
  async save(store, value) {
    drop(store, value[KEYS[store] ?? 'name']);
    await guard(db.put(store, value));
    apply(store, value);
  },
  async remove(store, key) {
    drop(store, key);
    await guard(db.del(store, key));
    apply(store, null, key);
  },
  async write(fn) {
    const ops = [];
    await guard(db.write(t => fn({
      put: (s, v) => { drop(s, v[KEYS[s] ?? 'name']); ops.push(() => apply(s, v)); t.put(s, v); },
      del: (s, k) => { drop(s, k); ops.push(() => apply(s, null, k)); t.del(s, k); },
      clear: s => { ops.push(() => { if (s === 'settings') state.settings = {}; else if (s !== 'photos') state[s] = []; }); t.clear(s); },
    })));
    ops.forEach(op => op());
  },
  saveSoon,
  estimate: runEstimate,
  load,
};

async function load() {
  const names = ['meals', 'weights', 'days', 'goals', 'drafts', 'settings'];
  const [meals, weights, days, goals, drafts, rows] = await Promise.all(names.map(n => db.all(n)));
  Object.assign(state, { meals, weights, days, goals, drafts, settings: Object.fromEntries(rows.map(r => [r.name, r.value])) });
}

/* ---------- Router ---------- */

let current = { screen: 'today', params: {} }, shownHash = '', shownDay = '';

function parse(hash) {
  const [name, arg] = hash.replace(/^#\/?/, '').split('/');
  const id = arg && /^[\w-]{1,64}$/.test(arg) ? arg : null;
  switch (name) {
    case 'gate': case 'welcome': case 'key': case 'goals': return { screen: 'setup', params: { step: name } };
    case 'summary': case 'progress': case 'settings': return { screen: name, params: {} };
    case 'today': return { screen: 'today', params: { day: ctx.today() } };
    case 'day': {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(arg ?? '') && arg <= ctx.today() ? arg : null;
      return day && { screen: 'today', params: { day } };
    }
    case 'add': return id && { screen: 'add', params: { id, mode: 'photo' } };
    case 'describe': return id && { screen: 'add', params: { id, mode: 'text' } };
    case 'check': return id && { screen: 'check', params: { id } };
    case 'meal': return id && { screen: 'check', params: { mealId: id } };
  }
  return null;
}

function go(route, { replace = false } = {}) {
  if (route === location.hash) { onRoute(); return; }
  if (replace) location.replace(route); else location.hash = route;
}

function onRoute() {
  flush();
  const box = document.getElementById('toast');
  if (!box.hidden && box.dataset.at !== location.hash) box.hidden = true;   // a toast stays on its own screen
  const next = parse(location.hash);
  if (!next) { go('#/today', { replace: true }); return; }
  current = next;
  SCREENS[current.screen].enter?.(state, current.params, ctx);
  render(true);
  document.querySelector('#app h1')?.focus({ preventScroll: true });   // VoiceOver starts on the new screen
}

// Typing never redraws (iOS would drop the keyboard and dictation): a redraw then waits for the field to lose focus.
let stale = false;
const typing = () => document.activeElement?.matches('#app textarea, #app input:not([type=range], [type=file], [type=date], [type=time])');

// Background news (an estimate came back, an update is ready) also waits while a sheet is open, so it stays open.
function redrawSoon() {
  if (document.querySelector('#app dialog[open]')) { stale = true; return; }
  render();
}

// A redraw replaces the focused button: remember it by its id or data attributes, so keyboard and VoiceOver keep their place.
// When it is gone after the redraw (a result replaced a spinner, a button was removed), focus goes to the screen's heading.
const FOCUS_KEYS = ['action', 'change', 'index', 'v', 'field', 'id', 'day', 'to'];
function focusSpot(root) {
  const el = document.activeElement;
  if (!el || el === root || !root.contains(el)) return null;
  if (el.matches('h1')) return { sel: 'h1', at: 0 };
  const sel = el.id ? `#${CSS.escape(el.id)}`
    : FOCUS_KEYS.filter(k => k in el.dataset).map(k => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('');
  return sel ? { sel, at: [...root.querySelectorAll(sel)].indexOf(el) } : { sel: 'h1', at: 0 };
}

function render(force = false) {
  if (!force && typing()) { stale = true; return; }
  stale = false;
  const root = document.getElementById('app');
  const same = shownHash === location.hash;
  const top = same ? root.querySelector('.screen')?.scrollTop ?? 0 : 0;
  const spot = same ? focusSpot(root) : null;
  root.innerHTML = String(SCREENS[current.screen].view(state, current.params));
  const scroller = root.querySelector('.screen');
  if (scroller) scroller.scrollTop = top;
  shownHash = location.hash;
  shownDay = ctx.today();
  hydrate(root);
  if (spot) (root.querySelectorAll(spot.sel)[spot.at] ?? root.querySelector(spot.sel) ?? root.querySelector('h1'))?.focus({ preventScroll: true });
}

/* ---------- After each render: bar widths (no style attributes under the security policy) and photos ---------- */

const photoUrls = new Map();   // meal id -> object URL, kept: a meal's photo never changes
let draftUrls = [];

function hydrate(root) {
  for (const el of root.querySelectorAll('[data-pct]')) el.style.width = `${Math.max(0, Math.min(100, +el.dataset.pct))}%`;
  draftUrls.forEach(u => URL.revokeObjectURL(u));
  draftUrls = [];
  for (const img of root.querySelectorAll('img[data-draft]')) {
    const p = state.drafts.find(d => d.id === img.dataset.draft)?.photos[+img.dataset.index];
    if (!p) continue;
    const url = URL.createObjectURL(new Blob([p.bytes], { type: p.type }));
    draftUrls.push(url);
    img.src = url;
  }
  for (const img of root.querySelectorAll('img[data-photo]')) {
    const id = img.dataset.photo;
    if (photoUrls.has(id)) { img.src = photoUrls.get(id); continue; }
    db.get('photos', id).then(p => {
      // Backups hold no photos: a restored meal shows the plain meal tile instead of an empty one.
      if (!p) { if (img.matches('.thumb')) img.outerHTML = String(html`<span class="thumb blank">${icon('meal')}</span>`); else img.remove(); return; }
      if (!photoUrls.has(id)) photoUrls.set(id, URL.createObjectURL(new Blob([p.bytes], { type: p.type })));
      img.src = photoUrls.get(id);
    }).catch(() => {});
  }
}

/* ---------- Taps and typing ---------- */

// Shared by every screen: close a sheet, and plain navigation buttons (data-to, data-replace).
const COMMON = {
  closeSheet: el => close(el.dataset.sheet),
  go: (el, e, c) => c.go(el.dataset.to, { replace: 'replace' in el.dataset }),
};

function dispatch(attr, e) {
  const el = e.target.closest(`[${attr}]`);
  if (!el) return;
  const name = el.getAttribute(attr);
  const fn = SCREENS[current.screen].actions?.[name] ?? COMMON[name];
  if (!fn) { console.warn('No action', name); return; }
  Promise.resolve()
    .then(() => fn(el, e, ctx))
    .catch(err => { if (!err?.kind) console.error(err); });
}

function listen() {
  const root = document.getElementById('app');
  root.addEventListener('click', e => {
    if (e.target.tagName === 'DIALOG') { e.target.close(); return; }   // a tap on the dimmed backdrop
    dispatch('data-action', e);
  });
  root.addEventListener('input', e => dispatch('data-input', e));
  root.addEventListener('change', e => dispatch('data-change', e));
  // iOS 26 leaves the page shifted after the keyboard closes.
  root.addEventListener('focusout', () => setTimeout(() => {
    if (typing()) return;
    window.scrollTo(0, 0);
    if (stale) redrawSoon();
  }, 50));
  root.addEventListener('close', () => { if (stale) redrawSoon(); }, true);   // a sheet closed: catch up
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('online', retryWaiting);
  document.addEventListener('visibilitychange', onVisibility);
}

/* ---------- Start, return and midnight ---------- */

const setupDone = () => state.goals.length > 0 && !!state.settings.firstDay;

function home() {
  const t = ctx.today(), first = state.settings.firstDay;
  return first && t > first && state.settings.summaryShownFor !== t ? '#/summary' : '#/today';
}

// Where Lean opens: setup until done, a meal that is being added, else the morning summary or Today.
function startRoute() {
  const hash = location.hash, next = parse(hash);
  if (!setupDone()) {
    if (next?.screen === 'setup' && next.params.step !== 'gate') return hash;
    return state.settings.apiKey ? '#/goals' : '#/welcome';
  }
  if (!state.settings.apiKey) return '#/key';
  if (adding(next)) return hash;
  return home();
}

// A meal being added, or a saved meal open for changes: a return after 10 minutes stays there.
const adding = r => !!r && (['add', 'check'].includes(r.screen) && !!state.drafts.find(d => d.id === r.params.id) ||
  (r.screen === 'check' && !!state.meals.find(m => m.id === r.params.mealId)));

let hiddenAt = 0, lastUpdateCheck = Date.now();

function onVisibility() {
  if (document.hidden) { hiddenAt = Date.now(); flush(); return; }
  if (!setupDone() || !state.settings.apiKey) return;
  retryWaiting();
  if (Date.now() - lastUpdateCheck > 3600000) { lastUpdateCheck = Date.now(); swReg?.update().catch(() => {}); }
  if (hiddenAt && Date.now() - hiddenAt > AWAY_MS && !adding(current) && current.screen !== 'setup') go(home(), { replace: true });
  else if (shownDay !== ctx.today()) onRoute();   // a new day began while Lean slept
}

function midnight() {
  const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => { if (!document.hidden && current.screen === 'today') onRoute(); midnight(); }, next - now);
}

/* ---------- Estimates and waiting meals ---------- */

// The free-limit blocks belong to the key: a call that ends after the key changed leaves them alone.
async function keepQuota(out, key) {
  if (state.settings.apiKey !== key) return;
  if (out?.quota) {
    // Merged, not replaced: two calls at once each add their own blocks; expired ones are ignored anyway.
    const quota = { ...state.settings.quota, ...out.quota };
    if (JSON.stringify(quota) !== JSON.stringify(state.settings.quota ?? {})) await ctx.save('settings', { name: 'quota', value: quota }).catch(() => {});
  }
  // Research question: what a real daily-limit answer looks like. The first one is kept and shown in Settings.
  if (out?.dailyBody && !state.settings.dailyBody) {
    await ctx.save('settings', { name: 'dailyBody', value: JSON.stringify(out.dailyBody).slice(0, 2000) }).catch(() => {});
  }
}

const showing = id => current.params.id === id;

// A first estimate saves the draft as 'estimating', so a killed app finds it as a waiting meal.
// A re-estimate (previous set) leaves the checked estimate and its edits as they are unless a new answer arrives.
async function runEstimate(id, previous = null) {
  const draft = state.drafts.find(d => d.id === id);
  if (!draft || state.running[id]) return;
  const run = state.running[id] = { slow: false, cancelled: false };
  const key = state.settings.apiKey;
  if (!previous) {
    const before = { status: draft.status, error: draft.error };
    Object.assign(draft, { status: 'estimating', error: null });
    try { await ctx.save('drafts', draft); }
    catch { Object.assign(draft, before); delete state.running[id]; if (showing(id)) render(); return; }
  }
  const slow = setTimeout(() => { run.slow = true; if (showing(id)) redrawSoon(); }, 15000);
  const started = Date.now();
  let patch = null, problem = null, again = false;
  try {
    const out = await estimate(
      { kind: draft.kind === 'text' ? 'text' : 'photo', photos: draft.photos.map(p => p.bytes), text: draft.text,
        hints: draft.hints, note: draft.note, previous },
      { key, quota: state.settings.quota, now: new Date() });
    await keepQuota(out, key);
    if (out.result.readable) patch = { status: 'ready', result: out.result, model: out.model, lighterNote: out.note, edits: null };
    else if (previous) problem = out.result.problem;
    else patch = { status: 'editing', error: { kind: 'unreadable', message: out.result.problem } };
  } catch (e) {
    await keepQuota(e, key);
    const message = e.message || 'Something went wrong. Try again.';
    // iOS suspends a Home Screen app that is locked or switched away, and a call can die with it: that meal waits.
    const cut = (document.hidden || hiddenAt >= started) && ['unreachable', 'timeout'].includes(e.kind);
    if (previous) problem = e.kind === 'network' ? "You're offline. Re-estimate once you're back online."
      : cut ? 'The re-estimate stopped while Lean was in the background. Try again.' : message;
    else if (e.kind === 'network' || cut) { patch = { status: 'waiting', error: null }; again = cut; }
    else patch = { status: 'failed', error: { kind: e.kind ?? 'other', message, link: e.link ?? null } };
  } finally {
    clearTimeout(slow);
    if (state.running[id] === run) delete state.running[id];   // Cancel may have made room for a newer call
  }
  // Cancelled or discarded meanwhile: the answer is dropped before it touches the draft.
  if (run.cancelled || !state.drafts.includes(draft)) return;
  if (patch) {
    Object.assign(draft, patch);
    try { await ctx.save('drafts', draft); } catch { return; }
    if (again && !document.hidden) retryWaiting();   // the return to Lean looked for waiting meals while this call still ran
  }
  if (problem && showing(id)) toast(`${problem} Your changes are kept.`);
  if (showing(id) && draft.error?.kind === 'unreadable') {
    go(`#/${draft.kind === 'text' ? 'describe' : 'add'}/${id}`, { replace: true });
  } else if (showing(id) || current.screen === 'today') redrawSoon();
}

// Waiting meals, and meals that hit the free daily limit, go once Lean is online and the limit has reset.
function retryWaiting() {
  if (!navigator.onLine || !state.settings.apiKey) return;
  for (const d of state.drafts) {
    const due = ['waiting', 'estimating'].includes(d.status) || (d.status === 'failed' && d.error?.kind === 'daily');
    if (due && !state.running[d.id] && !usedUp(d.kind, state.settings.quota, new Date())) runEstimate(d.id);
  }
}

/* ---------- Updates ---------- */

let swReg = null;

function registerWorker() {
  if (!('serviceWorker' in navigator) || !isSecureContext) return;
  const hadController = !!navigator.serviceWorker.controller;
  const ready = () => {
    if (swReg?.waiting && navigator.serviceWorker.controller && !state.updateReady) {
      state.updateReady = true;
      if (current.screen === 'today') redrawSoon();
    }
  };
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    swReg = reg;
    ready();
    reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', ready));
  }).catch(() => {});
  // Reload only for an update the owner asked for, not when the first worker takes over.
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
}

/* ---------- Start ---------- */

async function start() {
  // A Safari tab has its own storage that Safari can wipe: only the Home Screen app keeps data.
  // No listeners there, so no other route can open.
  if (navigator.standalone === false) { location.replace('#/gate'); current = parse('#/gate'); render(); return; }
  listen();
  try {
    await db.open();
    await load();
  } catch {
    document.getElementById('app').innerHTML =
      '<div class="screen"><h1 class="h-page top-gap">Lean couldn\'t open its storage</h1><p class="intro">Close Lean and open it again. Your data is not deleted.</p></div>';
    return;
  }
  // Meals left empty on an earlier day (the app was closed on Add) are only clutter.
  for (const d of state.drafts) {
    if (d.status === 'editing' && d.day < ctx.today() && !d.photos.length && !d.text.trim() && !d.note.trim()) ctx.remove('drafts', d.id).catch(() => {});
  }
  db.persist().catch(() => {});
  registerWorker();
  midnight();
  const route = startRoute();
  if (route === location.hash) onRoute(); else location.replace(route);
  retryWaiting();
}

start();
