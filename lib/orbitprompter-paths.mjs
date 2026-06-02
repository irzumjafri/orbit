/**
 * Paths for OrbitPrompter CLI (fork of Remoat).
 * The CLI still reads/writes ~/.remoat/ — not ~/.orbitprompter/.
 */

import fs from 'node:fs';
import path from 'node:path';

const CONFIG_DIR_NAME = '.remoat';

/** @param {string} homeDir */
export function orbitPrompterPaths(homeDir) {
  const dir = path.join(homeDir, CONFIG_DIR_NAME);
  return {
    dir,
    configJson: path.join(dir, 'config.json'),
    botLockFile: path.join(dir, '.bot.lock'),
    /** Legacy remoat setup: plain file with `TOKEN=...` */
    legacyTokenFile: path.join(dir, 'token')
  };
}

/** @param {string} homeDir */
export function ensureOrbitPrompterConfigDir(homeDir) {
  fs.mkdirSync(orbitPrompterPaths(homeDir).dir, { recursive: true });
}
