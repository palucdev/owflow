import { describe, expect, spyOn, test } from 'bun:test';
import { configureAgents } from '../../configuration/agents-config.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';
import * as fileUtility from '../../utils/file-utility.js';

type MarkdownFiles = ReturnType<typeof fileUtility.loadMarkdownDir>;

const markdownFile = (data: Record<string, unknown>, content: string): Record<string, unknown> => ({
  data,
  content,
});

const asMarkdownFiles = (files: readonly Record<string, unknown>[]): MarkdownFiles => files as unknown as MarkdownFiles;

const loadMarkdownSpy = () => spyOn(fileUtility, 'loadMarkdownDir');

describe('configureAgents initialization', () => {
  test('should initialize config.agent object when agent is undefined', () => {
    const config = {} as OpenCodeConfig;
    configureAgents(config);

    expect(config.agent).toBeDefined();
    expect(typeof config.agent).toBe('object');
  });

  test('should populate config.agent with markdown files from agents directory', () => {
    const config = {} as OpenCodeConfig;
    configureAgents(config);

    expect(Object.keys(config.agent).length).toBeGreaterThan(0);
  });
});

describe('configureAgents user precedence', () => {
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

    const spy = loadMarkdownSpy().mockReturnValue(
      asMarkdownFiles([
        markdownFile({ name: 'existing-agent', description: 'should be ignored' }, 'new prompt'),
        markdownFile({ name: 'new-agent', description: 'new agent desc' }, 'new agent prompt'),
      ]),
    );

    try {
      configureAgents(config);

      expect(config.agent['existing-agent']).toEqual(customAgent);
      expect(config.agent['new-agent']).toEqual({
        prompt: 'new agent prompt',
        description: 'new agent desc',
      });
    } finally {
      spy.mockRestore();
    }
  });

  test('should skip markdown files missing a name field', () => {
    const spy = loadMarkdownSpy().mockReturnValue(asMarkdownFiles([markdownFile({ description: 'No name agent' }, 'Prompt without name')]));

    try {
      const config = {} as OpenCodeConfig;
      configureAgents(config);

      expect(Object.keys(config.agent)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('configureAgents metadata mapping', () => {
  test('should parse agent metadata including description, mode, skills array, and hidden flag', () => {
    const markdownFiles = [
      markdownFile(
        {
          name: 'agent-full',
          description: 'Full agent description',
          mode: 'subtask',
          skills: ['skill-1', 'skill-2'],
          hidden: 'true',
          model: 'gpt-4o',
        },
        'Agent full prompt',
      ),
      markdownFile(
        {
          name: 'agent-minimal',
          hidden: 'false',
          skills: 'not-an-array',
        },
        'Minimal prompt',
      ),
    ];

    const spy = loadMarkdownSpy().mockReturnValue(asMarkdownFiles(markdownFiles));

    try {
      const config = {} as OpenCodeConfig;
      configureAgents(config);

      expect(config.agent['agent-full']).toEqual({
        prompt: 'Agent full prompt',
        description: 'Full agent description',
        mode: 'subtask',
        skills: ['skill-1', 'skill-2'],
        hidden: true,
        model: 'gpt-4o',
      });

      expect(config.agent['agent-minimal']).toEqual({
        prompt: 'Minimal prompt',
      });
    } finally {
      spy.mockRestore();
    }
  });
});

describe('configureAgents error isolation', () => {
  test('should catch and log error if prepareAgent throws', () => {
    let accessCount = 0;
    const faultyMarkdown = {
      get data() {
        accessCount += 1;
        if (accessCount === 1) return { name: 'faulty-agent' };
        throw new Error('Second access error');
      },
      content: 'Faulty content',
    };

    const spy = loadMarkdownSpy().mockReturnValue(asMarkdownFiles([faultyMarkdown]));
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
