import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = path.join(__dirname, ".."); // Points to dist/ where skills/commands/agents are copied

const UNKNOWN_VERSION = "unknown";

export const readPluginVersion = (pluginRoot: string = PLUGIN_ROOT): string => {
  try {
    const packageJsonPath = path.join(pluginRoot, "..", "package.json");
    const raw = fs.readFileSync(packageJsonPath, "utf8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" && version.length > 0
      ? version
      : UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
};

export const PLUGIN_VERSION = readPluginVersion();
