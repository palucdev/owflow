import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findStructuralErrors,
  parseYamlFile,
} from "../utils/yaml-structure.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const verify_template = tool({
  description: "Check if file in the given path exists and follows correct YAML structure by checking against the template file from /templates.",
  args: {
    filePath: tool.schema.string().describe("Path to the file to check"),
    templateName: tool.schema.string().describe("Name of the template from /templates (e.g. orchestrator-state-development.yml)"),
  },
  async execute({ filePath, templateName }, context) {
    const absolutePath = path.resolve(context.directory, filePath);

    if (!fs.existsSync(absolutePath)) {
      return { output: `File not found at ${filePath}. Hint: Double-check the path, create the file if it's missing, or verify you are in the correct directory.` };
    }

    const templatePath = path.join(__dirname, "../templates", templateName);

    if (!fs.existsSync(templatePath)) {
      return { output: `Template '${templateName}' not found. Hint: Verify the template name is correct and exists in the /templates folder (e.g., 'orchestrator-state-development.yml').` };
    }

    let targetYaml;
    const parsedTarget = parseYamlFile(absolutePath);
    if (!parsedTarget.ok) {
      return { output: `YAML Syntax Error in ${filePath}: ${parsedTarget.error}. Hint: Check the file content for invalid YAML formatting, such as incorrect indentation or unescaped strings, and fix them.` };
    }
    targetYaml = parsedTarget.data;

    let templateYaml;
    const parsedTemplate = parseYamlFile(templatePath);
    if (!parsedTemplate.ok) {
      return { output: `Internal Error: Failed to parse reference template YAML '${templateName}': ${parsedTemplate.error}. Hint: The template file itself contains invalid YAML syntax.` };
    }
    templateYaml = parsedTemplate.data;

    const errors = findStructuralErrors(templateYaml, targetYaml);

    if (errors.length > 0) {
      return { output: `YAML Structure Validation Failed. Your file is missing the following required keys:\n- ${errors.join("\n- ")}\n\nHint: Update the file at ${filePath} to include these missing keys so it matches the structure of '${templateName}'.` };
    }

    return { output: "File exists and follows the correct YAML structure." };
  }
});
