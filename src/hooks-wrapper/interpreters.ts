import type {
  HookExtension,
  InterpreterAvailability,
  InterpreterResolution,
} from "./types.js";

/** Injectable `Bun.which` seam; `null` means the executable is not on PATH. */
export type WhichInterpreter = (command: string) => string | null;

/** Candidate order per extension: first hit wins; `.ps1` falls back to Windows PowerShell. */
const INTERPRETER_CANDIDATES: Readonly<
  Record<".sh" | ".ps1", readonly [string, ...string[]]>
> = Object.freeze({
  ".sh": ["bash"],
  ".ps1": ["pwsh", "powershell.exe"],
});

/** Display name shared by report rows and gate hints (R2.2). */
export const interpreterName = (interpreter: InterpreterResolution): string =>
  interpreter.resolved ?? interpreter.expected ?? "runtime";

/** Report-cell label rendered identically by every visibility surface. */
export const interpreterLabel = (interpreter: InterpreterResolution): string =>
  `${interpreterName(interpreter)} (${
    interpreter.available ? "available" : "missing"
  })`;

export type InterpreterResolver = (
  extension: HookExtension,
) => InterpreterResolution;

/**
 * Resolves interpreters once at init. A missing executable is only an
 * availability flag — never a registration error (R3.2, R5.3).
 */
export const resolveInterpreterFactory = (
  which: WhichInterpreter = Bun.which,
): InterpreterResolver => {
  return (extension) => {
    if (extension !== ".sh" && extension !== ".ps1") return { available: true };
    for (const candidate of INTERPRETER_CANDIDATES[extension]) {
      const resolved = which(candidate);
      if (typeof resolved === "string" && resolved.length > 0) {
        return { resolved, available: true };
      }
    }
    return { expected: INTERPRETER_CANDIDATES[extension][0], available: false };
  };
};

/** Builds the full availability table the registry is frozen with. */
export const resolveInterpreterAvailability = (
  which: WhichInterpreter = Bun.which,
): InterpreterAvailability => {
  const resolve = resolveInterpreterFactory(which);
  return Object.freeze({
    ".ts": resolve(".ts"),
    ".js": resolve(".js"),
    ".sh": resolve(".sh"),
    ".ps1": resolve(".ps1"),
  });
};
