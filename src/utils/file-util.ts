import matter from "gray-matter";
import fs from "node:fs";
import path from "node:path";
import { PLUGIN_ROOT } from "../constants.js";

export const loadMarkdownDir = (
  dirPath: string,
): matter.GrayMatterFile<string>[] => {
  const fullPath = path.join(PLUGIN_ROOT, dirPath);
  let files: string[];
  try {
    files = fs.readdirSync(fullPath).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const parsed: matter.GrayMatterFile<string>[] = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(fullPath, f), "utf8");
      parsed.push(matter(raw));
    } catch (e) {
      console.warn(
        `[owflow] Skipping unparseable markdown file ${f} in ${dirPath}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return parsed;
};
