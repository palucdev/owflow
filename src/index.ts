/**
 * Owflow OpenCode Plugin
 * Registers skills/agents/commands via OpenCode's JS event system.
 */

import { Plugin } from "@opencode-ai/plugin/v2/effect";
import { Effect } from "effect";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { verify_template } from "./tools/verify_template";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = __dirname; // Points to dist/ where skills/commands/agents are copied

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

const prepareAgent = ({ data, content }: matter.GrayMatterFile<string>) => {
  return {
    prompt: content,
    ...(data.description && { description: data.description }),
    ...(data.model && { model: data.model }),
    ...(data.mode && { mode: data.mode }),
    // Add skills array if present
    ...(data.skills && Array.isArray(data.skills) && { skills: data.skills }),
    ...(data.hidden === "true" && { hidden: true }),
  };
};

export default Plugin.define({
  id: "owflow",
  effect: (ctx) => Effect.gen(function* () {
    // Register tool
    yield* ctx.tool.transform((draft) => {
      draft.add("verify_template", verify_template);
    });

    // Register skills directory
    yield* ctx.skill.transform((draft) => {
      draft.source({
        type: "directory",
        path: path.join(PLUGIN_ROOT, "skills")
      });
    });

    // Register commands
    yield* ctx.command.transform((draft) => {
      const commandsDir = path.join(PLUGIN_ROOT, "commands");
      for (const { data, content } of loadMarkdownDir(commandsDir)) {
        const name = data.name;
        if (!name) continue;
        draft.update(name, (cmd) => {
          cmd.template = content;
          if (data.description) cmd.description = data.description;
          if (data.agent) cmd.agent = data.agent;
          if (data.model) cmd.model = data.model;
          if (data.subtask !== undefined) cmd.subtask = data.subtask === "true";
        });
      }
    });

    // Register agents
    yield* ctx.agent.transform((draft) => {
      const agentsDir = path.join(PLUGIN_ROOT, "agents");
      for (const markdown of loadMarkdownDir(agentsDir)) {
        const name = markdown.data.name;
        if (!name) continue;
        try {
          draft.update(name, (agent) => {
            Object.assign(agent, prepareAgent(markdown));
          });
        } catch (error) {
          console.warn(
            `[owflow] Failed to register agent '${name}': ${(error as Error).message}`
          );
        }
      }
    });

    // Tool Execute Hook (Intercepting Bash)
    yield* ctx.tool.hook("execute.before", (event) => Effect.sync(() => {
      if (event.tool !== "bash") return;
      
      const agentName = event.agent ?? "main";
      const WHITELIST = [
        "task-group-implementer",
        "test-suite-runner",
        "e2e-test-verifier",
        "user-docs-generator",
        "docs-operator",
      ];
      if (WHITELIST.includes(agentName)) return;
      
      const input = event.input as { command?: string };
      const cmd = input.command ?? "";
      const DESTRUCTIVE = /git\s+stash|git\s+reset\s+--hard|git\s+checkout\s+--\s+\.|git\s+checkout\s+\.\s*(?:$|\s)|git\s+clean|git\s+push\s+(?:--force|-f)|rm\s+-[rf]{2}/i;
      
      if (DESTRUCTIVE.test(cmd)) {
        throw new Error(`Blocked: destructive command not permitted for agent "${agentName}"`);
      }
    }));

    // Session Hook (Compaction replacement)
    yield* ctx.session.hook("context", (event) => Effect.sync(() => {
      const tasksDir = path.join(process.cwd(), ".owflow/tasks");
      try {
        if (fs.existsSync(tasksDir)) {
          // Changed event.context.system.push to event.system.push
          event.system.push({
            type: "text",
            text: "## owflow Workflow State\nIf an orchestrator workflow was active before compaction, you MUST re-read orchestrator-state.yml in that task's directory to verify completed_phases and determine the next phase. Use the question tool at Phase Gates."
          });
        }
      } catch {
        // ignore
      }
    }));

  })
});
