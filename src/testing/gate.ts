import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { appendJsonLine, atomicWriteFile } from "../runtime/atomic.ts";
import { withTaskLock } from "../runtime/task-lock.ts";
import { workspaceLockPath, workspaceRoot } from "../workspace/paths.ts";

export const TEST_KINDS = ["build", "lint", "typecheck", "unit", "integration", "regression", "manual"] as const;
export type TestKind = (typeof TEST_KINDS)[number];
export type TestStatus = "passed" | "failed" | "not_run";

export type TestCheck = {
  kind: TestKind;
  required: boolean;
  status: TestStatus;
  command?: string;
  summary: string;
};

export type TestReport = {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  status: "passed" | "failed";
  checks: TestCheck[];
  userFeedback?: string;
  recordedAt: string;
};

export class TestGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestGateError";
  }
}

function timestamp(clock?: () => Date): string {
  return (clock ?? (() => new Date()))().toISOString();
}

function validateChecks(checks: TestCheck[]): void {
  const seen = new Set<TestKind>();
  for (const check of checks) {
    if (seen.has(check.kind)) throw new TestGateError(`duplicate test check: ${check.kind}`);
    seen.add(check.kind);
    if (check.summary.trim() === "") throw new TestGateError(`test check ${check.kind} needs a summary`);
  }
  if (!checks.some((check) => check.required)) throw new TestGateError("test report must contain at least one required check");
}

function markdown(report: TestReport): string {
  const lines = [
    "# Test Report",
    "",
    `status: ${report.status}`,
    `recorded_at: ${report.recordedAt}`,
    "",
    "| Check | Required | Status | Summary |",
    "|---|---:|---|---|",
    ...report.checks.map((check) => `| ${check.kind} | ${check.required ? "yes" : "no"} | ${check.status} | ${check.summary.replaceAll("|", "\\|")} |`),
  ];
  if (report.userFeedback !== undefined) lines.push("", "## Manual feedback", "", report.userFeedback);
  return `${lines.join("\n")}\n`;
}

export async function recordTestReport(options: {
  projectRoot: string;
  workspaceId: string;
  checks: TestCheck[];
  userFeedback?: string;
  clock?: () => Date;
}): Promise<TestReport> {
  validateChecks(options.checks);
  const requiredPassed = options.checks.filter((check) => check.required).every((check) => check.status === "passed");
  const manual = options.checks.find((check) => check.kind === "manual" && check.required);
  if (manual?.status === "passed" && (options.userFeedback?.trim() ?? "") === "") {
    throw new TestGateError("a passed required manual test needs user feedback");
  }
  const report: TestReport = {
    schemaVersion: 1,
    id: randomUUID(),
    workspaceId: options.workspaceId,
    status: requiredPassed ? "passed" : "failed",
    checks: options.checks.map((check) => ({ ...check })),
    recordedAt: timestamp(options.clock),
    ...(options.userFeedback === undefined ? {} : { userFeedback: options.userFeedback }),
  };
  await withTaskLock(workspaceLockPath(options.projectRoot, `${options.workspaceId}-testing`), async () => {
    const testingRoot = resolve(workspaceRoot(options.projectRoot, options.workspaceId), "testing");
    await appendJsonLine(resolve(testingRoot, "test-history.jsonl"), report);
    await atomicWriteFile(resolve(testingRoot, "test-report.md"), markdown(report));
  });
  return report;
}

export async function writeDeliveryReport(options: {
  projectRoot: string;
  workspaceId: string;
  summary: string;
  accepted: boolean;
  clock?: () => Date;
}): Promise<string> {
  if (options.summary.trim() === "") throw new TestGateError("delivery summary must not be empty");
  const testReportPath = resolve(workspaceRoot(options.projectRoot, options.workspaceId), "testing", "test-report.md");
  let testReport: string;
  try {
    testReport = await readFile(testReportPath, "utf8");
  } catch {
    throw new TestGateError("delivery requires an existing test report");
  }
  if (!/^status:\s*passed\s*$/im.test(testReport)) throw new TestGateError("delivery requires all required tests to pass");
  const status = options.accepted ? "accepted" : "rejected";
  const report = `# Delivery Report\n\nstatus: ${status}\nrecorded_at: ${timestamp(options.clock)}\n\n${options.summary.trim()}\n`;
  await atomicWriteFile(resolve(workspaceRoot(options.projectRoot, options.workspaceId), "delivery", "report.md"), report);
  return report;
}
