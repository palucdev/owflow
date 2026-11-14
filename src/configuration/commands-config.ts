import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import type { OpenCodeConfig } from '../types/opencode-types.js';
import * as fileUtility from '../utils/file-utility.js';
import { PLUGIN_ROOT } from '../utils/plugin-info.js';

// Keeps the rendered body independent of the line endings of this file's storage.
const CRLF = '\r\n';

// Mirrors gray-matter's `GrayMatterFile<string>["data"]` shape, which `extends`
// cannot express as an indexed-access type. The declared fields are the command
// contract; the registration loop enforces it at runtime before using them.
interface SkillFrontmatter extends Record<string, unknown> {
  name: string;
  description: string;
  'user-invocable': boolean | string | unknown;
}

const REQUIRED_COMMAND_KEYS = ['name', 'description'] as const;

/**
Renders the command body for one skill from its frontmatter.
Pure: one frontmatter object in, one string out.
*/
export const renderCommandTemplate = (data: SkillFrontmatter): string =>
  [
    `CRITICAL INSTRUCTION: You MUST invoke the ${data.name} skill immediately as your FIRST action.`,
    '',
    'Use the Skill tool with these exact parameters:',
    `name: "${data.name}"`,
    `prompt: "$ARGUMENTS"`,
  ].join(CRLF);

/**
Reads the frontmatter of every `skills/<slug>/SKILL.md`, one level deep.
I/O and parsing only — the invocable gate and the key contract live in the
registration loop. Failures are never swallowed: our own source data must not
register silently incomplete.
*/
export const readSkillFrontmatter = (): readonly {
  slug: string;
  data: SkillFrontmatter;
}[] => {
  const skillsDirectory = path.join(PLUGIN_ROOT, 'skills');
  const directoryEntries = fs.readdirSync(skillsDirectory, { withFileTypes: true });
  const skills: { slug: string; data: SkillFrontmatter }[] = [];
  for (const entry of directoryEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillFile = path.join(skillsDirectory, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      continue;
    }
    skills.push({
      slug: entry.name,
      data: matter(fs.readFileSync(skillFile, 'utf8')).data as SkillFrontmatter,
    });
  }
  return skills;
};

const configureStaticCommands = (config: OpenCodeConfig): void => {
  const markdownFiles = fileUtility.loadMarkdownDir('commands');
  for (const { data, content } of markdownFiles) {
    const name = data['name'];
    // Don't overwrite commands the user has explicitly configured
    if (!name || Object.prototype.hasOwnProperty.call(config.command, name)) {
      continue;
    }
    config.command[name] = {
      template: content,
      ...(data['description'] && { description: data['description'] }),
      ...(data['agent'] && { agent: data['agent'] }),
      ...(data['model'] && { model: data['model'] }),
      ...(data['subtask'] !== undefined && {
        subtask: data['subtask'] === 'true',
      }),
    };
  }
};

const configureSkillCommands = (config: OpenCodeConfig): void => {
  const skillEntries = readSkillFrontmatter();
  for (const { slug, data } of skillEntries) {
    if (data['user-invocable'] !== true) {
      continue;
    }
    const missing = REQUIRED_COMMAND_KEYS.filter(
      (key) => typeof data[key] !== 'string' || data[key] === '',
    );
    if (missing.length > 0) {
      throw new Error(
        `[owflow] Skill '${slug}' is user-invocable but is missing required frontmatter: ${missing.join(', ')}`,
      );
    }
    const name = data.name;
    // Don't overwrite commands the user has explicitly configured
    if (Object.prototype.hasOwnProperty.call(config.command, name)) {
      continue;
    }
    config.command[name] = {
      template: renderCommandTemplate(data),
      // A folded YAML description scalar parses with a trailing newline
      description: data.description.trimEnd(),
    };
  }
};

export const configureCommands = (config: OpenCodeConfig): void => {
  config.command ||= {};
  configureStaticCommands(config);
  configureSkillCommands(config);
};
