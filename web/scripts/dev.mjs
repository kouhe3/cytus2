#!/usr/bin/env node
// One-command local start: build the canonical DB projection if it is missing,
// then run Vite. The Vite plugin serves build/spa/data.json and the text store.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webDir, "..");
const buildDir = process.env.CYTUS2_BUILD_DIR ?? path.join(repoRoot, "build");
const projection = path.join(buildDir, "spa", "data.json");

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

if (!fs.existsSync(projection)) {
  const python = process.env.CYTUS2_PYTHON ?? "python";
  const pythonPath = [path.join(repoRoot, "tools"), process.env.PYTHONPATH]
    .filter(Boolean)
    .join(path.delimiter);
  console.log(`[web] ${projection} is missing; building the canonical DB`);
  try {
    await run(
      python,
      ["-m", "cytus2db", "build", "--out", buildDir],
      {
        cwd: repoRoot,
        env: { ...process.env, PYTHONPATH: pythonPath },
      },
    );
  } catch (error) {
    console.error(`[web] DB build failed: ${error instanceof Error ? error.message : error}`);
    console.error("[web] run `python -m cytus2db build --out build/` manually and retry.");
    process.exit(1);
  }
}

const { createServer } = await import("vite");
const server = await createServer({
  root: webDir,
  configFile: path.join(webDir, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 5190, strictPort: true },
});
await server.listen();
server.printUrls();
