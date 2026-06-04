/**
 * Send Telegram messages via Bot API (no OrbitPrompter bot process required).
 */

import https from 'node:https';

/**
 * @param {{ token: string, userIds: string[], text: string }} opts
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function sendTelegramNotifications({ token, userIds, text }) {
  const botToken = String(token ?? '').trim();
  const ids = (userIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  if (!botToken) return { ok: false, message: 'Telegram bot token missing' };
  if (!ids.length) return { ok: false, message: 'No allowed Telegram user IDs' };
  const body = String(text ?? '').trim();
  if (!body) return { ok: false, message: 'Empty message' };

  const errors = [];
  for (const chatId of ids) {
    try {
      await postTelegramMessage(botToken, chatId, body);
    } catch (e) {
      errors.push(`${chatId}: ${e?.message || String(e)}`);
    }
  }
  if (errors.length === ids.length) {
    return { ok: false, message: errors.join('; ') };
  }
  return { ok: true };
}

/**
 * @param {string} token
 * @param {string} chatId
 * @param {string} text
 */
function postTelegramMessage(token, chatId, text) {
  const payload = JSON.stringify({ chat_id: chatId, text });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 15000
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.ok) resolve(j);
            else reject(new Error(j.description || `HTTP ${res.statusCode}`));
          } catch {
            reject(new Error(data || `HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Telegram API timeout'));
    });
    req.write(payload);
    req.end();
  });
}
