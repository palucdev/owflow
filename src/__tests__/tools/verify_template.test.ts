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
  });

  describe("template: quick-bugfix-task.yml", () => {
    const templateName = "quick-bugfix-task.yml";

    test("successful verification: valid instance matching quick-bugfix-task", async () => {
      const result = await verify_template.execute(
        { filePath: templateName, templateName },
        { directory: templatesDir } as any,
      );
      expect((result as any).output).toBe(
        "File exists and follows the correct YAML structure.",
      );
    });

    test("faulty verification: missing required field 'escalated_to'", async () => {
      const filePath = "faulty-bugfix-missing-field.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
command: quick-bugfix
title: "Fix crash"
description: "App crashes on launch"
status: in_progress
created: "2026-01-01"
updated: "2026-01-01"
task_path: .owflow/tasks/quick-bugfix/task
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: escalated_to");
    });
  });

  describe("template: quick-dev-task.yml", () => {
    const templateName = "quick-dev-task.yml";

    test("successful verification: valid instance matching quick-dev-task", async () => {
      const result = await verify_template.execute(
        { filePath: templateName, templateName },
        { directory: templatesDir } as any,
      );
      expect((result as any).output).toBe(
        "File exists and follows the correct YAML structure.",
      );
    });

    test("faulty verification: missing required field 'standards_applied'", async () => {
      const filePath = "faulty-dev-task-missing-standards.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
command: quick-dev
title: "Add feature"
description: "New button"
status: in_progress
created: "2026-01-01"
updated: "2026-01-01"
task_path: .owflow/tasks/quick-dev/task
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: standards_applied");
    });
  });

  describe("template: quick-plan-task.yml", () => {
    const templateName = "quick-plan-task.yml";

    test("successful verification: valid instance matching quick-plan-task", async () => {
      const result = await verify_template.execute(
        { filePath: templateName, templateName },
        { directory: templatesDir } as any,
      );
      expect((result as any).output).toBe(
        "File exists and follows the correct YAML structure.",
      );
    });

    test("faulty verification: missing required field 'plan_path'", async () => {
      const filePath = "faulty-plan-missing-path.yml";
      fs.writeFileSync(
        path.join(testDir, filePath),
        `
command: quick-plan
title: "Plan architecture"
description: "Plan for v2"
status: in_progress
created: "2026-01-01"
updated: "2026-01-01"
task_path: .owflow/tasks/quick-plan/task
escalated_to: null
escalation_reason: null
standards_applied: []
`,
      );

      const result = await verify_template.execute(
        { filePath, templateName },
        { directory: testDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: plan_path");
    });
  });
});
