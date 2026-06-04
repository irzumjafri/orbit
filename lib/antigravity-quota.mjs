/**
 * Fetch Antigravity language-server model quotas (shared by dashboard + auto runner).
 */

import { $ } from 'zx';
import os from 'node:os';

/**
 * @returns {Promise<{ ok: boolean, models?: Array<{ label: string, modelId: string, percentage: number, resetTime: string }>, message?: string }>}
 */
export async function fetchAntigravityQuotas() {
  try {
    const platform = os.platform();
    let stdout = '';
    if (platform === 'darwin' || platform === 'linux') {
      const res = await $`pgrep -fl language_server`.catch(() => ({ stdout: '' }));
      stdout = res.stdout;
    } else if (platform === 'win32') {
      const res =
        await $`wmic process where "name='language_server.exe' or name='language_server_windows_amd64.exe'" get commandline,processid`.catch(
          () => ({ stdout: '' })
        );
      stdout = res.stdout;
    }

    let pid = null;
    let csrfToken = null;
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes('--csrf_token')) {
        if (platform === 'win32') {
          const tokenMatch = line.match(/--csrf_token[=\s]+([a-zA-Z0-9\-]+)/);
          const pidMatch = line.match(/(\d+)\s*$/);
          if (tokenMatch && tokenMatch[1] && pidMatch) {
            pid = parseInt(pidMatch[1], 10);
            csrfToken = tokenMatch[1];
            break;
          }
        } else {
          const parts = line.trim().split(/\s+/);
          const parsedPid = parseInt(parts[0], 10);
          const cmd = line.substring(parts[0].length).trim();
          const tokenMatch = cmd.match(/--csrf_token[=\s]+([a-zA-Z0-9\-]+)/);
          if (parsedPid && tokenMatch && tokenMatch[1]) {
            if (line.includes('extensions/antigravity') || !pid) {
              pid = parsedPid;
              csrfToken = tokenMatch[1];
            }
          }
        }
      }
    }

    if (!pid || !csrfToken) {
      return { ok: false, message: 'Antigravity language server not running' };
    }

    let ports = [];
    if (platform === 'darwin' || platform === 'linux') {
      const { stdout: lsofOut } = await $`lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid}`.catch(() => ({ stdout: '' }));
      const regex = new RegExp(
        `^\\S+\\s+${pid}\\s+.*?(?:TCP|UDP)\\s+(?:\\*|[\\d.]+|\\[[\\da-f:]+\\]):(\\d+)\\s+\\(LISTEN\\)`,
        'gim'
      );
      let match;
      while ((match = regex.exec(lsofOut)) !== null) {
        const port = parseInt(match[1], 10);
        if (!ports.includes(port)) ports.push(port);
      }
    } else if (platform === 'win32') {
      const { stdout: netstatOut } = await $`netstat -ano`.catch(() => ({ stdout: '' }));
      for (const line of netstatOut.split('\n')) {
        if (line.includes('LISTENING') && line.includes(String(pid))) {
          const parts = line.trim().split(/\s+/);
          const addr = parts[1];
          const portMatch = addr.match(/:(\d+)$/);
          if (portMatch) {
            const port = parseInt(portMatch[1], 10);
            if (!ports.includes(port)) ports.push(port);
          }
        }
      }
    }

    if (ports.length === 0) {
      return { ok: false, message: 'No listening ports found for language server' };
    }

    const https = await import('node:https');
    for (const port of ports) {
      try {
        const data = await new Promise((resolve, reject) => {
          const payload = JSON.stringify({
            metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' }
          });
          const options = {
            hostname: '127.0.0.1',
            port,
            path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              'Connect-Protocol-Version': '1',
              'X-Codeium-Csrf-Token': csrfToken
            },
            rejectUnauthorized: false,
            timeout: 1000
          };
          const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              if (res.statusCode !== 200) reject(new Error(`HTTP ${res.statusCode}`));
              else resolve(body);
            });
          });
          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('timeout'));
          });
          req.write(payload);
          req.end();
        });

        const parsed = JSON.parse(data);
        const configs = parsed?.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
        const models = configs.map((c) => {
          const label = c.label || c.displayName || c.modelName || '';
          const modelId = c.modelOrAlias?.model || '';
          const qi = c.quotaInfo || {};
          const remainingFraction = parseFloat(qi.remainingFraction ?? qi.remaining ?? 1);
          return {
            label,
            modelId,
            percentage: Math.round(remainingFraction * 100),
            resetTime: qi.resetTime || ''
          };
        });
        return { ok: true, models };
      } catch {
        // try next port
      }
    }
    return { ok: false, message: 'Failed to query language server' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
