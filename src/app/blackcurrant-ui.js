import { dayOfYear } from '@dgreenheck/ez-tree';

const DEFAULT_STATE = Object.freeze({
  age: 4,
  day: 175,
  scenario: 'maintained',
  view: 'three-quarter',
  ui: true,
});

const SEASON_PRESETS = Object.freeze([
  { label: 'Dormant', day: 30 },
  { label: 'Budbreak', day: 88 },
  { label: 'Flower', day: 112 },
  { label: 'Green fruit', day: 145 },
  { label: 'Ripe', day: 175 },
  { label: 'Autumn', day: 288 },
]);

const REVIEW_VIEWS = Object.freeze([
  ['front', 'Front'],
  ['three-quarter', '3/4'],
  ['side', 'Side'],
  ['top', 'Top'],
  ['close-up', 'Close'],
]);

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, number))
    : fallback;
}

function currentDayOfYear() {
  return dayOfYear(new Date());
}

function dateForDay(day) {
  // A non-leap reference year keeps the 1–365 control deterministic.
  const date = new Date(Date.UTC(2025, 0, day));
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function plantSnapshot(plant) {
  const stats = plant.stats();
  return {
    bbch: stats.phenology.bbch,
    stage: stats.phenology.stage,
    canes: stats.visibleCanes,
    leaves: stats.visibleLeaves,
    flowers: stats.visibleFlowers,
    greenBerries: stats.visibleGreenBerries,
    ripeBerries: stats.visibleRipeBerries,
    estimatedYieldKg: stats.estimatedYieldKg,
    careHints: stats.careHints,
  };
}

function careSourceLabel(source = '') {
  if (source.includes('rhs.org.uk')) return 'RHS blackcurrant guide';
  if (source.includes('zdr.cdr.gov.pl')) return 'IO-PIB cultivar trial';
  if (source.includes('gov.pl')) return 'Polish integrated production guidance';
  if (source.includes('hortsci')) return 'Five-season Tisel trial';
  return 'Cultivar guidance';
}

function careGuidance(snapshot) {
  const priority = { important: 30, recommended: 20, notice: 10 };
  const hints = [...snapshot.careHints].sort((a, b) => {
    const categoryA =
      a.category === 'harvest' && snapshot.ripeBerries > 0 ? 5 : 0;
    const categoryB =
      b.category === 'harvest' && snapshot.ripeBerries > 0 ? 5 : 0;
    return (
      (priority[b.priority] ?? 0) +
      categoryB -
      ((priority[a.priority] ?? 0) + categoryA)
    );
  });
  const selected = hints[0];
  if (selected) {
    return {
      title: selected.title,
      text: selected.message,
      source: careSourceLabel(selected.source),
      href: selected.source,
    };
  }

  return {
    title: 'Observe before acting',
    text: 'No calendar action is flagged for this stage. Weather, soil, site and the actual plant should override the simulation.',
    source: 'RHS blackcurrant guide',
    href: 'https://www.rhs.org.uk/fruit/blackcurrants/grow-your-own?type=f',
  };
}

function updateUrl(state) {
  const url = new URL(window.location.href);
  url.searchParams.set('year', String(state.age));
  url.searchParams.set('day', String(state.day));
  url.searchParams.set('view', state.view);
  url.searchParams.set('ui', state.ui ? '1' : '0');
  if (state.scenario === 'neglected')
    url.searchParams.set('scenario', 'neglected');
  else url.searchParams.delete('scenario');
  window.history.replaceState(null, '', url);
}

export function readBlackcurrantStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get('view');
  return {
    age: clampInteger(params.get('year'), 0, 50, DEFAULT_STATE.age),
    day: clampInteger(params.get('day'), 1, 365, currentDayOfYear()),
    scenario:
      params.get('scenario') === 'neglected'
        ? 'neglected'
        : DEFAULT_STATE.scenario,
    view: REVIEW_VIEWS.some(([value]) => value === requestedView)
      ? requestedView
      : DEFAULT_STATE.view,
    ui: params.get('ui') !== '0',
  };
}

function pruningEventDescription(event) {
  return `Pruned oldest eligible cane ${event.caneId}`;
}

function harvestEventDescription(result) {
  return `Recorded ${result.amountKg.toFixed(2)} kg ripe-fruit harvest`;
}

/**
 * Mounts the digital-twin controls and connects them to a Blackcurrant renderer.
 */
export function setupBlackcurrantUI({ plant, initialState, setReviewView }) {
  const container = document.getElementById('ui-container');
  const state = { ...initialState };
  const eventEntries = [];

  container.innerHTML = `
    <button class="bc-ui-reveal" type="button" aria-label="Show digital twin controls">Tisel controls</button>
    <aside class="bc-panel" aria-label="Tisel blackcurrant digital twin controls">
      <header class="bc-header">
        <div>
          <p class="bc-kicker">Garden digital twin · proof 01</p>
          <h1>Tisel digital twin</h1>
          <p>Blackcurrant · <i>Ribes nigrum</i></p>
        </div>
        <button class="bc-icon-button" type="button" data-action="hide-ui" aria-label="Hide controls">×</button>
      </header>

      <div class="bc-scroll">
        <section class="bc-stage-card" aria-live="polite">
          <div><span class="bc-overline">Current stage</span><strong data-stage>—</strong></div>
          <span class="bc-bbch">BBCH <b data-bbch>—</b></span>
        </section>

        <section class="bc-section" aria-labelledby="bc-time-heading">
          <div class="bc-section-heading">
            <h2 id="bc-time-heading">Twin time</h2>
            <span>Poland · scenario</span>
          </div>
          <label class="bc-range-row">
            <span>Plant age</span>
            <input data-age type="range" min="0" max="50" step="1">
            <output data-age-output>—</output>
          </label>
          <label class="bc-range-row">
            <span>Day</span>
            <input data-day type="range" min="1" max="365" step="1">
            <output data-day-output>—</output>
          </label>
          <div class="bc-inline-actions">
            <button type="button" data-current-day>Use today</button>
            <div class="bc-segmented" role="group" aria-label="Management scenario">
              <button type="button" data-scenario="maintained">Maintained</button>
              <button type="button" data-scenario="neglected">Neglected</button>
            </div>
          </div>
          <div class="bc-chip-row" aria-label="Jump to season">
            ${SEASON_PRESETS.map(({ label, day }) => `<button type="button" data-season-day="${day}">${label}</button>`).join('')}
          </div>
        </section>

        <section class="bc-section" aria-labelledby="bc-organs-heading">
          <div class="bc-section-heading">
            <h2 id="bc-organs-heading">Visible organs</h2>
            <span>rendered now</span>
          </div>
          <dl class="bc-stat-grid">
            <div><dt>Canes</dt><dd data-stat="canes">0</dd></div>
            <div><dt>Leaves</dt><dd data-stat="leaves">0</dd></div>
            <div><dt>Flowers</dt><dd data-stat="flowers">0</dd></div>
            <div><dt>Green fruit</dt><dd data-stat="greenBerries">0</dd></div>
            <div><dt>Ripe fruit</dt><dd data-stat="ripeBerries">0</dd></div>
          </dl>
          <p class="bc-yield-line">
            <span>Source-calibrated crop remaining</span>
            <strong data-yield>—</strong>
          </p>
          <p class="bc-density-note">Berry meshes are a representative visual sample, not one sphere per berry in the crop estimate.</p>
        </section>

        <section class="bc-care-card" aria-labelledby="bc-care-title">
          <p class="bc-overline">Care cue · verify on the real plant</p>
          <h2 id="bc-care-title" data-care-title>—</h2>
          <p data-care-text>—</p>
          <a data-care-source href="#" target="_blank" rel="noreferrer">Source ↗</a>
        </section>

        <section class="bc-section" aria-labelledby="bc-events-heading">
          <div class="bc-section-heading">
            <h2 id="bc-events-heading">Crop & care log</h2>
            <span>scenario events</span>
          </div>
          <div class="bc-event-actions">
            <button type="button" data-action="prune">Prune oldest</button>
            <button type="button" data-action="harvest">Harvest ripe</button>
            <button type="button" data-action="reset">Reset events</button>
          </div>
          <ol class="bc-event-log" data-event-log aria-live="polite" aria-relevant="additions">
            <li class="bc-empty-event">No simulated events yet.</li>
          </ol>
        </section>

        <section class="bc-section" aria-labelledby="bc-view-heading">
          <div class="bc-section-heading"><h2 id="bc-view-heading">Review camera</h2><span>orbit remains free</span></div>
          <div class="bc-view-row">
            ${REVIEW_VIEWS.map(([value, label]) => `<button type="button" data-view="${value}">${label}</button>`).join('')}
          </div>
        </section>

        <p class="bc-model-note"><strong>50 years ≠ one immortal bush.</strong> After year 15 the maintained view represents replacement cycles; neglected shows an ageing, crowded scenario. These are visual hypotheses, not yield forecasts.</p>
      </div>

      <footer class="bc-footer">
        Prototype built on <a href="https://github.com/dgreenheck/ez-tree" target="_blank" rel="noreferrer">EZ-Tree</a> by Dan Greenheck (MIT).
      </footer>
    </aside>
  `;

  const panel = container.querySelector('.bc-panel');
  const reveal = container.querySelector('.bc-ui-reveal');
  const ageInput = container.querySelector('[data-age]');
  const dayInput = container.querySelector('[data-day]');
  const log = container.querySelector('[data-event-log]');
  const pruneButton = container.querySelector('[data-action="prune"]');
  const harvestButton = container.querySelector('[data-action="harvest"]');

  function applyPlantState({ time = true, scenario = true } = {}) {
    if (time || scenario) {
      plant.setState({
        ageYears: state.age,
        dayOfYear: state.day,
        scenario: state.scenario,
      });
    }
  }

  function renderLog() {
    log.innerHTML = eventEntries.length
      ? eventEntries
          .map((event) => `<li><span>${event.when}</span>${event.text}</li>`)
          .join('')
      : '<li class="bc-empty-event">No simulated events yet.</li>';
  }

  function render() {
    const snapshot = plantSnapshot(plant);
    const guidance = careGuidance(snapshot);
    ageInput.value = state.age;
    dayInput.value = state.day;
    container.querySelector('[data-age-output]').value = `${state.age} yr`;
    container.querySelector('[data-day-output]').value =
      `${state.day} · ${dateForDay(state.day)}`;
    container.querySelector('[data-stage]').textContent = snapshot.stage;
    container.querySelector('[data-bbch]').textContent = snapshot.bbch;
    Object.entries(snapshot).forEach(([key, value]) => {
      const output = container.querySelector(`[data-stat="${key}"]`);
      if (output)
        output.textContent = Number.isFinite(value)
          ? value.toLocaleString()
          : '—';
    });
    container.querySelector('[data-yield]').textContent = Number.isFinite(
      snapshot.estimatedYieldKg,
    )
      ? `${Math.max(0, snapshot.estimatedYieldKg).toFixed(2)} kg`
      : '—';
    pruneButton.title =
      'Attempt renewal pruning; the plant model validates the selected twin state.';
    harvestButton.disabled = snapshot.ripeBerries <= 0;
    harvestButton.title = harvestButton.disabled
      ? 'No ripe berries are available at this time.'
      : `Harvest ${snapshot.ripeBerries.toLocaleString()} rendered ripe berries and record the source-calibrated crop.`;
    container.querySelectorAll('[data-scenario]').forEach((button) => {
      const active = button.dataset.scenario === state.scenario;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    container.querySelectorAll('[data-view]').forEach((button) => {
      const active = button.dataset.view === state.view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    container.querySelector('[data-care-title]').textContent = guidance.title;
    container.querySelector('[data-care-text]').textContent = guidance.text;
    const source = container.querySelector('[data-care-source]');
    source.textContent = `${guidance.source} ↗`;
    source.href = guidance.href;
    panel.hidden = !state.ui;
    reveal.hidden = state.ui;
    renderLog();
    updateUrl(state);
  }

  function setState(patch) {
    const timeChanged =
      (patch.age !== undefined && patch.age !== state.age) ||
      (patch.day !== undefined && patch.day !== state.day);
    const scenarioChanged =
      patch.scenario !== undefined && patch.scenario !== state.scenario;
    Object.assign(state, patch);
    applyPlantState({ time: timeChanged, scenario: scenarioChanged });
    render();
  }

  let pendingTimePatch = null;
  let pendingTimeFrame = null;

  function scheduleTimeState(patch) {
    pendingTimePatch = { ...(pendingTimePatch ?? {}), ...patch };
    if (pendingTimeFrame !== null) return;
    pendingTimeFrame = requestAnimationFrame(() => {
      const next = pendingTimePatch;
      pendingTimePatch = null;
      pendingTimeFrame = null;
      if (next) setState(next);
    });
  }

  function commitState(patch) {
    const next = { ...(pendingTimePatch ?? {}), ...patch };
    if (pendingTimeFrame !== null) cancelAnimationFrame(pendingTimeFrame);
    pendingTimePatch = null;
    pendingTimeFrame = null;
    setState(next);
  }

  ageInput.addEventListener('input', (event) => {
    scheduleTimeState({
      age: clampInteger(event.target.value, 0, 50, state.age),
    });
  });
  dayInput.addEventListener('input', (event) => {
    scheduleTimeState({
      day: clampInteger(event.target.value, 1, 365, state.day),
    });
  });
  container
    .querySelector('[data-current-day]')
    .addEventListener('click', () => {
      commitState({ day: currentDayOfYear() });
    });
  container.querySelectorAll('[data-scenario]').forEach((button) => {
    button.addEventListener('click', () =>
      commitState({ scenario: button.dataset.scenario }),
    );
  });
  container.querySelectorAll('[data-season-day]').forEach((button) => {
    button.addEventListener('click', () =>
      commitState({ day: Number(button.dataset.seasonDay) }),
    );
  });
  container.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = setReviewView(button.dataset.view);
      render();
    });
  });
  container
    .querySelector('[data-action="hide-ui"]')
    .addEventListener('click', () => {
      state.ui = false;
      render();
    });
  reveal.addEventListener('click', () => {
    state.ui = true;
    render();
  });
  pruneButton.addEventListener('click', () => {
    const event = plant.pruneOldestCane({
      ageYears: state.age,
      dayOfYear: state.day,
    });
    if (event.type === 'prune') {
      eventEntries.unshift({
        when: `Year ${state.age} · ${dateForDay(state.day)}`,
        text: pruningEventDescription(event),
      });
    }
    render();
  });
  harvestButton.addEventListener('click', () => {
    const result = plant.harvest();
    if (result.event) {
      eventEntries.unshift({
        when: `Year ${state.age} · ${dateForDay(state.day)}`,
        text: harvestEventDescription(result),
      });
    }
    render();
  });
  container
    .querySelector('[data-action="reset"]')
    .addEventListener('click', () => {
      plant.resetEvents();
      eventEntries.length = 0;
      render();
    });

  render();

  return {
    getState: () => ({ ...state }),
    setView(view) {
      state.view = setReviewView(view);
      render();
      return state.view;
    },
    refresh: render,
  };
}
