import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(
  __dirname,
  "../../templates/orchestrator-state-research.yml",
);

// Authoritative research step vocabulary — descriptive slugs, not phase-N keys.
const RESEARCH_SLUGS = [
  "brief-written",
  "plan-created",
  "findings-gathered",
  "synthesis-complete",
  "options-resolved",
  "alternatives-generated",
  "approaches-chosen",
  "design-generated",
  "research-completed",
] as const;

const PHASE_SUMMARY_SLOTS = [
  "plan",
  "gather",
  "synthesize",
  "scope",
  "brainstorm",
  "converge",
  "design",
] as const;

const readResearchStateTemplate = (): any =>
  yaml.parse(fs.readFileSync(templatePath, "utf8"));

describe("orchestrator-state-research.yml template shape", () => {
  test("should declare an entry point and descriptively key auto_fix_attempts to the nine research slugs", () => {
    const state = readResearchStateTemplate();
    const orchestrator = state.orchestrator;

    // Key existence + placeholder: fails on undefined too.
    expect(orchestrator.entry_point).toBeNull();

    const autoFix = orchestrator.auto_fix_attempts;
    expect(Object.keys(autoFix).sort()).toEqual(
      [...RESEARCH_SLUGS].sort(),
    );
    // Vocabulary R1: no legacy phase-N keys survive the re-keying.
    expect(
      Object.keys(autoFix).filter((key) => /^phase-\d+/.test(key)),
    ).toEqual([]);
    for (const slug of RESEARCH_SLUGS) {
      expect(autoFix[slug]).toBe(0);
    }
  });

  test("should key phase_summaries to the seven research subskill slots with converge and design detail fields", () => {
    const state = readResearchStateTemplate();
    const phaseSummaries = state.research_context.phase_summaries;

    // Exactly the 7 subskill slots — no finalize, no phase-N.
    expect(Object.keys(phaseSummaries).sort()).toEqual(
      [...PHASE_SUMMARY_SLOTS].sort(),
    );

    expect(phaseSummaries.converge).toEqual(
      expect.objectContaining({
        summary: null,
        decision_areas: [],
        deferred_ideas: [],
      }),
    );
    expect(phaseSummaries.design).toEqual(
      expect.objectContaining({
        summary: null,
        architecture_style: null,
        decisions_count: 0,
      }),
    );
  });

  test("should preserve the research contract fields unchanged while declaring new intake and synthesis outputs", () => {
    const state = readResearchStateTemplate();
    const researchContext = state.research_context;

    expect(researchContext.research_question).toBeNull();
    expect(researchContext.scope).toEqual({
      included: [],
      excluded: [],
      constraints: [],
    });
    expect(Object.keys(researchContext.gathering_strategy).sort()).toEqual(
      ["categories", "count", "source"].sort(),
    );
    expect(researchContext.project_doc_paths).toEqual([]);

    // 5 original outputs unchanged + new synthesis slot.
    expect(Object.keys(state.research_outputs).sort()).toEqual(
      [
        "research_report",
        "findings_directory",
        "solution_exploration",
        "high_level_design",
        "decision_log",
        "synthesis",
      ].sort(),
    );
  });
});
