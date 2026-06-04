import { execFile, spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import net from 'net';

const execFileAsync = promisify(execFile);

export const CDP_PORTS = [9222, 9223, 9333, 9444, 9555, 9666];
const BOT_LOCK_FILE = path.join(os.homedir(), '.remoat', '.bot.lock');

/** Prefer Antigravity IDE (Remoat plugin target) over legacy Antigravity.app. */
export function resolveAntigravityInstall(platform = os.platform()) {
  if (platform === 'darwin') {
    const candidates = [
      {
        label: 'Antigravity IDE',
        appPath: '/Applications/Antigravity IDE.app',
        macAppName: 'Antigravity IDE',
        cliPath: '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide'
      },
      {
        label: 'Antigravity',
        appPath: '/Applications/Antigravity.app',
        macAppName: 'Antigravity',
        cliPath: '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity'
      }
    ];
    return candidates.find((c) => fs.existsSync(c.appPath)) ?? null;
  }
  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    const pairs = [
      ['Antigravity IDE', path.join(local || '', 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe')],
      ['Antigravity', path.join(local || '', 'Programs', 'Antigravity', 'Antigravity.exe')]
    ];
    for (const [label, exe] of pairs) {
      if (exe && fs.existsSync(exe)) {
        return { label, appPath: exe, cliPath: exe, macAppName: label };
      }
    }
    return null;
  }
  return null;
}

function checkCdpPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(Array.isArray(JSON.parse(data)));
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

export async function findRespondingCdpPort() {
  for (const port of CDP_PORTS) {
    if (await checkCdpPort(port)) return port;
  }
  return null;
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

export async function findAvailableCdpPort() {
  for (const port of CDP_PORTS) {
    if (await isPortAvailable(port)) return port;
  }
  return null;
}

export async function waitForCdp(port, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkCdpPort(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Open Antigravity IDE with CDP (not legacy Antigravity.app via remoat open). */
export async function openAntigravityWithCdp(platform = os.platform()) {
  const install = resolveAntigravityInstall(platform);
  if (!install) {
    return {
      ok: false,
      message:
        'Antigravity IDE is not installed. Install it from Google, then run Ignite again.'
    };
  }

  const existing = await findRespondingCdpPort();
  if (existing) {
    return { ok: true, port: existing, install, alreadyOpen: true };
  }

  const port = await findAvailableCdpPort();
  if (!port) {
    return {
      ok: false,
      message: 'No free CDP port (9222–9666). Close other debug sessions and try again.'
    };
  }

  try {
    if (platform === 'darwin') {
      await execFileAsync('open', ['-n', '-a', install.macAppName, '--args', `--remote-debugging-port=${port}`]);
    } else if (platform === 'win32') {
      spawn(install.cliPath, [`--remote-debugging-port=${port}`], {
        detached: true,
        stdio: 'ignore'
      }).unref();
    } else {
      return {
        ok: false,
        message: 'On Linux, set ANTIGRAVITY_PATH in .env and run orbitprompter open from Terminal.'
      };
    }
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }

  await new Promise((r) => setTimeout(r, 1000));
  const ready = await waitForCdp(port);
  if (!ready) {
    return {
      ok: false,
      message: `${install.label} opened, but its remote debugging port is unresponsive. This usually happens if the IDE was already running.\n\nPlease completely QUIT all active windows of ${install.label} (Cmd + Q or quit via the menu) and click Ignite again to start.`
    };
  }

  return { ok: true, port, install, alreadyOpen: false };
}

export function orbitPrompterBotPid() {
  if (!fs.existsSync(BOT_LOCK_FILE)) return null;
  const pid = parseInt(String(fs.readFileSync(BOT_LOCK_FILE, 'utf8')).trim(), 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export function isOrbitPrompterBotRunning() {
  const pid = orbitPrompterBotPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function stopOrbitPrompterBot() {
  const pid = orbitPrompterBotPid();
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already stopped */
    }
  }
  if (fs.existsSync(BOT_LOCK_FILE)) {
    try {
      fs.unlinkSync(BOT_LOCK_FILE);
    } catch {
      /* */
    }
  }
}

export function spawnOrbitPrompterStart() {
  const install = resolveAntigravityInstall();
  const env = { ...process.env };
  if (install?.cliPath) {
    env.ANTIGRAVITY_PATH = install.cliPath;
  }
  return spawn('orbitprompter', ['start'], {
    detached: true,
    stdio: 'ignore',
    env
  });
}
