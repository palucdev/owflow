import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verify_template } from "../../tools/verify_template.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("verify_template tool", () => {
  const templatesDir = path.join(__dirname, "../templates");
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

  test("should pass if template has null or non-object values and target has them too", async () => {
    const nullTemplateName = "null-template.yml";
    const nullTemplatePath = path.join(templatesDir, nullTemplateName);
    fs.writeFileSync(nullTemplatePath, "key: null\nother: 123");

    const filePath = "valid-null.yml";
    fs.writeFileSync(
      path.join(testDir, filePath),
      "key: something\nother: 456",
    );

    const result = await verify_template.execute(
      { filePath, templateName: nullTemplateName },
      { directory: testDir } as any,
    );

    expect((result as any).output).toBe(
      "File exists and follows the correct YAML structure.",
    );

    fs.rmSync(nullTemplatePath);
  });

  describe("real templates validation", () => {
    let templateFiles: string[] = [];
    try {
      const files = fs.readdirSync(templatesDir);
      templateFiles = files.filter(
        (f) => f.endsWith(".yml") || f.endsWith(".yaml") || f.endsWith(".md"),
      );
      // Filter out our dummy test template
      templateFiles = templateFiles.filter(
        (f) => f !== "test-template.yml" && f !== "null-template.yml",
      );
    } catch (e) {
      // templates dir might not exist or be readable in some contexts, though beforeAll ensures it exists
    }

    for (const templateName of templateFiles) {
      test(`should successfully validate a valid instance of ${templateName}`, async () => {
        // We use the templates directory as the working directory
        // and the template name as the filePath, effectively comparing the template to itself to ensure it's structurally valid.
        const result = await verify_template.execute(
          { filePath: templateName, templateName },
          { directory: templatesDir } as any,
        );
        expect((result as any).output).toBe(
          "File exists and follows the correct YAML structure.",
        );
      });
    }
  });
});
