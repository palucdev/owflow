import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { forkTask, type ForkTaskInput, type ForkTaskResult } from '../../utils/fork-task.js';

const ISO_DATE_LENGTH = 10;
const trackedWorkspaces: string[] = [];

const DEFAULT_COMPLETED_PHASES = [
  'brief-written',
  'plan-created',
  'findings-gathered',
  'synthesis-complete',
  'alternatives-generated',
  'approaches-chosen',
  'design-generated',
  'research-completed',
];

export interface ForkWorkspace {
  readonly root: string;
  readonly taskRoot: string;
}

export interface BaseStateOptions {
  readonly completed?: readonly string[];
  readonly status?: string;
  readonly title?: string;
  readonly entryPoint?: string;
}

export interface ForkStateDocument {
  readonly orchestrator: {
    readonly completed_phases: string[];
    readonly started_phase: unknown;
    readonly task_path: string;
    readonly entry_point: string;
    readonly options: {
      readonly spec_audit_enabled?: boolean;
      readonly fork_information: {
        readonly forked_from: string;
        readonly fork_point: string;
        readonly forked_at: string;
        readonly intent?: string;
      };
    };
  };
  readonly task: { readonly status: string; readonly title: string };
  readonly research_context: {
    readonly phase_summaries: {
      readonly converge: { readonly decision_areas: readonly unknown[] };
    };
  };
  readonly research_outputs: { readonly synthesis: string };
}

export const createForkWorkspace = (): ForkWorkspace => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-fork-test-'));
  trackedWorkspaces.push(root);
  return { root, taskRoot: path.join(root, '.owflow', 'tasks') };
};

export const cleanupForkWorkspaces = (): void => {
  for (const workspace of trackedWorkspaces.splice(0)) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
};

const createResearchContext = () => ({
  research_type: 'mixed',
  research_question: 'Which cache invalidation approach fits our API?',
  scope: { included: ['api'], excluded: [], constraints: [] },
  methodology: ['benchmark-driven'],
  sources: ['src/**'],
  confidence_level: 'medium',
  gathering_strategy: {
    categories: ['codebase', 'docs'],
    count: 2,
    source: 'planner',
  },
  project_doc_paths: [],
  phase_summaries: {
    plan: { summary: 'planned', steps_completed: [] },
    gather: { summary: 'gathered' },
    synthesize: { summary: 'synthesized' },
    brainstorm: { summary: 'brainstormed' },
    converge: {
      summary: 'converged',
      decision_areas: [{ area: 'cache-topology', chosen_approach: 'write-through' }],
      deferred_ideas: ['ttl-tuning'],
    },
    design: { summary: 'designed', architecture_style: 'layered', decisions_count: 3 },
  },
});

const createBaseState = (options: BaseStateOptions = {}) => ({
  orchestrator: {
    started_phase: 'research-completed',
    entry_point: options.entryPoint ?? 'research',
    completed_phases: [...(options.completed ?? DEFAULT_COMPLETED_PHASES)],
    failed_phases: ['plan-created'],
    auto_fix_attempts: { 'plan-created': 2 },
    options: {},
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    task_ids: { 'research-plan': 't1' },
  },
  task: {
    title: options.title ?? 'Evaluate caching strategies',
    description: 'Research question',
    status: options.status ?? 'completed',
    tags: ['research'],
    priority: 'high',
  },
  research_context: createResearchContext(),
  research_outputs: {
    research_report: 'outputs/research-report.md',
    findings_directory: 'analysis/findings',
    solution_exploration: 'outputs/solution-exploration.md',
    high_level_design: 'outputs/high-level-design.md',
    decision_log: 'outputs/decision-log.md',
    synthesis: 'analysis/synthesis.md',
  },
});

export const writeState = (directory: string, state: unknown): void => {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'orchestrator-state.yml'), yaml.stringify(state), 'utf8');
};

export const createSourceTask = (workspace: ForkWorkspace, state: unknown = createBaseState()): string => {
  const sourceDirectory = path.join(workspace.taskRoot, 'research', '2026-01-01-source-task');
  writeState(sourceDirectory, state);
  fs.mkdirSync(path.join(sourceDirectory, 'planning'), { recursive: true });
  fs.writeFileSync(path.join(sourceDirectory, 'planning', 'research-brief.md'), 'brief', 'utf8');
  fs.writeFileSync(path.join(sourceDirectory, 'planning', 'research-plan.md'), 'plan', 'utf8');
  fs.writeFileSync(path.join(sourceDirectory, 'planning', 'sources.md'), 'sources', 'utf8');
  fs.mkdirSync(path.join(sourceDirectory, 'analysis', 'findings'), { recursive: true });
  fs.writeFileSync(path.join(sourceDirectory, 'analysis', 'findings', 'codebase-cache.md'), 'f', 'utf8');
  fs.writeFileSync(path.join(sourceDirectory, 'analysis', 'synthesis.md'), 's', 'utf8');
  fs.mkdirSync(path.join(sourceDirectory, 'outputs'), { recursive: true });
  fs.writeFileSync(path.join(sourceDirectory, 'outputs', 'research-report.md'), 'r', 'utf8');
  fs.writeFileSync(path.join(sourceDirectory, 'outputs', 'solution-exploration.md'), 'se', 'utf8');
  fs.writeFileSync(path.join(sourceDirectory, 'outputs', 'high-level-design.md'), 'hld', 'utf8');
  fs.writeFileSync(path.join(sourceDirectory, 'outputs', 'decision-log.md'), 'dl', 'utf8');
  fs.writeFileSync(path.join(sourceDirectory, 'stray-notes.txt'), 'junk', 'utf8');
  return sourceDirectory;
};

export const createBaseStateWith = (options: BaseStateOptions = {}): unknown => createBaseState(options);

export const forkInWorkspace = (workspace: ForkWorkspace, overrides: Partial<ForkTaskInput> = {}): ForkTaskResult =>
  forkTask({
    taskRoot: '.owflow/tasks',
    source: '2026-01-01-source-task',
    slug: 'fork-cache-alternative',
    from: 'synthesis-complete',
    cwd: workspace.root,
    ...overrides,
  });

export const readForkState = (forkPath: string): ForkStateDocument =>
  yaml.parse(fs.readFileSync(path.join(forkPath, 'orchestrator-state.yml'), 'utf8')) as ForkStateDocument;

export const prefixDate = (slug: string): string => `${new Date().toISOString().slice(0, ISO_DATE_LENGTH)}-${slug}`;

export const sourceDirectoryOf = (workspace: ForkWorkspace): string => path.join(workspace.taskRoot, 'research', '2026-01-01-source-task');

export const createBaseStateWithOptions = (options: Record<string, unknown>, stateOptions: BaseStateOptions = {}): unknown => {
  const state = createBaseState(stateOptions);
  state.orchestrator.options = options;
  return state;
};

export const createBaseStateWithoutOptions = (stateOptions: BaseStateOptions = {}): unknown => {
  const state = createBaseState(stateOptions);
  Reflect.deleteProperty(state.orchestrator, 'options');
  return state;
};
