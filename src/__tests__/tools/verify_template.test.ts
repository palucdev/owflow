import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verify_template } from "../../tools/verify_template.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("verify_template tool", () => {
  const templatesDir = path.join(__dirname, "../../templates");
  const testDir = path.join(__dirname, "test_tmp_dir");
  const testTemplateName = "test-template.yml";
  const testTemplatePath = path.join(templatesDir, testTemplateName);

  beforeAll(() => {
    // Ensure templates dir exists
    if (!fs.existsSync(templatesDir)) {
      fs.mkdirSync(templatesDir, { recursive: true });
    }
    // Create a dummy template
    fs.writeFileSync(
      testTemplatePath,
      `
key1: value1
key2:
  subKey1: subValue1
      `,
    );

    // Ensure test dir exists
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(testTemplatePath)) {
      fs.rmSync(testTemplatePath);
    }
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("general tool behavior", () => {
    test("should return error if file not found", async () => {
      const result = await verify_template.execute(
        { filePath: "nonexistent.yml", templateName: testTemplateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain(
        "File not found at nonexistent.yml",
      );
    });

    test("should return error if template not found", async () => {
      const filePath = "target.yml";
      fs.writeFileSync(path.join(testDir, filePath), "key1: value");

      const result = await verify_template.execute(
        { filePath, templateName: "nonexistent-template.yml" },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain(
        "Template 'nonexistent-template.yml' not found",
      );
    });

    test("should return error if target file has invalid YAML syntax", async () => {
      const filePath = "invalid.yml";
      fs.writeFileSync(path.join(testDir, filePath), "key1: : value\n  invalid");

      const result = await verify_template.execute(
        { filePath, templateName: testTemplateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain(
        "YAML Syntax Error in invalid.yml",
      );
    });

    test("should return error if reference template file has invalid YAML syntax", async () => {
      const invalidTemplateName = "invalid-template.yml";
      const invalidTemplatePath = path.join(templatesDir, invalidTemplateName);
      fs.writeFileSync(invalidTemplatePath, "key1: : value\n  invalid");

      const filePath = "target.yml";
      fs.writeFileSync(path.join(testDir, filePath), "key1: value");

      try {
        const result = await verify_template.execute(
          { filePath, templateName: invalidTemplateName },
          { directory: testDir } as any,
        );
        expect((result as any).output).toContain(
          `Internal Error: Failed to parse reference template YAML '${invalidTemplateName}'`,
        );
      } finally {
        if (fs.existsSync(invalidTemplatePath)) {
          fs.rmSync(invalidTemplatePath);
        }
      }
    });

    test("should return error if target file is missing keys from template", async () => {
      const filePath = "missing-keys.yml";
      // Missing key2
      fs.writeFileSync(path.join(testDir, filePath), "key1: some-value");

      const result = await verify_template.execute(
        { filePath, templateName: testTemplateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain(
        "YAML Structure Validation Failed",
      );
      expect((result as any).output).toContain("- Missing key: key2");
    });

    test("should pass if target file matches template structure", async () => {
      const filePath = "valid.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
key1: different_value
key2:
  subKey1: different_sub_value
extraKey: this is fine
        `,
      );

      const result = await verify_template.execute(
        { filePath, templateName: testTemplateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toBe(
        "File exists and follows the correct YAML structure.",
      );
    });
  });

  describe("template: orchestrator-state-base.yml", () => {
    const templateName = "orchestrator-state-base.yml";

    test("successful verification: valid instance matching orchestrator-state-base", async () => {
      const result = await verify_template.execute(
        { filePath: templateName, templateName },
        { directory: templatesDir } as any,
      );
      expect((result as any).output).toBe(
        "File exists and follows the correct YAML structure.",
      );
    });

    test("faulty verification: missing top-level section 'task'", async () => {
      const filePath = "faulty-base-missing-task.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator:
  started_phase: null
  completed_phases: []
  failed_phases: []
  auto_fix_attempts: {}
  options: {}
  created: "2026-01-01"
  updated: "2026-01-01"
  task_path: null
  task_ids: {}
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: task");
    });

    test("faulty verification: missing nested key 'orchestrator.created'", async () => {
      const filePath = "faulty-base-missing-nested.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator:
  started_phase: null
task:
  title: null
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: orchestrator.created");
    });
  });

  describe("template: orchestrator-state-development.yml", () => {
    const templateName = "orchestrator-state-development.yml";

    test("successful verification: valid instance matching orchestrator-state-development", async () => {
      const result = await verify_template.execute(
        { filePath: templateName, templateName },
        { directory: templatesDir } as any,
      );
      expect((result as any).output).toBe(
        "File exists and follows the correct YAML structure.",
      );
    });

    test("faulty verification: missing top-level section 'task_context'", async () => {
      const filePath = "faulty-dev-missing-context.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator: {}
task: {}
verification_context: {}
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: task_context");
    });

    test("faulty verification: missing nested section 'task_context.data_lifecycle'", async () => {
      const filePath = "faulty-dev-missing-nested.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator: {}
task: {}
task_context:
  risk_level: low
verification_context: {}
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: task_context.data_lifecycle");
    });
  });

  describe("template: orchestrator-state-migration.yml", () => {
    const templateName = "orchestrator-state-migration.yml";

    test("successful verification: valid instance matching orchestrator-state-migration", async () => {
      const result = await verify_template.execute(
        { filePath: templateName, templateName },
        { directory: templatesDir } as any,
      );
      expect((result as any).output).toBe(
        "File exists and follows the correct YAML structure.",
      );
    });

    test("faulty verification: missing top-level section 'migration_context'", async () => {
      const filePath = "faulty-migration-missing-context.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator: {}
task: {}
external_research: {}
verification_context: {}
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: migration_context");
    });

    test("faulty verification: missing nested key 'migration_context.target_system'", async () => {
      const filePath = "faulty-migration-missing-nested.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator: {}
task: {}
migration_context:
  migration_type: code
external_research: {}
verification_context: {}
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: migration_context.target_system");
    });
  });

  describe("template: orchestrator-state-performance.yml", () => {
    const templateName = "orchestrator-state-performance.yml";

    test("successful verification: valid instance matching orchestrator-state-performance", async () => {
      const result = await verify_template.execute(
        { filePath: templateName, templateName },
        { directory: templatesDir } as any,
      );
      expect((result as any).output).toBe(
        "File exists and follows the correct YAML structure.",
      );
    });

    test("faulty verification: missing top-level section 'performance_context'", async () => {
      const filePath = "faulty-performance-missing-context.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator: {}
task: {}
verification_context: {}
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: performance_context");
    });

    test("faulty verification: missing nested key 'performance_context.bottleneck_priorities'", async () => {
      const filePath = "faulty-performance-missing-nested.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator: {}
task: {}
performance_context:
  bottlenecks_identified: null
verification_context: {}
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: performance_context.bottleneck_priorities");
    });
  });

  describe("template: orchestrator-state-research.yml", () => {
    const templateName = "orchestrator-state-research.yml";

    test("successful verification: valid instance matching orchestrator-state-research", async () => {
      const result = await verify_template.execute(
        { filePath: templateName, templateName },
        { directory: templatesDir } as any,
      );
      expect((result as any).output).toBe(
        "File exists and follows the correct YAML structure.",
      );
    });

    test("faulty verification: missing top-level section 'research_outputs'", async () => {
      const filePath = "faulty-research-missing-outputs.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator: {}
task: {}
research_context: {}
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: research_outputs");
    });

    test("faulty verification: missing nested key 'research_context.gathering_strategy'", async () => {
      const filePath = "faulty-research-missing-nested.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator: {}
task: {}
research_context:
  research_type: technical
research_outputs: {}
      `,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: research_context.gathering_strategy");
    });

    test("faulty verification: missing nested key 'orchestrator.entry_point'", async () => {
      const filePath = "faulty-research-missing-entry-point.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator:
  started_phase: null
  completed_phases: []
  failed_phases: []
  auto_fix_attempts:
    brief-written: 0
    plan-created: 0
    findings-gathered: 0
    synthesis-complete: 0
    options-resolved: 0
    alternatives-generated: 0
    approaches-chosen: 0
    design-generated: 0
    research-completed: 0
  options:
    brainstorming_enabled: null
    design_enabled: null
  created: "2026-01-01T00:00:00Z"
  updated: "2026-01-01T00:00:00Z"
  task_path: null
  task_ids: {}
task:
  title: null
  description: null
  status: pending
  tags: []
  priority: null
research_context:
  research_type: technical
  research_question: null
  scope:
    included: []
    excluded: []
    constraints: []
  methodology: []
  sources: []
  confidence_level: high
  gathering_strategy:
    categories: []
    count: 0
    source: default
  project_doc_paths: []
  phase_summaries:
    plan:
      summary: null
      steps_completed: []
    gather:
      summary: null
    synthesize:
      summary: null
    scope:
      summary: null
    brainstorm:
      summary: null
    converge:
      summary: null
      decision_areas: []
      deferred_ideas: []
    design:
      summary: null
      architecture_style: null
      decisions_count: 0
research_outputs:
  research_report: null
  findings_directory: null
  solution_exploration: null
  high_level_design: null
  decision_log: null
  synthesis: null
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: orchestrator.entry_point");
    });

    test("binding proof: re-keyed research state instance with completed_phases [brief-written] validates against co-landed template", async () => {
      const filePath = "binding-proof-research-instance.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator:
  started_phase: null
  entry_point: "/owflow:research"
  completed_phases: [brief-written]
  failed_phases: []
  auto_fix_attempts:
    brief-written: 1
    plan-created: 0
    findings-gathered: 0
    synthesis-complete: 0
    options-resolved: 0
    alternatives-generated: 0
    approaches-chosen: 0
    design-generated: 0
    research-completed: 0
  options:
    brainstorming_enabled: true
    design_enabled: false
  created: "2026-09-26T00:00:00Z"
  updated: "2026-09-26T00:00:00Z"
  task_path: ".owflow/tasks/research/2026-09-26-binding-proof"
  task_ids: {}
task:
  title: "Binding proof instance"
  description: null
  status: in-progress
  tags: ["research"]
  priority: null
research_context:
  research_type: technical
  research_question: "Does the re-keyed vocabulary bind to the co-landed template?"
  scope:
    included: []
    excluded: []
    constraints: []
  methodology: []
  sources: []
  confidence_level: medium
  gathering_strategy:
    categories: []
    count: 0
    source: default
  project_doc_paths: []
  phase_summaries:
    plan:
      summary: "Brief written; research stated."
      steps_completed: []
    gather:
      summary: null
    synthesize:
      summary: null
    scope:
      summary: null
    brainstorm:
      summary: null
    converge:
      summary: null
      decision_areas: []
      deferred_ideas: []
    design:
      summary: null
      architecture_style: null
      decisions_count: 0
research_outputs:
  research_report: null
  findings_directory: null
  solution_exploration: null
  high_level_design: null
  decision_log: null
  synthesis: null
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toBe(
        "File exists and follows the correct YAML structure.",
      );
    });

    test("faulty verification: missing nested key 'research_context.phase_summaries.converge.decision_areas'", async () => {
      const filePath = "faulty-research-missing-decision-areas.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
orchestrator:
  started_phase: null
  entry_point: null
  completed_phases: []
  failed_phases: []
  auto_fix_attempts:
    brief-written: 0
    plan-created: 0
    findings-gathered: 0
    synthesis-complete: 0
    options-resolved: 0
    alternatives-generated: 0
    approaches-chosen: 0
    design-generated: 0
    research-completed: 0
  options:
    brainstorming_enabled: null
    design_enabled: null
  created: "2026-01-01T00:00:00Z"
  updated: "2026-01-01T00:00:00Z"
  task_path: null
  task_ids: {}
task:
  title: null
  description: null
  status: pending
  tags: []
  priority: null
research_context:
  research_type: technical
  research_question: null
  scope:
    included: []
    excluded: []
    constraints: []
  methodology: []
  sources: []
  confidence_level: high
  gathering_strategy:
    categories: []
    count: 0
    source: default
  project_doc_paths: []
  phase_summaries:
    plan:
      summary: null
      steps_completed: []
    gather:
      summary: null
    synthesize:
      summary: null
    scope:
      summary: null
    brainstorm:
      summary: null
    converge:
      summary: null
      deferred_ideas: []
    design:
      summary: null
      architecture_style: null
      decisions_count: 0
research_outputs:
  research_report: null
  findings_directory: null
  solution_exploration: null
  high_level_design: null
  decision_log: null
  synthesis: null
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: research_context.phase_summaries.converge.decision_areas");
    });
  });
});

