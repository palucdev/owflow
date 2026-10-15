import path from "node:path";
import type {
  TuiPluginApi,
  TuiPluginModule,
  TuiToast,
} from "@opencode-ai/plugin/tui";
import { digest } from "./hooks-wrapper/digest.js";
import { resolveInterpreterAvailability } from "./hooks-wrapper/interpreters.js";
import { buildRegistry } from "./hooks-wrapper/registry.js";
import { renderTable } from "./hooks-wrapper/report.js";

const TOAST_TITLE = "owflow user hooks";

const WORKSPACE_UNAVAILABLE_MESSAGE =
  "workspace directory unavailable; cannot scan .owflow/hooks/";

/**
 * A3: the TUI is a separate process from the server, so the live registry is
 * unreachable; this re-derives the would-load set with the same pure modules.
 */
export const buildShowHooksToast = (directory: string): TuiToast => {
  const scan = digest(path.join(directory, ".owflow", "hooks"), "report");
  const registry = buildRegistry(
    scan.entries,
    resolveInterpreterAvailability(),
  );
  return {
    variant: scan.failures.length > 0 ? "warning" : "info",
    title: TOAST_TITLE,
    message: renderTable({
      entries: registry.entries,
      failures: scan.failures,
    }),
  };
};

export const workspaceUnavailableToast = (): TuiToast => ({
  variant: "warning",
  title: TOAST_TITLE,
  message: WORKSPACE_UNAVAILABLE_MESSAGE,
});

const tui = async (api: TuiPluginApi): Promise<void> => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "show-hooks",
        title: "Show user hooks",
        namespace: "palette",
        slashName: "owflow:show-hooks",
        run: () => {
          const directory = api.state.path.directory;
          const available =
            typeof directory === "string" && directory.length > 0;
          api.ui.toast(
            available
              ? buildShowHooksToast(directory)
              : workspaceUnavailableToast(),
          );
        },
      },
    ],
    bindings: [],
  });
};

export default { id: "owflow", tui } satisfies TuiPluginModule;
