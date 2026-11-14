import { tool } from '@opencode-ai/plugin';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultEnvironmentConfig, type EnvironmentConfig } from '../utils/environment-config.js';
import { findStructuralErrors, parseYamlFile } from '../utils/yaml-structure.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ResolveTemplatePathOptions {
  readonly templateName: string;
  readonly config?: EnvironmentConfig;
}

const resolveTemplatePath = (options: ResolveTemplatePathOptions): string | undefined => {
  const config = options.config ?? createDefaultEnvironmentConfig();
  const templatesDirectory = path.resolve(
    config.templatesDirectory ?? path.join(__dirname, '../templates'),
  );
  const safeTemplateName = path.basename(options.templateName);
  const templatePath = path.resolve(templatesDirectory, safeTemplateName);

  const isInvalid =
    options.templateName !== safeTemplateName ||
    options.templateName.includes('..') ||
    !templatePath.startsWith(templatesDirectory + path.sep) ||
    !fs.existsSync(templatePath);

  return isInvalid ? undefined : templatePath;
};

export const verify_template = tool({
  description:
    'Check if file in the given path exists and follows correct YAML structure by checking against the template file from /templates.',
  args: {
    filePath: tool.schema.string().describe('Path to the file to check'),
    templateName: tool.schema
      .string()
      .describe('Name of the template from /templates (e.g. orchestrator-state-development.yml)'),
  },
  async execute({ filePath, templateName }, context) {
    const absolutePath = path.resolve(context.directory, filePath);
    if (!fs.existsSync(absolutePath)) {
      return {
        output: `File not found at ${filePath}. Hint: Double-check the path, create the file if it's missing, or verify you are in the correct directory.`,
      };
    }

    const templatePath = resolveTemplatePath({ templateName });
    if (!templatePath) {
      return {
        output: `Template '${templateName}' not found. Hint: Verify the template name is correct and exists in the /templates folder (e.g., 'orchestrator-state-development.yml').`,
      };
    }

    const parsedTarget = parseYamlFile(absolutePath);
    if (!parsedTarget.isOk) {
      return {
        output: `YAML Syntax Error in ${filePath}: ${parsedTarget.error}. Hint: Check the file content for invalid YAML formatting, such as incorrect indentation or unescaped strings, and fix them.`,
      };
    }

    const parsedTemplate = parseYamlFile(templatePath);
    if (!parsedTemplate.isOk) {
      return {
        output: `Internal Error: Failed to parse reference template YAML '${templateName}': ${parsedTemplate.error}. Hint: The template file itself contains invalid YAML syntax.`,
      };
    }

    const errors = findStructuralErrors(parsedTemplate.data, parsedTarget.data);
    if (errors.length > 0) {
      return {
        output: `YAML Structure Validation Failed. Your file is missing the following required keys:\n- ${errors.join('\n- ')}\n\nHint: Update the file at ${filePath} to include these missing keys so it matches the structure of '${templateName}'.`,
      };
    }

    return { output: 'File exists and follows the correct YAML structure.' };
  },
});
