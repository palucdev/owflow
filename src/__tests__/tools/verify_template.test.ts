import { expect, test, describe } from "bun:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verify_template } from "../../tools/verify_template.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("verify_template tool", () => {
  const templatesDir = path.join(__dirname, "../../templates");
  const fixturesDir = path.join(__dirname, "../fixtures/verify-template");
  const testTemplateName = "../__tests__/fixtures/verify-template/templates/test-template.yml";

  describe("general tool behavior", () => {
    test("should return error if file not found", async () => {
      const result = await verify_template.execute(
        { filePath: "nonexistent.yml", templateName: testTemplateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain(
        "File not found at nonexistent.yml",
      );
    });

    test("should return error if template not found", async () => {
      const result = await verify_template.execute(
        { filePath: "target.yml", templateName: "nonexistent-template.yml" },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain(
        "Template 'nonexistent-template.yml' not found",
      );
    });

    test("should return error if target file has invalid YAML syntax", async () => {
      const result = await verify_template.execute(
        { filePath: "templates/invalid-template.yml", templateName: testTemplateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain(
        "YAML Syntax Error in templates/invalid-template.yml",
      );
    });

    test("should return error if reference template file has invalid YAML syntax", async () => {
      const invalidTemplateName = "../__tests__/fixtures/verify-template/templates/invalid-template.yml";
      const result = await verify_template.execute(
        { filePath: "target.yml", templateName: invalidTemplateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain(
        `Internal Error: Failed to parse reference template YAML '${invalidTemplateName}'`,
      );
    });

    test("should return error if target file is missing keys from template", async () => {
      const result = await verify_template.execute(
        { filePath: "missing-keys.yml", templateName: testTemplateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain(
        "YAML Structure Validation Failed",
      );
      expect((result as any).output).toContain("- Missing key: key2");
    });

    test("should pass if target file matches template structure", async () => {
      const result = await verify_template.execute(
        { filePath: "valid.yml", templateName: testTemplateName },
        { directory: fixturesDir } as any,
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
      const result = await verify_template.execute(
        { filePath: "base-missing-task.yml", templateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: task");
    });

    test("faulty verification: missing nested key 'orchestrator.created'", async () => {
      const result = await verify_template.execute(
        { filePath: "base-missing-nested.yml", templateName },
        { directory: fixturesDir } as any,
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
      const result = await verify_template.execute(
        { filePath: "dev-missing-context.yml", templateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: task_context");
    });

    test("faulty verification: missing nested section 'task_context.data_lifecycle'", async () => {
      const result = await verify_template.execute(
        { filePath: "dev-missing-nested.yml", templateName },
        { directory: fixturesDir } as any,
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
      const result = await verify_template.execute(
        { filePath: "migration-missing-context.yml", templateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: migration_context");
    });

    test("faulty verification: missing nested key 'migration_context.target_system'", async () => {
      const result = await verify_template.execute(
        { filePath: "migration-missing-nested.yml", templateName },
        { directory: fixturesDir } as any,
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
      const result = await verify_template.execute(
        { filePath: "performance-missing-context.yml", templateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: performance_context");
    });

    test("faulty verification: missing nested key 'performance_context.bottleneck_priorities'", async () => {
      const result = await verify_template.execute(
        { filePath: "performance-missing-nested.yml", templateName },
        { directory: fixturesDir } as any,
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
      const result = await verify_template.execute(
        { filePath: "research-missing-outputs.yml", templateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: research_outputs");
    });

    test("faulty verification: missing nested key 'research_context.gathering_strategy'", async () => {
      const result = await verify_template.execute(
        { filePath: "research-missing-nested.yml", templateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: research_context.gathering_strategy");
    });

    test("faulty verification: missing nested key 'orchestrator.entry_point'", async () => {
      const result = await verify_template.execute(
        { filePath: "research-missing-entry-point.yml", templateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: orchestrator.entry_point");
    });

    test("binding proof: re-keyed research state instance with completed_phases [brief-written] validates against co-landed template", async () => {
      const result = await verify_template.execute(
        { filePath: "research-binding-proof.yml", templateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toBe(
        "File exists and follows the correct YAML structure.",
      );
    });

    test("faulty verification: missing nested key 'research_context.phase_summaries.converge.decision_areas'", async () => {
      const result = await verify_template.execute(
        { filePath: "research-missing-decision-areas.yml", templateName },
        { directory: fixturesDir } as any,
      );
      expect((result as any).output).toContain("YAML Structure Validation Failed");
      expect((result as any).output).toContain("- Missing key: research_context.phase_summaries.converge.decision_areas");
    });
  });
});
