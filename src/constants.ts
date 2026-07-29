import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = __dirname; // Points to dist/ where skills/commands/agents are copied
