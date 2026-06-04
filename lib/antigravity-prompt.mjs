/**
 * Submit auto-run prompts to Antigravity via orbitprompter CLI.
 */

import { spawn } from 'node:child_process';
import { resolveAntigravityInstall } from '../electron/antigravity-runtime.mjs';
import os from 'node:os';

const PROMPT_SUBMIT_TIMEOUT_MINUTES = 3;
const EXIT_MESSAGES = {
  2: 'CDP not available. Click Ignite on Overview first.',
  3: 'Antigravity workbench not found. Quit extra IDE windows and Ignite again.',
  4: 'Failed to submit prompt to Antigravity.',
  1: 'Prompt rejected (workspace busy or another submission in progress).'
};

/**
 * @param {{ modelLabel?: string, modelId?: string }} opts
 */
export function buildAutoRunPrompt({ modelLabel, modelId } = {}) {
  const modelLine =
    modelId && modelLabel
      ? `Prefer model: ${modelLabel} (${modelId}).`
      : modelId
        ? `Prefer model ID: ${modelId}.`
        : 'Use the best available model for this run.';
  return [
    'Run the /auto-run workflow.',
    modelLine,
    'Use GitHub MCP to find open issues and work exactly one eligible issue end-to-end.',
    'Do not start a second issue in this session.'
  ].join('\n');
}

/**
 * @param {{ text: string, modelId?: string, timeoutMinutes?: number }} opts
 * @returns {Promise<{ ok: boolean, exitCode?: number, message?: string, workspace?: string }>}
 */
export async function sendAutoRunPrompt({ text, modelId, timeoutMinutes = PROMPT_SUBMIT_TIMEOUT_MINUTES }) {
  const args = ['prompt', '--text', text, '--timeout-minutes', String(timeoutMinutes)];
  const mid = String(modelId ?? '').trim();
  if (mid && mid.toLowerCase() !== 'auto') {
    args.push('--model', mid);
  }

  const env = { ...process.env };
  const install = resolveAntigravityInstall(os.platform());
  if (install?.cliPath) env.ANTIGRAVITY_PATH = install.cliPath;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('orbitprompter', args, { env, shell: false });
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        resolve({
          ok: false,
          message: 'orbitprompter CLI not found. Install orbitprompter ≥ 1.0.3 globally.'
        });
      } else {
        resolve({ ok: false, message: err.message || String(err) });
      }
    });
    child.on('close', (code) => {
      if (code === 0) {
        let workspace;
        try {
          const line = stdout.trim().split('\n').find((l) => l.startsWith('{'));
          if (line) workspace = JSON.parse(line).workspace;
        } catch {
          /* optional JSON */
        }
        return resolve({ ok: true, exitCode: 0, workspace });
      }
      const mapped = EXIT_MESSAGES[code] || 'orbitprompter prompt failed.';
      const detail = stderr.trim() || stdout.trim();
      resolve({
        ok: false,
        exitCode: code ?? 1,
        message: detail ? `${mapped} ${detail}` : mapped
      });
    });
  });
}
