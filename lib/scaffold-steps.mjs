/** Install-step definitions for workflow and GEMINI scaffolding (GUI progress). */

export const WORKFLOW_SCAFFOLD_STEPS = [
  {
    id: 'scaffold-wf-feature',
    label: 'Writing feature.md',
    successMessage: 'Saved ~/.agents/workflows/feature.md'
  },
  {
    id: 'scaffold-wf-submit',
    label: 'Writing submit.md',
    successMessage: 'Saved ~/.agents/workflows/submit.md'
  },
  {
    id: 'scaffold-wf-test',
    label: 'Writing test.md',
    successMessage: 'Saved ~/.agents/workflows/test.md'
  },
  {
    id: 'scaffold-wf-project-creator',
    label: 'Writing project-creator.md',
    successMessage: 'Saved ~/.agents/workflows/project-creator.md'
  }
];

export const GEMINI_SCAFFOLD_STEP = {
  id: 'scaffold-gemini',
  label: 'Writing GEMINI.md',
  successMessage: 'Saved ~/.gemini/GEMINI.md'
};
