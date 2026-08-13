import { dayOfYear } from '@dgreenheck/ez-tree';
import { DEFAULT_PLANT_ID, PLANTS, PLANT_IDS } from './plants';

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

function sourceLabel(descriptor, url = '') {
  for (const source of Object.values(descriptor.sources)) {
    if (source.url === url) return source.title;
  }
  if (url.includes('rhs.org.uk')) return 'Royal Horticultural Society';
  if (url.includes('zdr.cdr.gov.pl')) return 'IO-PIB cultivar trial';
  return 'Cultivar guidance';
}

function careGuidance(descriptor, stats) {
  const priority = { important: 30, recommended: 20, notice: 10 };
  const hints = [...(stats.careHints ?? [])].sort(
    (a, b) => (priority[b.priority] ?? 0) - (priority[a.priority] ?? 0),
  );
  const selected = hints[0];
  if (selected) {
    return {
      title: selected.title,
      text: selected.message,
      source: sourceLabel(descriptor, selected.source),
      href: selected.source,
    };
  }
  const fallback = Object.values(descriptor.sources)[0];
  return {
    title: 'Observe before acting',
    text: 'No calendar action is flagged for this stage. Weather, soil, site and the actual plant should override the simulation.',
    source: fallback.title,
    href: fallback.url,
  };
}

export function readPlantStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requestedPlant = params.get('plant');
  const plant = PLANT_IDS.includes(requestedPlant)
    ? requestedPlant
    : DEFAULT_PLANT_ID;
  const descriptor = PLANTS[plant];
  const requestedView = params.get('view');
  const requestedProfile = params.get('profile');
  const profileOptions = descriptor.profileControl.options.map(
    ([value]) => value,
  );

  return {
    plant,
    age: clampInteger(
      params.get('year'),
      0,
      descriptor.maxYears,
      descriptor.defaults.age,
    ),
    day: clampInteger(params.get('day'), 1, 365, descriptor.defaults.day),
    scenario:
      params.get('scenario') === 'neglected' ? 'neglected' : 'maintained',
    phenologyProfile: profileOptions.includes(requestedProfile)
      ? requestedProfile
      : profileOptions[0],
    view: REVIEW_VIEWS.some(([value]) => value === requestedView)
      ? requestedView
      : 'three-quarter',
    ui: params.get('ui') !== '0',
  };
}

function updateUrl(state) {
  const url = new URL(window.location.href);
  url.searchParams.set('plant', state.plant);
  url.searchParams.set('year', String(state.age));
  url.searchParams.set('day', String(state.day));
  url.searchParams.set('view', state.view);
  url.searchParams.set('ui', state.ui ? '1' : '0');
  url.searchParams.set('profile', state.phenologyProfile);
  if (state.scenario === 'neglected')
    url.searchParams.set('scenario', 'neglected');
  else url.searchParams.delete('scenario');
  window.history.replaceState(null, '', url);
}

/**
 * Mounts the shared digital-twin controls.
 *
 * Every species-specific string, stat row, season shortcut and event action
 * comes from the plant descriptor, so adding a plant to the library adds it to
 * this panel without touching the panel.
 */
export function setupPlantUI({
  descriptor,
  plant,
  initialState,
  setReviewView,
  onSelectPlant,
}) {
  const container = document.getElementById('ui-container');
  const state = { ...initialState };
  const eventEntries = [];
  const profileControl = descriptor.profileControl;

  container.innerHTML = `
    <button class="bc-ui-reveal" type="button" aria-label="Show digital twin controls">${descriptor.label} controls</button>
    <aside class="bc-panel" aria-label="${descriptor.label} digital twin controls">
      <header class="bc-header">
        <div>
          <p class="bc-kicker">${descriptor.kicker}</p>
          <h1>${descriptor.cultivar} digital twin</h1>
          <p>${descriptor.label} · <i>${descriptor.species}</i></p>
        </div>
        <button class="bc-icon-button" type="button" data-action="hide-ui" aria-label="Hide controls">×</button>
      </header>

      <div class="bc-scroll">
        <section class="bc-section" aria-labelledby="bc-plant-heading">
          <div class="bc-section-heading">
            <h2 id="bc-plant-heading">Plant</h2>
            <span>library</span>
          </div>
          <div class="bc-segmented bc-plant-picker" role="group" aria-label="Select plant">
            ${PLANT_IDS.map(
              (id) =>
                `<button type="button" data-plant="${id}">${PLANTS[id].label}</button>`,
            ).join('')}
          </div>
        </section>

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
            <input data-age type="range" min="0" max="${descriptor.maxYears}" step="1">
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
            ${descriptor.seasons
              .map(
                ({ label, day }) =>
                  `<button type="button" data-season-day="${day}">${label}</button>`,
              )
              .join('')}
          </div>
          <div class="bc-section-heading bc-subheading">
            <h3>${profileControl.label}</h3>
          </div>
          <div class="bc-chip-row" role="group" aria-label="${profileControl.label}">
            ${profileControl.options
              .map(
                ([value, label]) =>
                  `<button type="button" data-profile="${value}">${label}</button>`,
              )
              .join('')}
          </div>
        </section>

        <section class="bc-section" aria-labelledby="bc-organs-heading">
          <div class="bc-section-heading">
            <h2 id="bc-organs-heading">Visible organs</h2>
            <span>rendered now</span>
          </div>
          <dl class="bc-stat-grid">
            ${descriptor.stats
              .map(
                ({ key, label }) =>
                  `<div><dt>${label}</dt><dd data-stat="${key}">0</dd></div>`,
              )
              .join('')}
          </dl>
          <p class="bc-yield-line">
            <span>${descriptor.yieldLine.label}</span>
            <strong data-yield>—</strong>
          </p>
          <p class="bc-density-note">${descriptor.yieldLine.note}</p>
        </section>

        <section class="bc-care-card" aria-labelledby="bc-care-title">
          <p class="bc-overline">Care cue · verify on the real plant</p>
          <h2 id="bc-care-title" data-care-title>—</h2>
          <p data-care-text>—</p>
          <a data-care-source href="#" target="_blank" rel="noreferrer">Source ↗</a>
        </section>

        <section class="bc-section" aria-labelledby="bc-events-heading">
          <div class="bc-section-heading">
            <h2 id="bc-events-heading">Care log</h2>
            <span>scenario events</span>
          </div>
          <div class="bc-event-actions">
            ${descriptor.actions
              .map(
                ({ id, label }) =>
                  `<button type="button" data-action="${id}">${label}</button>`,
              )
              .join('')}
            <button type="button" data-action="reset">Reset events</button>
          </div>
          <ol class="bc-event-log" data-event-log aria-live="polite" aria-relevant="additions">
            <li class="bc-empty-event">No simulated events yet.</li>
          </ol>
        </section>

        <section class="bc-section" aria-labelledby="bc-view-heading">
          <div class="bc-section-heading"><h2 id="bc-view-heading">Review camera</h2><span>orbit remains free</span></div>
          <div class="bc-view-row">
            ${REVIEW_VIEWS.map(
              ([value, label]) =>
                `<button type="button" data-view="${value}">${label}</button>`,
            ).join('')}
          </div>
        </section>

        <p class="bc-model-note">${descriptor.modelNote}</p>
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

  function applyPlantState() {
    plant.setState({
      ageYears: state.age,
      dayOfYear: state.day,
      scenario: state.scenario,
      [profileControl.key]: state.phenologyProfile,
    });
  }

  function renderLog() {
    log.innerHTML = eventEntries.length
      ? eventEntries
          .map((event) => `<li><span>${event.when}</span>${event.text}</li>`)
          .join('')
      : '<li class="bc-empty-event">No simulated events yet.</li>';
  }

  function setToggleGroup(selector, attribute, value) {
    container.querySelectorAll(selector).forEach((button) => {
      const active = button.dataset[attribute] === String(value);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function render() {
    const stats = plant.stats();
    const guidance = careGuidance(descriptor, stats);

    ageInput.value = state.age;
    dayInput.value = state.day;
    container.querySelector('[data-age-output]').value = `${state.age} yr`;
    container.querySelector('[data-day-output]').value =
      `${state.day} · ${dateForDay(state.day)}`;
    container.querySelector('[data-stage]').textContent = stats.phenology.stage;
    container.querySelector('[data-bbch]').textContent = stats.phenology.bbch;

    for (const { key } of descriptor.stats) {
      const output = container.querySelector(`[data-stat="${key}"]`);
      const value = stats[key];
      if (output) {
        output.textContent = Number.isFinite(value)
          ? value.toLocaleString()
          : '—';
      }
    }

    const yieldConfig = descriptor.yieldLine;
    const yieldValue = stats[yieldConfig.key];
    container.querySelector('[data-yield]').textContent = yieldConfig.format
      ? yieldConfig.format(yieldValue)
      : Number.isFinite(yieldValue)
        ? `${Math.max(0, yieldValue).toFixed(2)} ${yieldConfig.unit}`
        : '—';

    setToggleGroup('[data-plant]', 'plant', state.plant);
    setToggleGroup('[data-scenario]', 'scenario', state.scenario);
    setToggleGroup('[data-view]', 'view', state.view);
    setToggleGroup('[data-profile]', 'profile', state.phenologyProfile);

    // Species declare their own actions, so availability is asked of the
    // plant rather than assumed by the panel.
    const harvestButton = container.querySelector('[data-action="harvest"]');
    if (harvestButton) {
      harvestButton.disabled = (stats.visibleRipeBerries ?? 0) <= 0;
      harvestButton.title = harvestButton.disabled
        ? 'No ripe fruit is available at this time.'
        : `Harvest ${stats.visibleRipeBerries.toLocaleString()} rendered ripe berries.`;
    }

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
    const needsRebuild = Object.keys(patch).some(
      (key) => patch[key] !== state[key],
    );
    Object.assign(state, patch);
    if (needsRebuild) applyPlantState();
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

  function logEvent(text) {
    eventEntries.unshift({
      when: `Year ${state.age} · ${dateForDay(state.day)}`,
      text,
    });
  }

  ageInput.addEventListener('input', (event) => {
    scheduleTimeState({
      age: clampInteger(event.target.value, 0, descriptor.maxYears, state.age),
    });
  });
  dayInput.addEventListener('input', (event) => {
    scheduleTimeState({
      day: clampInteger(event.target.value, 1, 365, state.day),
    });
  });
  container
    .querySelector('[data-current-day]')
    .addEventListener('click', () => commitState({ day: currentDayOfYear() }));
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
  container.querySelectorAll('[data-profile]').forEach((button) => {
    button.addEventListener('click', () =>
      commitState({ phenologyProfile: button.dataset.profile }),
    );
  });
  container.querySelectorAll('[data-plant]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.plant;
      if (next !== state.plant) onSelectPlant(next);
    });
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

  const pruneButton = container.querySelector('[data-action="prune"]');
  pruneButton?.addEventListener('click', () => {
    const result = plant.pruneOldestCane({
      ageYears: state.age,
      dayOfYear: state.day,
    });
    if (result.applied || result.event) {
      logEvent(`Pruned oldest cane ${result.caneId ?? result.event.caneId}`);
    } else {
      logEvent(`Pruning refused: ${describeRefusal(result.reason)}`);
    }
    render();
  });

  const harvestButton = container.querySelector('[data-action="harvest"]');
  harvestButton?.addEventListener('click', () => {
    const result = plant.harvest();
    if (result.event) {
      logEvent(`Recorded ${result.amountKg.toFixed(2)} kg ripe-fruit harvest`);
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
    destroy() {
      if (pendingTimeFrame !== null) cancelAnimationFrame(pendingTimeFrame);
      container.innerHTML = '';
    },
  };
}

function describeRefusal(reason) {
  switch (reason) {
    case 'before-flowering-ends':
      return 'wait until flowering has finished';
    case 'after-bud-set':
      return 'too late, next spring’s buds are set';
    case 'too-young':
      return 'the shrub is too young to renew';
    case 'quota-reached':
      return 'this season’s renewal quota is used up';
    default:
      return reason ?? 'not applicable now';
  }
}
