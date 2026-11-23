import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROBE_TARGET_FILE = 'probe-target.txt';
const PROBE_LINK_FILE = 'probe-link.txt';

const canCreateSymlinks = (): boolean => {
  const probeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'owflow-symlink-probe-'));
  try {
    const targetPath = path.join(probeDirectory, PROBE_TARGET_FILE);
    fs.writeFileSync(targetPath, 'probe');
    const linkPath = path.join(probeDirectory, PROBE_LINK_FILE);
    fs.symlinkSync(targetPath, linkPath);
    return fs.lstatSync(linkPath).isSymbolicLink();
  } catch {
    return false;
  } finally {
    fs.rmSync(probeDirectory, { recursive: true, force: true });
  }
};

// True when symlink creation is permitted (Windows requires Developer Mode or an elevated shell).
export const isSymlinkCreationSupported = canCreateSymlinks();

// Resolved the same way production resolves hook interpreters; null when bash is unavailable.
export const bashInterpreter: string | null = Bun.which('bash');
