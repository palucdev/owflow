import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createVerifyTemplateTool, verify_template } from '../../tools/verify-template.js';
import { createTestEnvironmentConfig } from '../../utils/environment-config.js';
import { createToolContext, outputOf } from '../fixtures/tools/tool-test-harness.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const templatesDirectory = path.join(__dirname, '../../templates');
const fixturesDirectory = path.join(__dirname, '../fixtures/verify-template');
const testTemplateName = 'test-template.yml';

const fixtureTemplatesTool = createVerifyTemplateTool(createTestEnvironmentConfig({ templatesDirectory: path.join(fixturesDirectory, 'templates') }));

const executeFixtureTool = async (filePath: string, templateName: string): Promise<string> =>
  outputOf(await fixtureTemplatesTool.execute({ filePath, templateName }, createToolContext(fixturesDirectory)));

const executeDefaultTool = async (directory: string, toolArguments: { readonly filePath: string; readonly templateName: string }): Promise<string> =>
  outputOf(await verify_template.execute(toolArguments, createToolContext(directory)));

const STATE_TEMPLATE_NAMES: string[] = [
  'orchestrator-state-base.yml',
  'orchestrator-state-development.yml',
  'orchestrator-state-migration.yml',
  'orchestrator-state-performance.yml',
  'orchestrator-state-research.yml',
];

const UNSAFE_TEMPLATE_NAMES: string[] = ['../../package.json', 'nested/template.yml', 'nested\\template.yml'];

interface MissingKeyCase {
  readonly title: string;
  readonly fixture: string;
  readonly templateName: string;
  readonly missingKey: string;
}

const MISSING_KEY_CASES: MissingKeyCase[] = [
  {
    title: "base: missing top-level section 'task'",
    fixture: 'base-missing-task.yml',
    templateName: 'orchestrator-state-base.yml',
    missingKey: 'task',
  },
  {
    title: "base: missing nested key 'orchestrator.created'",
    fixture: 'base-missing-nested.yml',
    templateName: 'orchestrator-state-base.yml',
    missingKey: 'orchestrator.created',
  },
  {
    title: "development: missing top-level section 'task_context'",
    fixture: 'dev-missing-context.yml',
    templateName: 'orchestrator-state-development.yml',
    missingKey: 'task_context',
  },
  {
    title: "development: missing nested section 'task_context.data_lifecycle'",
    fixture: 'dev-missing-nested.yml',
    templateName: 'orchestrator-state-development.yml',
    missingKey: 'task_context.data_lifecycle',
  },
  {
    title: "migration: missing top-level section 'migration_context'",
    fixture: 'migration-missing-context.yml',
    templateName: 'orchestrator-state-migration.yml',
    missingKey: 'migration_context',
  },
  {
    title: "migration: missing nested key 'migration_context.target_system'",
    fixture: 'migration-missing-nested.yml',
    templateName: 'orchestrator-state-migration.yml',
    missingKey: 'migration_context.target_system',
  },
  {
    title: "performance: missing top-level section 'performance_context'",
    fixture: 'performance-missing-context.yml',
    templateName: 'orchestrator-state-performance.yml',
    missingKey: 'performance_context',
  },
  {
    title: "performance: missing nested key 'performance_context.bottleneck_priorities'",
    fixture: 'performance-missing-nested.yml',
    templateName: 'orchestrator-state-performance.yml',
    missingKey: 'performance_context.bottleneck_priorities',
  },
  {
    title: "research: missing top-level section 'research_outputs'",
    fixture: 'research-missing-outputs.yml',
    templateName: 'orchestrator-state-research.yml',
    missingKey: 'research_outputs',
  },
  {
    title: "research: missing nested key 'research_context.gathering_strategy'",
    fixture: 'research-missing-nested.yml',
    templateName: 'orchestrator-state-research.yml',
    missingKey: 'research_context.gathering_strategy',
  },
  {
    title: "research: missing nested key 'orchestrator.entry_point'",
    fixture: 'research-missing-entry-point.yml',
    templateName: 'orchestrator-state-research.yml',
    missingKey: 'orchestrator.entry_point',
  },
  {
    title: "research: missing nested key 'research_context.phase_summaries.converge.decision_areas'",
    fixture: 'research-missing-decision-areas.yml',
    templateName: 'orchestrator-state-research.yml',
    missingKey: 'research_context.phase_summaries.converge.decision_areas',
  },
];

interface BindingProofCase {
  readonly title: string;
  readonly fixture: string;
  readonly templateName: string;
}

const BINDING_PROOF_CASES: BindingProofCase[] = [
  {
    title: 'binding proof: re-keyed migration state instance with completed_phases [state-analysed] validates against co-landed template',
    fixture: 'migration-binding-proof.yml',
    templateName: 'orchestrator-state-migration.yml',
  },
  {
    title: 'binding proof: re-keyed research state instance with completed_phases [brief-written] validates against co-landed template',
    fixture: 'research-binding-proof.yml',
    templateName: 'orchestrator-state-research.yml',
  },
];

describe('verify_template tool: general behavior', () => {
  test('should return error if file not found', async () => {
    expect(await executeFixtureTool('nonexistent.yml', testTemplateName)).toContain('File not found at nonexistent.yml');
  });

  test('should return error if template not found', async () => {
    const output = await executeFixtureTool('target.yml', 'nonexistent-template.yml');
    expect(output).toContain("Template 'nonexistent-template.yml' not found");
  });

  test('should return error if target file has invalid YAML syntax', async () => {
    const output = await executeFixtureTool('templates/invalid-template.yml', testTemplateName);
    expect(output).toContain('YAML Syntax Error in templates/invalid-template.yml');
  });

  test('should return error if reference template file has invalid YAML syntax', async () => {
    const output = await executeFixtureTool('target.yml', 'invalid-template.yml');
    expect(output).toContain("Internal Error: Failed to parse reference template YAML 'invalid-template.yml'");
  });

  test('should return error if target file is missing keys from template', async () => {
    const output = await executeFixtureTool('missing-keys.yml', testTemplateName);
    expect(output).toContain('YAML Structure Validation Failed');
    expect(output).toContain('- Missing key: key2');
  });

  test('should pass if target file matches template structure', async () => {
    expect(await executeFixtureTool('valid.yml', testTemplateName)).toBe('File exists and follows the correct YAML structure.');
  });

  test.each(UNSAFE_TEMPLATE_NAMES)("should reject unsafe template name '%s'", async (templateName) => {
    expect(await executeFixtureTool('valid.yml', templateName)).toContain(`Template '${templateName}' not found`);
  });
});

describe('verify_template tool: state templates', () => {
  test.each(STATE_TEMPLATE_NAMES)('%s validates against itself', async (templateName) => {
    expect(await executeDefaultTool(templatesDirectory, { filePath: templateName, templateName })).toBe(
      'File exists and follows the correct YAML structure.',
    );
  });

  test.each(MISSING_KEY_CASES)('$title', async (row) => {
    const output = await executeDefaultTool(fixturesDirectory, { filePath: row.fixture, templateName: row.templateName });
    expect(output).toContain('YAML Structure Validation Failed');
    expect(output).toContain(`- Missing key: ${row.missingKey}`);
  });

  test.each(BINDING_PROOF_CASES)('$title', async (row) => {
    expect(await executeDefaultTool(fixturesDirectory, { filePath: row.fixture, templateName: row.templateName })).toBe(
      'File exists and follows the correct YAML structure.',
    );
  });
});
