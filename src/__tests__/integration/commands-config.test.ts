import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import * as commandsConfig from '../../configuration/commands-config.js';
import { configureCommands } from '../../configuration/commands-config.js';
import { PLUGIN_ROOT } from '../../utils/plugin-info.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';

const EXPECTED_TOTAL_COMMANDS = 52;
const EXPECTED_INVOCABLE_SKILLS = 46;

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

describe('command registration on disk', () => {
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

  test('should register one command per invocable skill alongside the maintained commands', () => {
    const config = {} as OpenCodeConfig;
    configureCommands(config);

    expect(Object.keys(config.command)).toHaveLength(EXPECTED_TOTAL_COMMANDS);

    // Both totals fall out of disk state: one wrapper per invocable skill on
    // top of the maintained command files.
    const invocableSkills = commandsConfig.readSkillFrontmatter().filter((entry) => entry.data['user-invocable'] === true);
    expect(invocableSkills).toHaveLength(EXPECTED_INVOCABLE_SKILLS);
  });

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

describe('skill frontmatter on disk', () => {
  test('should declare a prefixed name and a boolean user-invocable flag in every skill', () => {
    for (const { data } of commandsConfig.readSkillFrontmatter()) {
      const name = data.name;

      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
      expect(name.startsWith('owflow:')).toBe(true);
      expect(typeof data['user-invocable']).toBe('boolean');
    }
  });

  test('should hand the palette a description free of trailing whitespace', () => {
    // The folded scalar the trim exists for still parses with a trailing newline.
    const { data } = matter(fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'agents-md-generator', 'SKILL.md'), 'utf8'));
    const config = {} as OpenCodeConfig;

    configureCommands(config);

    const registered = config.command['owflow:agents-md-generator']!;

    expect(registered.description).toBe(data.description.trimEnd());
    expect(registered.description).not.toMatch(/\s$/);
    expect(data.description).toMatch(/\s$/);
  });
});
