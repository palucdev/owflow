import fs from "node:fs";
import yaml from "yaml";

export interface ParsedYaml {
  ok: boolean;
  data?: any;
  error?: string;
}

export const parseYamlFile = (absolutePath: string): ParsedYaml => {
  try {
    const fileContent = fs.readFileSync(absolutePath, "utf8");
    return { ok: true, data: yaml.parse(fileContent) };
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
};

export const findStructuralErrors = (
  templateObj: any,
  targetObj: any,
  currentPath: string = "",
): string[] => {
  const errors: string[] = [];

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
        ...findStructuralErrors(templateObj[key], targetObj[key], newPath),
      );
    }
  }

  return errors;
};
