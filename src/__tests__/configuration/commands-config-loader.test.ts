import { describe, expect, spyOn, test } from 'bun:test';
import matter from 'gray-matter';
import fs from 'node:fs';
import path from 'node:path';
import * as commandsConfig from '../../configuration/commands-config.js';
import { configureCommands } from '../../configuration/commands-config.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';
import { PLUGIN_ROOT } from '../../utils/plugin-info.js';
import * as fileUtility from '../../utils/file-utility.js';
import { asMarkdownFiles, createMarkdownFile, createSkillEntries, createSkillEntry } from './commands-config-test-helpers.js';

const EXPECTED_TOTAL_COMMAND_COUNT = 52;
const EXPECTED_INVOCABLE_SKILL_COUNT = 46;

const STATIC_COMMAND_NAMES = [
  'owflow:work',
  'owflow:reviews-code',
  'owflow:reviews-pragmatic',
  'owflow:reviews-production-readiness',
  'owflow:reviews-reality-check',
  'owflow:reviews-spec-audit',
];

const INTERNAL_ENGINE_NAMES = [
  'owflow:codebase-analyzer',
  'owflow:docs-manager',
  'owflow:implementation-plan-executor',
  'owflow:implementation-verifier',
  'owflow:orchestrator-framework',
];

describe('configureCommands user precedence', () => {
  test('should not overwrite a maintained content command the user configured', () => {
    const customCommand = {
      template: 'custom template content',
      description: 'custom user description',
    };
    const config = {
      command: {
        'owflow:work': customCommand,
      },
    } as unknown as OpenCodeConfig;

    configureCommands(config);

    expect(config.command['owflow:work']).toEqual(customCommand);
    expect(config.command['owflow:dev-bugfix']).toBeDefined();
  });

  test('should not overwrite existing command definitions configured by user during synthesis', () => {
    const customCommand = {
      template: 'custom template content',
      description: 'custom user description',
    };
    const config = {
      command: {
        'owflow:dev-spec': customCommand,
      },
    } as unknown as OpenCodeConfig;

    // The static directory is stubbed out so only synthesis can register the
    // sibling command the assertion below inspects.
    const spy = spyOn(fileUtility, 'loadMarkdownDir').mockReturnValue(asMarkdownFiles([]));

    try {
      configureCommands(config);

      expect(config.command['owflow:dev-spec']).toEqual(customCommand);
      expect(config.command['owflow:dev-plan']!.template).toContain('name: "owflow:dev-plan"');
    } finally {
      spy.mockRestore();
    }
  });
});

const expectParsedCommands = (config: OpenCodeConfig): void => {
  expect(config.command['cmd-full']).toEqual({
    template: 'Template for cmd-full',
    description: 'Full command description',
    agent: 'custom-agent',
    model: 'gpt-4',
    subtask: true,
  });

  expect(config.command['cmd-subtask-false']).toEqual({
    template: 'Template for cmd-subtask-false',
    description: 'Subtask false command',
    subtask: false,
  });

  expect(config.command['undefined']).toBeUndefined();
};

describe('configureCommands metadata mapping', () => {
  test('should correctly parse frontmatter attributes including description, agent, model, and subtask boolean', () => {
    const markdownFiles = [
      createMarkdownFile(
        {
          name: 'cmd-full',
          description: 'Full command description',
          agent: 'custom-agent',
          model: 'gpt-4',
          subtask: 'true',
        },
        'Template for cmd-full',
      ),
      createMarkdownFile(
        {
          name: 'cmd-subtask-false',
          description: 'Subtask false command',
          subtask: 'false',
        },
        'Template for cmd-subtask-false',
      ),
      createMarkdownFile(
        {
          description: 'No name command',
        },
        'Template for no-name',
      ),
    ];

    const spy = spyOn(fileUtility, 'loadMarkdownDir').mockReturnValue(asMarkdownFiles(markdownFiles));
    const skillSpy = spyOn(commandsConfig, 'readSkillFrontmatter').mockReturnValue([]);

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);
      expectParsedCommands(config);
    } finally {
      spy.mockRestore();
      skillSpy.mockRestore();
    }
  });
});

describe('skill command registration', () => {
  test('should register a command for an invocable skill and none for an internal engine', () => {
    const staticSpy = spyOn(fileUtility, 'loadMarkdownDir').mockReturnValue(asMarkdownFiles([]));
    const readerSpy = spyOn(commandsConfig, 'readSkillFrontmatter').mockReturnValue(
      createSkillEntries([
        { slug: 'dev-plan', data: { 'user-invocable': true, name: 'owflow:dev-plan', description: 'Plan phase.' } },
        { slug: 'docs-manager', data: { 'user-invocable': false, name: 'owflow:docs-manager', description: 'Internal engine.' } },
      ]),
    );

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);

      expect(config.command['owflow:dev-plan']!.template).toContain('name: "owflow:dev-plan"');
      expect(config.command['owflow:docs-manager']).toBeUndefined();
    } finally {
      readerSpy.mockRestore();
      staticSpy.mockRestore();
    }
  });

  test('should not treat a string user-invocable value as the boolean flag', () => {
    const staticSpy = spyOn(fileUtility, 'loadMarkdownDir').mockReturnValue(asMarkdownFiles([]));
    const readerSpy = spyOn(commandsConfig, 'readSkillFrontmatter').mockReturnValue([
      createSkillEntry('dev-plan', { 'user-invocable': 'true', name: 'owflow:dev-plan', description: 'Plan phase.' }),
    ]);

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);

      expect(config.command['owflow:dev-plan']).toBeUndefined();
    } finally {
      readerSpy.mockRestore();
      staticSpy.mockRestore();
    }
  });
});

describe('synthesized and maintained command precedence', () => {
  test('should let a maintained command win over a synthesized one with the same name', () => {
    const staticBody = 'The maintained body for the colliding name.';
    const staticSpy = spyOn(fileUtility, 'loadMarkdownDir').mockReturnValue(
      asMarkdownFiles([createMarkdownFile({ name: 'owflow:dev-plan' }, staticBody)]),
    );
    const readerSpy = spyOn(commandsConfig, 'readSkillFrontmatter').mockReturnValue([
      createSkillEntry('dev-plan', { 'user-invocable': true, name: 'owflow:dev-plan', description: 'Plan phase.' }),
    ]);

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);

      expect(config.command['owflow:dev-plan']!.template).toBe(staticBody);
    } finally {
      readerSpy.mockRestore();
      staticSpy.mockRestore();
    }
  });
});

describe('skill command totals', () => {
  test('should register one command per invocable skill alongside the six maintained commands', () => {
    const config = {} as OpenCodeConfig;
    configureCommands(config);

    expect(Object.keys(config.command)).toHaveLength(EXPECTED_TOTAL_COMMAND_COUNT);

    // Both totals fall out of disk state: one wrapper per invocable skill on
    // top of the maintained command files.
    const invocableSkills = commandsConfig.readSkillFrontmatter().filter((entry) => entry.data['user-invocable'] === true);
    expect(invocableSkills).toHaveLength(EXPECTED_INVOCABLE_SKILL_COUNT);
  });
});

describe('maintained command registration', () => {
  test('should register the six static content commands and no internal engine', () => {
    const config = {} as OpenCodeConfig;
    configureCommands(config);

    for (const name of STATIC_COMMAND_NAMES) {
      expect(config.command[name]).toBeDefined();
      expect(config.command[name]!.template).toBeDefined();
    }
    for (const name of INTERNAL_ENGINE_NAMES) {
      expect(config.command[name]).toBeUndefined();
    }
  });
});

describe('skill command description hygiene', () => {
  test('should hand the palette a description free of trailing whitespace', () => {
    const skillFile = path.join(PLUGIN_ROOT, 'skills', 'agents-md-generator', 'SKILL.md');
    const { data } = matter(fs.readFileSync(skillFile, 'utf8'));
    const staticSpy = spyOn(fileUtility, 'loadMarkdownDir').mockReturnValue(asMarkdownFiles([]));
    const readerSpy = spyOn(commandsConfig, 'readSkillFrontmatter').mockReturnValue([createSkillEntry('agents-md-generator', data)]);

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);
      const registered = config.command['owflow:agents-md-generator']!;

      expect(registered.description).toBe(String(data['description']).trimEnd());
      expect(registered.description).not.toMatch(/\s$/);
      // The folded scalar the trim exists for still parses with a trailing newline.
      expect(data['description']).toMatch(/\s$/);
    } finally {
      readerSpy.mockRestore();
      staticSpy.mockRestore();
    }
  });
});
