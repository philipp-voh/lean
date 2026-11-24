// Setup: S8 (Safari tab), A1 Welcome, A2 Connect Google AI, A3 Your goals with the pace slider.
import { calcGoals, parseNum, trend } from '../logic.js';
import { testKey, wholeKey } from '../ai.js';
import { firstTime, fmt, html, icon, pinto, pintoOn } from '../ui.js';
import * as restore from './settings.js';

let keyText = '';
let form = null;   // the goals form while it is open; typing writes here, never redraws

export function enter(state, { step }) {
  if (step === 'key') keyText = '';
  if (step === 'goals') form = startForm(state);
}

export function view(state, { step }) {
  if (step === 'gate') return gate();
  if (step === 'welcome') return welcome(state);
  if (step === 'key') return key(state);
  return goals(state);
}

/* ---------- S8: opened in a Safari tab ---------- */

const gate = () => html`
  <div class="screen">
    <h1 class="h-page top-gap" tabindex="-1">Add Lean to your Home Screen first</h1>
    <p class="intro">Safari deletes a website's data after 7 days without a visit; the Home Screen app keeps it.</p>
    <ol class="steps">
      <li><span class="sn" aria-hidden="true">1</span><p class="sb inline">Tap Share ${icon('share', 'ic accent')} in Safari.</p></li>
      <li><span class="sn" aria-hidden="true">2</span><p class="sb inline">Tap Add to Home Screen ${icon('add-square', 'ic accent')}</p></li>
    </ol>
  </div>`;

/* ---------- A1 Welcome: Pinto says hello in place of the leaf tile ---------- */

const welcome = state => html`
  <div class="screen">
    <div class="hero">
      ${pintoOn(state.settings) ? pinto('hello', firstTime('w')) : html`<span class="mark">${icon('leaf')}</span>`}
      <h1 class="wordmark" tabindex="-1">Lean</h1>
      <p class="promise">Take a photo of a meal. Get its calories and protein in a few seconds.</p>
    </div>
    <ul class="points">
      <li><span class="badge">${icon('camera')}</span><div><b>Logs meals from photos</b><span class="pt">A free Google AI reads the plate, the pack and the label.</span></div></li>
      <li><span class="badge">${icon('chart')}</span><div><b>Two goals: calories and protein</b><span class="pt">Plus a weight trend that smooths out the daily ups and downs.</span></div></li>
      <li><span class="badge">${icon('phone')}</span><div><b>Your data stays on this phone</b><span class="pt">No account and no ads. Only a meal's photos and note go to Google, when you tap Estimate.</span></div></li>
    </ul>
    <label class="link restore-link">New phone? Restore from a backup
      <input class="sr" type="file" accept=".json,application/json" data-change="restoreFile"></label>
  </div>
  <div class="dock plain"><button class="btn primary grow" data-action="go" data-to="#/key">Get started</button></div>
  ${restore.sheet(state)}`;

/* ---------- A2 Connect Google AI ---------- */

function key(state) {
  const back = state.ui.keyFrom ?? '#/welcome';
  const label = back === '#/welcome' ? 'Welcome' : back === '#/settings' ? 'Settings' : 'Back';
  return html`
  <nav class="nav bar">
    <button class="text-btn" data-action="go" data-to="${back}" data-replace>${icon('left')}${label}</button><span></span>
    <button class="btn primary sm" data-action="saveKey">${back === '#/welcome' ? 'Continue' : 'Save'}</button>
  </nav>
  <div class="screen">
    <h1 class="h-page" tabindex="-1">Connect Google AI</h1>
    <p class="intro">Lean uses Google's Gemini models to read your photos. With your own key, that's free.</p>
    <ol class="steps">
      <li><span class="sn" aria-hidden="true">1</span><div class="sb"><p>Open Google AI Studio and sign in with your Google account.</p>
        <a class="btn secondary sm" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Open Google AI Studio${icon('external', 'ic sm')}</a></div></li>
      <li><span class="sn" aria-hidden="true">2</span><div class="sb"><p>Create an API key there and copy it.</p></div></li>
      <li><span class="sn" aria-hidden="true">3</span><div class="sb"><label for="key-in">Paste it here.</label>
        <div class="key-row">
          <input class="input" id="key-in" type="password" autocomplete="off" autocapitalize="off" spellcheck="false"
            placeholder="Your Google AI key" data-input="keyText" aria-describedby="key-status">
          <button class="btn secondary sm" data-action="pasteKey">Paste</button>
        </div>
        <div class="test-row"><button class="btn secondary sm" data-action="testKey">Test key</button>
          <p class="ok" id="key-status" role="status" data-key-status></p></div>
      </div></li>
    </ol>
    <p class="privacy">${icon('lock')}<span>The key stays on this phone. Only a meal's photos and note go to Google when you tap Estimate, resized and without location.</span></p>
  </div>`;
}

function keyStatus(text, ok, link) {
  const box = document.querySelector('[data-key-status]');
  if (!box) return;
  box.classList.toggle('bad', !ok);
  box.replaceChildren();
  if (text) box.insertAdjacentHTML('beforeend', String(html`${ok ? icon('check') : icon('alert')}<span>${text}</span>`));
  if (link) box.insertAdjacentHTML('beforeend', String(html` <a class="link" href="${link}" target="_blank" rel="noopener noreferrer">Open Google</a>`));
}

/* ---------- A3 Your goals ---------- */

const FIELDS = { age: [18, 120, 'your age in years'], heightCm: [120, 230, 'a height from 120 to 230 cm'], weightKg: [30, 300, 'a weight from 30 to 300 kg'] };

function startForm(state) {
  const p = state.settings.profile ?? {};
  const last = trend(state.weights).at(-1);
  const goal = [...state.goals].sort((a, b) => (a.from < b.from ? 1 : -1))[0];
  // Weight = trend weight, else the Setup weight
  const kg = last ? Math.round(last.trend * 10) / 10 : p.weightKg;
  return {
    mode: state.ui.goalsTyped ? 'typed' : 'calc',
    sex: p.sex ?? 'male', activity: p.activity ?? 'medium', pace: p.pace ?? 0.5,
    age: p.age ?? '', heightCm: p.heightCm ?? '', weightKg: kg ?? '',
    kcal: goal?.kcal ?? '', protein: goal?.protein ?? '', tried: false,
  };
}

// Reads the form: the profile (or null with a reason) and, for typed numbers, the checked limits.
function readForm() {
  const p = { sex: form.sex, activity: form.activity, pace: form.pace };
  let why = null;
  for (const [k, [min, max, what]] of Object.entries(FIELDS)) {
    const v = parseNum(form[k]);
    if (k === 'age' && v != null && v < 18) { why = 'Lean is for adults 18 and over.'; break; }
    if (v == null || v < min || v > max) { why = `Enter ${what}.`; break; }
    p[k] = k === 'weightKg' ? Math.round(v * 10) / 10 : Math.round(v);
  }
  return why ? { profile: null, why } : { profile: p, why: null };
}

function readTyped(profile) {
  const floor = form.sex === 'female' ? 1200 : 1500;
  const kcal = parseNum(form.kcal), protein = parseNum(form.protein);
  const kg = profile?.weightKg;
  if (kcal == null || kcal < floor || kcal > 6000) return { why: `Enter a calorie limit from ${fmt.kcal(floor)} to 6,000 kcal.` };
  if (protein == null || protein < 30 || protein > 400) return { why: 'Enter a protein goal from 30 to 400 g.' };
  const perKg = kg ? protein / kg : null;
  const note = perKg && (perKg < 1.6 || perKg > 2.2) ? `That's ${perKg.toFixed(1)} g per kg; the usual range is 1.6 to 2.2 g.` : null;
  return { kcal: Math.round(kcal), protein: Math.round(protein), note, why: null };
}

const seg = (name, label, value, options) => html`
  <div class="frow"><span class="lbl" id="g-${name}">${label}</span>
    <div class="seg" role="radiogroup" aria-labelledby="g-${name}">${options.map(([v, l]) => html`
      <button role="radio" aria-checked="${v === value}" data-action="pick" data-field="${name}" data-v="${v}">${l}</button>`)}</div></div>`;

const numIn = (field, label, unit, mode) => html`
  <label><span class="fl">${label}</span><span class="num-in">
    <input value="${form[field]}" inputmode="${mode}" data-input="field" data-field="${field}" autocomplete="off"
      aria-label="${label}${unit ? ` in ${unit === 'cm' ? 'centimetres' : unit === 'kg' ? 'kilograms' : 'years'}` : ''}">
    ${unit ? html`<span class="u">${unit}</span>` : ''}</span></label>`;

function goals(state) {
  const setup = !state.settings.firstDay;
  const typed = form.mode === 'typed';
  const c = computed();
  return html`
  <nav class="nav bar">
    <button class="text-btn" data-action="go" data-to="${setup ? '#/key' : '#/settings'}" data-replace>${icon('left')}${setup ? 'Google AI' : 'Settings'}</button><span></span>
    <button class="btn primary sm" data-action="saveGoals">${setup ? 'Start tracking' : 'Save'}</button>
  </nav>
  <div class="screen">
    <h1 class="h-page" tabindex="-1">Your goals</h1>
    <p class="intro">A starting point you can change any time.</p>
    <div class="form">
      ${seg('sex', 'Sex', form.sex, [['male', 'Male'], ['female', 'Female']])}
      <div class="trip">
        ${numIn('age', 'Age', '', 'numeric')}${numIn('heightCm', 'Height', 'cm', 'numeric')}${numIn('weightKg', 'Weight', 'kg', 'decimal')}
      </div>
      ${seg('activity', 'Activity', form.activity, [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])}
      ${typed ? '' : html`
      <div class="pace">
        <div class="pace-top"><label class="lbl" for="g-pace">Pace</label><output class="pace-v" for="g-pace" data-out="pace">${c.pace}</output></div>
        <input id="g-pace" type="range" min="0.1" max="1" step="0.1" value="${form.pace}" data-input="pace" aria-valuetext="${paceText(c)}" aria-describedby="g-pace-s">
        <p class="pace-scale" id="g-pace-s"><span>0.1 kg</span><span>1.0 kg</span></p>
      </div>`}
    </div>
    <p class="field-err" role="alert" data-out="why">${c.why}</p>
    ${typed ? html`
    <div class="duo">
      <label><span class="fl">Calories a day</span><span class="num-in"><input id="g-k" value="${form.kcal}" inputmode="numeric" data-input="field" data-field="kcal" autocomplete="off"><span class="u">kcal</span></span></label>
      <label class="prot"><span class="fl">Protein a day</span><span class="num-in"><input id="g-p" value="${form.protein}" inputmode="numeric" data-input="field" data-field="protein" autocomplete="off"><span class="u">g</span></span></label>
    </div>
    <p class="rw" data-out="typedNote">${c.typedNote}</p>
    <div class="after"><button class="link" data-action="mode" data-v="calc">${icon('refresh', 'ic sm')}Recalculate from my details</button></div>` : html`
    <div class="result" role="group" aria-label="Your daily goals">
      <div><p class="gl">Calories a day</p><p class="rn" data-out="kcal">${c.kcal}</p><p class="rw" data-out="burn">${c.burn}</p></div>
      <div class="prot"><p class="gl">Protein a day</p><p class="rn"><span data-out="protein">${c.protein}</span><small>g</small></p><p class="rw">2.0 g per kg of body weight</p></div>
    </div>
    <ul class="notes" data-out="notes" aria-live="polite">${c.notes.map(n => html`<li>${n}</li>`)}</ul>
    <div class="after"><button class="link" data-action="mode" data-v="typed">${icon('pencil', 'ic sm')}Type your own numbers</button></div>`}
    <p class="fine">Kidney disease? Ask your doctor before eating more than about 1.3 g protein per kg.</p>
    <p class="fine gap">Lean is a personal tracker, not medical advice. Photo estimates can be off by a third or more; your weight trend is the real check. Ask a doctor before cutting calories if you are pregnant or breastfeeding, have diabetes or kidney, heart or liver disease, take medicine such as insulin, or have had an eating disorder. If logging starts to feel stressful or controlling, take a break and talk to your doctor.</p>
  </div>`;
}

// What the numbers read now; the view draws it and show() updates it in place.
function computed() {
  const { profile, why } = readForm();
  if (form.mode === 'typed') {
    const t = readTyped(profile);
    return { why: why?.includes('18') ? why : form.tried ? t.why ?? '' : '', typedNote: t.note ?? '' };
  }
  const g = profile && calcGoals(profile, null);
  return {
    pace: `${form.pace.toFixed(1)} kg a week`,
    kcal: g ? fmt.kcal(g.kcal) : '–', protein: g ? String(g.protein) : '–',
    burn: g ? `Burn about ${fmt.kcal(g.burn)} minus ${fmt.kcal(g.deficit)}` : '',
    notes: g?.notes ?? [],
    why: why && (form.tried || why.includes('18')) ? why : '',
  };
}

// VoiceOver reads the pace with the calorie limit it gives.
const paceText = c => (c.kcal === '–' ? c.pace : `${c.pace}, ${c.kcal} kcal a day`);

// Typing keeps the keyboard and dictation: only the numbers change.
function show() {
  for (const [name, value] of Object.entries(computed())) {
    const el = document.querySelector(`[data-out="${name}"]`);
    if (!el) continue;
    if (Array.isArray(value)) {
      // Only when the notes change: a rebuilt list would make VoiceOver read the same caution on every slider step.
      if (el.textContent !== value.join('')) el.replaceChildren(...value.map(n => Object.assign(document.createElement('li'), { textContent: n })));
    }
    else el.textContent = value;
  }
}

export const actions = {
  restoreFile: restore.actions.restoreFile,
  restoreConfirm: restore.actions.restoreConfirm,

  keyText(el) { keyText = el.value; keyStatus('', true); },

  async pasteKey() {
    try {
      keyText = (await navigator.clipboard.readText()).trim();
      document.getElementById('key-in').value = keyText;
      keyStatus('', true);
    } catch { keyStatus('Lean can’t read the clipboard. Tap the field and paste.', false); }
  },

  async testKey() {
    keyStatus('Testing…', true);
    const r = await testKey(keyText);
    keyStatus(r.message, r.ok, r.link);
  },

  async saveKey(el, e, ctx) {
    const k = keyText.trim();
    if (!k) { keyStatus('Paste your key first.', false); return; }
    if (!wholeKey(k)) { keyStatus("This doesn't look like a whole key. Copy it again from Google AI Studio.", false); return; }
    // A new key clears the free-limit blocks.
    await ctx.write(t => { t.put('settings', { name: 'apiKey', value: k }); t.put('settings', { name: 'quota', value: {} }); });
    const back = ctx.state.ui.keyFrom;
    ctx.state.ui.keyFrom = null;
    const done = ctx.state.goals.length && ctx.state.settings.firstDay;
    // Back to a meal that waited for a working key: estimate it now.
    if (back?.startsWith('#/check/')) ctx.estimate(back.slice(8));
    ctx.go(back && back !== '#/welcome' ? back : done ? '#/today' : '#/goals', { replace: true });
  },

  pick(el, e, ctx) { form[el.dataset.field] = el.dataset.v; ctx.refresh(); },
  mode(el, e, ctx) { form.mode = el.dataset.v; form.tried = false; ctx.refresh(); },
  field(el) { form[el.dataset.field] = el.value; show(); },
  pace(el) { form.pace = Math.round(Number(el.value) * 10) / 10; el.setAttribute('aria-valuetext', paceText(computed())); show(); },

  async saveGoals(el, e, ctx) {
    form.tried = true;
    const { profile, why } = readForm();
    const typed = form.mode === 'typed';
    const t = typed ? readTyped(profile) : null;
    // Under 18 stops Setup in both modes.
    if (why?.includes('18') || (!typed && why) || t?.why) { show(); document.querySelector('[data-out="why"]').scrollIntoView({ block: 'center' }); return; }
    const g = typed ? null : calcGoals(profile, null);
    const day = ctx.today();
    const record = typed
      ? { from: day, kcal: t.kcal, protein: t.protein, mode: 'typed', basis: null }
      : { from: day, kcal: g.kcal, protein: g.protein, mode: 'calc', basis: { burn: g.burn, deficit: g.deficit, pace: g.pace, weightKg: profile.weightKg } };
    const first = !ctx.state.settings.firstDay;
    await ctx.write(w => {
      w.put('goals', record);
      if (profile) w.put('settings', { name: 'profile', value: profile });
      if (first) w.put('settings', { name: 'firstDay', value: day });
    });
    ctx.state.ui.goalsTyped = false;
    ctx.go(first ? '#/today' : '#/settings', { replace: true });
  },
};
