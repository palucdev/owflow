import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

const RESEARCH_COMMAND_FILES = [
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

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(srcRoot, relativePath), "utf8");

describe("research vocabulary guard (slug vocabulary integrity)", () => {
  test("should contain no phase-N remnants in research skills, the research template, or research commands", () => {
    const surfaces: string[] = [
      ...RESEARCH_SKILL_FOLDERS.map(
        (folder) => `skills/${folder}/SKILL.md`,
      ),
      "templates/orchestrator-state-research.yml",
      ...RESEARCH_COMMAND_FILES.map((name) => `commands/${name}.md`),
    ];

    const violations: string[] = [];
    for (const surface of surfaces) {
      const fullPath = path.join(srcRoot, surface);
      if (!fs.existsSync(fullPath)) {
        violations.push(`${surface}: file missing`);
        continue;
      }
      const content = fs.readFileSync(fullPath, "utf8");
      const matches = content.match(/phase-[1-6]/g);
      if (matches && matches.length > 0) {
        violations.push(`${surface}: ${matches.length}× phase-N remnant`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("should keep phase-N keys in the performance and migration holdout templates as out-of-scope", () => {
    const readPhaseNumbers = (templateName: string): number[] => {
      const content = fs.readFileSync(
        path.join(srcRoot, "templates", templateName),
        "utf8",
      );
      return (content.match(/phase-\d+/g) ?? [])
        .map((match) => Number.parseInt(match.slice("phase-".length), 10))
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b);
    };

    const performancePhases = readPhaseNumbers(
      "orchestrator-state-performance.yml",
    );
    const migrationPhases = readPhaseNumbers(
      "orchestrator-state-migration.yml",
    );

    // Holdout templates keep their numeric phase keys — DR-9 scoping leaves
    // performance and migration untouched, so their legacy phase-N auto-fix
    // vocabulary must still be present (and re-keying must not have leaked).
    expect(performancePhases).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(migrationPhases).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("development consumer-contract guard (research intake surface)", () => {
  test("should keep the Research Artifacts table and --research intake markers in the development skill", () => {
    const content = readSource("skills/development/SKILL.md");

    const requiredMarkers: Array<[string, string]> = [
      ["artifacts table", "### Research Artifacts (Standard List)"],
      ["state row", "orchestrator-state.yml"],
      ["state description", "research_type, confidence_level"],
      ["report row", "outputs/research-report.md"],
      ["solution-exploration row", "outputs/solution-exploration.md"],
      ["high-level-design row", "outputs/high-level-design.md"],
      ["decision-log row", "outputs/decision-log.md"],
      ["flag hint", "--research=PATH"],
      ["entry-gate intake", "analysis/research-context/"],
    ];

    const missing = requiredMarkers
      .filter(([, marker]) => !content.includes(marker))
      .map(([label]) => label);

    expect(missing).toEqual([]);
  });
});
