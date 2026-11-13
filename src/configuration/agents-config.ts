import type { OpenCodeConfig } from '../types/opencode-types.js';
import { loadMarkdownDir } from '../utils/file-utility.js';
import matter from 'gray-matter';

const prepareAgent = ({ data, content }: matter.GrayMatterFile<string>) => {
  return {
    prompt: content,
    ...(data.description && { description: data.description }),
    ...(data.model && { model: data.model }),
    ...(data.mode && { mode: data.mode }),
    // Add skills array if present
    ...(data.skills && Array.isArray(data.skills) && { skills: data.skills }),
    ...(data.hidden === 'true' && { hidden: true }),
  };
};

export const configureAgents = (config: OpenCodeConfig): void => {
  config.agent = config.agent || {};
  for (const markdown of loadMarkdownDir('agents')) {
    const name = markdown.data.name;
    if (!name) continue;
    // Don't overwrite agents the user has explicitly configured
    if (config.agent[name]) continue;

    try {
      config.agent[name] = prepareAgent(markdown);
    } catch (error) {
      console.warn(`[owflow] Failed to register agent '${name}': ${(error as Error).message}`);
    }
  }
};
