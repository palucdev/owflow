import { describe, expect, spyOn, test } from 'bun:test';
import matter from 'gray-matter';
import fs from 'node:fs';
import path from 'node:path';
import * as commandsConfig from '../../configuration/commands-config.js';
import { configureCommands } from '../../configuration/commands-config.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';
import { PLUGIN_ROOT } from '../../utils/plugin-info.js';
import * as fileUtility from '../../utils/file-utility.js';
import { asMarkdownFiles, createSkillEntries, createSkillEntry } from './commands-config-test-helpers.js';

const CRLF = '\r\n';
const EXPECTED_RENDERED_LINE_COUNT = 5;
const NAME_SPLIT_PART_COUNT = 3;
const NON_STRING_DESCRIPTION = 2026;
const LINE_BREAK_PREFIX_LENGTH = 1;

const FRONTMATTER = {
  name: 'owflow:dev-spec',
  description: 'Controlled description for the digestion tests.',
  'user-invocable': true,
};

const EXPECTED_LINES = [
  'CRITICAL INSTRUCTION: You MUST invoke the owflow:dev-spec skill immediately as your FIRST action.',
  '',
  'Use the Skill tool with these exact parameters:',
  'name: "owflow:dev-spec"',
  'prompt: "$ARGUMENTS"',
];

const renderCommand = (): string =>
  commandsConfig.renderCommandTemplate(FRONTMATTER as unknown as Parameters<typeof commandsConfig.renderCommandTemplate>[0]);

describe('renderCommandTemplate', () => {
  test('should never transform or strip the owflow prefix of the name slot', () => {
    const rendered = renderCommand();

    expect(rendered.split(FRONTMATTER.name)).toHaveLength(NAME_SPLIT_PART_COUNT);
    expect(rendered).not.toContain('name: "dev-spec"');
    expect(rendered).not.toContain('invoke the dev-spec skill');
  });

  test('should emit exactly the five expected lines with no leading or trailing newline', () => {
    const rendered = renderCommand();

    expect(rendered).toBe(EXPECTED_LINES.join(CRLF));
    expect(rendered.split(CRLF)).toHaveLength(EXPECTED_RENDERED_LINE_COUNT);
    expect(rendered.slice(0, LINE_BREAK_PREFIX_LENGTH)).not.toBe(CRLF);
    expect(rendered.endsWith(CRLF)).toBe(false);
  });
});

const skillsDirectory = path.join(PLUGIN_ROOT, 'skills');

const readSkill = (slug: string) => {
  const raw = fs.readFileSync(path.join(skillsDirectory, slug, 'SKILL.md'), 'utf8');
  return { slug, raw, data: matter(raw).data };
};

const allSkills = fs
  .readdirSync(skillsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted((first, second) => first.localeCompare(second))
  .map((slug) => readSkill(slug));

describe('invocable skill frontmatter', () => {
  test.each(allSkills.map((skill) => skill.slug))('should declare a prefixed name and a boolean user-invocable flag in %s', (slug) => {
    const { data } = readSkill(slug);
    const name = data['name'] as string;

    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
    expect(name.startsWith('owflow:')).toBe(true);
    expect(typeof data['user-invocable']).toBe('boolean');
  });
});

describe('synthesized command contract', () => {
  test('should register a command carrying only the template and the description', () => {
    const staticSpy = spyOn(fileUtility, 'loadMarkdownDir').mockReturnValue(asMarkdownFiles([]));
    const readerSpy = spyOn(commandsConfig, 'readSkillFrontmatter').mockReturnValue([
      createSkillEntry('dev-plan', {
        'user-invocable': true,
        name: 'owflow:dev-plan',
        description: 'Plan phase.',
        'argument-hint': '[task description]',
        agent: 'custom-agent',
        model: 'gpt-4',
        subtask: 'true',
      }),
    ]);

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);
      const registered = config.command['owflow:dev-plan']!;

      expect(Object.keys(registered).toSorted((first, second) => first.localeCompare(second))).toEqual(['description', 'template']);
      expect(registered.description).toBe('Plan phase.');
    } finally {
      readerSpy.mockRestore();
      staticSpy.mockRestore();
    }
  });
});

describe('synthesized command validation', () => {
  test('should name every missing required key when a skill breaks the contract', () => {
    const readerSpy = spyOn(commandsConfig, 'readSkillFrontmatter').mockReturnValue([createSkillEntry('dev-spec', { 'user-invocable': true })]);

    try {
      expect(() => configureCommands({} as OpenCodeConfig)).toThrow(
        "Skill 'dev-spec' is user-invocable but is missing required frontmatter: name, description",
      );
    } finally {
      readerSpy.mockRestore();
    }
  });

  test('should report a non-string required value as a missing key', () => {
    const readerSpy = spyOn(commandsConfig, 'readSkillFrontmatter').mockReturnValue([
      createSkillEntry('dev-spec', {
        'user-invocable': true,
        name: 'owflow:dev-spec',
        description: NON_STRING_DESCRIPTION,
      }),
    ]);

    try {
      expect(() => configureCommands({} as OpenCodeConfig)).toThrow('missing required frontmatter: description');
    } finally {
      readerSpy.mockRestore();
    }
  });

  test('should treat an empty required value as a missing key', () => {
    const readerSpy = spyOn(commandsConfig, 'readSkillFrontmatter').mockReturnValue(
      createSkillEntries([{ slug: 'dev-spec', data: { 'user-invocable': true, name: 'owflow:dev-spec', description: '' } }]),
    );

    try {
      expect(() => configureCommands({} as OpenCodeConfig)).toThrow('missing required frontmatter: description');
    } finally {
      readerSpy.mockRestore();
    }
  });
});

describe('reader failure classes', () => {
  test('should throw when the skills directory cannot be listed', () => {
    const readdirSpy = spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory, scandir 'owflow/skills'");
    });

    try {
      expect(() => commandsConfig.readSkillFrontmatter()).toThrow('ENOENT');
    } finally {
      readdirSpy.mockRestore();
    }
  });

  test('should throw when a SKILL.md cannot be read', () => {
    const readdirSpy = spyOn(fs, 'readdirSync').mockReturnValue([{ name: 'dev-spec', isDirectory: () => true }] as unknown as ReturnType<
      typeof fs.readdirSync
    >);
    const doesFileExistSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    const readFileSpy = spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error("EACCES: permission denied, open 'dev-spec/SKILL.md'");
    });

    try {
      expect(() => commandsConfig.readSkillFrontmatter()).toThrow('EACCES');
    } finally {
      readFileSpy.mockRestore();
      doesFileExistSpy.mockRestore();
      readdirSpy.mockRestore();
    }
  });
});

describe('reader parsing and skip behavior', () => {
  test('should throw when a SKILL.md carries unparseable frontmatter', () => {
    const readdirSpy = spyOn(fs, 'readdirSync').mockReturnValue([{ name: 'dev-spec', isDirectory: () => true }] as unknown as ReturnType<
      typeof fs.readdirSync
    >);
    const doesFileExistSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    const readFileSpy = spyOn(fs, 'readFileSync').mockReturnValue('---\nname: "owflow:dev-spec"\nargument-hint: [unclosed\n---\n\nbody');

    try {
      expect(() => commandsConfig.readSkillFrontmatter()).toThrow();
    } finally {
      readFileSpy.mockRestore();
      doesFileExistSpy.mockRestore();
      readdirSpy.mockRestore();
    }
  });

  test('should skip only the entries with no SKILL.md and read the rest', () => {
    const skillsDirectory = path.join(PLUGIN_ROOT, 'skills');
    const skillFile = path.join(skillsDirectory, 'dev-spec', 'SKILL.md');
    // A file entry is given a resolvable SKILL.md path too, so only the
    // is-directory guard can skip it — otherwise the existsSync guard below
    // would hide that branch.
    const fileEntryPath = path.join(skillsDirectory, 'notes.md', 'SKILL.md');
    // Captured before the spy so the surviving entry is parsed from the real
    // file rather than a fabricated frontmatter.
    const realReadFileSync = fs.readFileSync;
    const readdirSpy = spyOn(fs, 'readdirSync').mockReturnValue([
      { name: 'assets', isDirectory: () => true },
      { name: 'notes.md', isDirectory: () => false },
      { name: 'dev-spec', isDirectory: () => true },
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    const doesFileExistSpy = spyOn(fs, 'existsSync').mockImplementation(
      ((target: string) => target === skillFile || target === fileEntryPath) as unknown as typeof fs.existsSync,
    );
    const readFileSpy = spyOn(fs, 'readFileSync').mockImplementation(((target: string, encoding: BufferEncoding) =>
      realReadFileSync(target, encoding)) as unknown as typeof fs.readFileSync);

    try {
      const skills = commandsConfig.readSkillFrontmatter();

      expect(skills).toHaveLength(1);
      expect(skills[0]!.slug).toBe('dev-spec');
      expect(skills[0]!.data.name).toBe('owflow:dev-spec');
      expect(skills[0]!.data['user-invocable']).toBe(true);
    } finally {
      readFileSpy.mockRestore();
      doesFileExistSpy.mockRestore();
      readdirSpy.mockRestore();
    }
  });
});
