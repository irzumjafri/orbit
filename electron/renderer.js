// Navigation Logic
const viewChoices = document.getElementById('view-choices');
const viewForm = document.getElementById('view-form');
const viewProgress = document.getElementById('view-progress');

function updateDots(step) {
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (!dot) continue;
    dot.classList.toggle('active', i <= step);
    dot.classList.toggle('is-current', i === step);
  }
  document.querySelectorAll('.wiz-step-indicator .step-line').forEach((line, i) => {
    line.classList.toggle('is-filled', step > i + 1);
  });
}

function flashStepSuccess(iconEl) {
  if (!iconEl) return;
  iconEl.classList.remove('motion-pop');
  void iconEl.offsetWidth;
  iconEl.classList.add('motion-pop');
  iconEl.addEventListener(
    'animationend',
    () => iconEl.classList.remove('motion-pop'),
    { once: true }
  );
}

/** Three dots = install wizard only (launch → configure → progress). Hidden on Orbit dashboard. */
function setWizardStepperVisible(visible) {
  const el = document.getElementById('step-indicator');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

function showInstallerChoices() {
  const boot = document.getElementById('view-boot');
  if (boot) {
    boot.classList.remove('active');
    boot.removeAttribute('aria-busy');
  }
  viewChoices.classList.add('active');
  viewForm.classList.remove('active');
  viewProgress.classList.remove('active');
  updateDots(1);
  setWizardStepperVisible(true);
}

// Highlight selection visually
function bindChoiceCardHover(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('mouseenter', function () {
    this.classList.add('selected');
  });
  el.addEventListener('mouseleave', function () {
    this.classList.remove('selected');
  });
}
['card-express', 'card-custom'].forEach(bindChoiceCardHover);

// UI Navigation
document.addEventListener('DOMContentLoaded', async () => {
  if (window.electronEnv?.platform) {
    document.documentElement.dataset.platform = window.electronEnv.platform;
  }

  const boot = document.getElementById('view-boot');
  const bootLabel = document.getElementById('view-boot-label');
  const choices = document.getElementById('view-choices');

  setWizardStepperVisible(false);

  const setBootText = (msg) => {
    if (bootLabel) bootLabel.textContent = msg;
  };

  const hideBoot = () => {
    if (boot) {
      boot.classList.remove('active');
      boot.removeAttribute('aria-busy');
    }
  };

  let startView;
  let isInstalled;
  try {
    setBootText('Checking your environment…');
    [startView, isInstalled] = await Promise.all([
      window.api.invoke('get-start-view'),
      window.api.invoke('check-is-installed')
    ]);
  } catch (err) {
    console.error(err);
    setBootText('Could not read settings — opening installer.');
    showInstallerChoices();
    return;
  }

  const openDashboard =
    startView === 'dashboard' || (startView === 'auto' && isInstalled);

  if (openDashboard) {
    setBootText('Opening Orbit…');
    const dash = document.getElementById('view-dashboard');
    try {
      hideBoot();
      viewChoices.classList.remove('active');
      viewForm.classList.remove('active');
      viewProgress.classList.remove('active');
      setWizardStepperVisible(false);
      dash.style.display = 'flex';
      dash.classList.add('active');
      await initDashboard();
    } catch (dashErr) {
      console.error(dashErr);
      dash.classList.remove('active');
      dash.style.display = 'none';
      showInstallerChoices();
    }
  } else {
    showInstallerChoices();
  }
});

// Express flow
document.getElementById('card-express').addEventListener('click', () => {
  document.querySelectorAll('.tool-checkbox').forEach((cb) => {
    cb.checked = true;
  });
  document.getElementById('install-ag').checked = true;
  document.getElementById('configure-mcps').checked = true;
  document.getElementById('install-workflows').checked = true;
  document.getElementById('install-gemini').checked = true;
  document.getElementById('remoat-bot-token').value = '';
  document.getElementById('remoat-allowed-user-ids').value = '';
  document.getElementById('remoat-workspace-dir').value = '';
  startInstall();
});

// Custom payload: tools (2) then Remoat token (3) + access/workspace (4); launch is step 1 (cards).
let customSubStep = 1;

function isRemoatToolSelected() {
  return Array.from(document.querySelectorAll('.tool-checkbox:checked')).some((cb) => cb.value === 'orbitprompter' || cb.value === 'remoat');
}

function wantsWorkflows() {
  return document.getElementById('install-workflows')?.checked ?? false;
}

function wantsGemini() {
  return document.getElementById('install-gemini')?.checked ?? false;
}

function isWorkflowsOnlyPayload() {
  if (!wantsWorkflows()) return false;
  const tools = document.querySelectorAll('.tool-checkbox:checked');
  return (
    tools.length === 0 &&
    !document.getElementById('install-ag').checked &&
    !document.getElementById('configure-mcps').checked
  );
}

function hasAnyPayloadSelected() {
  return (
    document.querySelectorAll('.tool-checkbox:checked').length > 0 ||
    document.getElementById('install-ag').checked ||
    document.getElementById('configure-mcps').checked ||
    wantsWorkflows() ||
    wantsGemini()
  );
}

function customStepTotal() {
  if (isWorkflowsOnlyPayload()) return 2;
  return isRemoatToolSelected() ? 4 : 2;
}

function refreshCustomSubtitle() {
  const sub = document.getElementById('custom-form-subtitle');
  const intro = document.getElementById('custom-tools-intro');
  if (!sub) return;
  const total = customStepTotal();
  if (intro) {
    if (isWorkflowsOnlyPayload()) {
      intro.textContent =
        'Only Autopilot workflow files will be installed. Continue to write feature.md, submit.md, test.md, and project-creator.md under ~/.agents/workflows/.';
    } else if (isRemoatToolSelected()) {
      intro.textContent =
        'Choose what to install. With OrbitPrompter CLI selected, you will set the bot token (step 3) then access and workspace (step 4).';
    } else {
      intro.textContent = 'Choose what to install. Continue starts the install when OrbitPrompter is not selected.';
    }
  }
  if (customSubStep === 1) {
    if (isWorkflowsOnlyPayload()) {
      sub.textContent = 'Step 2 of 2 — Autopilot workflows';
      return;
    }
    sub.textContent =
      total === 4
        ? 'Step 2 of 4 — Tools, integrations & Autopilot'
        : 'Step 2 of 2 — Payload — Continue starts install';
    return;
  }
  if (customSubStep === 2) {
    sub.textContent = 'Step 3 of 4 — OrbitPrompter bot token';
    return;
  }
  sub.textContent = 'Step 4 of 4 — Who can use OrbitPrompter & workspace';
}

function setCustomSubStep(step) {
  customSubStep = step;
  document.getElementById('custom-step-tools').classList.toggle('active', step === 1);
  document.getElementById('custom-step-remoat-token').classList.toggle('active', step === 2);
  document.getElementById('custom-step-remoat-access').classList.toggle('active', step === 3);
  const btnContinue = document.getElementById('btn-custom-continue');
  const btnLaunch = document.getElementById('btn-start-custom');
  btnContinue.style.display = step === 3 ? 'none' : 'inline-flex';
  btnLaunch.style.display = step === 3 ? 'inline-flex' : 'none';
  refreshCustomSubtitle();
  const scrollEl = document.querySelector('#view-form .custom-form-scroll');
  if (scrollEl) scrollEl.scrollTop = 0;
}

document.getElementById('card-custom').addEventListener('click', () => {
  setCustomSubStep(1);
  document.getElementById('view-boot')?.classList.remove('active');
  viewChoices.classList.remove('active');
  viewProgress.classList.remove('active');
  viewForm.classList.add('active');
  setWizardStepperVisible(true);
  updateDots(2);
});

document.getElementById('btn-back').addEventListener('click', () => {
  if (!viewForm.classList.contains('active')) return;
  if (customSubStep === 3) {
    setCustomSubStep(2);
    return;
  }
  if (customSubStep === 2) {
    setCustomSubStep(1);
    return;
  }
  viewForm.classList.remove('active');
  viewChoices.classList.add('active');
  updateDots(1);
  setWizardStepperVisible(true);
});

document.getElementById('btn-custom-continue').addEventListener('click', () => {
  if (customSubStep === 1) {
    if (!hasAnyPayloadSelected()) {
      window.alert('Select at least one tool, integration, or Autopilot item to install.');
      return;
    }
    if (isWorkflowsOnlyPayload() || !isRemoatToolSelected()) startInstall();
    else setCustomSubStep(2);
  } else if (customSubStep === 2) {
    setCustomSubStep(3);
  }
});

document.getElementById('btn-start-custom').addEventListener('click', () => {
  startInstall();
});

document.getElementById('custom-step-tools').addEventListener('change', (e) => {
  if (customSubStep !== 1) return;
  if (
    e.target.classList.contains('tool-checkbox') ||
    e.target.id === 'install-ag' ||
    e.target.id === 'configure-mcps' ||
    e.target.id === 'install-workflows' ||
    e.target.id === 'install-gemini'
  ) {
    refreshCustomSubtitle();
  }
});

// Installation Logic
const CORE_INSTALL_STEPS = [
  { id: 'homebrew', label: 'Initializing Homebrew Thrusters' },
  { id: 'clis', label: 'Deploying CLI Payloads' },
  { id: 'antigravity', label: 'Installing Antigravity Core' },
  { id: 'path', label: 'Calibrating Shell Trajectories' },
  { id: 'mcps', label: 'Docking MCP Servers' },
  { id: 'remoat', label: 'Establishing OrbitPrompter Uplink' }
];

const GEMINI_INSTALL_STEP = {
  id: 'scaffold-gemini',
  label: 'Writing GEMINI.md',
  group: 'gemini',
  groupLabel: '~/.gemini/'
};

const WORKFLOW_INSTALL_STEPS = [
  { id: 'scaffold-wf-feature', label: 'Writing feature.md', group: 'workflows', groupLabel: '~/.agents/workflows/' },
  { id: 'scaffold-wf-submit', label: 'Writing submit.md', group: 'workflows' },
  { id: 'scaffold-wf-test', label: 'Writing test.md', group: 'workflows' },
  { id: 'scaffold-wf-project-creator', label: 'Writing project-creator.md', group: 'workflows' }
];

const FULL_INSTALL_STEPS = [
  ...CORE_INSTALL_STEPS,
  GEMINI_INSTALL_STEP,
  ...WORKFLOW_INSTALL_STEPS
];

function appendScaffoldInstallSteps(steps, { gemini = true, workflows = true } = {}) {
  const out = [...steps];
  if (gemini) out.push(GEMINI_INSTALL_STEP);
  if (workflows) out.push(...WORKFLOW_INSTALL_STEPS);
  return out;
}

const TMOLE_INSTALL_STEP = { id: 'tmole', label: 'Installing tmole (Tunnelmole)' };

function buildCustomInstallSteps() {
  if (isWorkflowsOnlyPayload()) return [TMOLE_INSTALL_STEP, ...WORKFLOW_INSTALL_STEPS];

  const wf = wantsWorkflows();
  const gem = wantsGemini();
  if (!wf && !gem) return [...CORE_INSTALL_STEPS];
  return appendScaffoldInstallSteps(CORE_INSTALL_STEPS, { gemini: gem, workflows: wf });
}

function setInstallProgressUI({ index, total, label, phase }) {
  const fill = document.getElementById('progress-fill');
  const track = document.getElementById('progress-track');
  const meta = document.getElementById('progress-meta');
  const title = document.getElementById('progress-title');
  const pct = total > 0 ? Math.round((index / total) * 100) : 0;
  if (fill) fill.style.width = `${pct}%`;
  if (track) track.setAttribute('aria-valuenow', String(pct));
  if (meta) {
    meta.hidden = false;
    meta.textContent = total ? `Step ${Math.min(index + 1, total)} of ${total}` : '';
  }
  if (title && label) {
    title.innerText = phase === 'done' ? label : `${label}…`;
  }
}

function renderInstallStepRows(container, stepDefs) {
  container.innerHTML = '';
  let lastGroup = null;
  let staggerIndex = 0;
  for (const step of stepDefs) {
    if (step.group && step.group !== lastGroup) {
      const groupEl = document.createElement('div');
      groupEl.className = 'wiz-step-group motion-stagger-item';
      groupEl.style.setProperty('--stagger-i', String(staggerIndex++));
      groupEl.textContent = step.groupLabel || step.group;
      container.appendChild(groupEl);
      lastGroup = step.group;
    } else if (!step.group) {
      lastGroup = null;
    }
    const el = document.createElement('div');
    el.className = 'wiz-step-item motion-stagger-item';
    el.style.setProperty('--stagger-i', String(staggerIndex++));
    el.dataset.stepId = step.id;
    el.innerHTML = `
      <div class="wiz-step-icon pending" id="icon-${step.id}"></div>
      <div class="wiz-step-text">
        <div class="wiz-step-label">${step.label}</div>
        <div class="wiz-step-msg" id="msg-${step.id}">Waiting…</div>
      </div>
    `;
    container.appendChild(el);
  }
}

async function runInstallSteps(stepDefs, { runningTitle, doneTitle, failTitle }) {
  setWizardStepperVisible(true);
  document.getElementById('view-boot')?.classList.remove('active');
  viewChoices.classList.remove('active');
  viewForm.classList.remove('active');
  viewProgress.classList.add('active');
  updateDots(3);

  const progressTitle = document.getElementById('progress-title');
  const btnFinish = document.getElementById('btn-finish');
  progressTitle.innerText = runningTitle;
  progressTitle.classList.remove('wiz-progress-title--fail', 'wiz-progress-title--done');
  btnFinish.style.display = 'none';

  const selectedTools = Array.from(document.querySelectorAll('.tool-checkbox:checked')).map((cb) => cb.value);
  const installAg = document.getElementById('install-ag').checked;
  const remoatPayload = {
    telegramBotToken: document.getElementById('remoat-bot-token').value,
    allowedUserIds: document.getElementById('remoat-allowed-user-ids').value,
    workspaceBaseDir: document.getElementById('remoat-workspace-dir').value
  };

  const container = document.getElementById('steps-container');
  container.innerHTML = '';
  const panel = document.querySelector('.wiz-panel--progress');
  if (panel) {
    panel.style.display = 'none'; // Hide the whole panel during installation for a super clean view
    const listEl = panel.querySelector('.wiz-progress-list');
    if (listEl) {
      listEl.style.display = 'flex'; // Restore in case it was hidden on a previous successful run
    }
  }

  const total = stepDefs.length;
  const progressTrack = document.getElementById('progress-track');
  progressTrack?.classList.add('is-active');
  setInstallProgressUI({ index: 0, total, label: runningTitle.replace(/…$/, ''), phase: 'run' });

  for (let i = 0; i < stepDefs.length; i++) {
    const step = stepDefs[i];

    setInstallProgressUI({ index: i, total, label: step.label, phase: 'run' });

    let data = null;
    if (step.id === 'clis') data = selectedTools;
    if (step.id === 'antigravity') data = installAg;
    if (step.id === 'remoat') data = remoatPayload;
    if (step.id === 'mcps') data = document.getElementById('configure-mcps').checked;

    const result = await window.api.installStep(step.id, data);

    if (result.status === 'success') {
      setInstallProgressUI({ index: i + 1, total, label: step.label, phase: 'run' });
    } else {
      if (panel) {
        panel.style.display = 'flex';
      }
      container.innerHTML = `
        <div class="wiz-step-item" style="border: 1px solid rgba(248, 113, 113, 0.25); padding: 16px; border-radius: 10px; background: rgba(248, 113, 113, 0.05); text-align: left; width: 100%; box-sizing: border-box;">
          <div style="font-weight: 600; color: #f87171; margin-bottom: 8px; font-size: 14px; display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-flex; width: 18px; height: 18px; align-items: center; justify-content: center; background: rgba(248, 113, 113, 0.15); border-radius: 50%; color: #f87171; font-size: 10px; border: 1px solid rgba(248, 113, 113, 0.3);">✕</span>
            Error installing: ${step.label}
          </div>
          <pre style="margin: 0; white-space: pre-wrap; font-family: monospace; font-size: 12px; color: #fca5a5; line-height: 1.5; text-align: left; background: rgba(0, 0, 0, 0.2); padding: 12px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.04); overflow-x: auto;">${escapeHtml(result.message)}</pre>
        </div>
      `;
      btnFinish.style.display = 'inline-flex';
      progressTitle.innerText = failTitle;
      progressTitle.classList.remove('wiz-progress-title--done');
      progressTitle.classList.add('wiz-progress-title--fail');
      setInstallProgressUI({ index: i, total, label: failTitle.replace(/…$/, ''), phase: 'run' });
      progressTrack?.classList.remove('is-active');
      return;
    }
  }

  progressTrack?.classList.remove('is-active');
  if (panel) {
    panel.style.display = 'flex';
    // Remove the body structure but keep the footer centered
    const listEl = panel.querySelector('.wiz-progress-list');
    if (listEl) {
      listEl.style.display = 'none';
    }
  }
  btnFinish.style.display = 'inline-flex';
  setInstallProgressUI({ index: total, total, label: doneTitle, phase: 'done' });
  progressTitle.innerText = doneTitle;
  progressTitle.classList.remove('wiz-progress-title--fail');
  progressTitle.classList.add('wiz-progress-title--done');
}

function startInstall() {
  const workflowsOnly = isWorkflowsOnlyPayload();
  const stepDefs = viewForm.classList.contains('active') ? buildCustomInstallSteps() : FULL_INSTALL_STEPS;
  return runInstallSteps(stepDefs, {
    runningTitle: workflowsOnly
      ? 'Installing Autopilot workflows'
      : 'Setting up your environment',
    doneTitle: workflowsOnly ? 'Workflows installed.' : 'Orbit is ready.',
    failTitle: workflowsOnly ? 'Workflow install failed' : 'Setup failed'
  });
}

document.getElementById('btn-finish').addEventListener('click', async () => {
  const boot = document.getElementById('view-boot');
  const bootLabel = document.getElementById('view-boot-label');
  viewProgress.classList.remove('active');
  if (boot) {
    boot.classList.add('active');
    boot.setAttribute('aria-busy', 'true');
  }
  if (bootLabel) bootLabel.textContent = 'Opening Orbit…';
  setWizardStepperVisible(false);
  const dash = document.getElementById('view-dashboard');
  try {
      await initDashboard();
    dash.style.display = 'flex';
    dash.classList.add('active');
  } catch (err) {
    console.error(err);
    dash.classList.remove('active');
    dash.style.display = 'none';
    showInstallerChoices();
    return;
  }
  if (boot) {
    boot.classList.remove('active');
    boot.removeAttribute('aria-busy');
  }
});

// Dashboard Logic
const STATUS_HINTS = {
  git: 'Version control',
  python: 'Scripting & tooling',
  node: 'JavaScript runtime',
  supabase: 'Supabase CLI',
  eas: 'Expo build service',
  tmole: 'Public HTTPS tunnels (/test workflow)',
  remoat: 'Telegram bridge',
  antigravity: 'Google Antigravity IDE'
};

const TOOL_DISPLAY_NAMES = {
  git: 'Git',
  python: 'Python',
  node: 'Node',
  supabase: 'Supabase CLI',
  eas: 'EAS',
  tmole: 'tmole',
  remoat: 'OrbitPrompter',
  antigravity: 'Antigravity IDE'
};

const DOC_META = {
  gemini: { title: 'GEMINI.md', hint: '~/.gemini/ — global agent rules' },
  feature: { title: 'feature.md', hint: '~/.agents/workflows/' },
  submit: { title: 'submit.md', hint: '~/.agents/workflows/' },
  test: { title: 'test.md', hint: '/test — tmole web or APK' },
  projectCreator: { title: 'project-creator.md', hint: 'ProjectFactory — new repos & clones' }
};

let workflowCatalog = null;
let workflowEditorDirty = false;

function findWorkflowItem(id) {
  if (!workflowCatalog) return null;
  if (workflowCatalog.gemini?.id === id) return workflowCatalog.gemini;
  return (
    workflowCatalog.builtins?.find((b) => b.id === id) ||
    workflowCatalog.custom?.find((c) => c.id === id) ||
    null
  );
}

function setWorkflowStatus(message, isError = false) {
  const el = document.getElementById('workflow-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('is-error', !!isError);
}

function updateWorkflowChrome(workflowId) {
  const hint = document.getElementById('workflow-slash-hint');
  const delBtn = document.getElementById('btn-delete-workflow');
  const item = findWorkflowItem(workflowId);
  if (hint) {
    if (item?.slash) {
      hint.hidden = false;
      hint.innerHTML = `In Antigravity Agent chat, type <code>${escapeHtml(item.slash)}</code>`;
    } else {
      hint.hidden = true;
      hint.textContent = '';
    }
  }
  if (delBtn) {
    const deletable = workflowId.startsWith('custom:');
    delBtn.disabled = !deletable;
    delBtn.title = deletable ? 'Delete this workflow file' : 'Built-in and global rules cannot be deleted';
  }
}

function populateWorkflowSelect(select, catalog, selectedId) {
  select.innerHTML = '';
  const addGroup = (label, items) => {
    if (!items?.length) return;
    const og = document.createElement('optgroup');
    og.label = label;
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = item.id;
      const desc = item.description ? ` — ${item.description}` : '';
      opt.textContent = `${item.label}${desc}`;
      og.appendChild(opt);
    }
    select.appendChild(og);
  };
  addGroup('Global', [catalog.gemini]);
  addGroup('Built-in workflows', catalog.builtins);
  const customGroup = document.createElement('optgroup');
  customGroup.label = 'Custom workflows';
  if (catalog.custom.length === 0) {
    const placeholder = document.createElement('option');
    placeholder.disabled = true;
    placeholder.textContent = '(none — use New workflow)';
    customGroup.appendChild(placeholder);
  } else {
    for (const item of catalog.custom) {
      const opt = document.createElement('option');
      opt.value = item.id;
      const desc = item.description ? ` — ${item.description}` : '';
      opt.textContent = `${item.label}${desc}`;
      customGroup.appendChild(opt);
    }
  }
  select.appendChild(customGroup);
  const ids = [
    catalog.gemini.id,
    ...catalog.builtins.map((b) => b.id),
    ...catalog.custom.map((c) => c.id)
  ];
  const next = selectedId && ids.includes(selectedId) ? selectedId : catalog.gemini.id;
  select.value = next;
}

async function loadWorkflowIntoEditor(workflowId) {
  const editor = document.getElementById('workflow-editor');
  const res = await window.api.invoke('dash-workflows', 'get', { id: workflowId });
  if (editor) editor.value = res?.ok ? res.content : '';
  workflowEditorDirty = false;
  updateWorkflowChrome(workflowId);
}

async function refreshWorkflowUi(selectedId) {
  const select = document.getElementById('workflow-select');
  if (!select) return;
  const res = await window.api.invoke('dash-workflows', 'list');
  if (!res?.gemini) {
    setWorkflowStatus(res?.message || 'Could not load workflows.', true);
    return;
  }
  workflowCatalog = res;
  populateWorkflowSelect(select, res, selectedId);
  await loadWorkflowIntoEditor(select.value);
  setWorkflowStatus('');
}

function setWorkflowCreatePanelVisible(visible) {
  const panel = document.getElementById('workflow-create-panel');
  const editor = document.getElementById('workflow-editor');
  const toolbar = document.querySelector('.workflow-toolbar');
  const footer = document.querySelector('.workflow-footer');
  if (panel) panel.hidden = !visible;
  if (editor) editor.hidden = visible;
  if (toolbar) toolbar.hidden = visible;
  if (footer) footer.hidden = visible;
}

let brandIconsPromise = null;
function loadBrandIcons() {
  if (!brandIconsPromise) {
    brandIconsPromise = window.api.invoke('dash-brand-icons');
  }
  return brandIconsPromise;
}

function glyphFromBrand(icons, key, fallbackLabel) {
  const svg = icons[key];
  if (svg) {
    return { className: 'settings-tile__glyph settings-tile__glyph--fluent', svg };
  }
  const fb = String(fallbackLabel || key || '?')
    .slice(0, 2)
    .toUpperCase();
  return { className: 'settings-tile__glyph settings-tile__glyph--fallback', text: fb };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function diagGlyphHtml(glyph) {
  if (glyph.svg) {
    return `<div class="diag-tc-ico">${glyph.svg}</div>`;
  }
  return `<div class="diag-tc-ico">${escapeHtml(glyph.text)}</div>`;
}

function diagBadgeLabel(ok, warn) {
  if (ok) return 'Ready';
  if (warn) return 'Warning';
  return 'Missing';
}

function diagBadgeClass(ok, warn) {
  if (ok) return 'diag-tc-badge diag-tc-badge--ok';
  return 'diag-tc-badge diag-tc-badge--miss';
}

let diagStaggerCounter = 0;

function diagToolCard(title, desc, ok, glyph, warn = false) {
  const missing = !ok && !warn;
  const i = diagStaggerCounter++;
  return `<div class="diag-tc motion-stagger-item${missing ? ' diag-tc--miss' : ''}" style="--stagger-i: ${i}">
    ${diagGlyphHtml(glyph)}
    <div class="diag-tc-n">${escapeHtml(title)}</div>
    <div class="diag-tc-d">${escapeHtml(desc)}</div>
    <span class="${diagBadgeClass(ok && !warn, warn)}">${diagBadgeLabel(ok, warn)}</span>
  </div>`;
}

function diagSection(title, cardsHtml) {
  return `<div class="diag-section"><p class="dash-section-title">${escapeHtml(title)}</p><div class="diag-tool-grid">${cardsHtml}</div></div>`;
}

function computeDiagnosticsSummary(status, install, docs) {
  const toolOk = Object.values(status).filter(Boolean).length;
  const toolTotal = Object.keys(status).length;
  const mcpOk = install.mcpAny ? 1 : 0;
  const docKeys = ['gemini', 'feature', 'submit', 'test', 'projectCreator'];
  const docOk = docKeys.reduce((n, k) => n + (docs[k] ? 1 : 0), 0);
  const ok = toolOk + mcpOk + docOk;
  const total = toolTotal + 1 + docKeys.length;
  return { ok, total };
}

function overviewComponentRow(name, desc, state, statusLabel, staggerIndex = 0) {
  const isOk = state === 'ok';
  const statusHtml = isOk
    ? `<div class="lp-status lp-status--ok"><span class="lp-dot lp-dot--ok"></span>Ready</div>`
    : `<div class="lp-status lp-status--warn"><span class="lp-dot lp-dot--warn"></span>${escapeHtml(statusLabel)}</div>`;
  return `<div class="lp-comp-row" style="--stagger-i: ${staggerIndex}">
    <div>
      <div class="lp-comp-name">${escapeHtml(name)}</div>
      <div class="lp-comp-sub">${escapeHtml(desc)}</div>
    </div>
    ${statusHtml}
  </div>`;
}

function renderOverview(status, install, docs) {
  const list = document.getElementById('overview-components');
  const countEl = document.getElementById('overview-diag-count');
  const fillEl = document.getElementById('overview-diag-fill');
  if (!list) return;

  const docKeys = ['gemini', 'feature', 'submit', 'test', 'projectCreator'];
  const missingDocs = docKeys.filter((k) => !docs[k]);
  const remoatReady = !!(status.remoat && install.remoatConfig);
  const remoatWarn = !!(status.remoat && !install.remoatConfig);
  const autopilotOk = missingDocs.length === 0;

  const { ok, total } = computeDiagnosticsSummary(status, install, docs);
  const pct = total > 0 ? (ok / total) * 100 : 0;
  if (countEl) countEl.textContent = `${ok} / ${total}`;
  if (fillEl) fillEl.style.width = `${pct}%`;

  let apLabel =
    missingDocs.length === 0
      ? 'Ready'
      : missingDocs.length === 1
        ? '1 missing'
        : `${missingDocs.length} missing`;
  if (docs.customWorkflowCount > 0) {
    apLabel =
      missingDocs.length === 0
        ? `${docs.customWorkflowCount} custom`
        : `${apLabel} · ${docs.customWorkflowCount} custom`;
  }

  list.innerHTML =
    overviewComponentRow(
      'Antigravity',
      'Google Antigravity IDE',
      status.antigravity ? 'ok' : 'warn',
      'Missing',
      0
    ) +
    overviewComponentRow(
      'OrbitPrompter',
      'Telegram bridge',
      remoatReady ? 'ok' : 'warn',
      remoatWarn ? 'Configure' : 'Missing',
      1
    ) +
    overviewComponentRow(
      'Autopilot',
      'Workflow instructions',
      autopilotOk ? 'ok' : 'warn',
      apLabel,
      2
    );
}

let dashboardListenersBound = false;

function syncRemoatUi(running, canLaunch) {
  const btn = document.getElementById('btn-dash-launch');
  const titleEl = document.getElementById('dash-launch-title');
  const hintEl = document.getElementById('dash-launch-hint');
  const mascotWrap = document.querySelector('.lp-mascot-wrap');
  const controlCenter = document.querySelector('.control-center');
  
  if (mascotWrap) {
    const wasIgnited = mascotWrap.classList.contains('is-ignited');
    mascotWrap.classList.toggle('is-ignited', !!running);
    if (wasIgnited && !running) {
      mascotWrap.classList.add('is-landing');
    } else if (running) {
      mascotWrap.classList.remove('is-landing');
    }
  }
  if (controlCenter) controlCenter.classList.toggle('is-ignited', !!running);

  if (!btn || !titleEl) return;
  if (running) {
    titleEl.textContent = 'Land';
    if (hintEl) hintEl.textContent = 'Shut down the OrbitPrompter bot';
    btn.classList.add('is-running');
    btn.classList.remove('is-ready');
    btn.disabled = false;
    btn.title = 'Stop the OrbitPrompter bot';
  } else {
    titleEl.textContent = 'Ignite';
    if (hintEl) hintEl.textContent = 'Open Antigravity IDE · Start OrbitPrompter bot';
    btn.classList.remove('is-running');
    btn.classList.toggle('is-ready', canLaunch);
    btn.disabled = !canLaunch;
    btn.title = canLaunch
      ? 'Open Antigravity IDE with debugging, then start the OrbitPrompter bot'
      : 'Install Antigravity IDE, the orbitprompter CLI, and save settings under Configure.';
  }
}

async function initDashboard() {
  const STAGE_IDS = ['mission', 'diagnostics', 'remoat', 'autopilot', 'limits'];

  const setStageTab = (tab) => {
    STAGE_IDS.forEach((id) => {
      const panel = document.getElementById(`dash-stage-panel-${id}`);
      const btn = document.getElementById(`btn-dock-${id}`);
      const on = id === tab;
      if (panel) {
        if (on) {
          panel.classList.remove('active');
          panel.toggleAttribute('hidden', false);
          void panel.offsetWidth;
          panel.classList.add('active');
        } else {
          panel.classList.remove('active');
          panel.toggleAttribute('hidden', true);
        }
      }
      if (btn) {
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      }
    });
  };

  const loadStatus = async () => {
    diagStaggerCounter = 0;
    const [status, install, docs, brandIcons] = await Promise.all([
      window.api.invoke('dash-status'),
      window.api.invoke('dash-install-checks'),
      window.api.invoke('dash-docs-status'),
      loadBrandIcons()
    ]);
    const grid = document.getElementById('status-grid');
    const toolTiles = Object.entries(status)
      .map(([key, ok]) => {
        const hint = STATUS_HINTS[key] || 'Environment check';
        const title = TOOL_DISPLAY_NAMES[key] || key;
        const glyph = glyphFromBrand(brandIcons, key, key);
        const warn = key === 'remoat' && ok && !install.remoatConfig;
        return diagToolCard(title, hint, ok && !warn, glyph, warn);
      })
      .join('');

    const mcpParts = [];
    if (install.mcpConfigJsonFile) mcpParts.push('mcp_config.json');
    if (install.mcpJsonFile) mcpParts.push('mcp.json');
    const mcpHint = mcpParts.length
      ? `~/.gemini/antigravity/ (${mcpParts.join(' + ')})`
      : '~/.gemini/antigravity/';
    const mcpTile = diagToolCard(
      'Antigravity MCP',
      mcpHint,
      install.mcpAny,
      glyphFromBrand(brandIcons, 'mcp', 'MC')
    );

    const docKeysList = ['gemini', 'feature', 'submit', 'test', 'projectCreator'];
    const docTiles = docKeysList
      .map((k) => {
        const meta = DOC_META[k];
        return diagToolCard(
          meta.title,
          meta.hint,
          docs[k],
          glyphFromBrand(brandIcons, 'markdown', 'MD')
        );
      })
      .join('');

    grid.innerHTML =
      diagSection('Tools & runtimes', toolTiles + mcpTile) +
      diagSection('Autopilot files', docTiles);
    return { status, install, docs };
  };

  const refreshDashHome = async () => {
    let status;
    let install;
    let docs;
    try {
      [status, install, docs] = await Promise.all([
        window.api.invoke('dash-status'),
        window.api.invoke('dash-install-checks'),
        window.api.invoke('dash-docs-status')
      ]);
      renderOverview(status, install, docs);
    } catch (err) {
      console.error(err);
      const countEl = document.getElementById('overview-diag-count');
      if (countEl) countEl.textContent = '—';
      try {
        const running = await window.api.invoke('dash-remoat-status');
        syncRemoatUi(running, false);
      } catch {
        syncRemoatUi(false, false);
      }
      return;
    }
    const running = await window.api.invoke('dash-remoat-status');
    const canOpen = !!(status.antigravity && status.remoat);
    const canStartBot = !!(status.remoat && install.remoatConfig);
    const canLaunch = canOpen && canStartBot;
    syncRemoatUi(running, canLaunch);
  };

  const showDashHome = async () => {
    setStageTab('mission');
    await refreshDashHome();
  };

  const showDashDiagnostics = async () => {
    setStageTab('diagnostics');
    const { status, install } = await loadStatus();
    const running = await window.api.invoke('dash-remoat-status');
    const canLaunch = !!(status.antigravity && status.remoat && install.remoatConfig);
    syncRemoatUi(running, canLaunch);
  };

  const showDashRemoat = async () => {
    setStageTab('remoat');
    const running = await window.api.invoke('dash-remoat-status');
    const [status, install] = await Promise.all([
      window.api.invoke('dash-status'),
      window.api.invoke('dash-install-checks')
    ]);
    const canLaunch = !!(status.antigravity && status.remoat && install.remoatConfig);
    syncRemoatUi(running, canLaunch);
  };

  const showDashAutopilot = async () => {
    setStageTab('autopilot');
    setWorkflowCreatePanelVisible(false);
    await refreshWorkflowUi();
    const running = await window.api.invoke('dash-remoat-status');
    const [status, install] = await Promise.all([
      window.api.invoke('dash-status'),
      window.api.invoke('dash-install-checks')
    ]);
    const canLaunch = !!(status.antigravity && status.remoat && install.remoatConfig);
    syncRemoatUi(running, canLaunch);
  };

  const AVAILABLE_MODELS = [
    {
      name: "Gemini 3.5 Flash (Medium)",
      provider: "Google",
      class: "gemini",
      icon: "♊",
      context: 1048576,
      maxOutput: 8192,
      rpm: 15,
      tpm: 1000000,
      rpd: 1500
    },
    {
      name: "Gemini 3.5 Flash (High)",
      provider: "Google",
      class: "gemini",
      icon: "♊",
      context: 1048576,
      maxOutput: 8192,
      rpm: 15,
      tpm: 1000000,
      rpd: 1500
    },
    {
      name: "Gemini 3.5 Flash (Low)",
      provider: "Google",
      class: "gemini",
      icon: "♊",
      context: 1048576,
      maxOutput: 8192,
      rpm: 15,
      tpm: 1000000,
      rpd: 1500
    },
    {
      name: "Gemini 3.1 Pro (Low)",
      provider: "Google",
      class: "gemini",
      icon: "♊",
      context: 2097152,
      maxOutput: 8192,
      rpm: 2,
      tpm: 32000,
      rpd: 50
    },
    {
      name: "Gemini 3.1 Pro (High)",
      provider: "Google",
      class: "gemini",
      icon: "♊",
      context: 2097152,
      maxOutput: 8192,
      rpm: 2,
      tpm: 32000,
      rpd: 50
    },
    {
      name: "Claude Sonnet 4.6 (Thinking)",
      provider: "Anthropic",
      class: "anthropic",
      icon: "🎴",
      context: 200000,
      maxOutput: 8192,
      rpm: 5,
      tpm: 40000,
      rpd: "Tier Dependent"
    },
    {
      name: "Claude Opus 4.6 (Thinking)",
      provider: "Anthropic",
      class: "anthropic",
      icon: "🎴",
      context: 200000,
      maxOutput: 4096,
      rpm: 5,
      tpm: 40000,
      rpd: "Tier Dependent"
    },
    {
      name: "GPT-OSS 120B (Medium)",
      provider: "OpenAI",
      class: "openai",
      icon: "🌀",
      context: 128000,
      maxOutput: 4096,
      rpm: 500,
      tpm: 150000,
      rpd: "Tier Dependent"
    }
  ];

  const renderModelLimits = () => {
    const grid = document.getElementById('limits-grid');
    if (!grid) return;
    const maxContext = Math.max(...AVAILABLE_MODELS.map(m => m.context));
    grid.innerHTML = AVAILABLE_MODELS.map(model => {
      const pct = (model.context / maxContext) * 100;
      const cleanId = model.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      return `
        <div class="model-card model-card--${model.class} dash-surface" id="card-model-${cleanId}">
          <div class="model-card__header">
            <div class="model-card__icon-wrap">${model.icon}</div>
            <div>
              <h3 class="model-card__title">${escapeHtml(model.name)}</h3>
              <p class="model-card__provider">${escapeHtml(model.provider)}</p>
            </div>
          </div>
          <div class="model-card__stat-group">
            <div class="model-card__stat-row">
              <span class="model-card__stat-label">Context Window</span>
              <span class="model-card__stat-value">${model.context.toLocaleString()} tokens</span>
            </div>
            <div class="model-card__progress-bar">
              <div class="model-card__progress-fill" style="width: ${pct}%;"></div>
            </div>
            <div class="model-card__stat-row">
              <span class="model-card__stat-label">Max Output Tokens</span>
              <span class="model-card__stat-value">${model.maxOutput.toLocaleString()} tokens</span>
            </div>
            <div class="model-card__stat-row">
              <span class="model-card__stat-label">RPM (Requests per Min)</span>
              <span class="model-card__stat-value">${typeof model.rpm === 'number' ? model.rpm.toLocaleString() + ' RPM' : model.rpm}</span>
            </div>
            <div class="model-card__stat-row">
              <span class="model-card__stat-label">TPM (Tokens per Min)</span>
              <span class="model-card__stat-value">${typeof model.tpm === 'number' ? model.tpm.toLocaleString() + ' TPM' : model.tpm}</span>
            </div>
            <div class="model-card__stat-row">
              <span class="model-card__stat-label">RPD (Requests per Day)</span>
              <span class="model-card__stat-value">${typeof model.rpd === 'number' ? model.rpd.toLocaleString() + ' RPD' : model.rpd}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  };

  const showDashLimits = async () => {
    setStageTab('limits');
    renderModelLimits();
    const running = await window.api.invoke('dash-remoat-status');
    const [status, install] = await Promise.all([
      window.api.invoke('dash-status'),
      window.api.invoke('dash-install-checks')
    ]);
    const canLaunch = !!(status.antigravity && status.remoat && install.remoatConfig);
    syncRemoatUi(running, canLaunch);
  };

  const dashLaunchOrLand = async () => {
    const running = await window.api.invoke('dash-remoat-status');
    if (running) {
      await window.api.invoke('dash-remoat-toggle');
      await refreshDashHome();
      return;
    }
    const openRes = await window.api.invoke('dash-remoat-open');
    if (!openRes?.ok) {
      window.alert(openRes?.message || 'Could not open Antigravity IDE with remote debugging.');
      return;
    }
    const startRes = await window.api.invoke('dash-remoat-toggle');
    if (startRes?.ok === false && startRes.message) {
      window.alert(startRes.message);
      await refreshDashHome();
      return;
    }
    await refreshDashHome();
  };

  if (!dashboardListenersBound) {
    dashboardListenersBound = true;
    document.getElementById('btn-refresh-status').addEventListener('click', async () => {
      const { status, install } = await loadStatus();
      const running = await window.api.invoke('dash-remoat-status');
      const canLaunch = !!(status.antigravity && status.remoat && install.remoatConfig);
      syncRemoatUi(running, canLaunch);
      await refreshDashHome();
    });
    const openDiag = () => {
      void showDashDiagnostics();
    };
    document.getElementById('btn-dock-mission')?.addEventListener('click', () => {
      void showDashHome();
    });
    document.getElementById('btn-dock-diagnostics')?.addEventListener('click', openDiag);
    document.getElementById('btn-dock-remoat')?.addEventListener('click', () => {
      void showDashRemoat();
    });
    document.getElementById('btn-dock-autopilot')?.addEventListener('click', () => {
      void showDashAutopilot();
    });
    document.getElementById('btn-dock-limits')?.addEventListener('click', () => {
      void showDashLimits();
    });
    document.getElementById('btn-dash-launch').addEventListener('click', () => {
      void dashLaunchOrLand();
    });
    document.getElementById('btn-save-remoat').addEventListener('click', async () => {
      const res = await window.api.invoke('dash-remoat-config', 'save', {
        telegramBotToken: document.getElementById('dash-remoat-token').value,
        allowedUserIds: document.getElementById('dash-remoat-user-ids').value,
        workspaceBaseDir: document.getElementById('dash-remoat-workspace').value
      });
      if (res && res.ok === false && res.message) window.alert(res.message);
      else await refreshDashHome();
    });
    const workflowSelect = document.getElementById('workflow-select');
    const workflowEditor = document.getElementById('workflow-editor');

    workflowSelect?.addEventListener('change', async () => {
      if (workflowEditorDirty) {
        const keep = window.confirm('Discard unsaved changes to this document?');
        if (!keep) {
          workflowSelect.value = workflowSelect.dataset.lastId || 'gemini';
          return;
        }
      }
      workflowSelect.dataset.lastId = workflowSelect.value;
      await loadWorkflowIntoEditor(workflowSelect.value);
    });

    workflowEditor?.addEventListener('input', () => {
      workflowEditorDirty = true;
      setWorkflowStatus('Unsaved changes');
    });

    document.getElementById('btn-save-workflow')?.addEventListener('click', async () => {
      const id = workflowSelect?.value;
      const content = workflowEditor?.value ?? '';
      const res = await window.api.invoke('dash-workflows', 'save', { id, content });
      if (!res?.ok) {
        setWorkflowStatus(res?.message || 'Save failed.', true);
        return;
      }
      workflowEditorDirty = false;
      setWorkflowStatus('Saved.');
      await refreshDashHome();
    });

    document.getElementById('btn-new-workflow')?.addEventListener('click', () => {
      setWorkflowCreatePanelVisible(true);
      document.getElementById('workflow-new-name')?.focus();
      document.getElementById('workflow-new-name').value = '';
      document.getElementById('workflow-new-description').value = '';
      setWorkflowStatus('');
    });

    document.getElementById('btn-cancel-workflow-create')?.addEventListener('click', () => {
      setWorkflowCreatePanelVisible(false);
      setWorkflowStatus('');
    });

    document.getElementById('btn-create-workflow')?.addEventListener('click', async () => {
      const name = document.getElementById('workflow-new-name')?.value ?? '';
      const description = document.getElementById('workflow-new-description')?.value ?? '';
      const res = await window.api.invoke('dash-workflows', 'create', { name, description });
      if (!res?.ok) {
        setWorkflowStatus(res?.message || 'Could not create workflow.', true);
        return;
      }
      setWorkflowCreatePanelVisible(false);
      await refreshWorkflowUi(res.id);
      workflowEditorDirty = false;
      setWorkflowStatus(`Created ${res.file}. Edit below, then Save.`);
      document.getElementById('workflow-editor')?.focus();
      await refreshDashHome();
    });

    document.getElementById('btn-delete-workflow')?.addEventListener('click', async () => {
      const id = workflowSelect?.value;
      if (!id?.startsWith('custom:')) return;
      const item = findWorkflowItem(id);
      const label = item?.file || id;
      if (!window.confirm(`Delete workflow file ${label}? This cannot be undone.`)) return;
      const res = await window.api.invoke('dash-workflows', 'delete', { id });
      if (!res?.ok) {
        setWorkflowStatus(res?.message || 'Delete failed.', true);
        return;
      }
      workflowEditorDirty = false;
      await refreshWorkflowUi('gemini');
      setWorkflowStatus('Workflow deleted.');
      await refreshDashHome();
    });
  }

  await showDashHome();
  const remoatCfg = await window.api.invoke('dash-remoat-config', 'get');
  document.getElementById('dash-remoat-token').value = remoatCfg.telegramBotToken || '';
  document.getElementById('dash-remoat-user-ids').value = remoatCfg.allowedUserIds || '';
  document.getElementById('dash-remoat-workspace').value = remoatCfg.workspaceBaseDir || '';

  await refreshWorkflowUi('gemini');
  const workflowSelectInit = document.getElementById('workflow-select');
  if (workflowSelectInit) workflowSelectInit.dataset.lastId = workflowSelectInit.value;
}
