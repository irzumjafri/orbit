/**
 * Shared copy for ~/.gemini/GEMINI.md and ~/.agents/workflows/*.md
 * (used by electron/main.js install scaffold step).
 */

import path from 'node:path';

export const WORKSPACE_HINT_FALLBACK =
  'Use the absolute path in the `workspaceBaseDir` field of `~/.remoat/config.json` as the parent directory for every new project folder and for every `git clone`. Never assume a path like `~/Development/personal` unless that file explicitly contains it.';

/** @param {string} homeDir @param {string} raw */
export function expandWorkspaceBaseDir(homeDir, raw) {
  const d = String(raw ?? '').trim();
  if (!d) return path.join(homeDir, 'Code');
  if (d === '~') return homeDir;
  if (d.startsWith('~/')) return path.join(homeDir, d.slice(2));
  return path.resolve(d);
}

const PROJECT_CREATOR_RULES = `You are a project assistant. Use **only** the workspace root stated above for new folders and clones (no other base path).

### On a new project request
1. Create a new directory under that workspace root using exactly the name the user provides.
2. Run \`git init\` and scaffold the project for the framework or tools they ask for (dependencies, conventional layout, README as appropriate).
3. Create a GitHub repository using the **GitHub MCP**, push the initial commit, and set \`origin\`.
4. Give the user **only** the link to the new repository.
5. Do **not** include long plans or extra detail. **Always** tell the user to go to the **General** channel in Telegram and **start a new topic** there to control the project (OrbitPrompter).

### When the user wants an existing repository
1. Use the GitHub MCP to **list their repositories**, find the one they mean, and \`git clone\` it into the workspace root (sibling to other projects).
2. Same closing instruction: **General** channel → **new topic** in Telegram for project control.`;

/** @param {{ workspaceHintLine: string }} opts */
export function buildGeminiMarkdown({ workspaceHintLine }) {
  return `
# Global Mobile Workflow Rules
## Branching Strategy
- NEVER code on main. Always create a branch: feat/ or fix/.
- Use atomic commits with descriptive messages.

## Build & Delivery
- After coding, offer a build immediately.
- For RN: eas build --platform android --profile development --local
- For Flutter: flutter build apk --debug
- Share: npx serve + tmole OR curl transfer.sh
- For phone testing, prefer the **/test** workflow (\`~/.agents/workflows/test.md\`).

## Pull Requests
- Only create a PR when I say "Submit" or "Looks good."

## Project creator (ProjectFactory)

${workspaceHintLine}

${PROJECT_CREATOR_RULES}

_Shorter checklist file: \`~/.agents/workflows/project-creator.md\`._
`.trim();
}

export function buildFeatureMd() {
  return `
# Feature Workflow
1. Branch from main (feat/feature-name)
2. Implement code.
3. Build locally (eas build --local / flutter build apk).
4. Share build using curl to transfer.sh.
`.trim();
}

export function buildSubmitMd() {
  return `
# Submit Workflow
1. Commit changes.
2. Push branch.
3. Create PR.
`.trim();
}

export function buildTestMd() {
  return `---
description: Build for phone testing — web via tmole URL, mobile via tmole APK download link
---

# Test / share on phone

When the user runs **/test** or asks to try the app on their phone, detect the stack, build, expose a **public HTTPS link with tmole**, and return **only** the link(s) they need (no long plans).

## 1. Detect project type

Inspect the repo root (\`package.json\`, \`pubspec.yaml\`, \`app.json\` / \`app.config.*\`, \`next.config.*\`, etc.):

| Signals | Type |
|--------|------|
| \`pubspec.yaml\` + Flutter SDK | **Flutter** |
| \`react-native\`, Expo, or \`eas.json\` | **React Native** |
| Next.js, Vite, CRA, static site, or web \`dev\`/\`build\`/\`start\` scripts | **Web** |

If unclear, ask one short question; otherwise pick the best match.

## 2. Web applications

Goal: **production build** running locally, then a **tmole** URL the user opens on their phone.

1. Install deps if needed (\`npm install\`, \`pnpm install\`, etc.).
2. Run the **production** build (examples):
   - \`npm run build\` then \`npm run start\` (Next.js and many SSR apps)
   - \`npm run build\` then \`npm run preview\` (Vite — note preview port, often **4173**)
   - \`npm run build\` and serve the output folder with \`npx serve -s dist\` or \`npx serve -s out\` (static/SPA)
3. Confirm the app responds on \`http://127.0.0.1:<PORT>\` (use the port from logs; default **3000** or **4173** if unknown).
4. Expose it with tmole (install once if missing: \`npm install -g tmole\`):
   \`\`\`bash
   tmole http://127.0.0.1:<PORT>
   \`\`\`
   Or: \`npx tmole http://127.0.0.1:<PORT>\`
5. Reply with the **tmole HTTPS URL** and one line: “Open this on your phone to test the production build.”
6. Leave the server and tmole running unless the user asks to stop them.

**Do not** use dev mode (\`npm run dev\`) unless production build/start is impossible; prefer production-like output.

## 3. Flutter (mobile)

Goal: **APK** the user can install on Android, delivered via a **download link**.

1. From the project root: \`flutter pub get\` if needed.
2. Build a installable APK:
   \`\`\`bash
   flutter build apk --release
   \`\`\`
   (Use \`flutter build apk --debug\` only if release fails or the user asked for a faster debug build.)
3. APK path (default): \`build/app/outputs/flutter-apk/app-release.apk\` (or \`app-debug.apk\` for debug).
4. Serve the APK over HTTP on localhost, then tmole it:
   \`\`\`bash
   cd build/app/outputs/flutter-apk
   npx serve -p 8787 .
   tmole http://127.0.0.1:8787
   \`\`\`
5. Give the user the **tmole HTTPS URL** plus the direct path to the APK on that server (e.g. \`…/app-release.apk\`) so they can tap **Download** on their phone and install (enable “Install unknown apps” if prompted).

## 4. React Native (Expo / EAS)

Goal: **Android APK** + **tmole download link**.

1. Prefer a **local** dev APK when possible:
   \`\`\`bash
   eas build --platform android --profile development --local
   \`\`\`
   (Or \`npx expo run:android --variant release\` for bare workflow when EAS is not configured.)
2. Locate the generated \`.apk\` under the project (e.g. EAS output path printed in the terminal).
3. Serve the folder containing the APK and run tmole (same pattern as Flutter, port **8787** or any free port):
   \`\`\`bash
   npx serve -p 8787 /path/to/apk-directory
   tmole http://127.0.0.1:8787
   \`\`\`
4. Return the **tmole HTTPS URL** and filename so the user can download and install on Android.

For **iOS**, say clearly that tmole APK links are Android-only; offer TestFlight or a local simulator run if they need iOS.

## 5. Fallbacks

- If **tmole** is unavailable or errors: upload the APK with \`curl --upload-file ./app.apk https://transfer.sh/app.apk\` and return that URL; for web, \`npx serve\` + transfer.sh is acceptable.
- If the build fails, show the **last 30 lines** of build output and one concrete fix—do not guess.

## 6. Response format

Keep the final message short:

- **Web:** tmole URL only (+ port note if helpful).
- **Mobile:** tmole URL + APK filename + “tap download on your phone to install.”
`.trim();
}

/** @param {{ workspaceHintLine: string }} opts */
export function buildProjectCreatorMd({ workspaceHintLine }) {
  return `
# Project creator (ProjectFactory)

_Same rules are in \`~/.gemini/GEMINI.md\` under **Project creator (ProjectFactory)**._

${workspaceHintLine}

${PROJECT_CREATOR_RULES}
`.trim();
}
