import fs from 'node:fs';

// Markdown assets are shipped inside dist/ alongside the compiled plugin.
const DIST_FOLDERS = ['skills', 'agents', 'commands', 'templates'];

for (const folder of DIST_FOLDERS) {
  fs.cpSync(`src/${folder}`, `dist/${folder}`, { recursive: true });
  console.log(`Copied ${folder} to dist/`);
}
