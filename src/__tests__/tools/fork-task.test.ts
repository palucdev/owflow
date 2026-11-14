import { describe, expect, test, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';
import { fork_task } from '../../tools/fork-task.js';

interface ToolResult {
  readonly output: string;
}

interface ForkState {
  readonly orchestrator: {
    readonly completed_phases: string[];
    readonly options: { readonly fork_information?: { readonly intent?: string } };
  };
  readonly task: { readonly status: string; readonly title: string };
}

const ISO_DATE_LENGTH = 10;
const FORK_SLUG = 'diverge-cache-choice';
const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-fork-tool-test-'));
  temporaryDirectories.push(directory);
  return directory;
};

const createForkStateDocument = () => ({
  orchestrator: {
    entry_point: 'research',
    completed_phases: ['brief-written', 'plan-created', 'synthesis-complete'],
    failed_phases: [],
    auto_fix_attempts: {},
    options: {},
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    task_ids: {},
  },
  task: {
    title: 'Title',
    status: 'completed',
    tags: [],
  },
  research_context: {
    research_type: 'mixed',
    research_question: 'Q?',
    scope: { included: [], excluded: [], constraints: [] },
    methodology: [],
    sources: [],
    confidence_level: 'medium',
    gathering_strategy: { categories: [], count: 0, source: 'default' },
    project_doc_paths: [],
    phase_summaries: {
      plan: { steps_completed: [] },
      converge: { decision_areas: [], deferred_ideas: [] },
      design: { decisions_count: 0 },
    },
  },
  research_outputs: {
    research_report: 'outputs/research-report.md',
  },
});

const createSourceTask = (temporaryDirectory: string): string => {
  const source = path.join(temporaryDirectory, '.owflow', 'tasks', 'research', '2026-01-01-source-task');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'orchestrator-state.yml'), yaml.stringify(createForkStateDocument()), 'utf8');
  fs.writeFileSync(path.join(source, 'keep-me.md'), 'x', 'utf8');
  fs.mkdirSync(path.join(source, 'analysis'), { recursive: true });
  fs.writeFileSync(path.join(source, 'analysis', 'synthesis.md'), 's', 'utf8');
  return source;
};

const executeForkTool = async (parameters: Record<string, string>, directory: string): Promise<ToolResult> => {
  const result = await fork_task.execute(parameters as never, { directory } as never);
  if (typeof result === 'string') {
    throw new TypeError(`expected a tool output object, got: ${result}`);
  }
  return result as ToolResult;
};

const forkDirectoryPath = (temporaryDirectory: string): string =>
  path.join(temporaryDirectory, '.owflow', 'tasks', 'research', `${new Date().toISOString().slice(0, ISO_DATE_LENGTH)}-${FORK_SLUG}`);

const expectVerbatimCopy = (forkDirectory: string): void => {
  expect(fs.existsSync(forkDirectory)).toBe(true);
  // verbatim copy — including the post-fork-point artifact
  expect(fs.existsSync(path.join(forkDirectory, 'keep-me.md'))).toBe(true);
  expect(fs.existsSync(path.join(forkDirectory, 'analysis', 'synthesis.md'))).toBe(true);
};

const expectTrimmedState = (forkDirectory: string): void => {
  const state = readForkState(forkDirectory);
  expect(state.orchestrator.completed_phases).toEqual(['brief-written', 'plan-created']);
  expect(state.task.status).toBe('in_progress');
  expect(state.task.title).toContain('(fork of 2026-01-01-source-task)');
};

const readForkState = (forkDirectory: string): ForkState =>
  yaml.parse(fs.readFileSync(path.join(forkDirectory, 'orchestrator-state.yml'), 'utf8')) as ForkState;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('fork_task tool', () => {
  test('creates the fork with a verbatim copy and trimmed state', async () => {
    const temporaryDirectory = createTemporaryDirectory();
    createSourceTask(temporaryDirectory);
    const result = await executeForkTool(
      {
        taskRoot: '.owflow/tasks',
        source: '2026-01-01-source-task',
        slug: FORK_SLUG,
        from: 'plan-created',
      },
      temporaryDirectory,
    );

    expect(result.output).toContain('FORK CREATED');
    expect(result.output).toContain('Fork point: plan-created');

    const forkDirectory = forkDirectoryPath(temporaryDirectory);
    expectVerbatimCopy(forkDirectory);
    expectTrimmedState(forkDirectory);
  });
});

describe('fork_task option forwarding and errors', () => {
  test('passes the optional intent through to the fork state and output', async () => {
    const temporaryDirectory = createTemporaryDirectory();
    createSourceTask(temporaryDirectory);
    const result = await executeForkTool(
      {
        taskRoot: '.owflow/tasks',
        source: '2026-01-01-source-task',
        slug: FORK_SLUG,
        from: 'plan-created',
        intent: 're-synthesis from a different angle',
      },
      temporaryDirectory,
    );

    expect(result.output).toContain('Intent: re-synthesis from a different angle');

    const forkDirectory = forkDirectoryPath(temporaryDirectory);
    const state = readForkState(forkDirectory);
    expect(state.orchestrator.options.fork_information?.intent).toBe('re-synthesis from a different angle');
  });

  test('reports tool errors as output instead of throwing', async () => {
    const temporaryDirectory = createTemporaryDirectory();
    createSourceTask(temporaryDirectory);
    const invalidName = await executeForkTool(
      {
        taskRoot: '.owflow/tasks',
        source: '2026-01-01-source-task',
        slug: 'Bad Slug',
        from: 'plan-created',
      },
      temporaryDirectory,
    );
    expect(invalidName.output).toContain('INVALID_NAME');

    const badStep = await executeForkTool(
      {
        taskRoot: '.owflow/tasks',
        source: '2026-01-01-source-task',
        slug: FORK_SLUG,
        from: 'research-completed',
      },
      temporaryDirectory,
    );
    expect(badStep.output).toContain('UNKNOWN_STEP');
  });
});
