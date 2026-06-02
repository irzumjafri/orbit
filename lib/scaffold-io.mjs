import { fs } from 'zx';
import path from 'path';

export function formatScaffoldPermissionError(homeDir, filePath) {
  const rel = filePath.startsWith(homeDir) ? `~${filePath.slice(homeDir.length)}` : filePath;
  return (
    `Permission denied writing ${rel}. Existing files may be owned by root (often after running the CLI with sudo). ` +
    'Fix in Terminal: sudo chown -R "$(whoami)" ~/.agents ~/.gemini'
  );
}

/** Write scaffold files as the current user; replace root-owned files when the parent dir is writable. */
export async function writeUserScaffoldFile(homeDir, filePath, content) {
  await fs.ensureDir(path.dirname(filePath));
  try {
    await fs.writeFile(filePath, content, 'utf8');
    return;
  } catch (err) {
    if (err?.code !== 'EACCES' && err?.code !== 'EPERM') throw err;
  }
  try {
    if (await fs.pathExists(filePath)) {
      await fs.unlink(filePath);
    }
    await fs.writeFile(filePath, content, 'utf8');
  } catch {
    throw new Error(formatScaffoldPermissionError(homeDir, filePath));
  }
}
