import { make as makeTool } from "@opencode-ai/plugin/v2/effect/tool";
import { Schema, Effect } from "effect";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const verify_template = makeTool({
  description:
    "Check if file in the given path exists and follows correct YAML structure by checking against the template file from /templates.",
  input: Schema.Struct({
    filePath: Schema.String,
    templateName: Schema.String,
  }),
  output: Schema.Struct({
    output: Schema.String,
  }),
  execute: (input: { filePath: string; templateName: string }) =>
    Effect.sync(() => {
      const { filePath, templateName } = input;
      const absolutePath = path.resolve(process.cwd(), filePath);

      if (!fs.existsSync(absolutePath)) {
        return {
          output: `File not found at ${filePath}. Hint: Double-check the path, create the file if it's missing, or verify you are in the correct directory.`,
        };
      }

      const templatePath = path.join(__dirname, "../templates", templateName);

      if (!fs.existsSync(templatePath)) {
        return {
          output: `Template '${templateName}' not found. Hint: Verify the template name is correct and exists in the /templates folder (e.g., 'orchestrator-state-development.yml').`,
        };
      }

      let targetYaml;
      try {
        const fileContent = fs.readFileSync(absolutePath, "utf8");
        targetYaml = yaml.parse(fileContent);
      } catch (error: any) {
        return {
          output: `YAML Syntax Error in ${filePath}: ${error.message}. Hint: Check the file content for invalid YAML formatting, such as incorrect indentation or unescaped strings, and fix them.`,
        };
      }

      let templateYaml;
      try {
        const templateContent = fs.readFileSync(templatePath, "utf8");
        templateYaml = yaml.parse(templateContent);
      } catch (error: any) {
        return {
          output: `Internal Error: Failed to parse reference template YAML '${templateName}': ${error.message}. Hint: The template file itself contains invalid YAML syntax.`,
        };
      }

      function checkStructure(
        templateObj: any,
        targetObj: any,
        currentPath: string = "",
      ): string[] {
        let errors: string[] = [];

        if (typeof templateObj !== "object" || templateObj === null) {
          return errors;
        }

        for (const key of Object.keys(templateObj)) {
          const newPath = currentPath ? `${currentPath}.${key}` : key;

          if (
            typeof targetObj !== "object" ||
            targetObj === null ||
            !(key in targetObj)
          ) {
            errors.push(`Missing key: ${newPath}`);
            continue;
          }

          if (
            typeof templateObj[key] === "object" &&
            templateObj[key] !== null &&
            !Array.isArray(templateObj[key])
          ) {
            errors.push(
              ...checkStructure(templateObj[key], targetObj[key], newPath),
            );
          }
        }

        return errors;
      }

      const errors = checkStructure(templateYaml, targetYaml);

      if (errors.length > 0) {
        return {
          output: `YAML Structure Validation Failed. Your file is missing the following required keys:\n- ${errors.join("\n- ")}\n\nHint: Update the file at ${filePath} to include these missing keys so it matches the structure of '${templateName}'.`,
        };
      }

      return { output: "File exists and follows the correct YAML structure." };
    }),
});
