import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { PLUGIN_VERSION, readPluginVersion } from "../../utils/plugin-info.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "../../..");

describe("plugin-info", () => {
  let tmpDir: string;

  /** Mirrors the real layout: package.json sits one level above the plugin root. */
  const makePluginRoot = (packageJson: string | null): string => {
    const root = path.join(tmpDir, "dist");
    fs.mkdirSync(root, { recursive: true });
    if (packageJson !== null) {
      fs.writeFileSync(path.join(tmpDir, "package.json"), packageJson, "utf8");
    }
    return root;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owflow-plugin-info-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("PLUGIN_VERSION", () => {
    test("should match the version in the repository package.json", () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
      ) as { version: string };

      expect(PLUGIN_VERSION).toBe(pkg.version);
    });

    test("should resolve from the default plugin root", () => {
      expect(readPluginVersion()).toBe(PLUGIN_VERSION);
    });
  });

  describe("readPluginVersion", () => {
    test("should read the version from package.json above the plugin root", () => {
      const root = makePluginRoot(JSON.stringify({ version: "1.2.3" }));
      expect(readPluginVersion(root)).toBe("1.2.3");
    });

    test("should return 'unknown' when package.json is missing", () => {
      const root = makePluginRoot(null);
      expect(readPluginVersion(root)).toBe("unknown");
    });

    test("should return 'unknown' when package.json is not valid JSON", () => {
      const root = makePluginRoot("not-json{");
      expect(readPluginVersion(root)).toBe("unknown");
    });

    test("should return 'unknown' when the version field is absent", () => {
      const root = makePluginRoot(JSON.stringify({ name: "owflow" }));
      expect(readPluginVersion(root)).toBe("unknown");
    });

    test("should return 'unknown' when the version field is not a non-empty string", () => {
      expect(
        readPluginVersion(makePluginRoot(JSON.stringify({ version: 123 }))),
      ).toBe("unknown");
      expect(
        readPluginVersion(makePluginRoot(JSON.stringify({ version: "" }))),
      ).toBe("unknown");
    });
  });
});
