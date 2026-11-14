import type { OpenCodeConfig } from '../types/opencode-types.js';
import * as fileUtility from '../utils/file-utility.js';
import matter from 'gray-matter';

const prepareAgent = ({ data, content }: matter.GrayMatterFile<string>) => ({
  prompt: content,
  ...(data['description'] && { description: data['description'] }),
  ...(data['model'] && { model: data['model'] }),
  ...(data['mode'] && { mode: data['mode'] }),
  // Add skills array if present
  ...(Array.isArray(data['skills']) && { skills: data['skills'] }),
  ...(data['hidden'] === 'true' && { hidden: true }),
});

export const configureAgents = (config: OpenCodeConfig): void => {
  config.agent ||= {};
  const markdownFiles = fileUtility.loadMarkdownDir('agents');
  for (const markdown of markdownFiles) {
    const name = markdown.data['name'];
    // Don't overwrite agents the user has explicitly configured
    if (!name || Object.prototype.hasOwnProperty.call(config.agent, name)) {
      continue;
    }

    try {
      config.agent[name] = prepareAgent(markdown);
    } catch (error) {
      console.warn(`[owflow] Failed to register agent '${name}': ${(error as Error).message}`);
    }
  }
};
