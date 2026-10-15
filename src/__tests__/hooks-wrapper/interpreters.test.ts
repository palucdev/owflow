import { describe, expect, spyOn, test } from "bun:test";
import {
  resolveInterpreterAvailability,
  resolveInterpreterFactory,
} from "../../hooks-wrapper/interpreters.js";

describe("resolveInterpreterFactory", () => {
  test("should resolve bash for .sh and pwsh for .ps1 through the real Bun.which default", () => {
    const paths: Record<string, string | null> = {
      bash: "/usr/bin/bash",
      pwsh: "/usr/bin/pwsh",
    };
    const whichSpy = spyOn(Bun, "which").mockImplementation(
      (command: string) => paths[command] ?? null,
    );

    try {
      const resolve = resolveInterpreterFactory();

      expect(resolve(".sh")).toEqual({
        resolved: "/usr/bin/bash",
        available: true,
      });
      expect(resolve(".ps1")).toEqual({
        resolved: "/usr/bin/pwsh",
        available: true,
      });
      expect(resolve(".ts")).toEqual({ available: true });
      expect(resolve(".js")).toEqual({ available: true });

      // In-process extensions never consult the PATH lookup, and a pwsh hit
      // means the Windows fallback candidate is never probed.
      expect(whichSpy).toHaveBeenCalledTimes(2);
      expect(whichSpy).toHaveBeenCalledWith("bash");
      expect(whichSpy).toHaveBeenCalledWith("pwsh");
      expect(whichSpy).not.toHaveBeenCalledWith("powershell.exe");
    } finally {
      whichSpy.mockRestore();
    }
  });
});

describe("resolveInterpreterAvailability", () => {
  test("should fall back to powershell.exe and record an unresolved interpreter as unavailable without throwing", () => {
    const which = (command: string): string | null =>
      command === "powershell.exe"
        ? "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
        : null;

    const availability = resolveInterpreterAvailability(which);

    expect(availability[".ps1"]).toEqual({
      resolved: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
      available: true,
    });
    expect(availability[".sh"]).toEqual({
      expected: "bash",
      available: false,
    });
    expect(availability[".ts"]).toEqual({ available: true });
    expect(availability[".js"]).toEqual({ available: true });
  });
});
