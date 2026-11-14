import matter from 'gray-matter';
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './plugin-info.js';

export const loadMarkdownDirectory = (directoryPath: string): matter.GrayMatterFile<string>[] => {
  const fullPath = path.join(PLUGIN_ROOT, directoryPath);
  let files: string[];
  try {
    files = fs.readdirSync(fullPath).filter((fileName) => fileName.endsWith('.md'));
  } catch {
    return [];
  }
  const parsed: matter.GrayMatterFile<string>[] = [];
  for (const fileName of files) {
    try {
      const raw = fs.readFileSync(path.join(fullPath, fileName), 'utf8');
      parsed.push(matter(raw));
    } catch (error) {
      console.warn(
        `[owflow] Skipping unparseable markdown file ${fileName} in ${directoryPath}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return parsed;
};

export { loadMarkdownDirectory as loadMarkdownDir };
