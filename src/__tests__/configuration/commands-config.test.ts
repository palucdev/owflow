import { describe, expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import * as commandsConfig from '../../configuration/commands-config.js';
import { configureCommands, renderCommandTemplate } from '../../configuration/commands-config.js';
import type { SkillFrontmatter, SkillFrontmatterEntry } from '../../configuration/commands-config.js';
import { PLUGIN_ROOT } from '../../utils/plugin-info.js';
import type { OpenCodeConfig } from '../../types/opencode-types.js';
import * as fileUtility from '../../utils/file-utility.js';

interface RestorableSpy {
  mockRestore(): void;
}

const markdownFile = (data: Record<string, unknown>, content: string) => ({ data, content }) as unknown as matter.GrayMatterFile<string>;

const skillEntry = (slug: string, data: Record<string, unknown>) => ({ slug, data }) as unknown as SkillFrontmatterEntry;

const directoryEntry = (name: string, isDirectory: boolean) =>
  ({ name, isDirectory: () => isDirectory }) as unknown as ReturnType<typeof fs.readdirSync>[number];

// Unquoted YAML makes a number description; the guard has to reject it before
// the renderer calls a string method on it.
const NUMERIC_DESCRIPTION = 2026;

const staticCommandFiles = () => [
  markdownFile(
    { name: 'cmd-full', description: 'Full command description', agent: 'custom-agent', model: 'gpt-4', subtask: 'true' },
    'Template for cmd-full',
  ),
  markdownFile({ name: 'cmd-subtask-false', description: 'Subtask false command', subtask: 'false' }, 'Template for cmd-subtask-false'),
  markdownFile({ description: 'No name command' }, 'Template for no-name'),
];

const synthesizedSkillEntries = () => [
  skillEntry('dev-plan', {
    'user-invocable': true,
    name: 'owflow:dev-plan',
    description: 'Plan phase.',
    // None of these belong on a command; the synthesized value must not
    // forward them the way the static loop maps agent/model/subtask.
    'argument-hint': '[task description]',
    agent: 'custom-agent',
    model: 'gpt-4',
    subtask: 'true',
  }),
];

const mockMarkdownDirectory = (files: matter.GrayMatterFile<string>[]) => spyOn(fileUtility, 'loadMarkdownDir').mockReturnValue(files);

const mockSkillReader = (entries: SkillFrontmatterEntry[]) => spyOn(commandsConfig, 'readSkillFrontmatter').mockReturnValue(entries);

const withMocks = (spies: RestorableSpy[], run: () => void) => {
  try {
    run();
  } finally {
    for (const spy of spies) {
      spy.mockRestore();
    }
  }
};

describe('configureCommands', () => {
  test('should not overwrite existing command definitions configured by user during synthesis', () => {
    const customCommand = { template: 'custom template content', description: 'custom user description' };
    const config = { command: { 'owflow:dev-spec': customCommand } } as unknown as OpenCodeConfig;

    // The static directory is stubbed out so only synthesis can register the
    // sibling command the assertion below inspects.
    withMocks([mockMarkdownDirectory([])], () => {
      configureCommands(config);

      expect(config.command['owflow:dev-spec']).toEqual(customCommand);
      expect(config.command['owflow:dev-plan']!.template).toContain('name: "owflow:dev-plan"');
    });
  });

  test('should correctly parse frontmatter attributes including description, agent, model, and subtask boolean', () => {
    const config = {} as OpenCodeConfig;

    withMocks([mockMarkdownDirectory(staticCommandFiles()), mockSkillReader([])], () => {
      configureCommands(config);

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
    });
  });
});

describe('renderCommandTemplate', () => {
  const CRLF = '\r\n';

  // The name is the template's only variable input, so it is also the only
  // source of name occurrences in the rendered body — exactly the two slots.
  const FRONTMATTER: SkillFrontmatter = {
    name: 'owflow:dev-spec',
    description: 'Controlled description for the digestion tests.',
    'user-invocable': true,
  };
  const EXPECTED_NAME_OCCURRENCES = 2;
  const EXPECTED_TEMPLATE_LINE_COUNT = 5;
  const EXPECTED_LINES = [
    'CRITICAL INSTRUCTION: You MUST invoke the owflow:dev-spec skill immediately as your FIRST action.',
    '',
    'Use the Skill tool with these exact parameters:',
    'name: "owflow:dev-spec"',
    'prompt: "$ARGUMENTS"',
  ];

  test('should never transform or strip the owflow prefix of the name slot', () => {
    const rendered = renderCommandTemplate(FRONTMATTER);

    expect(rendered.split(FRONTMATTER.name).length - 1).toBe(EXPECTED_NAME_OCCURRENCES);
    expect(rendered).not.toContain('name: "dev-spec"');
    expect(rendered).not.toContain('invoke the dev-spec skill');
  });

  test('should emit exactly the five expected lines with no leading or trailing newline', () => {
    const rendered = renderCommandTemplate(FRONTMATTER);
    const renderedLines = rendered.split(CRLF);

    expect(rendered).toBe(EXPECTED_LINES.join(CRLF));
    expect(renderedLines).toHaveLength(EXPECTED_TEMPLATE_LINE_COUNT);
    expect(renderedLines[1]).toBe('');
    expect(rendered.startsWith('CRITICAL')).toBe(true);
    expect(rendered.startsWith(CRLF)).toBe(false);
    expect(rendered.endsWith(CRLF)).toBe(false);
  });
});

const invocableSkill = () => skillEntry('dev-plan', { 'user-invocable': true, name: 'owflow:dev-plan', description: 'Plan phase.' });

describe('skill command registration', () => {
  test('should register a command for an invocable skill and none for an internal engine', () => {
    const config = {} as OpenCodeConfig;
    const entries = [
      invocableSkill(),
      skillEntry('docs-manager', { 'user-invocable': false, name: 'owflow:docs-manager', description: 'Internal engine.' }),
    ];

    withMocks([mockMarkdownDirectory([]), mockSkillReader(entries)], () => {
      configureCommands(config);

      expect(config.command['owflow:dev-plan']!.template).toContain('name: "owflow:dev-plan"');
      expect(config.command['owflow:docs-manager']).toBeUndefined();
    });
  });

  test('should not treat a string user-invocable value as the boolean flag', () => {
    const config = {} as OpenCodeConfig;
    const entries = [skillEntry('dev-plan', { 'user-invocable': 'true', name: 'owflow:dev-plan', description: 'Plan phase.' })];

    withMocks([mockMarkdownDirectory([]), mockSkillReader(entries)], () => {
      configureCommands(config);

      expect(config.command['owflow:dev-plan']).toBeUndefined();
    });
  });

  test('should let a maintained command win over a synthesized one with the same name', () => {
    const staticBody = 'The maintained body for the colliding name.';
    const config = {} as OpenCodeConfig;
    const markdownFiles = [markdownFile({ name: 'owflow:dev-plan' }, staticBody)];

    withMocks([mockMarkdownDirectory(markdownFiles), mockSkillReader([invocableSkill()])], () => {
      configureCommands(config);

      expect(config.command['owflow:dev-plan']!.template).toBe(staticBody);
    });
  });
});

// The reader has no try/catch on the read or parse path, so every filesystem
// and parsing failure has to reach the caller instead of degrading to an
// empty list.
describe('reader failure classes', () => {
  test('should throw when the skills directory cannot be listed', () => {
    const readdirSpy = spyOn(fs, 'readdirSync').mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory, scandir 'owflow/skills'");
    });

    withMocks([readdirSpy], () => {
      expect(() => commandsConfig.readSkillFrontmatter()).toThrow('ENOENT');
    });
  });

  test('should throw when a SKILL.md cannot be read', () => {
    const readdirSpy = spyOn(fs, 'readdirSync').mockReturnValue([directoryEntry('dev-spec', true)]);
    const hasSkillFileSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    const readFileSpy = spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error("EACCES: permission denied, open 'dev-spec/SKILL.md'");
    });

    withMocks([readdirSpy, hasSkillFileSpy, readFileSpy], () => {
      expect(() => commandsConfig.readSkillFrontmatter()).toThrow('EACCES');
    });
  });

  test('should throw when a SKILL.md carries unparseable frontmatter', () => {
    const readdirSpy = spyOn(fs, 'readdirSync').mockReturnValue([directoryEntry('dev-spec', true)]);
    const hasSkillFileSpy = spyOn(fs, 'existsSync').mockReturnValue(true);
    const readFileSpy = spyOn(fs, 'readFileSync').mockReturnValue('---\nname: "owflow:dev-spec"\nargument-hint: [unclosed\n---\n\nbody');

    withMocks([readdirSpy, hasSkillFileSpy, readFileSpy], () => {
      expect(() => commandsConfig.readSkillFrontmatter()).toThrow();
    });
  });
});

describe('reader entry filtering', () => {
  test('should skip only the entries with no SKILL.md and read the rest', () => {
    const skillFile = path.join(PLUGIN_ROOT, 'skills', 'dev-spec', 'SKILL.md');
    // A file entry is given a resolvable SKILL.md path too, so only the
    // is-directory guard can skip it — otherwise the existsSync guard below
    // would hide that branch.
    const fileEntryPath = path.join(PLUGIN_ROOT, 'skills', 'notes.md', 'SKILL.md');
    // Captured before the spy so the surviving entry is parsed from the real
    // file rather than a fabricated frontmatter.
    const realReadFileSync = fs.readFileSync;
    const readdirSpy = spyOn(fs, 'readdirSync').mockImplementation((() => [
      directoryEntry('assets', true),
      directoryEntry('notes.md', false),
      directoryEntry('dev-spec', true),
    ]) as unknown as typeof fs.readdirSync);
    const hasSkillFileSpy = spyOn(fs, 'existsSync').mockImplementation((target: fs.PathLike) => target === skillFile || target === fileEntryPath);
    const readFileSpy = spyOn(fs, 'readFileSync').mockImplementation(((target: fs.PathLike, encoding: BufferEncoding) =>
      realReadFileSync(target, encoding)) as typeof fs.readFileSync);

    withMocks([readdirSpy, hasSkillFileSpy, readFileSpy], () => {
      const skills = commandsConfig.readSkillFrontmatter();

      expect(skills).toHaveLength(1);
      expect(skills[0]!.slug).toBe('dev-spec');
      expect(skills[0]!.data.name).toBe('owflow:dev-spec');
      expect(skills[0]!.data['user-invocable']).toBe(true);
    });
  });
});

describe('synthesized command contract', () => {
  test('should register a command carrying only the template and the description', () => {
    const config = {} as OpenCodeConfig;

    withMocks([mockMarkdownDirectory([]), mockSkillReader(synthesizedSkillEntries())], () => {
      configureCommands(config);
      const registered = config.command['owflow:dev-plan']!;

      expect(Object.keys(registered).toSorted((first, second) => first.localeCompare(second))).toEqual(['description', 'template']);
      expect(registered.description).toBe('Plan phase.');
    });
  });

  test('should name every missing required key when a skill breaks the contract', () => {
    const entries = [skillEntry('dev-spec', { 'user-invocable': true })];

    withMocks([mockSkillReader(entries)], () => {
      expect(() => configureCommands({} as OpenCodeConfig)).toThrow(
        "Skill 'dev-spec' is user-invocable but is missing required frontmatter: name, description",
      );
    });
  });

  test('should report a non-string required value as a missing key', () => {
    const entries = [skillEntry('dev-spec', { 'user-invocable': true, name: 'owflow:dev-spec', description: NUMERIC_DESCRIPTION })];

    withMocks([mockSkillReader(entries)], () => {
      expect(() => configureCommands({} as OpenCodeConfig)).toThrow('missing required frontmatter: description');
    });
  });

  test('should treat an empty required value as a missing key', () => {
    const entries = [skillEntry('dev-spec', { 'user-invocable': true, name: 'owflow:dev-spec', description: '' })];

    withMocks([mockSkillReader(entries)], () => {
      expect(() => configureCommands({} as OpenCodeConfig)).toThrow('missing required frontmatter: description');
    });
  });
});
