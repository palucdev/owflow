import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';

import { forkTask, type ForkTaskInput, type ForkTaskResult } from '../../utils/fork-task.js';

export const ISO_DATE_LENGTH = 10;

export interface ForkWorkspace {
  readonly temporaryDirectory: string;
  readonly taskRoot: string;
}

export interface ForkWorkspaceHarness {
  readonly workspace: () => ForkWorkspace;
  readonly setup: () => void;
  readonly teardown: () => void;
}

const createForkWorkspace = (): ForkWorkspace => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-fork-task-test-'));
  const taskRoot = path.join(temporaryDirectory, '.owflow', 'tasks');
  return { temporaryDirectory, taskRoot };
};

export const createForkWorkspaceHarness = (): ForkWorkspaceHarness => {
  const active: { current?: ForkWorkspace } = {};
  return {
    workspace: (): ForkWorkspace => {
      const workspace = active.current;
      if (workspace === undefined) {
        throw new Error('Fork workspace is only available inside a running test');
      }
      return workspace;
    },
    setup: (): void => {
      active.current = createForkWorkspace();
    },
    teardown: (): void => {
      const workspace = active.current;
      if (workspace !== undefined && fs.existsSync(workspace.temporaryDirectory)) {
        fs.rmSync(workspace.temporaryDirectory, { recursive: true, force: true });
      }
    },
  };
};

const DEFAULT_COMPLETED_PHASES: readonly string[] = [
  'brief-written',
  'plan-created',
  'findings-gathered',
  'synthesis-complete',
  'alternatives-generated',
  'approaches-chosen',
  'design-generated',
  'research-completed',
];

interface OrchestratorSectionOverrides {
  readonly completed?: readonly string[];
  readonly entryPoint?: string;
  // An explicitly passed `options: undefined` omits the key from the section entirely.
  readonly options?: Record<string, unknown>;
}

export interface SourceOrchestratorSection {
  readonly started_phase: string;
  readonly entry_point: string;
  readonly completed_phases: string[];
  readonly failed_phases: string[];
  readonly auto_fix_attempts: Record<string, unknown>;
  readonly created: string;
  readonly updated: string;
  readonly task_path: null;
  readonly task_ids: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export const makeOrchestratorSection = (overrides: OrchestratorSectionOverrides): SourceOrchestratorSection => ({
  started_phase: 'research-completed',
  entry_point: overrides.entryPoint ?? 'research',
  completed_phases: [...(overrides.completed ?? DEFAULT_COMPLETED_PHASES)],
  failed_phases: ['plan-created'],
  auto_fix_attempts: { 'plan-created': 2 },
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
  task_path: JSON.parse('null') as null,
  task_ids: { 'research-plan': 't1' },
  ...(overrides.options !== undefined && { options: overrides.options }),
});

export interface SourceTaskSection {
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly tags: string[];
  readonly priority: string;
}

interface TaskSectionOverrides {
  readonly status?: string;
  readonly title?: string;
}

const makeTaskSection = (overrides: TaskSectionOverrides = {}): SourceTaskSection => ({
  title: overrides.title ?? 'Evaluate caching strategies',
  description: 'Research question',
  status: overrides.status ?? 'completed',
  tags: ['research'],
  priority: 'high',
});

const makePhaseSummaries = (): Record<string, unknown> => ({
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
});

const makeResearchContextSection = (): Record<string, unknown> => ({
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
  phase_summaries: makePhaseSummaries(),
});

const makeResearchOutputsSection = (): Record<string, unknown> => ({
  research_report: 'outputs/research-report.md',
  findings_directory: 'analysis/findings',
  solution_exploration: 'outputs/solution-exploration.md',
  high_level_design: 'outputs/high-level-design.md',
  decision_log: 'outputs/decision-log.md',
  synthesis: 'analysis/synthesis.md',
});

export interface SourceTaskState {
  orchestrator: SourceOrchestratorSection;
  task: SourceTaskSection;
  research_context: Record<string, unknown>;
  research_outputs: Record<string, unknown>;
}

interface SourceTaskStateOverrides {
  readonly completed?: readonly string[];
  readonly status?: string;
  readonly orchestrator?: SourceOrchestratorSection;
}

export const makeSourceTaskState = (overrides: SourceTaskStateOverrides = {}): SourceTaskState => ({
  orchestrator: overrides.orchestrator ?? makeOrchestratorSection({ completed: overrides.completed, options: {} }),
  task: makeTaskSection({ status: overrides.status }),
  research_context: makeResearchContextSection(),
  research_outputs: makeResearchOutputsSection(),
});

export interface ForkStateView {
  orchestrator: {
    completed_phases: string[];
    started_phase: string | null;
    task_path: string;
    entry_point: string;
    options: {
      spec_audit_enabled?: boolean;
      fork_information: {
        intent?: string;
        forked_from: string;
        fork_point: string;
        forked_at: string;
      };
    };
  };
  task: { status: string; title: string };
  research_context: { phase_summaries: { converge: { decision_areas: unknown[] } } };
  research_outputs: { synthesis: string };
}

export const writeState = (directory: string, state: SourceTaskState): void => {
  fs.mkdirSync(path.dirname(path.join(directory, 'orchestrator-state.yml')), { recursive: true });
  fs.writeFileSync(path.join(directory, 'orchestrator-state.yml'), yaml.stringify(state), 'utf8');
};

export const createSourceTask = (workspace: ForkWorkspace, state: SourceTaskState): string => {
  const source = path.join(workspace.taskRoot, 'research', '2026-01-01-source-task');
  fs.mkdirSync(source, { recursive: true });
  writeState(source, state);
  fs.mkdirSync(path.join(source, 'planning'), { recursive: true });
  fs.writeFileSync(path.join(source, 'planning', 'research-brief.md'), 'brief', 'utf8');
  fs.writeFileSync(path.join(source, 'planning', 'research-plan.md'), 'plan', 'utf8');
  fs.writeFileSync(path.join(source, 'planning', 'sources.md'), 'sources', 'utf8');
  fs.mkdirSync(path.join(source, 'analysis', 'findings'), { recursive: true });
  fs.writeFileSync(path.join(source, 'analysis', 'findings', 'codebase-cache.md'), 'f', 'utf8');
  fs.writeFileSync(path.join(source, 'analysis', 'synthesis.md'), 's', 'utf8');
  fs.mkdirSync(path.join(source, 'outputs'), { recursive: true });
  fs.writeFileSync(path.join(source, 'outputs', 'research-report.md'), 'r', 'utf8');
  fs.writeFileSync(path.join(source, 'outputs', 'solution-exploration.md'), 'se', 'utf8');
  fs.writeFileSync(path.join(source, 'outputs', 'high-level-design.md'), 'hld', 'utf8');
  fs.writeFileSync(path.join(source, 'outputs', 'decision-log.md'), 'dl', 'utf8');
  fs.writeFileSync(path.join(source, 'stray-notes.txt'), 'junk', 'utf8');
  return source;
};

export const readForkState = (forkPath: string): ForkStateView =>
  yaml.parse(fs.readFileSync(path.join(forkPath, 'orchestrator-state.yml'), 'utf8')) as ForkStateView;

export const forkFromSource = (workspace: ForkWorkspace, overrides: Partial<ForkTaskInput> = {}): ForkTaskResult =>
  forkTask({
    taskRoot: path.join('.owflow', 'tasks'),
    source: '2026-01-01-source-task',
    slug: 'fork-cache-alternative',
    from: 'synthesis-complete',
    cwd: workspace.temporaryDirectory,
    ...overrides,
  });
