// E1 Settings: goals, Google key, backup and restore, the Pinto switch, About. Also the restore sheet Welcome uses.
import { DEMO_KEY, VERSION } from '../config.js';
import * as db from '../db.js';
import * as backup from '../backup.js';
import { testKey } from '../ai.js';
import { dayStr } from '../logic.js';
import { close, fmt, html, icon, pintoOn, sheet as open, toast } from '../ui.js';

const LEAVES = "When you tap Estimate, Try again or Re-estimate, and for a meal that waited offline once you're back online, the meal's resized photos, without location data, and your hints and note go to Google's Gemini API. With storing off, Google doesn't save the request for later use. Like any Gemini API call, it may keep a log for a limited time to detect misuse. In the EEA, Switzerland and the UK, free use isn't used to improve Google's products. Your key stays on this phone.";
const HEALTH = 'Lean is a personal tracker, not medical advice. Photo estimates can be off by a third or more; your weight trend is the real check. Ask a doctor before cutting calories if you are pregnant or breastfeeding, have diabetes or kidney, heart or liver disease, take medicine such as insulin, or have had an eating disorder. If logging starts to feel stressful or controlling, take a break and talk to your doctor.';

export function enter(state, params, ctx) {
  state.ui.keyTest = null;
  db.snapshot().then(s => {
    state.ui.snapshot = s;
    if (s && location.hash === '#/settings') ctx.refresh();
  }).catch(() => {});
}

const latest = goals => [...goals].sort((a, b) => (a.from < b.from ? 1 : -1))[0];

const info = (id, title, text) => html`
  <dialog class="sheet" id="${id}" aria-labelledby="${id}-t"><div class="sheet-body">
    <div class="sheet-head"><h2 id="${id}-t">${title}</h2><button class="icon-btn" data-action="closeSheet" data-sheet="${id}" aria-label="Close">${icon('x')}</button></div>
    <p class="sheet-text">${text}</p>
  </div></dialog>`;

export function view(state) {
  const s = state.settings, g = latest(state.goals);
  const keyState = !s.apiKey ? 'Not set' : s.apiKey === DEMO_KEY ? 'Demo mode' : 'Connected';
  const t = state.ui.keyTest;
  return html`
  <nav class="nav bar"><button class="text-btn" data-action="go" data-to="#/today" data-replace>${icon('left')}Today</button><span class="title">Settings</span><span></span></nav>
  <div class="screen">
    <h1 class="sr" tabindex="-1">Settings</h1>
    <section class="group" aria-labelledby="s-goals"><h2 id="s-goals">Goals</h2>
      <button class="set" data-action="typeGoals"><span>Calories</span><span class="val">${g ? `${fmt.kcal(g.kcal)} kcal` : 'Not set'}${icon('right', 'chev')}</span></button>
      <button class="set" data-action="typeGoals"><span>Protein</span><span class="val p">${g ? `${g.protein} g` : 'Not set'}${icon('right', 'chev')}</span></button>
      <button class="set" data-action="recalc"><span class="action">Recalculate from my details</span>${icon('right', 'chev')}</button>
    </section>
    <section class="group" aria-labelledby="s-key"><h2 id="s-key">Google AI key</h2>
      <div class="set"><span class="ok">${s.apiKey ? icon('check') : ''}${keyState}</span>
        <span class="btns">${s.apiKey ? html`<button class="btn secondary sm" data-action="testKey">Test</button>` : ''}<button class="btn secondary sm" data-action="changeKey">${s.apiKey ? 'Change' : 'Add key'}</button></span></div>
      ${t ? html`<p class="set-note${t.ok ? '' : ' bad'}" role="status">${t.message}${t.link ? html` <a class="link" href="${t.link}" target="_blank" rel="noopener noreferrer">Open Google</a>` : ''}</p>` : ''}
    </section>
    <section class="group" aria-labelledby="s-backup"><h2 id="s-backup">Backup <span>the only copy of your data is on this phone</span></h2>
      <button class="set" data-action="backupNow"><span class="action">${state.ui.backupTap ? 'Save backup' : 'Back up now'}</span>
        <span class="val">${s.lastBackupAt ? `Last ${fmt.dayShort(dayStr(new Date(s.lastBackupAt)))}` : 'Never'}</span></button>
      <label class="set"><span class="action">Restore from a backup</span>${icon('right', 'chev')}
        <input class="sr" type="file" accept=".json,application/json" data-change="restoreFile"></label>
      ${state.ui.snapshot ? html`<button class="set" data-action="restoreSnapshot"><span class="action">Restore from before the last update</span>${icon('right', 'chev')}</button>` : ''}
    </section>
    <section class="group"><label class="set"><span>Pinto</span><input type="checkbox" switch data-change="pinto"${pintoOn(s) ? html` checked` : ''}></label></section>
    <section class="group" aria-labelledby="s-about"><h2 id="s-about">About</h2>
      <button class="set" data-action="info" data-sheet="leaves"><span>What leaves this phone</span>${icon('right', 'chev')}</button>
      <button class="set" data-action="info" data-sheet="health"><span>Before you start</span>${icon('right', 'chev')}</button>
      <div class="set"><span>Version</span><span class="val">${VERSION}</span></div>
      ${s.dailyBody ? html`<p class="fine any">First daily-limit answer from Google: ${s.dailyBody}</p>` : ''}
    </section>
    <p class="fine gap">Lean gives estimates, not medical advice.</p>
  </div>
  ${info('leaves', 'What leaves this phone', LEAVES)}
  ${info('health', 'Before you start', HEALTH)}
  ${sheet(state)}`;
}

/* ---------- Restore, shared with Welcome ---------- */

export function sheet(state) {
  const r = state.ui.restore;
  return html`
  <dialog class="sheet" id="restore" aria-labelledby="restore-t"><div class="sheet-body">
    <div class="sheet-head"><h2 id="restore-t">Restore from a backup</h2><button class="icon-btn" data-action="closeSheet" data-sheet="restore" aria-label="Close">${icon('x')}</button></div>
    ${!r ? '' : r.error ? html`
      <p class="sheet-text" role="alert">${r.error} Nothing was changed.</p>
      <label class="btn secondary block">Choose another file<input class="sr" type="file" accept=".json,application/json" data-change="restoreFile"></label>` : html`
      <p class="sheet-text">${r.summary.text}${r.newer ? ` ${r.newer} newer ${r.newer === 1 ? 'meal' : 'meals'} on this phone will go.` : ''}</p>
      <p class="fine">This replaces the meals, weigh-ins and goals on this phone. Your Google key stays.</p>
      <button class="btn primary block" data-action="restoreConfirm">Restore</button>`}
  </div></dialog>`;
}

async function offer(result, ctx) {
  const s = ctx.state;
  if (!result.ok) s.ui.restore = { error: result.error };
  else {
    const ids = new Set(result.data.meals.map(m => m.id));
    s.ui.restore = { data: result.data, summary: result.summary, newer: s.meals.filter(m => !ids.has(m.id)).length };
  }
  ctx.refresh();
  open('restore');
}

/* ---------- Backup, shared with Today's reminder ---------- */

export async function backupNow(el, e, ctx) {
  const s = ctx.state;
  const data = { settings: s.settings, goals: s.goals, meals: s.meals, weights: s.weights, days: s.days };
  let how;
  try { how = await backup.save(data, ctx.now()); }
  catch (err) { toast(err.message); return; }
  // Sharing needs a fresh tap: a second button press gives it one.
  if (how === 'needs-tap') { s.ui.backupTap = true; ctx.refresh(); return; }
  s.ui.backupTap = false;
  await ctx.save('settings', { name: 'lastBackupAt', value: ctx.now().toISOString() });
  ctx.refresh();
  toast(how === 'shared' ? 'Backup saved.' : 'Backup downloaded.');
}

export const actions = {
  backupNow,
  typeGoals(el, e, ctx) { ctx.state.ui.goalsTyped = true; ctx.go('#/goals'); },
  recalc(el, e, ctx) { ctx.state.ui.goalsTyped = false; ctx.go('#/goals'); },
  changeKey(el, e, ctx) { ctx.state.ui.keyFrom = '#/settings'; ctx.go('#/key'); },
  info(el) { open(el.dataset.sheet); },

  // Pinto on or off, everywhere. If the change can't be saved, the switch goes back (the save has said so).
  async pinto(el, e, ctx) {
    try { await ctx.save('settings', { name: 'pinto', value: el.checked }); }
    catch { el.checked = !el.checked; }
  },

  async testKey(el, e, ctx) {
    if (el.getAttribute('aria-disabled') === 'true') return;
    el.setAttribute('aria-disabled', 'true');   // not disabled: that would drop keyboard and VoiceOver focus
    el.textContent = 'Testing…';
    ctx.state.ui.keyTest = await testKey(ctx.state.settings.apiKey);
    ctx.refresh();
  },

  async restoreFile(el, e, ctx) {
    const file = el.files?.[0];
    el.value = '';
    if (file) await offer(await backup.read(file), ctx);
  },

  async restoreSnapshot(el, e, ctx) {
    const snap = await db.snapshot();
    if (snap) await offer(backup.check(snap), ctx);
  },

  async restoreConfirm(el, e, ctx) {
    const r = ctx.state.ui.restore;
    if (!r?.data) return;
    el.disabled = true;
    let done;
    try { done = await backup.restore(r.data); }
    catch (err) { el.disabled = false; toast(err.kind === 'full' ? err.message : "Lean couldn't restore this backup. Nothing was changed."); return; }
    await ctx.load();
    ctx.state.ui.restore = null;
    close('restore');
    if (location.hash === '#/settings') ctx.refresh();
    else ctx.go(ctx.state.settings.apiKey ? '#/today' : '#/key', { replace: true });
    toast(done.text);   // after the move: a toast stays on the screen it was shown on
  },
};
