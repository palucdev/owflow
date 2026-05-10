import fs from "fs";

// Copy the 'skills' folder recursively into 'dist/skills'
fs.cpSync("src/skills", "dist/skills", { recursive: true });

console.log("Copied skills to dist/");

// Copy the 'agents' folder recursively into 'dist/agents'
fs.cpSync("src/agents", "dist/agents", { recursive: true });

console.log("Copied agents to dist/");

// Copy the 'commands' folder recursively into 'dist/commands'
fs.cpSync("src/commands", "dist/commands", { recursive: true });

console.log("Copied commands to dist/");
