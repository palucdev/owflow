import fs from 'node:fs';
import yaml from 'yaml';

export interface ParsedYaml {
  readonly isOk: boolean;
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

export const parseYamlFile = (absolutePath: string): ParsedYaml => {
  try {
    const fileContent = fs.readFileSync(absolutePath, 'utf8');
    const parsedData: unknown = yaml.parse(fileContent);
    return { isOk: true, ok: true, data: parsedData };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { isOk: false, ok: false, error: errorMessage };
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface StructuralErrorOptions {
  readonly templateObject: unknown;
  readonly targetObject: unknown;
  readonly currentPath?: string;
}

const checkStructuralErrors = (options: StructuralErrorOptions): string[] => {
  const { templateObject, targetObject, currentPath = '' } = options;
  const errors: string[] = [];

  if (!isRecord(templateObject)) {
    return errors;
  }

  const isTargetRecord = isRecord(targetObject);

  for (const [key, templateValue] of Object.entries(templateObject)) {
    const newPath = currentPath ? `${currentPath}.${key}` : key;

    if (!isTargetRecord || !Object.prototype.hasOwnProperty.call(targetObject, key)) {
      errors.push(`Missing key: ${newPath}`);
      continue;
    }

    if (isRecord(templateValue)) {
      errors.push(
        ...checkStructuralErrors({
          templateObject: templateValue,
          targetObject: targetObject[key],
          currentPath: newPath,
        }),
      );
    }
  }

  return errors;
};

export const findStructuralErrors = (
  templateObject: unknown,
  targetObject: unknown,
): string[] => checkStructuralErrors({ templateObject, targetObject });
