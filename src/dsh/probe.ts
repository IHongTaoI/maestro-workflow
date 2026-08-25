import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

/** npm's Windows `dsh.cmd` shim requires cmd.exe resolution; the probe uses fixed arguments only. */
export const useCommandShell = process.platform === "win32";

export type DshProbeResult =
  | { status: "available"; command: "dsh"; version: string }
  | { status: "unavailable"; command: "dsh"; reason: string }
  | { status: "unrecognized"; command: "dsh"; reason: string }
  | { status: "error"; command: "dsh"; reason: string };

export const runCommand: CommandRunner = (command, args) => new Promise((resolve) => {
  const child = spawn(command, args, { shell: useCommandShell, windowsHide: true });
  let stdout = "";
  let stderr = "";
  let errorCode: string | undefined;

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.once("error", (error: NodeJS.ErrnoException) => { errorCode = error.code; });
  child.once("close", (exitCode) => {
    resolve({
      exitCode,
      stdout,
      stderr,
      ...(errorCode === undefined ? {} : { errorCode }),
    });
  });
});

function extractVersion(output: string): string | undefined {
  return output.match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/)?.[0];
}

/** Runs only `dsh --version`; it neither launches DSH nor changes its configuration. */
export async function probeDsh(runner: CommandRunner = runCommand): Promise<DshProbeResult> {
  const result = await runner("dsh", ["--version"]);
  if (result.errorCode === "ENOENT") {
    return { status: "unavailable", command: "dsh", reason: "dsh executable was not found on PATH" };
  }
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || `dsh exited with code ${String(result.exitCode)}`;
    return { status: "error", command: "dsh", reason: detail };
  }

  const version = extractVersion(`${result.stdout}\n${result.stderr}`);
  if (!version) {
    return { status: "unrecognized", command: "dsh", reason: "dsh --version did not contain a semantic version" };
  }
  return { status: "available", command: "dsh", version };
}
