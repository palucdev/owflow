import * as commandsConfig from '../../configuration/commands-config.js';
import * as fileUtility from '../../utils/file-utility.js';

export type SkillEntry = ReturnType<typeof commandsConfig.readSkillFrontmatter>[number];
export type MarkdownFiles = ReturnType<typeof fileUtility.loadMarkdownDir>;

export const createSkillEntry = (slug: string, data: Record<string, unknown>): SkillEntry => ({ slug, data }) as unknown as SkillEntry;

export const createSkillEntries = (entries: readonly { readonly slug: string; readonly data: Record<string, unknown> }[]): SkillEntry[] =>
  entries.map((entry) => createSkillEntry(entry.slug, entry.data));

export const asMarkdownFiles = (files: readonly Record<string, unknown>[]): MarkdownFiles => files as unknown as MarkdownFiles;

export const createMarkdownFile = (data: Record<string, unknown>, content: string): Record<string, unknown> => ({
  data,
  content,
});
