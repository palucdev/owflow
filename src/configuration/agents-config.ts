import type { OpenCodeConfig } from "../types/opencode-types.js";
import { loadMarkdownDir } from "../utils/file-util.js";
import matter from "gray-matter";

/**
 * Resolves model aliases to the configured small_model value.
 * Maps common small/fast model aliases to OpenCode's small_model config.
 *
 * @param {string} modelValue - The model value from agent frontmatter
 * @param {string} smallModel - The small_model from OpenCode config
 * @returns {string|undefined} - Resolved model value or undefined
 */
const resolveModelAlias = (
  modelValue: string,
  smallModel: string,
): string | undefined => {
  // Aliases that should map to small_model
  const SMALL_MODEL_ALIASES = [
    "haiku", // Claude Code alias
    "gpt-4o-mini", // OpenAI small model
    "small", // Generic alias
    "fast", // Generic alias
  ];

  // If no model specified or it's 'inherit', return undefined (let OpenCode decide)
  if (!modelValue || modelValue === "inherit") {
    return undefined;
  }

  // If it's a small model alias and we have a configured small_model, use it
  if (SMALL_MODEL_ALIASES.includes(modelValue.toLowerCase())) {
    if (smallModel) {
      return smallModel;
    }
    // If no small_model configured, return undefined (inherit)
    console.warn(
      `[owflow] Agent uses '${modelValue}' but no small_model configured in opencode.json - falling back to inherit`,
    );
    return undefined;
  }

  // Otherwise, pass through the original value
  return modelValue;
};

const prepareAgent = (
  { data, content }: matter.GrayMatterFile<string>,
  smallModel: string,
) => {
  return {
    prompt: content,
    ...(data.description && { description: data.description }),
    // Resolve model aliases (haiku, gpt-4o-mini, etc.) to small_model
    ...(() => {
      const resolvedModel = resolveModelAlias(data.model, smallModel);
      return resolvedModel ? { model: resolvedModel } : {};
    })(),
    ...(data.mode && { mode: data.mode }),
    // Add skills array if present
    ...(data.skills && Array.isArray(data.skills) && { skills: data.skills }),
    ...(data.hidden === "true" && { hidden: true }),
  };
};

export const configureAgents = (
  config: OpenCodeConfig,
  smallModel: string,
): void => {
  config.agent = config.agent || {};
  for (const markdown of loadMarkdownDir("agents")) {
    const name = markdown.data.name;
    if (!name) continue;
    // Don't overwrite agents the user has explicitly configured
    if (config.agent[name]) continue;

    try {
      config.agent[name] = prepareAgent(markdown, smallModel);
    } catch (error) {
      console.warn(
        `[owflow] Failed to register agent '${name}': ${(error as Error).message}`,
      );
    }
  }
};
