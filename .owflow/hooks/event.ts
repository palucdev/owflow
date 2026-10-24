import path from "node:path";
import { fileURLToPath } from "node:url";

type Envelope = {
  event: string;
  session?: { sessionID: string };
  context: Record<string, unknown>;
};

type HostEvent = {
  type?: string;
  properties?: Record<string, unknown>;
};

const PROTOCOL = "owflow-hooks/1";
const PROJECT_ROOT = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);
const BUILD_COMMAND_PATTERN = /\bbun\s+run\s+build\b/;
const IMPLEMENTATION_TOOLS = new Set([
  "edit",
  "write",
  "multiedit",
  "apply_patch",
  "patch",
]);
const IMPLEMENTATION_ROOT_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "bun.lock",
  "bun.lockb",
]);
const IMPLEMENTATION_ROOT_DIRS = ["src/", "scripts/"];
const PATCH_PATH_PATTERN =
  /^\*\*\* (?:Add|Update|Delete|Move)\b[^:]*:\s*(.+)$/;

const parentSessions = new Map<string, string>();
const dirtySessions = new Set<string>();
const editSequences = new Map<string, number>();
const pendingAgentBuilds = new Map<
  string,
  { root: string; sequence: number }
>();
let building = false;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asExitCode = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const hostEventFrom = (envelope: Envelope): HostEvent => {
  const wrapped = asRecord(envelope.context).event;
  return asRecord(wrapped ?? envelope.context) as HostEvent;
};

const rootSession = (sessionID: string): string => {
  let current = sessionID;
  const seen = new Set<string>();
  for (;;) {
    const parent = parentSessions.get(current);
    if (parent === undefined || seen.has(parent)) return current;
    seen.add(current);
    current = parent;
  }
};

const rememberSession = (
  id: string | undefined,
  parentID: string | undefined,
): void => {
  if (id === undefined) return;
  if (parentID !== undefined && parentID !== id) {
    parentSessions.set(id, parentID);
  } else {
    parentSessions.delete(id);
  }
};

const forgetSession = (sessionID: string): void => {
  const affected = new Set<string>([sessionID]);
  for (const [child, parent] of parentSessions) {
    if (parent === sessionID) affected.add(child);
  }
  for (const id of affected) {
    parentSessions.delete(id);
    dirtySessions.delete(id);
    editSequences.delete(id);
  }
  for (const [callID, build] of pendingAgentBuilds) {
    if (affected.has(build.root)) pendingAgentBuilds.delete(callID);
  }
};

const isImplementationPath = (file: string): boolean => {
  const normalized = file.replaceAll("\\", "/");
  const relative = path.isAbsolute(normalized)
    ? path.relative(PROJECT_ROOT, normalized).replaceAll("\\", "/")
    : normalized.replace(/^\.\//, "");
  if (relative.startsWith("../") || relative === "..") return false;
  if (IMPLEMENTATION_ROOT_FILES.has(relative)) return true;
  return IMPLEMENTATION_ROOT_DIRS.some((directory) =>
    relative.startsWith(directory),
  );
};

const editSequence = (root: string): number => editSequences.get(root) ?? 0;

const markDirty = (root: string): void => {
  dirtySessions.add(root);
  editSequences.set(root, editSequence(root) + 1);
};

const patchFiles = (part: Record<string, unknown>): string[] => {
  const files = Array.isArray(part.files) ? part.files : [];
  return files.filter((file): file is string => typeof file === "string");
};

const patchTextFiles = (text: string | undefined): string[] => {
  if (text === undefined) return [];
  return text
    .split("\n")
    .map((line) => PATCH_PATH_PATTERN.exec(line.trim())?.[1]?.trim())
    .filter((file): file is string => file !== undefined && file.length > 0);
};

const recordAgentBuild = (
  root: string,
  callID: string | undefined,
  state: Record<string, unknown>,
  command: string | undefined,
  status: string | undefined,
): void => {
  if (callID === undefined || command === undefined) return;
  if (!BUILD_COMMAND_PATTERN.test(command)) return;

  if (status === "completed") {
    const pending = pendingAgentBuilds.get(callID);
    pendingAgentBuilds.delete(callID);
    if (asExitCode(asRecord(state.metadata).exit) !== 0) return;
    if (pending !== undefined && pending.root !== root) return;
    if (pending !== undefined && editSequence(root) !== pending.sequence) {
      return;
    }
    dirtySessions.delete(root);
    console.log(
      "[owflow] build-hook: agent already ran bun run build successfully; skipping forced build",
    );
    return;
  }

  if (status !== "running" && status !== "pending") return;
  if (!pendingAgentBuilds.has(callID)) {
    pendingAgentBuilds.set(callID, { root, sequence: editSequence(root) });
  }
};

const trackMessagePart = (properties: Record<string, unknown>): void => {
  const part = asRecord(properties.part);
  const sessionID = asString(part.sessionID);
  if (sessionID === undefined) return;
  const root = rootSession(sessionID);

  if (part.type === "patch") {
    if (patchFiles(part).some(isImplementationPath)) markDirty(root);
    return;
  }

  if (part.type !== "tool") return;
  const tool = asString(part.tool);
  if (tool === undefined) return;

  const state = asRecord(part.state);
  const status = asString(state.status);
  const callID = asString(part.callID);
  const input = asRecord(state.input);

  if (tool === "bash") {
    recordAgentBuild(root, callID, state, asString(input.command), status);
    return;
  }

  if (status !== "completed" || !IMPLEMENTATION_TOOLS.has(tool)) return;
  const filePath =
    asString(input.filePath) ?? asString(input.path) ?? asString(input.file);
  if (filePath !== undefined) {
    if (isImplementationPath(filePath)) markDirty(root);
    return;
  }
  const patchPaths = patchTextFiles(asString(input.patchText));
  if (patchPaths.length > 0) {
    if (patchPaths.some(isImplementationPath)) markDirty(root);
    return;
  }
  if (tool === "apply_patch" || tool === "patch") markDirty(root);
};

const runForcedBuild = async (root: string): Promise<void> => {
  building = true;
  const startedAt = Date.now();
  console.log(
    `[owflow] build-hook: implementation changes detected (session ${root}); running bun run build`,
  );
  try {
    const bun = Bun.which("bun") ?? process.execPath;
    const proc = Bun.spawn([bun, "run", "build"], {
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (exitCode === 0) {
      console.log(`[owflow] build-hook: bun run build passed in ${elapsed}s`);
    } else {
      const tail = `${stdout}\n${stderr}`
        .trim()
        .split("\n")
        .slice(-40)
        .join("\n");
      console.error(
        `[owflow] build-hook: bun run build FAILED (exit ${exitCode ?? "signal"}) after ${elapsed}s`,
      );
      if (tail.length > 0) console.error(tail);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[owflow] build-hook: could not run bun run build: ${message}`,
    );
  } finally {
    building = false;
  }
};

const trackHostEvent = (hostEvent: HostEvent): void => {
  const properties = asRecord(hostEvent.properties);
  switch (hostEvent.type) {
    case "session.created":
    case "session.updated": {
      const info = asRecord(properties.info);
      rememberSession(asString(info.id), asString(info.parentID));
      return;
    }
    case "session.deleted": {
      const info = asRecord(properties.info);
      const id = asString(info.id);
      if (id !== undefined) forgetSession(id);
      return;
    }
    case "message.part.updated": {
      trackMessagePart(properties);
      return;
    }
    case "session.idle": {
      const sessionID = asString(properties.sessionID);
      if (sessionID === undefined) return;
      if (parentSessions.has(sessionID)) return;
      const root = rootSession(sessionID);
      if (root !== sessionID) return;
      if (!dirtySessions.has(root) || building) return;
      dirtySessions.delete(root);
      void runForcedBuild(root);
      return;
    }
    default:
      return;
  }
};

export default async (envelope: Envelope) => {
  try {
    trackHostEvent(hostEventFrom(envelope));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[owflow] build-hook: ignored ${envelope.event} error: ${message}`,
    );
  }
  return { protocol: PROTOCOL, status: "ok" as const };
};
