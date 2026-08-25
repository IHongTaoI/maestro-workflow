import { DSH_COMPATIBILITY_TARGET } from "./compatibility.ts";
import { probeDsh } from "./probe.ts";

const result = await probeDsh();
process.stdout.write(`${JSON.stringify({ compatibilityTarget: DSH_COMPATIBILITY_TARGET, ...result }, null, 2)}\n`);
if (result.status === "error") process.exitCode = 1;
