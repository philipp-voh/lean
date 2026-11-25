// B1 Add photos (up to 4, hints, note) with S3 photo not readable, and B4 Describe a meal.
import { dayStr, localStamp } from '../logic.js';
import { NO_REASON } from '../ai.js';
import { prepare } from '../photos.js';
import { fmt, html, icon, toast } from '../ui.js';

const HINTS = ['Ate half', 'Cooked in oil or butter', 'Restaurant meal', 'Shared'];
const MAX = 4;
const pad = n => String(n).padStart(2, '0');

export const spinner = html`<svg class="spin" viewBox="0 0 24 24" aria-hidden="true"><circle class="spin-track" cx="12" cy="12" r="8.5"/><path class="spin-arc" d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"/></svg>`;

export const hhmm = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
export const dayRoute = (day, today) => (day === today ? '#/today' : `#/day/${day}`);

export async function newDraft(ctx, { day, kind }) {
  const now = ctx.now();
  const draft = {
    id: crypto.randomUUID(), day, time: day === ctx.today() ? hhmm(now) : '12:00', kind, status: 'editing',
    photos: [], hints: [], note: '', text: '', result: null, error: null, edits: null, createdAt: localStamp(now),
  };
  await ctx.save('drafts', draft);
  return draft;
}

// One photo at a time, each saved to the draft at once, so a killed app keeps them.
export async function addPhotos(ctx, draft, files) {
  const room = MAX - draft.photos.length;
  if (files.length > room) toast(!room ? 'Up to 4 photos per meal.' : `Up to 4 photos per meal: ${room === 1 ? 'the first one is added' : `the first ${room} are added`}.`);
  files = files.slice(0, room);
  if (!files.length) { ctx.redrawSoon(); return; }   // full meanwhile (picked while the last ones were prepared): catch up
  ctx.state.ui.preparing = draft.id;
  ctx.refresh();
  for (const file of files) {
    try {
      const photo = await prepare(file);
      if (!ctx.state.drafts.includes(draft)) break;   // discarded meanwhile: don't bring it back
      if (draft.photos.length >= MAX) { toast('Up to 4 photos per meal.'); break; }   // an Undo took the last place
      draft.photos.push(photo);
      await ctx.save('drafts', draft);
    } catch (e) {
      if (e.kind !== 'full') toast(e.message || "Lean couldn't open this photo. Try another one.");
    }
  }
  ctx.state.ui.preparing = null;
  ctx.redrawSoon();   // waits while the photo picker is open again
}

let params = {};
export function enter(state, p) { params = p; }

const draftOf = state => state.drafts.find(d => d.id === params.id);
const filesOf = el => { const f = [...(el.files ?? [])]; el.value = ''; return f; };

export const gone = () => html`
  <nav class="nav bar"><button class="text-btn" data-action="go" data-to="#/today" data-replace>${icon('left')}Today</button><span></span><span></span></nav>
  <div class="screen"><h1 class="h-page" tabindex="-1">This meal is no longer here</h1><p class="intro">It was saved or discarded.</p></div>`;

export function view(state, { mode }) {
  const d = draftOf(state);
  if (!d) return gone();
  return mode === 'text' ? describe(state, d) : photos(state, d);
}

const unreadable = d => d.error?.kind === 'unreadable';

const alert = d => html`
  <div class="alert" role="alert">${icon('alert')}<div>
    <p class="alert-t">${d.kind === 'text' ? "Lean couldn't make out this meal" : "Lean couldn't read this photo"}</p>
    <p class="alert-s">${d.error.message === NO_REASON ? '' : `${d.error.message} `}${d.kind === 'text' ? 'Add what and how much, such as chicken curry, about 300 g.' : 'Add a short note, such as chicken curry, about 300 g, or retake the photo.'}</p>
  </div></div>`;

const chips = d => html`
  <div class="chips wrap" role="group" aria-label="Hints">${HINTS.map(h => html`
    <button class="chip" aria-pressed="${d.hints.includes(h)}" data-action="hint" data-v="${h}">${icon('check', 'ic ck')}${h}</button>`)}</div>`;

// Coming back from Check and save: the checked estimate stays one tap away.
const toCheck = d => (d.result ? html`<button class="link" data-action="go" data-to="#/check/${d.id}" data-replace>${icon('left')}Back to the estimate</button>` : '');

const cameraInput = (action = 'addPhotos') => html`<input class="sr" type="file" accept="image/*" capture="environment" data-change="${action}">`;

function photos(state, d) {
  const bad = unreadable(d);
  const preparing = state.ui.preparing === d.id;
  return html`
  <nav class="nav bar">
    <button class="text-btn" data-action="discard">Cancel</button><span class="title">${d.reopened ? 'Change meal' : 'New meal'}</span>
    <button class="btn primary sm" data-action="estimate">${bad ? 'Try again' : 'Estimate'}</button>
  </nav>
  <div class="screen">
    <h1 class="sr" tabindex="-1">${d.reopened ? 'Change meal' : 'New meal'}</h1>
    ${toCheck(d)}
    ${bad ? '' : html`<p class="intro">Add the pack or nutrition label for exact values. The photo of the plate shows how much.</p>`}
    <div class="photos">
      ${d.photos.map((p, i) => html`
      <figure class="ph"><img class="thumb" data-draft="${d.id}" data-index="${i}" alt="Photo ${i + 1}"><figcaption>Photo ${i + 1}</figcaption>
        <button class="remove" data-action="removePhoto" data-index="${i}" aria-label="Remove photo ${i + 1}"><span>${icon('x')}</span></button></figure>`)}
      ${preparing ? html`<figure class="ph"><span class="add-tile" role="status">${spinner}</span><figcaption>Preparing photos</figcaption></figure>` :
        d.photos.length < MAX ? html`<figure class="ph"><label class="add-tile">${icon(d.photos.length ? 'plus' : 'camera')}<span class="sr">${d.photos.length ? 'Take another photo' : 'Take photo'}</span>${cameraInput()}</label>
          <figcaption>${d.photos.length ? 'Add photo' : 'Take photo'}</figcaption></figure>` : ''}
    </div>
    ${d.photos.length < MAX ? html`<label class="link lib">${icon('image')}Choose from library<input class="sr" type="file" accept="image/*" multiple data-change="addPhotos"></label>` : ''}
    ${bad ? html`${alert(d)}<label class="btn secondary sm retake">${icon('camera', 'ic sm')}Retake photo${cameraInput('retake')}</label>` : ''}
    <label class="field-label" for="a-note">${bad ? 'What is it?' : "Anything the photos can't show?"}</label>
    ${bad ? '' : chips(d)}
    <input class="input full" id="a-note" value="${d.note}" maxlength="300" autocomplete="off" data-input="note"
      placeholder="${bad ? 'Chicken curry, about 300 g' : '60 g granola, a splash of milk'}">
    ${bad ? chips(d) : ''}
    <p class="field-err" role="alert" data-out="why"></p>
    <p class="fine push">When you tap ${bad ? 'Try again' : 'Estimate'}, these photos and your note go to Google's AI. They stay on this phone for 7 days, then one small copy.</p>
  </div>`;
}

function describe(state, d) {
  const today = dayStr(new Date());
  return html`
  <nav class="nav bar">
    <button class="text-btn" data-action="discard">Cancel</button><span class="title">Describe a meal</span>
    <button class="btn primary sm" data-action="estimate">${unreadable(d) ? 'Try again' : 'Estimate'}</button>
  </nav>
  <div class="screen">
    <h1 class="sr" tabindex="-1">Describe a meal</h1>
    ${toCheck(d)}
    ${unreadable(d) ? alert(d) : ''}
    <label class="field-label first" for="b4-text">What did you eat?</label>
    <textarea class="ta" id="b4-text" rows="4" maxlength="600" data-input="text" placeholder="2 scrambled eggs, 1 slice of sourdough with butter, flat white">${d.text}</textarea>
    <p class="field-err" role="alert" data-out="why"></p>
    <p class="hint-line">${icon('info')}<span>Amounts make it more accurate, like 2 eggs or 150 g of rice.</span></p>
    <div class="kv"><label for="b4-time">${d.day === today ? 'Time' : `${fmt.dayShort(d.day)}, time`}</label>
      <input class="date-in" id="b4-time" type="time" value="${d.time}" data-change="time"></div>
    <div class="links">
      <label class="link">${icon('image')}Choose photos from library<input class="sr" type="file" accept="image/*" multiple data-change="library"></label>
      <button class="link" data-action="manual">${icon('pencil')}Type the numbers</button>
    </div>
    <p class="fine push">When you tap ${unreadable(d) ? 'Try again' : 'Estimate'}, only this text goes to Google's AI.</p>
  </div>`;
}


const say = text => { const el = document.querySelector('[data-out="why"]'); if (el) el.textContent = text; };

export const actions = {
  async addPhotos(el, e, ctx) { await addPhotos(ctx, draftOf(ctx.state), filesOf(el)); },

  async retake(el, e, ctx) {
    const d = draftOf(ctx.state), files = filesOf(el);
    if (!files.length) return;
    d.photos = [];
    d.error = null;
    await addPhotos(ctx, d, files);
  },

  async library(el, e, ctx) {
    const d = draftOf(ctx.state), files = filesOf(el);
    if (!files.length) return;
    // The typed words become the note for the photos.
    Object.assign(d, { kind: 'photo', note: [d.note, d.text].filter(Boolean).join(' '), text: '', error: null });
    await ctx.save('drafts', d);
    ctx.go(`#/add/${d.id}`, { replace: true });
    await addPhotos(ctx, d, files);
  },

  // Undo for 5 seconds puts the photo back where it was (it stays in memory until then).
  async removePhoto(el, e, ctx) {
    const d = draftOf(ctx.state), at = +el.dataset.index, [photo] = d.photos.splice(at, 1);
    await ctx.save('drafts', d);
    ctx.refresh();
    toast('Photo removed.', {
      action: 'Undo',
      onAction: async () => {
        const now = draftOf(ctx.state);
        if (!now || now.photos.length >= 4) return;
        now.photos.splice(Math.min(at, now.photos.length), 0, photo);
        await ctx.save('drafts', now);
        ctx.refresh();
      },
    });
  },

  hint(el, e, ctx) {
    const d = draftOf(ctx.state), h = el.dataset.v;
    d.hints = d.hints.includes(h) ? d.hints.filter(x => x !== h) : [...d.hints, h];
    el.setAttribute('aria-pressed', d.hints.includes(h));
    ctx.saveSoon('drafts', d);
  },

  note(el, e, ctx) { const d = draftOf(ctx.state); d.note = el.value; ctx.saveSoon('drafts', d); },
  text(el, e, ctx) { const d = draftOf(ctx.state); d.text = el.value; say(''); ctx.saveSoon('drafts', d); },

  async time(el, e, ctx) {
    const d = draftOf(ctx.state);
    if (/^\d{2}:\d{2}$/.test(el.value)) { d.time = el.value; await ctx.save('drafts', d); }
    else el.value = d.time;
  },

  async manual(el, e, ctx) {
    const d = draftOf(ctx.state);
    Object.assign(d, { kind: 'quick', status: 'ready', error: null, edits: null });
    await ctx.save('drafts', d);
    ctx.go(`#/check/${d.id}`, { replace: true });
  },

  async discard(el, e, ctx) {
    const d = draftOf(ctx.state);
    const back = dayRoute(d.day, ctx.today()), mode = params.mode;
    await ctx.remove('drafts', d.id);
    ctx.go(back, { replace: true });
    // Undo instead of asking first: the draft is still in memory, so it can be saved again. A reopened meal
    // stays as it was saved: only the changes go.
    if (d.photos.length || d.text.trim() || d.note.trim()) {
      toast(d.reopened ? 'Changes discarded.' : 'Meal discarded.', {
        action: 'Undo',
        onAction: () => ctx.save('drafts', d).then(() => ctx.go(`#/${mode === 'text' ? 'describe' : 'add'}/${d.id}`)).catch(() => {}),
      });
    }
  },

  async estimate(el, e, ctx) {
    const d = draftOf(ctx.state);
    if (d.kind === 'text' ? d.text.trim().length < 2 : !d.photos.length) {
      say(d.kind === 'text' ? 'Describe the meal first.' : 'Take a photo first, or describe the meal.');
      return;
    }
    if (!ctx.state.settings.apiKey) { ctx.state.ui.keyFrom = `#/check/${d.id}`; ctx.go('#/key'); return; }
    d.error = null;
    ctx.estimate(d.id);
    ctx.go(`#/check/${d.id}`, { replace: true });
  },
};
