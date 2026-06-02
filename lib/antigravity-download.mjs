/**
 * Resolve Antigravity IDE installer URLs from https://antigravity.google/download
 * (same source as the official download page — not GitHub releases).
 */

import os from 'node:os';

export const ANTIGRAVITY_DOWNLOAD_PAGE = 'https://antigravity.google/download';

/** @typedef {'darwin-arm' | 'darwin-x64' | 'windows-x64' | 'windows-arm64' | 'linux-x64' | 'linux-arm'} AntigravityIdePlatformKey */

/**
 * @param {string} platform
 * @param {string} [arch]
 * @returns {AntigravityIdePlatformKey | null}
 */
export function antigravityIdePlatformKey(platform = os.platform(), arch = os.arch()) {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm' : 'darwin-x64';
  }
  if (platform === 'win32') {
    return arch === 'arm64' ? 'windows-arm64' : 'windows-x64';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'linux-arm' : 'linux-x64';
  }
  return null;
}

/**
 * @param {string} html
 * @param {string} pageUrl
 */
export function mainBundleJsUrlFromHtml(html, pageUrl = ANTIGRAVITY_DOWNLOAD_PAGE) {
  const matches = [...html.matchAll(/(?:src|href)="([^"]*main-[^"]+\.js)"/g)];
  if (!matches.length) {
    throw new Error('Could not find Antigravity download bundle on antigravity.google/download');
  }
  return new URL(matches[matches.length - 1][1], pageUrl).href;
}

/**
 * @param {string} bundleJs
 * @returns {string[]}
 */
export function parseAntigravityIdeDownloadUrls(bundleJs) {
  const start = bundleJs.indexOf('id:"antigravity-ide"');
  const end = bundleJs.indexOf('},{name:"download",id:"antigravity-sdk"', start);
  if (start === -1 || end === -1) {
    throw new Error('Could not find Antigravity IDE downloads in official bundle');
  }
  const section = bundleJs.slice(start, end);
  return [...section.matchAll(/href:"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * @param {string[]} urls
 * @param {AntigravityIdePlatformKey} platformKey
 */
export function pickIdeDownloadUrl(urls, platformKey) {
  const match = urls.find((u) => u.includes(`/${platformKey}/`));
  if (!match) {
    throw new Error(`No Antigravity IDE download for ${platformKey} on antigravity.google/download`);
  }
  return match;
}

/**
 * @param {string} [platform]
 * @param {string} [arch]
 * @returns {Promise<{ url: string, platformKey: AntigravityIdePlatformKey, downloadPage: string }>}
 */
export async function resolveAntigravityIdeDownloadUrl(
  platform = os.platform(),
  arch = os.arch()
) {
  const platformKey = antigravityIdePlatformKey(platform, arch);
  if (!platformKey) {
    throw new Error(`Unsupported platform for Antigravity IDE install: ${platform}`);
  }

  const pageRes = await fetch(ANTIGRAVITY_DOWNLOAD_PAGE, {
    headers: { 'Accept-Encoding': 'gzip, deflate, br' }
  });
  if (!pageRes.ok) {
    throw new Error(`Failed to load ${ANTIGRAVITY_DOWNLOAD_PAGE} (${pageRes.status})`);
  }
  const html = await pageRes.text();
  const bundleUrl = mainBundleJsUrlFromHtml(html);

  const bundleRes = await fetch(bundleUrl);
  if (!bundleRes.ok) {
    throw new Error(`Failed to load Antigravity download metadata (${bundleRes.status})`);
  }
  const bundleJs = await bundleRes.text();
  const urls = parseAntigravityIdeDownloadUrls(bundleJs);
  const url = pickIdeDownloadUrl(urls, platformKey);

  return { url, platformKey, downloadPage: ANTIGRAVITY_DOWNLOAD_PAGE };
}
