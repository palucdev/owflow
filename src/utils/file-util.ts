import matter from "gray-matter";
import fs from "node:fs";
import path from "node:path";
import { PLUGIN_ROOT } from "../index.js";

export const loadMarkdownDir = (
  dirPath: string,
): matter.GrayMatterFile<string>[] => {
  const fullPath = path.join(PLUGIN_ROOT, dirPath);
  try {
    return fs
      .readdirSync(fullPath)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const raw = fs.readFileSync(path.join(fullPath, f), "utf8");
        return matter(raw);
      });
  } catch {
    return [];
  }
};
