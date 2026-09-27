import { describe, expect, spyOn, test } from "bun:test";
import matter from "gray-matter";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configureCommands } from "../../configuration/commands-config.js";
import type { OpenCodeConfig } from "../../types/opencode-types.js";
import * as fileUtil from "../../utils/file-util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Tests read from src/ only — PLUGIN_ROOT-based loading reads dist/, and the
// build runs copy-markdowns AFTER tests, so dist/ may not exist at test time.
const srcRoot = path.join(__dirname, "../..");

const RESEARCH_SKILL_FOLDERS = [
  "research",
  "research-plan",
  "research-gather",
  "research-synthesize",
  "research-scope",
  "research-brainstorm",
  "research-converge",
  "research-design",
  "research-finalize",
  "goal-research",
] as const;

/**
 * Mirror of file-util's loadMarkdownDir logic, but rooted at src/ so the
 * configureCommands spy serves source markdown instead of dist/ copies.
 */
const loadMarkdownFromSrc = (
  dirPath: string,
): matter.GrayMatterFile<string>[] => {
  const fullPath = path.join(srcRoot, dirPath);
  const parsed: matter.GrayMatterFile<string>[] = [];
  for (const f of fs.readdirSync(fullPath).filter((f) => f.endsWith(".md"))) {
    parsed.push(matter(fs.readFileSync(path.join(fullPath, f), "utf8")));
  }
  return parsed;
};

describe("research family 3-way correspondence (skill folder ↔ SKILL.md ↔ command file)", () => {
  test("should register a templated command entry for every research user-invocable skill when commands load from src", () => {
    const spy = spyOn(fileUtil, "loadMarkdownDir").mockImplementation(() =>
      loadMarkdownFromSrc("commands"),
    );

    try {
      const config = {} as OpenCodeConfig;
      configureCommands(config);

      const problems: string[] = [];
      for (const folder of RESEARCH_SKILL_FOLDERS) {
        const entry = config.command[`owflow:${folder}`];
        if (!entry) {
          problems.push(`missing config.command entry: owflow:${folder}`);
        } else if (!entry.template) {
          problems.push(`empty template for: owflow:${folder}`);
        }
      }
      expect(problems).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  test("should name every research command file with the owflow-prefixed skill folder name", () => {
    const problems: string[] = [];
    for (const folder of RESEARCH_SKILL_FOLDERS) {
      const cmdPath = path.join(srcRoot, "commands", `${folder}.md`);
      if (!fs.existsSync(cmdPath)) {
        problems.push(`missing command file: src/commands/${folder}.md`);
        continue;
      }
      const { data } = matter(fs.readFileSync(cmdPath, "utf8"));
      if (data.name !== `owflow:${folder}`) {
        problems.push(
          `src/commands/${folder}.md name is ${String(data.name)}, expected owflow:${folder}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  test("should mark every research skill folder user-invocable with a matching owflow-prefixed name", () => {
    const problems: string[] = [];
    for (const folder of RESEARCH_SKILL_FOLDERS) {
      const skillPath = path.join(srcRoot, "skills", folder, "SKILL.md");
      if (!fs.existsSync(skillPath)) {
        problems.push(`missing skill file: src/skills/${folder}/SKILL.md`);
        continue;
      }
      const { data } = matter(fs.readFileSync(skillPath, "utf8"));
      if (data.name !== `owflow:${folder}`) {
        problems.push(
          `src/skills/${folder}/SKILL.md name is ${String(data.name)}, expected owflow:${folder}`,
        );
      }
      if (data["user-invocable"] !== true) {
        problems.push(
          `src/skills/${folder}/SKILL.md user-invocable is ${String(
            data["user-invocable"],
          )}, expected true`,
        );
      }
    }
    expect(problems).toEqual([]);
  });
});
