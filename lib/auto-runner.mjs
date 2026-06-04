/**
 * Auto runner scheduler: quota-aware scheduled + manual runs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { orbitPrompterPaths } from './orbitprompter-paths.mjs';
import { buildAutoRunPrompt, sendAutoRunPrompt } from './antigravity-prompt.mjs';
import { fetchAntigravityQuotas } from './antigravity-quota.mjs';
import { sendTelegramNotifications } from './telegram-notify.mjs';

export const AUTO_RUNNER_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const QUOTA_EXHAUSTED_THRESHOLD = 5;

export const DEFAULT_AUTO_RUNNER_CONFIG = {
  enabled: false,
  leadTimeBeforeResetHours: 1,
  runTimeoutMinutes: 120
};

/**
 * @param {unknown} raw
 */
export function normalizeAutoRunnerConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: !!r.enabled,
    leadTimeBeforeResetHours: Math.max(
      0.25,
      parseFloat(r.leadTimeBeforeResetHours) || DEFAULT_AUTO_RUNNER_CONFIG.leadTimeBeforeResetHours
    ),
    runTimeoutMinutes: Math.max(
      5,
      parseInt(String(r.runTimeoutMinutes ?? DEFAULT_AUTO_RUNNER_CONFIG.runTimeoutMinutes), 10) ||
        DEFAULT_AUTO_RUNNER_CONFIG.runTimeoutMinutes
    )
  };
}

/**
 * @param {string} homeDir
 */
export function autoRunnerStatePath(homeDir) {
  return path.join(orbitPrompterPaths(homeDir).dir, 'auto-runner-state.json');
}

/**
 * @param {string} homeDir
 */
export function readAutoRunnerState(homeDir) {
  const p = autoRunnerStatePath(homeDir);
  if (!fs.existsSync(p)) {
    return { inFlight: null, lastFired: {}, lastResult: null, nextScheduledHint: null };
  }
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      inFlight: j.inFlight ?? null,
      lastFired: j.lastFired && typeof j.lastFired === 'object' ? j.lastFired : {},
      lastResult: j.lastResult ?? null,
      nextScheduledHint: j.nextScheduledHint ?? null
    };
  } catch {
    return { inFlight: null, lastFired: {}, lastResult: null, nextScheduledHint: null };
  }
}

/**
 * @param {string} homeDir
 * @param {object} state
 */
export function writeAutoRunnerState(homeDir, state) {
  const p = autoRunnerStatePath(homeDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * @param {string} [iso]
 */
export function formatResetTime(iso) {
  if (!iso) return 'reset time unknown';
  const diffMs = new Date(iso) - new Date();
  if (diffMs <= 0) return 'resetting now';
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  return `resets in ${hours}h ${mins}m`;
}

/**
 * @param {Array<{ modelId: string, label: string, percentage: number, resetTime: string }>} models
 * @param {number} leadHours
 * @param {Record<string, string>} lastFired
 */
export function pickEligibleScheduledModel(models, leadHours, lastFired) {
  const now = Date.now();
  const leadMs = leadHours * 3600000;
  const eligible = [];

  for (const m of models) {
    if (!m.resetTime) continue;
    const reset = new Date(m.resetTime).getTime();
    if (!Number.isFinite(reset)) continue;
    const triggerAt = reset - leadMs;
    if (now < triggerAt || now >= reset) continue;
    const key = `${m.modelId}:${m.resetTime}`;
    if (lastFired[key]) continue;
    eligible.push({ ...m, triggerAt, reset, fireKey: key });
  }

  eligible.sort((a, b) => {
    if (a.reset !== b.reset) return a.reset - b.reset;
    return b.percentage - a.percentage;
  });

  return eligible[0] ?? null;
}

/**
 * @param {Array<{ modelId: string, label: string, percentage: number, resetTime: string }>} models
 * @param {string} [modelChoice] auto or modelId
 */
export function resolveModelChoice(models, modelChoice) {
  const choice = String(modelChoice ?? 'auto').trim();
  if (choice && choice.toLowerCase() !== 'auto') {
    const found = models.find((m) => m.modelId === choice);
    if (found) return found;
  }
  if (!models.length) return null;
  const sorted = [...models].sort((a, b) => b.percentage - a.percentage);
  return sorted[0];
}

/**
 * @param {Array<{ modelId: string, resetTime: string }>} models
 * @param {number} leadHours
 */
export function computeNextScheduledHint(models, leadHours) {
  const picked = pickEligibleScheduledModel(models, leadHours, {});
  if (picked) {
    return { modelId: picked.modelId, label: picked.label, at: new Date(picked.triggerAt).toISOString() };
  }
  const now = Date.now();
  const leadMs = leadHours * 3600000;
  let best = null;
  for (const m of models) {
    if (!m.resetTime) continue;
    const reset = new Date(m.resetTime).getTime();
    if (!Number.isFinite(reset) || reset <= now) continue;
    const triggerAt = reset - leadMs;
    if (triggerAt <= now) continue;
    if (!best || triggerAt < best.triggerAt) {
      best = { modelId: m.modelId, label: m.label, triggerAt };
    }
  }
  if (!best) return null;
  return { modelId: best.modelId, label: best.label, at: new Date(best.triggerAt).toISOString() };
}

export class AutoRunnerController {
  /**
   * @param {object} opts
   * @param {string} opts.homeDir
   * @param {() => Promise<boolean>} opts.isIgnited
   * @param {() => Promise<number | null>} opts.findCdpPort
   * @param {() => { telegramBotToken: string, allowedUserIds: string[] }} opts.readTelegramConfig
   * @param {() => object} opts.readAutoRunnerConfig
   * @param {() => Promise<void>} [opts.ensureAutoRunWorkflow]
   */
  constructor(opts) {
    this.homeDir = opts.homeDir;
    this.isIgnited = opts.isIgnited;
    this.findCdpPort = opts.findCdpPort;
    this.readTelegramConfig = opts.readTelegramConfig;
    this.readAutoRunnerConfig = opts.readAutoRunnerConfig;
    this.ensureAutoRunWorkflow = opts.ensureAutoRunWorkflow ?? (async () => {});
    this._pollTimer = null;
    this._runTimer = null;
    this._status = { line: 'Idle', ignited: false };
  }

  getStatus() {
    return { ...this._status };
  }

  startPolling() {
    this.stopPolling();
    const cfg = normalizeAutoRunnerConfig(this.readAutoRunnerConfig());
    if (!cfg.enabled) return;
    this._pollTimer = setInterval(() => void this.pollTick(), AUTO_RUNNER_POLL_INTERVAL_MS);
    void this.pollTick();
  }

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /**
   * @param {boolean} enabled
   */
  setScheduledEnabled(enabled) {
    if (enabled) this.startPolling();
    else this.stopPolling();
  }

  async pollTick() {
    const ignited = await this.isIgnited();
    this._status.ignited = ignited;
    if (!ignited) {
      this._status.line = 'Ignite on Overview to use Auto runner';
      return;
    }

    const cfg = normalizeAutoRunnerConfig(this.readAutoRunnerConfig());
    const state = readAutoRunnerState(this.homeDir);
    if (state.inFlight) {
      this._status.line = `Running (${state.inFlight.label || state.inFlight.modelId})…`;
      return;
    }

    const quota = await fetchAntigravityQuotas();
    if (quota.ok && quota.models) {
      state.nextScheduledHint = computeNextScheduledHint(quota.models, cfg.leadTimeBeforeResetHours);
      writeAutoRunnerState(this.homeDir, state);
      this._status.nextScheduledHint = state.nextScheduledHint;
    }

    if (!cfg.enabled) {
      this._status.line = state.nextScheduledHint
        ? `Scheduled off · next window ${formatResetTime(state.nextScheduledHint.at)}`
        : 'Scheduled auto-run off';
      return;
    }

    if (!quota.ok || !quota.models?.length) {
      this._status.line = 'Waiting for quota data (language server offline)';
      return;
    }

    const eligible = pickEligibleScheduledModel(
      quota.models,
      cfg.leadTimeBeforeResetHours,
      state.lastFired
    );
    if (!eligible) {
      this._status.line = state.nextScheduledHint
        ? `Idle · next trigger ~${formatResetTime(state.nextScheduledHint.at)}`
        : 'Idle · no model in pre-reset window';
      return;
    }

    await this.executeRun({
      trigger: 'scheduled',
      model: eligible,
      fireKey: eligible.fireKey
    });
  }

  /**
   * @param {{ modelChoice?: string }} opts
   */
  async runNow({ modelChoice = 'auto' } = {}) {
    const ignited = await this.isIgnited();
    if (!ignited) {
      return { ok: false, message: 'Ignite on Overview first (CDP required).' };
    }

    const state = readAutoRunnerState(this.homeDir);
    if (state.inFlight) {
      return { ok: false, message: 'An auto-run is already in progress.' };
    }

    const quota = await fetchAntigravityQuotas();
    if (!quota.ok || !quota.models?.length) {
      return { ok: false, message: quota.message || 'Could not read model quotas.' };
    }

    const model = resolveModelChoice(quota.models, modelChoice);
    if (!model) {
      return { ok: false, message: 'No model available for this run.' };
    }

    return this.executeRun({ trigger: 'manual', model, fireKey: null });
  }

  /**
   * @param {{ trigger: 'scheduled'|'manual', model: object, fireKey: string | null }} opts
   */
  async executeRun({ trigger, model, fireKey }) {
    const cfg = normalizeAutoRunnerConfig(this.readAutoRunnerConfig());
    const state = readAutoRunnerState(this.homeDir);

    const cdp = await this.findCdpPort();
    if (!cdp) {
      const msg = 'Antigravity CDP not available — click Ignite on Overview first.';
      this._status.line = msg;
      return { ok: false, message: msg };
    }

    await this.ensureAutoRunWorkflow();

    const tg = this.readTelegramConfig();
    const inFlight = {
      startedAt: new Date().toISOString(),
      trigger,
      modelId: model.modelId,
      label: model.label
    };
    state.inFlight = inFlight;
    writeAutoRunnerState(this.homeDir, state);
    this._status.line = `Starting auto-run (${model.label || model.modelId})…`;

    const startMsg =
      trigger === 'manual'
        ? `Manual auto-run starting (${model.label || model.modelId}).`
        : `Scheduled auto-run starting (${model.label || model.modelId}) — quota resets ~${formatResetTime(model.resetTime)}.`;
    if (tg.telegramBotToken && tg.allowedUserIds?.length) {
      await sendTelegramNotifications({
        token: tg.telegramBotToken,
        userIds: tg.allowedUserIds,
        text: startMsg
      });
    }

    const promptText = buildAutoRunPrompt({ modelLabel: model.label, modelId: model.modelId });
    const promptRes = await sendAutoRunPrompt({ text: promptText, modelId: model.modelId });

    if (!promptRes.ok) {
      state.inFlight = null;
      state.lastResult = {
        at: new Date().toISOString(),
        trigger,
        modelId: model.modelId,
        status: 'error',
        message: promptRes.message
      };
      writeAutoRunnerState(this.homeDir, state);
      this._status.line = promptRes.message || 'Prompt failed';
      if (tg.telegramBotToken && tg.allowedUserIds?.length) {
        await sendTelegramNotifications({
          token: tg.telegramBotToken,
          userIds: tg.allowedUserIds,
          text: `Auto-run failed: ${promptRes.message || 'unknown error'}`
        });
      }
      return { ok: false, message: promptRes.message };
    }

    if (this._runTimer) clearTimeout(this._runTimer);
    this._runTimer = setTimeout(
      () => void this.finishRun({ trigger, model, fireKey, timedOut: true }),
      cfg.runTimeoutMinutes * 60 * 1000
    );

    this._status.line = `Running (${model.label || model.modelId}) — up to ${cfg.runTimeoutMinutes}m`;
    return { ok: true, message: 'Auto-run prompt submitted' };
  }

  /**
   * v1: completion after runTimeoutMinutes (submit-only CLI). v2 may use orbitprompter --wait.
   * @param {object} opts
   */
  async finishRun({ trigger, model, fireKey, timedOut }) {
    if (this._runTimer) {
      clearTimeout(this._runTimer);
      this._runTimer = null;
    }

    const cfg = normalizeAutoRunnerConfig(this.readAutoRunnerConfig());
    const state = readAutoRunnerState(this.homeDir);
    const tg = this.readTelegramConfig();

    const quota = await fetchAntigravityQuotas();
    let pct = model.percentage;
    let resetTime = model.resetTime;
    if (quota.ok && quota.models) {
      const m = quota.models.find((x) => x.modelId === model.modelId);
      if (m) {
        pct = m.percentage;
        resetTime = m.resetTime;
      }
    }

    const exhausted = pct <= QUOTA_EXHAUSTED_THRESHOLD;
    const quotaLine = exhausted
      ? 'Quota: exhausted.'
      : `Quota: ${pct}% remaining.`;
    const resetLine = `Next reset: ${formatResetTime(resetTime)}.`;

    const prefix = timedOut ? `Timed out after ${cfg.runTimeoutMinutes} minutes. ` : '';
    const completionText = `${prefix}Auto-run finished (${model.label || model.modelId}). ${quotaLine} ${resetLine}`;

    if (trigger === 'scheduled' && fireKey) {
      state.lastFired[fireKey] = new Date().toISOString();
    }
    state.inFlight = null;
    state.lastResult = {
      at: new Date().toISOString(),
      trigger,
      modelId: model.modelId,
      status: timedOut ? 'timeout' : 'ok'
    };
    state.nextScheduledHint = quota.ok
      ? computeNextScheduledHint(quota.models, cfg.leadTimeBeforeResetHours)
      : state.nextScheduledHint;
    writeAutoRunnerState(this.homeDir, state);

    this._status.line = timedOut ? `Timed out · ${model.label}` : `Last run OK · ${model.label}`;
    this._status.lastResult = state.lastResult;

    if (tg.telegramBotToken && tg.allowedUserIds?.length) {
      await sendTelegramNotifications({
        token: tg.telegramBotToken,
        userIds: tg.allowedUserIds,
        text: completionText
      });
    }
  }

  /**
   * @returns {Promise<object>}
   */
  async getSnapshot() {
    const ignited = await this.isIgnited();
    const cfg = normalizeAutoRunnerConfig(this.readAutoRunnerConfig());
    const state = readAutoRunnerState(this.homeDir);
    const quota = await fetchAntigravityQuotas();
    const cdp = await this.findCdpPort();
    const tg = this.readTelegramConfig();
    if (quota.ok && quota.models) {
      state.nextScheduledHint = computeNextScheduledHint(quota.models, cfg.leadTimeBeforeResetHours);
      writeAutoRunnerState(this.homeDir, state);
    }
    return {
      config: cfg,
      state,
      ignited,
      cdpAvailable: !!cdp,
      quota,
      status: this.getStatus(),
      telegramConfigured: !!(tg.telegramBotToken && tg.allowedUserIds?.length),
      pollIntervalMinutes: AUTO_RUNNER_POLL_INTERVAL_MS / 60000
    };
  }
}
