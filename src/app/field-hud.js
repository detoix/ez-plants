/**
 * The readout the field page exists for.
 *
 * Two families of number, kept visually apart because they answer different
 * questions. What the renderer actually did this frame comes from
 * `renderer.info`, not from anything the library reports about itself -- a
 * library's own draw-call count is a claim, and the point of this page is to
 * check the claim. What the field reports about itself sits underneath.
 */

const SAMPLES = 120;

function row(label, hint = '') {
  const dt = document.createElement('dt');
  dt.textContent = label;
  if (hint) dt.title = hint;
  const dd = document.createElement('dd');
  dd.textContent = '—';
  return { dt, dd };
}

export function createFieldHUD(container) {
  const panel = document.createElement('section');
  panel.className = 'fx-hud';
  panel.setAttribute('aria-label', 'Field performance readout');

  // On a phone the full readout is most of the screen, and the screen is the
  // garden. So it folds down to the one line that is worth watching while you
  // walk -- frame rate and frame time -- and opens on a tap. The summary is
  // live in both states, so a collapsed HUD is still a working instrument
  // rather than a closed drawer.
  const body = document.createElement('div');
  body.className = 'fx-hud-body';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'fx-hud-toggle';
  toggle.setAttribute('aria-controls', 'fx-hud-body');
  body.id = 'fx-hud-body';
  const summary = document.createElement('span');
  summary.className = 'fx-hud-summary';
  summary.textContent = '—';
  const chevron = document.createElement('span');
  chevron.className = 'fx-hud-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  toggle.append(summary, chevron);
  panel.append(toggle, body);

  function setCollapsed(collapsed) {
    panel.classList.toggle('fx-hud-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute(
      'aria-label',
      collapsed ? 'Show the full performance readout' : 'Hide the readout',
    );
  }

  toggle.addEventListener('click', () =>
    setCollapsed(!panel.classList.contains('fx-hud-collapsed')),
  );

  const compact = window.matchMedia('(max-width: 640px), (max-height: 520px)');
  setCollapsed(compact.matches);

  const groups = new Map();
  const rows = new Map();

  function addGroup(id, title) {
    const heading = document.createElement('h2');
    heading.textContent = title;
    const list = document.createElement('dl');
    body.append(heading, list);
    groups.set(id, list);
  }

  function addRow(group, id, label, hint) {
    const { dt, dd } = row(label, hint);
    groups.get(group).append(dt, dd);
    rows.set(id, dd);
  }

  // Which GPU is actually doing this. On a hybrid-graphics laptop the browser
  // is usually handed the integrated one, and a page has no way to ask for the
  // other -- so a performance number means nothing until you know which chip
  // produced it. Cheap to display, and it removes a whole class of confusion.
  addGroup('gpu', 'Renderer');
  addRow('gpu', 'gpu', 'GPU', 'Reported by WEBGL_debug_renderer_info');

  addGroup('frame', 'This frame');
  addRow('frame', 'fps', 'FPS', 'Mean over the last 120 frames');
  addRow('frame', 'frameMs', 'Frame', 'Mean, and the worst of the last 120');
  addRow(
    'frame',
    'js',
    'CPU in JS',
    'view + wind + render, all on the main thread',
  );
  addRow(
    'frame',
    'split',
    'render/view/wind',
    'Where that CPU goes. Small numbers against a long frame means we are waiting on the GPU',
  );
  addRow(
    'frame',
    'calls',
    'Draw calls',
    'renderer.info.render.calls — the whole scene',
  );
  addRow('frame', 'triangles', 'Triangles', 'renderer.info.render.triangles');

  addGroup('field', 'The field');
  addRow('field', 'plants', 'Plants');
  addRow(
    'field',
    'fieldCalls',
    'Field draws',
    'What PlantField reports for itself',
  );
  addRow('field', 'instances', 'Organ instances');
  addRow('field', 'budget', 'Budget');
  addRow(
    'field',
    'slots',
    'Slots',
    'Instance slots spanned, and how many draw nothing',
  );

  addGroup('lod', 'View pass');
  addRow(
    'lod',
    'visible',
    'Plants drawn',
    'Survived the one-sphere-per-plant frustum test',
  );
  addRow('lod', 'levels', 'Plants per band', 'Near → far');
  addRow(
    'lod',
    'lodApplied',
    'Applied / queued',
    'Level changes this frame, and waiting',
  );
  addRow(
    'lod',
    'lodMs',
    'View cost',
    'Culling, deciding levels, applying this frame’s share',
  );
  addRow(
    'lod',
    'writes',
    'Instance writes',
    'Per second, and the total since load',
  );

  container.append(panel);

  let gpuNamed = false;

  const deltas = new Float32Array(SAMPLES);
  let cursor = 0;
  let filled = 0;
  let lastWrites = 0;
  let writeRate = 0;
  let rateClock = 0;

  const set = (id, value) => {
    const node = rows.get(id);
    if (node && node.textContent !== value) node.textContent = value;
  };
  const int = (value) => Math.round(value).toLocaleString('en-US');

  function update({ delta, renderer, fields, view, timings }) {
    deltas[cursor] = delta;
    cursor = (cursor + 1) % SAMPLES;
    filled = Math.min(filled + 1, SAMPLES);

    let total = 0;
    let worst = 0;
    for (let index = 0; index < filled; index += 1) {
      total += deltas[index];
      if (deltas[index] > worst) worst = deltas[index];
    }
    const mean = total / Math.max(1, filled);

    const fps = mean > 0 ? (1 / mean).toFixed(0) : '—';
    set('fps', fps);
    set(
      'frameMs',
      `${(mean * 1000).toFixed(1)} ms · worst ${(worst * 1000).toFixed(0)}`,
    );
    const line = `${fps} fps · ${(mean * 1000).toFixed(1)} ms`;
    if (summary.textContent !== line) summary.textContent = line;
    if (!gpuNamed) {
      gpuNamed = true;
      // Ask the renderer for its own context rather than re-querying the
      // canvas: it is the context that is actually drawing.
      try {
        const gl = renderer.getContext();
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const name = debug
          ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER);
        rows.get('gpu').textContent = name || 'unknown';
        rows.get('gpu').title = name || '';
      } catch {
        rows.get('gpu').textContent = 'unavailable';
      }
    }

    const js = timings.render + timings.wind + timings.view;
    set('js', `${js.toFixed(1)} ms of ${(mean * 1000).toFixed(1)}`);
    set(
      'split',
      `${timings.render.toFixed(1)} / ${timings.view.toFixed(1)} / ${timings.wind.toFixed(1)}`,
    );
    set('calls', int(renderer.info.render.calls));
    set('triangles', int(renderer.info.render.triangles));

    let plants = 0;
    let fieldCalls = 0;
    let instances = 0;
    let budget = 0;
    let slots = 0;
    let unused = 0;
    let writes = 0;
    let overBudget = false;
    let levelCounts = null;

    for (const entry of fields) {
      const stats = entry.field.stats();
      plants += stats.plants;
      fieldCalls += stats.drawCalls;
      instances += stats.organInstances;
      budget += stats.budget;
      slots += stats.slots;
      unused += stats.unusedSlots;
      writes += stats.instanceWrites;
      overBudget ||= stats.overBudget;
      if (!levelCounts) levelCounts = stats.levelCounts.slice();
      else stats.levelCounts.forEach((n, i) => (levelCounts[i] += n));
    }

    rateClock += delta;
    if (rateClock >= 0.5) {
      writeRate = (writes - lastWrites) / rateClock;
      lastWrites = writes;
      rateClock = 0;
    }

    set('plants', int(plants));
    set('fieldCalls', int(fieldCalls));
    set('instances', int(instances));
    set('budget', `${int(budget)}${overBudget ? ' · over' : ''}`);
    rows.get('budget').classList.toggle('fx-warn', overBudget);
    set(
      'slots',
      `${int(slots)} · ${int(unused)} idle (${slots ? ((unused / slots) * 100).toFixed(0) : 0}%)`,
    );

    set('visible', `${int(view.visible)} of ${int(view.plants)}`);
    set('levels', levelCounts ? levelCounts.map(int).join(' · ') : '—');
    set('lodApplied', `${int(view.applied)} / ${int(view.pending)}`);
    set('lodMs', `${view.ms.toFixed(2)} ms`);
    set('writes', `${int(writeRate)}/s · ${int(writes)} total`);
  }

  return { update, element: panel };
}
