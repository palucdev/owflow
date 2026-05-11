/**
 * Owflow OpenCode Plugin
 * Registers skills/agents/commands via OpenCode's JS event system.
 */

import type { Config, Plugin } from "@opencode-ai/plugin";

import path from "node:path";
import fs from "node:fs";

import { fileURLToPath } from "url";
import type { OpenCodeConfig } from "./types/opencode-types";
import matter from "gray-matter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = __dirname; // Points to dist/ where skills/commands/agents are copied

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

const loadMarkdownDir = (dirPath: string): matter.GrayMatterFile<string>[] => {
  try {
    return fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const raw = fs.readFileSync(path.join(dirPath, f), "utf8");
        return matter(raw);
      });
  } catch {
    return [];
  }
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

const OwflowPlugin: Plugin = async ({ $, directory }) => {
  const agentBySession = new Map();
  return {
    /**
     * Register owflow's skills, commands, and agents so OpenCode discovers
     * them without requiring manual config file edits.
     */
    config: async (config: unknown) => {
      let typedConfig = config as OpenCodeConfig;

      // Get small_model config for alias resolution
      // Try from config parameter first, fallback to reading opencode.json
      let smallModel = typedConfig.small_model ?? "";

      if (!smallModel) {
        try {
          // Check project-level opencode.json
          const projectConfigPath = path.join(directory, "opencode.json");
          if (fs.existsSync(projectConfigPath)) {
            const rawConfig = fs.readFileSync(projectConfigPath, "utf8");
            const opencodeConfig = JSON.parse(rawConfig);
            smallModel = opencodeConfig.small_model;
          }
        } catch (error) {
          console.warn(
            `Couldn't read or parse opencode.json config - small_model remains undefined`,
          );
        }
      }

      // --- Skills ---
      typedConfig.skills = typedConfig.skills || {};
      typedConfig.skills.paths = typedConfig.skills.paths || [];
      const skillsDir = path.join(PLUGIN_ROOT, "skills");
      if (!typedConfig.skills.paths.includes(skillsDir)) {
        typedConfig.skills.paths.push(skillsDir);
      }

      // --- Commands ---
      typedConfig.command = typedConfig.command || {};
      const commandsDir = path.join(PLUGIN_ROOT, "commands");
      for (const { data, content } of loadMarkdownDir(commandsDir)) {
        const name = data.name;
        if (!name) continue;
        // Don't overwrite commands the user has explicitly configured
        if (typedConfig.command[name]) continue;
        typedConfig.command[name] = {
          template: content,
          ...(data.description && { description: data.description }),
          ...(data.agent && { agent: data.agent }),
          ...(data.model && { model: data.model }),
          ...(data.subtask !== undefined && {
            subtask: data.subtask === "true",
          }),
        };
      }

      // --- Agents ---
      typedConfig.agent = typedConfig.agent || {};
      const agentsDir = path.join(PLUGIN_ROOT, "agents");
      for (const markdown of loadMarkdownDir(agentsDir)) {
        const name = markdown.data.name;
        if (!name) continue;
        // Don't overwrite agents the user has explicitly configured
        if (typedConfig.agent[name]) continue;

        try {
          typedConfig.agent[name] = prepareAgent(markdown, smallModel);
        } catch (error) {
          console.warn(
            `[owflow] Failed to register agent '${name}': ${(error as Error).message}`,
          );
        }
      }

      config = typedConfig;
    },

    /**
     * Post-compaction reminder.
     * Injects orchestrator state reminder into the compaction context so the
     * AI knows to re-read orchestrator-state.yml after the context is rebuilt.
     */
    "experimental.session.compacting": async (input, output) => {
      const tasksDir = `${directory}/.owflow/tasks`;
      try {
        await $`test -d ${tasksDir}`;
        output.context.push(`## owflow Workflow State
If an orchestrator workflow was active before compaction, you MUST re-read
orchestrator-state.yml in that task's directory to verify completed_phases
and determine the next phase. Use the question tool at Phase Gates.`);
      } catch {
        // No .owflow/tasks directory — not a owflow project, skip injection
      }
    },

    "chat.message": async (input, _output) => {
      try {
        agentBySession.set(input.sessionID, input.agent ?? "main");
      } catch {
        // ignore
      }
    },

    "tool.execute.before": async (input, output) => {
      try {
        if (input.tool !== "bash") return;
        const agentName = agentBySession.get(input.sessionID) ?? "main";
        const WHITELIST = [
          "task-group-implementer",
          "test-suite-runner",
          "e2e-test-verifier",
          "user-docs-generator",
          "docs-operator",
        ];
        if (WHITELIST.includes(agentName)) return;
        const cmd = output?.args?.command ?? "";
        const DESTRUCTIVE =
          /git\s+stash|git\s+reset\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*(?:$|\s)|git\s+clean|git\s+push\s+(?:--force|-f)|rm\s+-[rf]{2}/i;
        if (DESTRUCTIVE.test(cmd)) {
          throw new Error(
            `Blocked: destructive command not permitted for agent "${agentName}"`,
          );
        }
      } catch (e) {
        // Re-throw only intentional blocks; swallow unexpected errors
        if ((e as Error).message?.startsWith("Blocked:")) throw e;
      }
    },
  };
};

export default OwflowPlugin;
