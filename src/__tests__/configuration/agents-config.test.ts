import { describe, expect, spyOn, test } from 'bun:test';
import matter from 'gray-matter';
import { configureAgents } from '../../configuration/agents-config.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';
import * as fileUtility from '../../utils/file-utility.js';

const markdownFile = (data: Record<string, unknown>, content: string) => ({ data, content }) as unknown as matter.GrayMatterFile<string>;

const agentMetadataFiles = () => [
  markdownFile(
    { name: 'agent-full', description: 'Full agent description', mode: 'subtask', skills: ['skill-1', 'skill-2'], hidden: 'true', model: 'gpt-4o' },
    'Agent full prompt',
  ),
  // Non-array skills should be ignored
  markdownFile({ name: 'agent-minimal', hidden: 'false', skills: 'not-an-array' }, 'Minimal prompt'),
];

const agentMetadataExpectation = {
  prompt: 'Agent full prompt',
  description: 'Full agent description',
  mode: 'subtask',
  skills: ['skill-1', 'skill-2'],
  hidden: true,
  model: 'gpt-4o',
};

// The second data access throws, exercising the registration loop's error path.
const faultyAgentMarkdown = () => {
  let accessCount = 0;
  return {
    get data() {
      accessCount++;
      if (accessCount === 1) return { name: 'faulty-agent' };
      throw new Error('Second access error');
    },
    content: 'Faulty content',
  } as unknown as matter.GrayMatterFile<string>;
};

describe('configureAgents basics', () => {
  test('should initialize config.agent object when agent is undefined', () => {
    const config = {} as OpenCodeConfig;
    configureAgents(config);

    expect(config.agent).toBeDefined();
    expect(typeof config.agent).toBe('object');
  });

  test('should populate config.agent with markdown files from agents directory', () => {
    const config = {} as OpenCodeConfig;
    configureAgents(config);

    // Real agents directory should load some agents
    expect(Object.keys(config.agent).length).toBeGreaterThan(0);
  });
});

describe('configureAgents overwrite and skip rules', () => {
  test('should not overwrite existing agent definitions configured by user', () => {
    const customAgent = {
      prompt: 'custom agent prompt',
      description: 'custom description',
    };
    const config = {
      agent: {
        'existing-agent': customAgent,
      },
    } as unknown as OpenCodeConfig;
    const markdownFiles = [
      markdownFile({ name: 'existing-agent', description: 'should be ignored' }, 'new prompt'),
      markdownFile({ name: 'new-agent', description: 'new agent desc' }, 'new agent prompt'),
    ];

    const spy = spyOn(fileUtility, 'loadMarkdownDir').mockReturnValue(markdownFiles);

    try {
      configureAgents(config);

      expect(config.agent['existing-agent']).toEqual(customAgent);
      expect(config.agent['new-agent']).toEqual({ prompt: 'new agent prompt', description: 'new agent desc' });
    } finally {
      spy.mockRestore();
    }
  });

  test('should skip markdown files missing a name field', () => {
    const markdownFiles = [markdownFile({ description: 'No name agent' }, 'Prompt without name')];
    const spy = spyOn(fileUtility, 'loadMarkdownDir').mockReturnValue(markdownFiles);

    try {
      const config = {} as OpenCodeConfig;
      configureAgents(config);

      expect(Object.keys(config.agent)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('configureAgents metadata and error path', () => {
  test('should parse agent metadata including description, mode, skills array, and hidden flag', () => {
    const spy = spyOn(fileUtility, 'loadMarkdownDir').mockReturnValue(agentMetadataFiles());

    try {
      const config = {} as OpenCodeConfig;
      configureAgents(config);

      expect(config.agent['agent-full']).toEqual(agentMetadataExpectation);
      expect(config.agent['agent-minimal']).toEqual({ prompt: 'Minimal prompt' });
    } finally {
      spy.mockRestore();
    }
  });

  test('should catch and log error if prepareAgent throws', () => {
    const spy = spyOn(fileUtility, 'loadMarkdownDir').mockReturnValue([faultyAgentMarkdown()]);
    const consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const config = {} as OpenCodeConfig;
      configureAgents(config);

      expect(config.agent['faulty-agent']).toBeUndefined();
      expect(consoleWarnSpy).toHaveBeenCalledWith("[owflow] Failed to register agent 'faulty-agent': Second access error");
    } finally {
      spy.mockRestore();
      consoleWarnSpy.mockRestore();
    }
  });
});
