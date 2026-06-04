/**
 * Read/write Antigravity workflow markdown under ~/.agents/workflows/
 * and global GEMINI.md.
 */

import fs from 'node:fs';
import path from 'node:path';

export const BUILTIN_WORKFLOW_FILES = {
  feature: 'feature.md',
  submit: 'submit.md',
  test: 'test.md',
  projectCreator: 'project-creator.md',
  autoRun: 'auto-run.md'
};

const RESERVED_SLUGS = new Set([
  'gemini',
  'feature',
  'submit',
  'test',
  'project-creator',
  'projectcreator',
  'auto-run',
  'autorun',
  ...Object.values(BUILTIN_WORKFLOW_FILES).map((f) => f.replace(/\.md$/, ''))
]);

const DEFAULT_CUSTOM_BODY = `# New workflow

Describe what Antigravity should do when the user runs this slash command.

1. First step
2. Second step
3. Finish with a short summary for the user
`;

/** @param {string} homeDir */
export function workflowsDir(homeDir) {
  return path.join(homeDir, '.agents', 'workflows');
}

/** @param {string} homeDir */
export function geminiMdPath(homeDir) {
  return path.join(homeDir, '.gemini', 'GEMINI.md');
}

/** @param {string} raw */
export function sanitizeWorkflowSlug(raw) {
  let s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) return null;
  if (s.length > 64) s = s.slice(0, 64);
  if (RESERVED_SLUGS.has(s)) return null;
  return s;
}

/** @param {string} s */
function yamlSafeString(s) {
  const t = String(s ?? '').trim();
  if (!t) return '""';
  if (/[\n:#"'&*!?>|@[\]{},]/.test(t)) return JSON.stringify(t);
  return t;
}

/** @param {string} homeDir @param {string} workflowId */
export function resolveWorkflowPath(homeDir, workflowId) {
  if (workflowId === 'gemini') return geminiMdPath(homeDir);
  if (workflowId in BUILTIN_WORKFLOW_FILES) {
    return path.join(workflowsDir(homeDir), BUILTIN_WORKFLOW_FILES[workflowId]);
  }
  if (workflowId.startsWith('custom:')) {
    const slug = workflowId.slice('custom:'.length);
    if (!slug || sanitizeWorkflowSlug(slug) !== slug) return null;
    return path.join(workflowsDir(homeDir), `${slug}.md`);
  }
  return null;
}

/** @param {string} homeDir */
export function isWorkflowDeletable(homeDir, workflowId) {
  return workflowId.startsWith('custom:') && !!resolveWorkflowPath(homeDir, workflowId);
}

/** @param {string} filePath */
function readDescriptionFromMd(filePath) {
  if (!fs.existsSync(filePath)) return '';
  const head = fs.readFileSync(filePath, 'utf8').slice(0, 800);
  const m = head.match(/^---\s*\n[\s\S]*?\ndescription:\s*(.+)\n[\s\S]*?^---/m);
  if (!m) return '';
  let d = m[1].trim();
  if ((d.startsWith('"') && d.endsWith('"')) || (d.startsWith("'") && d.endsWith("'"))) {
    try {
      d = JSON.parse(d.startsWith('"') ? d : `"${d.replace(/'/g, "\\'")}"`);
    } catch {
      d = d.slice(1, -1);
    }
  }
  return d;
}

/** @param {string} homeDir */
export function listWorkflows(homeDir) {
  const dir = workflowsDir(homeDir);
  const builtinFiles = new Set(Object.values(BUILTIN_WORKFLOW_FILES));

  const builtins = Object.entries(BUILTIN_WORKFLOW_FILES).map(([id, file]) => {
    const filePath = path.join(dir, file);
    return {
      id,
      kind: 'builtin',
      file,
      label: file,
      slash: `/${file.replace(/\.md$/, '')}`,
      description: readDescriptionFromMd(filePath),
      exists: fs.existsSync(filePath)
    };
  });

  let custom = [];
  if (fs.existsSync(dir)) {
    custom = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md') && !builtinFiles.has(e.name))
      .map((e) => {
        const slug = e.name.replace(/\.md$/, '');
        const filePath = path.join(dir, e.name);
        return {
          id: `custom:${slug}`,
          kind: 'custom',
          file: e.name,
          label: e.name,
          slash: `/${slug}`,
          description: readDescriptionFromMd(filePath),
          exists: true
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  return {
    gemini: {
      id: 'gemini',
      kind: 'gemini',
      file: 'GEMINI.md',
      label: 'GEMINI.md',
      slash: null,
      description: 'Global rules (all workspaces)',
      exists: fs.existsSync(geminiMdPath(homeDir))
    },
    builtins,
    custom
  };
}

/** @param {string} homeDir @param {string} workflowId */
export function getWorkflowContent(homeDir, workflowId) {
  const filePath = resolveWorkflowPath(homeDir, workflowId);
  if (!filePath) return { ok: false, message: 'Unknown workflow.' };
  if (!fs.existsSync(filePath)) return { ok: true, content: '' };
  return { ok: true, content: fs.readFileSync(filePath, 'utf8') };
}

/** @param {string} homeDir @param {string} workflowId @param {string} content */
export function saveWorkflowContent(homeDir, workflowId, content) {
  const filePath = resolveWorkflowPath(homeDir, workflowId);
  if (!filePath) return { ok: false, message: 'Unknown workflow.' };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return { ok: true };
}

/** @param {string} homeDir @param {{ name: string, description?: string, body?: string }} opts */
export function createWorkflow(homeDir, { name, description, body }) {
  const slug = sanitizeWorkflowSlug(name);
  if (!slug) {
    return {
      ok: false,
      message:
        'Invalid name. Use letters and numbers (e.g. deploy-staging). Reserved: feature, submit, test, project-creator, gemini.'
    };
  }

  const dir = workflowsDir(homeDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${slug}.md`);
  if (fs.existsSync(filePath)) {
    return { ok: false, message: `Workflow "${slug}.md" already exists.` };
  }

  const desc = String(description ?? '').trim() || `/${slug} workflow`;
  const mainBody = String(body ?? '').trim() || DEFAULT_CUSTOM_BODY;
  const content = `---\ndescription: ${yamlSafeString(desc)}\n---\n\n${mainBody}\n`;

  fs.writeFileSync(filePath, content);
  return { ok: true, id: `custom:${slug}`, slug, file: `${slug}.md` };
}

/** @param {string} homeDir @param {string} workflowId */
export function deleteWorkflow(homeDir, workflowId) {
  if (!isWorkflowDeletable(homeDir, workflowId)) {
    return { ok: false, message: 'Only custom workflows can be deleted.' };
  }
  const filePath = resolveWorkflowPath(homeDir, workflowId);
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, message: 'Workflow file not found.' };
  }
  fs.unlinkSync(filePath);
  return { ok: true };
}
