import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { $, fs, os } from 'zx';
import { spawn } from 'child_process';

// Prepend standard developer bin paths to process.env.PATH on macOS and Linux.
// This resolves the issue where GUI-launched Electron apps cannot locate git, node, supabase, etc.
if (os.platform() !== 'win32') {
  const standardPaths = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    path.join(os.homedir(), '.npm-global/bin'),
    path.join(os.homedir(), '.local/bin'),
    path.join(os.homedir(), 'bin')
  ];
  const currentPaths = process.env.PATH ? process.env.PATH.split(path.delimiter) : [];
  const mergedPaths = Array.from(new Set([...standardPaths, ...currentPaths]));
  process.env.PATH = mergedPaths.join(path.delimiter);
}
import {
  siGit,
  siPython,
  siNodedotjs,
  siSupabase,
  siExpo,
  siTelegram,
  siVisualstudiocode,
  siJson,
  siMarkdown
} from 'simple-icons/icons';
import {
  WORKSPACE_HINT_FALLBACK,
  expandWorkspaceBaseDir,
  buildGeminiMarkdown,
  buildFeatureMd,
  buildSubmitMd,
  buildTestMd,
  buildProjectCreatorMd
} from '../lib/scaffold-templates.mjs';
import { writeUserScaffoldFile } from '../lib/scaffold-io.mjs';
import { ensureOrbitPrompterConfigDir, orbitPrompterPaths } from '../lib/orbitprompter-paths.mjs';
import {
  listWorkflows,
  getWorkflowContent,
  saveWorkflowContent,
  createWorkflow,
  deleteWorkflow,
  isWorkflowDeletable
} from '../lib/workflows-io.mjs';
import { WORKFLOW_SCAFFOLD_STEPS, GEMINI_SCAFFOLD_STEP } from '../lib/scaffold-steps.mjs';
import {
  ANTIGRAVITY_DOWNLOAD_PAGE,
  resolveAntigravityIdeDownloadUrl
} from '../lib/antigravity-download.mjs';
import {
  resolveAntigravityInstall,
  openAntigravityWithCdp,
  isOrbitPrompterBotRunning,
  stopOrbitPrompterBot,
  spawnOrbitPrompterStart
} from './antigravity-runtime.mjs';

/** SVG markup from Simple Icons (used in diagnostics tiles). */
function simpleIconSvg(icon) {
  const d = String(icon.path).replace(/"/g, '&quot;');
  return `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="22" height="22" aria-hidden="true"><path fill="#${icon.hex}" d="${d}"/></svg>`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isMac = os.platform() === 'darwin';
const isWindows = os.platform() === 'win32';
const homeDir = os.homedir();

function readOrbitPrompterConfigJson() {
  const { configJson } = orbitPrompterPaths(homeDir);
  if (!fs.existsSync(configJson)) return {};
  try {
    return JSON.parse(fs.readFileSync(configJson, 'utf8'));
  } catch {
    return {};
  }
}

function workspaceHintForScaffold() {
  const j = readOrbitPrompterConfigJson();
  const raw = j.workspaceBaseDir;
  if (!raw || !String(raw).trim()) return WORKSPACE_HINT_FALLBACK;
  const abs = expandWorkspaceBaseDir(homeDir, raw);
  return `**Workspace root:** \`${abs}\` (from \`~/.remoat/config.json\` → \`workspaceBaseDir\`).`;
}

async function writeWorkflowScaffoldFiles(hint) {
  const workflowsDir = path.join(homeDir, '.agents', 'workflows');
  await writeUserScaffoldFile(homeDir, path.join(workflowsDir, 'feature.md'), buildFeatureMd());
  await writeUserScaffoldFile(homeDir, path.join(workflowsDir, 'submit.md'), buildSubmitMd());
  await writeUserScaffoldFile(homeDir, path.join(workflowsDir, 'test.md'), buildTestMd());
  await writeUserScaffoldFile(
    homeDir,
    path.join(workflowsDir, 'project-creator.md'),
    buildProjectCreatorMd({ workspaceHintLine: hint })
  );
}

async function writeGeminiScaffoldFile(hint) {
  const geminiPath = path.join(homeDir, '.gemini', 'GEMINI.md');
  await writeUserScaffoldFile(homeDir, geminiPath, buildGeminiMarkdown({ workspaceHintLine: hint }));
}

async function runScaffoldInstallStep(stepId) {
  const hint = workspaceHintForScaffold();
  const workflowsDir = path.join(homeDir, '.agents', 'workflows');
  const meta = WORKFLOW_SCAFFOLD_STEPS.find((s) => s.id === stepId);
  if (meta) {
    const writers = {
      'scaffold-wf-feature': () =>
        writeUserScaffoldFile(homeDir, path.join(workflowsDir, 'feature.md'), buildFeatureMd()),
      'scaffold-wf-submit': () =>
        writeUserScaffoldFile(homeDir, path.join(workflowsDir, 'submit.md'), buildSubmitMd()),
      'scaffold-wf-test': () =>
        writeUserScaffoldFile(homeDir, path.join(workflowsDir, 'test.md'), buildTestMd()),
      'scaffold-wf-project-creator': () =>
        writeUserScaffoldFile(
          homeDir,
          path.join(workflowsDir, 'project-creator.md'),
          buildProjectCreatorMd({ workspaceHintLine: hint })
        )
    };
    await writers[stepId]();
    return { status: 'success', message: meta.successMessage };
  }
  if (stepId === GEMINI_SCAFFOLD_STEP.id) {
    await writeGeminiScaffoldFile(hint);
    return { status: 'success', message: GEMINI_SCAFFOLD_STEP.successMessage };
  }
  return { status: 'error', message: `Unknown scaffold step: ${stepId}` };
}

function parseAllowedUserIdsFromCsv(csv) {
  return String(csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function validateAllowedUserIds(ids) {
  if (ids.length === 0) {
    return 'OrbitPrompter requires at least one allowed Telegram user ID. Message @userinfobot on Telegram for your numeric ID.';
  }
  const bad = ids.find((id) => !/^\d+$/.test(id));
  if (bad) {
    return `Invalid Telegram user ID "${bad}". Use digits only; separate multiple IDs with commas.`;
  }
  return null;
}

function mergeWriteOrbitPrompterConfig({ telegramBotToken, allowedUserIds, workspaceBaseDir }) {
  ensureOrbitPrompterConfigDir(homeDir);
  const { configJson } = orbitPrompterPaths(homeDir);
  const existing = readOrbitPrompterConfigJson();
  const ws = workspaceBaseDir !== undefined && workspaceBaseDir !== null && String(workspaceBaseDir).trim()
    ? expandWorkspaceBaseDir(homeDir, workspaceBaseDir)
    : expandWorkspaceBaseDir(homeDir, existing.workspaceBaseDir ?? '');
  const out = {
    ...existing,
    telegramBotToken: String(telegramBotToken ?? '').trim(),
    allowedUserIds,
    workspaceBaseDir: ws
  };
  fs.writeFileSync(configJson, `${JSON.stringify(out, null, 2)}\n`);
}

// Manually load .env file from the parent directory
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      // Drop inline comments: KEY=value # comment (value must not contain " #")
      const commentAt = val.search(/\s+#/);
      if (commentAt !== -1) val = val.slice(0, commentAt).trim();
      process.env[key] = val;
    });
  }
} catch (e) {
  console.error('Failed to parse .env file', e);
}

function createWindow() {
  const win = new BrowserWindow({
    minWidth: 640,
    minHeight: 520,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#030609',
    icon: path.join(__dirname, 'assets/orbit_icon.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => {
    win.setTitle('Orbit');
    win.setFullScreen(true);
    win.show();
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Setup IPC handlers
ipcMain.handle('install-step', async (event, step, data) => {
  try {
    switch (step) {
      case 'homebrew':
        if (isWindows) {
          return { status: 'success', message: 'Skipped Homebrew (Using Winget)' };
        }
        try {
          await $`brew --version`;
          return { status: 'success', message: 'Homebrew already installed' };
        } catch {
          await $`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`;
          return { status: 'success', message: 'Homebrew installed successfully' };
        }
      case 'clis':
        if (isMac) {
          const brewPackages = ['git', 'python', 'node', 'supabase/tap/supabase'].filter(pkg => data.some(t => pkg.includes(t)));
          if (brewPackages.length > 0) await $`brew install ${brewPackages}`;
        } else if (isWindows) {
          if (data.includes('git')) await $`winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements`;
          if (data.includes('python')) await $`winget install --id Python.Python.3.11 -e --accept-package-agreements --accept-source-agreements`;
          if (data.includes('node')) await $`winget install --id OpenJS.NodeJS -e --accept-package-agreements --accept-source-agreements`;
        }
        const npmPackages = ['eas-cli', 'orbitprompter', 'tmole'].filter((pkg) => data.includes(pkg));
        if (npmPackages.length > 0) {
          if (npmPackages.includes('orbitprompter')) {
            try {
              await $`npm uninstall -g remoat`;
            } catch (e) {
              // Ignore if not installed
            }
          }
          if (isWindows) {
            await $`npm install -g ${npmPackages}`;
          } else {
            await $`export PATH="$HOME/.npm-global/bin:$PATH" && npm install -g ${npmPackages}`;
          }
        }
        return { status: 'success', message: 'CLIs installed successfully' };
      case 'tmole':
        try {
          if (isWindows) {
            await $`npm install -g tmole`;
          } else {
            await $`export PATH="$HOME/.npm-global/bin:$PATH" && npm install -g tmole`;
          }
          return { status: 'success', message: 'tmole installed (run `tmole http://127.0.0.1:PORT` for public URLs)' };
        } catch (e) {
          return { status: 'error', message: e?.message || String(e) };
        }
      case 'antigravity':
        if (data) {
          try {
            const { url, platformKey } = await resolveAntigravityIdeDownloadUrl(os.platform(), os.arch());
            if (isMac) {
              const dmgPath = path.join(os.tmpdir(), 'Antigravity-IDE.dmg');
              const mountPoint = path.join(os.tmpdir(), 'orbit-antigravity-ide-mount');
              await $`curl -fsSL ${url} -o ${dmgPath}`;
              await fs.mkdir(mountPoint, { recursive: true });
              try {
                await $`hdiutil attach ${dmgPath} -mountpoint ${mountPoint} -nobrowse -quiet`;
                const entries = await fs.readdir(mountPoint);
                const appBundle = entries.find((name) => name.endsWith('.app'));
                if (!appBundle) {
                  throw new Error('Antigravity IDE disk image did not contain a .app bundle');
                }
                await $`cp -R ${path.join(mountPoint, appBundle)} /Applications/`;
              } finally {
                await $`hdiutil detach ${mountPoint} -quiet`.catch(() => {});
              }
              return {
                status: 'success',
                message: `Antigravity IDE installed from ${ANTIGRAVITY_DOWNLOAD_PAGE} (${platformKey})`
              };
            }
            if (isWindows) {
              const tempExe = path.join(os.tmpdir(), 'Antigravity-IDE-setup.exe');
              await $`curl -fsSL ${url} -o ${tempExe}`;
              await $`${tempExe} /S`;
              return {
                status: 'success',
                message: `Antigravity IDE installed from ${ANTIGRAVITY_DOWNLOAD_PAGE} (${platformKey})`
              };
            }
            if (isLinux) {
              const installDir = path.join(homeDir, '.local', 'share', 'antigravity-ide');
              const archive = path.join(os.tmpdir(), 'Antigravity-IDE.tar.gz');
              await $`curl -fsSL ${url} -o ${archive}`;
              await fs.mkdir(installDir, { recursive: true });
              await $`tar -xzf ${archive} -C ${installDir}`;
              return {
                status: 'success',
                message: `Antigravity IDE extracted to ${installDir}. Set ANTIGRAVITY_PATH in .env to the IDE binary (see ${ANTIGRAVITY_DOWNLOAD_PAGE}).`
              };
            }
            return {
              status: 'error',
              message: `Automatic install is not supported on ${os.platform()}. Download Antigravity IDE from ${ANTIGRAVITY_DOWNLOAD_PAGE}.`
            };
          } catch (e) {
            await shell.openExternal(ANTIGRAVITY_DOWNLOAD_PAGE).catch(() => {});
            return {
              status: 'error',
              message: `${e?.message || String(e)} — opened ${ANTIGRAVITY_DOWNLOAD_PAGE} in your browser.`
            };
          }
        }
        return { status: 'success', message: 'Skipped Antigravity IDE install' };
      case 'path':
        if (isWindows) {
          return { status: 'success', message: 'Paths handled by installers on Windows' };
        }
        const rcPath = path.join(homeDir, process.env.SHELL?.includes('zsh') ? '.zshrc' : '.bashrc');
        let contentToAppend = '\n# Orbit additions\n';
        if (isMac) contentToAppend += 'eval "$(/opt/homebrew/bin/brew shellenv)"\n';
        contentToAppend += 'export PATH="$HOME/.npm-global/bin:$PATH"\n';
        await fs.appendFile(rcPath, contentToAppend);
        return { status: 'success', message: 'Paths configured' };
      case 'remoat':
      case 'orbitprompter': {
        const tokenFrom = (d) => String(d?.token ?? d?.telegramBotToken ?? '').trim();
        const emptyPayload =
          !data ||
          (typeof data === 'string' && !data.trim()) ||
          (typeof data === 'object' && !tokenFrom(data));
        if (emptyPayload) {
          return { status: 'success', message: 'Skipped OrbitPrompter linking' };
        }

        let token;
        let allowedCsv;
        let workspaceRaw;
        if (typeof data === 'string') {
          token = data.trim();
          allowedCsv = '';
          workspaceRaw = '';
        } else {
          token = tokenFrom(data);
          allowedCsv = String(data.allowedUserIds ?? '').trim();
          workspaceRaw = String(data.workspaceBaseDir ?? '').trim();
        }

        const allowedUserIds = parseAllowedUserIdsFromCsv(allowedCsv);
        const idErr = validateAllowedUserIds(allowedUserIds);
        if (idErr) {
          return { status: 'error', message: idErr };
        }

        mergeWriteOrbitPrompterConfig({
          telegramBotToken: token,
          allowedUserIds,
          workspaceBaseDir: workspaceRaw || undefined
        });
        return { status: 'success', message: 'OrbitPrompter saved to ~/.remoat/config.json' };
      }
      case 'mcps':
        try {
          const agDir = path.join(homeDir, '.gemini', 'antigravity');
          const mcpConfigPath = path.join(agDir, 'mcp_config.json');
          const mcpConfig = {
            "mcpServers": {
              "github": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-github"]
              },
              "supabase": {
                "command": "npx",
                "args": ["-y", "@supabase/mcp"]
              }
            }
          };
          await fs.ensureDir(agDir);
          fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
          return { status: 'success', message: 'GitHub & Supabase MCPs configured' };
        } catch (e) {
          return { status: 'error', message: 'Failed to configure MCPs: ' + e.message };
        }
      case 'scaffold-workflows': {
        const hint = workspaceHintForScaffold();
        await writeWorkflowScaffoldFiles(hint);
        return {
          status: 'success',
          message: 'Wrote feature.md, submit.md, test.md, project-creator.md to ~/.agents/workflows/'
        };
      }
      case 'scaffold-gemini':
      case 'scaffold-wf-feature':
      case 'scaffold-wf-submit':
      case 'scaffold-wf-test':
      case 'scaffold-wf-project-creator':
        return runScaffoldInstallStep(step);
      case 'scaffold': {
        const hint = workspaceHintForScaffold();
        await writeGeminiScaffoldFile(hint);
        await writeWorkflowScaffoldFiles(hint);
        return { status: 'success', message: 'Agent instructions installed' };
      }
    }
  } catch (error) {
    console.error(error);
    return { status: 'error', message: error.message || error.toString() };
  }
});

// Dashboard Handlers
// ORBIT_START_VIEW (or AG_ORBIT_UI): auto | installer | dashboard
//   auto — open dashboard only if ~/.gemini/.../mcp*.json or ~/.remoat/config*. exists
//   installer — always start on the launch wizard
//   dashboard — always open the dashboard (even without prior install)
ipcMain.handle('get-start-view', () => {
  const raw = String(process.env.ORBIT_START_VIEW || process.env.AG_ORBIT_UI || '')
    .trim()
    .toLowerCase();
  if (raw === 'installer' || raw === 'wizard' || raw === 'setup') return 'installer';
  if (raw === 'dashboard' || raw === 'dash') return 'dashboard';
  return 'auto';
});

function orbitInstallPaths() {
  const agDir = path.join(homeDir, '.gemini', 'antigravity');
  const { dir: orbitDir, configJson, legacyTokenFile } = orbitPrompterPaths(homeDir);
  return {
    mcpJson: path.join(agDir, 'mcp.json'),
    mcpConfigJson: path.join(agDir, 'mcp_config.json'),
    orbitPrompterConfigLegacy: legacyTokenFile,
    orbitPrompterConfigJson: configJson,
    orbitPrompterDir: orbitDir
  };
}

function hasAntigravityMcpConfig(p = orbitInstallPaths()) {
  return fs.existsSync(p.mcpJson) || fs.existsSync(p.mcpConfigJson);
}

function hasOrbitPrompterPersistedConfig(p = orbitInstallPaths()) {
  return fs.existsSync(p.orbitPrompterConfigLegacy) || fs.existsSync(p.orbitPrompterConfigJson);
}

ipcMain.handle('check-is-installed', () => {
  const p = orbitInstallPaths();
  return hasAntigravityMcpConfig(p) || hasOrbitPrompterPersistedConfig(p);
});

ipcMain.handle('dash-install-checks', () => {
  const p = orbitInstallPaths();
  const mcpJsonFile = fs.existsSync(p.mcpJson);
  const mcpConfigJsonFile = fs.existsSync(p.mcpConfigJson);
  const mcpAny = mcpJsonFile || mcpConfigJsonFile;
  const orbitPrompterConfig = hasOrbitPrompterPersistedConfig(p);
  return {
    mcpJsonFile,
    mcpConfigJsonFile,
    mcpAny,
    remoatConfig: orbitPrompterConfig,
    autoDash: mcpAny || orbitPrompterConfig
  };
});

ipcMain.handle('dash-docs-status', () => {
  const catalog = listWorkflows(homeDir);
  return {
    gemini: catalog.gemini.exists,
    feature: catalog.builtins.find((b) => b.id === 'feature')?.exists ?? false,
    submit: catalog.builtins.find((b) => b.id === 'submit')?.exists ?? false,
    test: catalog.builtins.find((b) => b.id === 'test')?.exists ?? false,
    projectCreator: catalog.builtins.find((b) => b.id === 'projectCreator')?.exists ?? false,
    customWorkflowCount: catalog.custom.length
  };
});

ipcMain.handle('dash-brand-icons', () => ({
  git: simpleIconSvg(siGit),
  python: simpleIconSvg(siPython),
  node: simpleIconSvg(siNodedotjs),
  supabase: simpleIconSvg(siSupabase),
  eas: simpleIconSvg(siExpo),
  remoat: simpleIconSvg(siTelegram),
  antigravity: simpleIconSvg(siVisualstudiocode),
  mcp: simpleIconSvg(siJson),
  markdown: simpleIconSvg(siMarkdown)
}));

ipcMain.handle('dash-status', async () => {
  const check = async (cmd) => {
    try {
      await $`which ${cmd}`;
      return true;
    } catch {
      return false;
    }
  };
  const [git, py3, py, node, supabase, eas, tmole, orbitprompter] = await Promise.all([
    check('git'),
    check('python3'),
    check('python'),
    check('node'),
    check('supabase'),
    check('eas'),
    check('tmole'),
    check('orbitprompter')
  ]);
  const antigravity = !!resolveAntigravityInstall(os.platform());
  return {
    git,
    python: py3 || py,
    node,
    supabase,
    eas,
    tmole,
    remoat: orbitprompter,
    antigravity
  };
});

ipcMain.handle('dash-remoat-status', () => isOrbitPrompterBotRunning());

ipcMain.handle('dash-remoat-open', async () => {
  try {
    return await openAntigravityWithCdp(os.platform());
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }
});

ipcMain.handle('dash-remoat-toggle', async () => {
  if (isOrbitPrompterBotRunning()) {
    stopOrbitPrompterBot();
    return { running: false };
  }
  if (!hasOrbitPrompterPersistedConfig()) {
    return {
      running: false,
      ok: false,
      message: 'Save your Telegram bot token and allowed user IDs under Configure first.'
    };
  }
  try {
    const child = spawnOrbitPrompterStart();
    child.unref?.();
    await new Promise((r) => setTimeout(r, 2000));
    if (!isOrbitPrompterBotRunning()) {
      return {
        running: false,
        ok: false,
        message:
          'OrbitPrompter bot did not stay running. Ensure Antigravity IDE is open with CDP (Ignite does this automatically), then check Terminal: orbitprompter doctor'
      };
    }
    return { running: true };
  } catch (e) {
    return { running: false, ok: false, message: e?.message || String(e) };
  }
});

ipcMain.handle('dash-remoat-config', async (event, action, payload) => {
  const { legacyTokenFile } = orbitPrompterPaths(homeDir);
  if (action === 'get') {
    const j = readOrbitPrompterConfigJson();
    let telegramBotToken = String(j.telegramBotToken ?? '').trim();
    if (!telegramBotToken && fs.existsSync(legacyTokenFile)) {
      const content = fs.readFileSync(legacyTokenFile, 'utf8');
      telegramBotToken = content.replace(/^TOKEN=/, '').trim();
    }
    const allowedUserIds = Array.isArray(j.allowedUserIds) ? j.allowedUserIds.join(', ') : '';
    const workspaceBaseDir = String(j.workspaceBaseDir ?? '');
    return { telegramBotToken, allowedUserIds, workspaceBaseDir };
  }
  if (action === 'save' && payload && typeof payload === 'object') {
    const allowedUserIds = parseAllowedUserIdsFromCsv(payload.allowedUserIds);
    const idErr = validateAllowedUserIds(allowedUserIds);
    if (idErr) return { ok: false, message: idErr };
    const telegramBotToken = String(payload.telegramBotToken ?? '').trim();
    if (!telegramBotToken) return { ok: false, message: 'Telegram bot token is required.' };
    mergeWriteOrbitPrompterConfig({
      telegramBotToken,
      allowedUserIds,
      workspaceBaseDir: payload.workspaceBaseDir
    });
    return { ok: true };
  }
  return null;
});

ipcMain.handle('dash-workflows', async (_event, action, payload) => {
  try {
    switch (action) {
      case 'list':
        return { ok: true, ...listWorkflows(homeDir) };
      case 'get': {
        const id = String(payload?.id ?? '');
        const res = getWorkflowContent(homeDir, id);
        return res.ok ? { ok: true, content: res.content } : res;
      }
      case 'save': {
        const id = String(payload?.id ?? '');
        const res = saveWorkflowContent(homeDir, id, String(payload?.content ?? ''));
        return res;
      }
      case 'create': {
        return createWorkflow(homeDir, {
          name: payload?.name,
          description: payload?.description,
          body: payload?.body
        });
      }
      case 'delete': {
        return deleteWorkflow(homeDir, String(payload?.id ?? ''));
      }
      case 'can-delete':
        return {
          ok: true,
          deletable: isWorkflowDeletable(homeDir, String(payload?.id ?? ''))
        };
      default:
        return { ok: false, message: `Unknown action: ${action}` };
    }
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }
});

/** @deprecated Use dash-workflows */
ipcMain.handle('dash-workflow', async (_event, action, type, content) => {
  if (action === 'get') {
    const res = getWorkflowContent(homeDir, type);
    return res.ok ? res.content : '';
  }
  if (action === 'save') {
    const res = saveWorkflowContent(homeDir, type, content);
    return res.ok === true;
  }
});
