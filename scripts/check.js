import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const files = ["bin/maestro.js"];
for (const entry of await readdir("src", { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".js")) {
    files.push(`src/${entry.name}`);
  }
}

for (const file of files) {
  const checked = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (checked.status !== 0) {
    process.exitCode = checked.status ?? 1;
    break;
  }
}
