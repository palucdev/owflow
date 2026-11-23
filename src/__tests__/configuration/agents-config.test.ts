import { describe, expect, spyOn, test } from 'bun:test';
import { configureAgents } from '../../configuration/agents-config.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';
import * as fileUtil from '../../utils/file-utility.js';

describe('configureAgents', () => {
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

    const spy = spyOn(fileUtil, 'loadMarkdownDir').mockReturnValue([
      {
        data: { name: 'existing-agent', description: 'should be ignored' },
        content: 'new prompt',
      },
      {
        data: { name: 'new-agent', description: 'new agent desc' },
        content: 'new agent prompt',
      },
    ] as any);

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
    const spy = spyOn(fileUtil, 'loadMarkdownDir').mockReturnValue([
      {
        data: { description: 'No name agent' },
        content: 'Prompt without name',
      },
    ] as any);

    try {
      const config = {} as OpenCodeConfig;
      configureAgents(config);

      expect(Object.keys(config.agent).length).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  test('should parse agent metadata including description, mode, skills array, and hidden flag', () => {
    const mockMarkdownFiles = [
      {
        data: {
          name: 'agent-full',
          description: 'Full agent description',
          mode: 'subtask',
          skills: ['skill-1', 'skill-2'],
          hidden: 'true',
          model: 'gpt-4o',
        },
        content: 'Agent full prompt',
      },
      {
        data: {
          name: 'agent-minimal',
          hidden: 'false',
          skills: 'not-an-array', // Non-array skills should be ignored
        },
        content: 'Minimal prompt',
      },
    ];

    const spy = spyOn(fileUtil, 'loadMarkdownDir').mockReturnValue(mockMarkdownFiles as any);

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

  test('should catch and log error if prepareAgent throws', () => {
    let accessCount = 0;
    const faultyMarkdown = {
      get data() {
        accessCount++;
        if (accessCount === 1) return { name: 'faulty-agent' };
        throw new Error('Second access error');
      },
      content: 'Faulty content',
    };

    const spy = spyOn(fileUtil, 'loadMarkdownDir').mockReturnValue([faultyMarkdown] as any);
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
