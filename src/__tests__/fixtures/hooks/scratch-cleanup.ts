import fs from 'node:fs';
import path from 'node:path';

const SCRATCH_BASE = path.join(process.cwd(), '.test-scratch');

export const removeScratchDirectory = (fileScratchRoot: string): void => {
  fs.rmSync(fileScratchRoot, { recursive: true, force: true });
  try {
    fs.rmdirSync(SCRATCH_BASE);
  } catch {
    // The scratch base may still be in use by another test file, or may already be removed.
  }
};
