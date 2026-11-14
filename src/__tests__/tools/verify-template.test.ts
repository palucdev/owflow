import { describe, expect, spyOn, test } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify_template } from '../../tools/verify-template.js';
import * as environmentConfig from '../../utils/environment-config.js';

interface ToolResult {
  readonly output: string;
}

interface ToolInvocation {
  readonly filePath: string;
  readonly templateName: string;
  readonly directory: string;
  readonly templatesDirectory: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIRECTORY = path.join(__dirname, '../fixtures/verify-template');
const FIXTURE_TEMPLATES_DIRECTORY = path.join(FIXTURE_DIRECTORY, 'templates');
const REAL_TEMPLATES_DIRECTORY = path.join(__dirname, '../../templates');
const TEST_TEMPLATE_NAME = 'test-template.yml';
const INVALID_TEMPLATE_NAME = 'invalid-template.yml';
const SUCCESS_OUTPUT = 'File exists and follows the correct YAML structure.';

const invokeTool = async (invocation: ToolInvocation): Promise<ToolResult> => {
  const configSpy = spyOn(environmentConfig, 'createDefaultEnvironmentConfig').mockReturnValue(
    environmentConfig.createTestEnvironmentConfig({ templatesDirectory: invocation.templatesDirectory }),
  );

  try {
    const result = await verify_template.execute(
      { filePath: invocation.filePath, templateName: invocation.templateName } as never,
      { directory: invocation.directory } as never,
    );
    if (typeof result === 'string') {
      throw new TypeError(`expected a tool output object, got: ${result}`);
    }
    return result as ToolResult;
  } finally {
    configSpy.mockRestore();
  }
};

const invokeGeneralTool = (filePath: string, templateName: string): Promise<ToolResult> =>
  invokeTool({
    filePath,
    templateName,
    directory: FIXTURE_DIRECTORY,
    templatesDirectory: FIXTURE_TEMPLATES_DIRECTORY,
  });

const invokeMixedTemplateTool = (filePath: string, templateName: string): Promise<ToolResult> =>
  invokeTool({
    filePath,
    templateName,
    directory: FIXTURE_DIRECTORY,
    templatesDirectory: REAL_TEMPLATES_DIRECTORY,
  });

const invokeRealTemplateTool = (filePath: string, templateName: string): Promise<ToolResult> =>
  invokeTool({
    filePath,
    templateName,
    directory: REAL_TEMPLATES_DIRECTORY,
    templatesDirectory: REAL_TEMPLATES_DIRECTORY,
  });

describe('verify_template lookup failures', () => {
  test('should return error if file not found', async () => {
    const result = await invokeGeneralTool('nonexistent.yml', TEST_TEMPLATE_NAME);
    expect(result.output).toContain('File not found at nonexistent.yml');
  });

  test('should return error if template not found', async () => {
    const result = await invokeGeneralTool('target.yml', 'nonexistent-template.yml');
    expect(result.output).toContain("Template 'nonexistent-template.yml' not found");
  });

  test('should prevent path traversal outside templates directory', async () => {
    const result = await invokeGeneralTool('valid.yml', '../../package.json');
    expect(result.output).toContain("Template '../../package.json' not found");
  });

  test('should reject template names containing slashes or backslashes', async () => {
    const slashResult = await invokeGeneralTool('valid.yml', 'nested/template.yml');
    expect(slashResult.output).toContain("Template 'nested/template.yml' not found");

    const backslashResult = await invokeGeneralTool('valid.yml', 'nested\\template.yml');
    expect(backslashResult.output).toContain("Template 'nested\\template.yml' not found");
  });
});

describe('verify_template YAML failures', () => {
  test('should return error if target file has invalid YAML syntax', async () => {
    const result = await invokeGeneralTool('templates/invalid-template.yml', TEST_TEMPLATE_NAME);
    expect(result.output).toContain('YAML Syntax Error in templates/invalid-template.yml');
  });

  test('should return error if reference template file has invalid YAML syntax', async () => {
    const result = await invokeGeneralTool('target.yml', INVALID_TEMPLATE_NAME);
    expect(result.output).toContain(`Internal Error: Failed to parse reference template YAML '${INVALID_TEMPLATE_NAME}'`);
  });

  test('should return error if target file is missing keys from template', async () => {
    const result = await invokeGeneralTool('missing-keys.yml', TEST_TEMPLATE_NAME);
    expect(result.output).toContain('YAML Structure Validation Failed');
    expect(result.output).toContain('- Missing key: key2');
  });

  test('should pass if target file matches template structure', async () => {
    const result = await invokeGeneralTool('valid.yml', TEST_TEMPLATE_NAME);
    expect(result.output).toBe(SUCCESS_OUTPUT);
  });
});

describe('template: orchestrator-state-base.yml', () => {
  const templateName = 'orchestrator-state-base.yml';

  test('successful verification: valid instance matching orchestrator-state-base', async () => {
    const result = await invokeRealTemplateTool(templateName, templateName);
    expect(result.output).toBe(SUCCESS_OUTPUT);
  });

  test("faulty verification: missing top-level section 'task'", async () => {
    const result = await invokeMixedTemplateTool('base-missing-task.yml', templateName);
    expect(result.output).toContain('YAML Structure Validation Failed');
    expect(result.output).toContain('- Missing key: task');
  });

  test("faulty verification: missing nested key 'orchestrator.created'", async () => {
    const result = await invokeMixedTemplateTool('base-missing-nested.yml', templateName);
    expect(result.output).toContain('YAML Structure Validation Failed');
    expect(result.output).toContain('- Missing key: orchestrator.created');
  });
});

describe('template: orchestrator-state-development.yml', () => {
  const templateName = 'orchestrator-state-development.yml';

  test('successful verification: valid instance matching orchestrator-state-development', async () => {
    const result = await invokeRealTemplateTool(templateName, templateName);
    expect(result.output).toBe(SUCCESS_OUTPUT);
  });

  test("faulty verification: missing top-level section 'task_context'", async () => {
    const result = await invokeMixedTemplateTool('dev-missing-context.yml', templateName);
    expect(result.output).toContain('YAML Structure Validation Failed');
    expect(result.output).toContain('- Missing key: task_context');
  });

  test("faulty verification: missing nested section 'task_context.data_lifecycle'", async () => {
    const result = await invokeMixedTemplateTool('dev-missing-nested.yml', templateName);
    expect(result.output).toContain('YAML Structure Validation Failed');
    expect(result.output).toContain('- Missing key: task_context.data_lifecycle');
  });
});

describe('template: orchestrator-state-migration.yml', () => {
  const templateName = 'orchestrator-state-migration.yml';

  test('successful verification: valid instance matching orchestrator-state-migration', async () => {
    const result = await invokeRealTemplateTool(templateName, templateName);
    expect(result.output).toBe(SUCCESS_OUTPUT);
  });

  test("faulty verification: missing top-level section 'migration_context'", async () => {
    const result = await invokeMixedTemplateTool('migration-missing-context.yml', templateName);
    expect(result.output).toContain('YAML Structure Validation Failed');
    expect(result.output).toContain('- Missing key: migration_context');
  });

  test("faulty verification: missing nested key 'migration_context.target_system'", async () => {
    const result = await invokeMixedTemplateTool('migration-missing-nested.yml', templateName);
    expect(result.output).toContain('YAML Structure Validation Failed');
    expect(result.output).toContain('- Missing key: migration_context.target_system');
  });

  test('binding proof: re-keyed migration state instance with completed_phases [state-analysed] validates against co-landed template', async () => {
    const result = await invokeMixedTemplateTool('migration-binding-proof.yml', templateName);
    expect(result.output).toBe(SUCCESS_OUTPUT);
  });
});

describe('template: orchestrator-state-performance.yml', () => {
  const templateName = 'orchestrator-state-performance.yml';

  test('successful verification: valid instance matching orchestrator-state-performance', async () => {
    const result = await invokeRealTemplateTool(templateName, templateName);
    expect(result.output).toBe(SUCCESS_OUTPUT);
  });

  test("faulty verification: missing top-level section 'performance_context'", async () => {
    const result = await invokeMixedTemplateTool('performance-missing-context.yml', templateName);
    expect(result.output).toContain('YAML Structure Validation Failed');
    expect(result.output).toContain('- Missing key: performance_context');
  });

  test("faulty verification: missing nested key 'performance_context.bottleneck_priorities'", async () => {
    const result = await invokeMixedTemplateTool('performance-missing-nested.yml', templateName);
    expect(result.output).toContain('YAML Structure Validation Failed');
    expect(result.output).toContain('- Missing key: performance_context.bottleneck_priorities');
  });
});

describe('template: orchestrator-state-research.yml', () => {
  const templateName = 'orchestrator-state-research.yml';

  test('successful verification: valid instance matching orchestrator-state-research', async () => {
    const result = await invokeRealTemplateTool(templateName, templateName);
    expect(result.output).toBe(SUCCESS_OUTPUT);
  });

  test('binding proof: re-keyed research state instance with completed_phases [brief-written] validates against co-landed template', async () => {
    const result = await invokeMixedTemplateTool('research-binding-proof.yml', templateName);
    expect(result.output).toBe(SUCCESS_OUTPUT);
  });

  test.each([
    {
      fixtureFile: 'research-missing-outputs.yml',
      missingKey: 'research_outputs',
      label: "missing top-level section 'research_outputs'",
    },
    {
      fixtureFile: 'research-missing-nested.yml',
      missingKey: 'research_context.gathering_strategy',
      label: "missing nested key 'research_context.gathering_strategy'",
    },
    {
      fixtureFile: 'research-missing-entry-point.yml',
      missingKey: 'orchestrator.entry_point',
      label: "missing nested key 'orchestrator.entry_point'",
    },
  ])('faulty verification: $label', async ({ fixtureFile, missingKey }) => {
    const result = await invokeMixedTemplateTool(fixtureFile, templateName);
    expect(result.output).toContain('YAML Structure Validation Failed');
    expect(result.output).toContain(`- Missing key: ${missingKey}`);
  });

  test("faulty verification: missing nested key 'research_context.phase_summaries.converge.decision_areas'", async () => {
    const result = await invokeMixedTemplateTool('research-missing-decision-areas.yml', templateName);
    expect(result.output).toContain('YAML Structure Validation Failed');
    expect(result.output).toContain('- Missing key: research_context.phase_summaries.converge.decision_areas');
  });
});
