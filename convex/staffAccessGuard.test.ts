/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// Every server-side "is this person staff?" must go through convex/lib/staff.ts,
// because that is where a staff role is held back for an account whose email
// isn't confirmed or isn't a company address (lib/staff-access.ts). A check that
// reads `user.role` itself would let such an account keep its powers, and
// nothing else would fail. This reads the source of every server file and fails
// on one that does, so the next person to write `user.role === "ADMIN"` is told
// to use isActiveStaff / isActiveAdmin / getStaffUser / getAdminUser /
// requireStaff / requireAdmin instead.

const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// A staff role compared directly: `x.role === "ADMIN"`, `"ADMIN" === x.role`,
// or `[...].includes(x.role)`.
const DIRECT_ROLE_CHECKS = [
  /\.role\s*(?:===|!==|==|!=)\s*["'](?:ADMIN|MODERATOR)["']/,
  /["'](?:ADMIN|MODERATOR)["']\s*(?:===|!==|==|!=)\s*[\w.]+\.role\b/,
  /\.includes\(\s*[\w.]+\.role\s*\)/,
];

function isComment(line: string): boolean {
  const start = line.trim();
  return (
    start.startsWith("//") || start.startsWith("*") || start.startsWith("/*")
  );
}

function hasDirectRoleCheck(line: string): boolean {
  return !isComment(line) && DIRECT_ROLE_CHECKS.some((p) => p.test(line));
}

// Lines that are allowed to compare a role, and why. Matched on the exact line,
// so changing one means looking at it again.
const ALLOWED_LINES: Array<{ file: string; line: string; why: string }> = [
  {
    file: "./lib/mlro.ts",
    line: 'return user.role === "ADMIN";',
    why: "picks the MLRO among people the caller already checked with getStaffUser or requireAdmin",
  },
  {
    file: "./organizations.ts",
    line: '(membership.role !== "OWNER" && membership.role !== "ADMIN")',
    why: "an organization's own member roles, not the platform's staff roles",
  },
  {
    file: "./admin.ts",
    line: '(member) => member.role === "ADMIN" && member.access === "OK",',
    why: "reads a list that listStaff has already built from the rules",
  },
];

// The one place that decides, and the tests, which set roles up on purpose.
function isExempt(file: string): boolean {
  return (
    file === "./lib/staff.ts" ||
    file.startsWith("./_generated/") ||
    file.endsWith(".test.ts") ||
    file.endsWith(".fixtures.ts")
  );
}

function violations(files: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [file, source] of Object.entries(files)) {
    if (isExempt(file)) continue;
    source.split("\n").forEach((line, index) => {
      if (!hasDirectRoleCheck(line)) return;
      const allowed = ALLOWED_LINES.some(
        (entry) => entry.file === file && entry.line === line.trim(),
      );
      if (!allowed) found.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  return found;
}

describe("staff checks go through convex/lib/staff.ts", () => {
  it("looks at the server's files (so an empty search can't pass)", () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThan(40);
    expect(files).toContain("./lib/staff.ts");
    expect(files).toContain("./admin.ts");
  });

  it("finds no server code that reads a staff role directly", () => {
    expect(violations(sources)).toEqual([]);
  });

  it("every allowed line still exists, so the list can't go stale", () => {
    for (const entry of ALLOWED_LINES) {
      const lines = (sources[entry.file] ?? "")
        .split("\n")
        .map((line) => line.trim());
      expect(lines, `${entry.file}: ${entry.line}`).toContain(entry.line);
    }
  });
});

// The scan has to catch what it is for. Each of these is the mistake it exists
// to stop, written out so the patterns can't quietly stop matching.
describe("the scan itself", () => {
  it.each([
    'if (user.role === "ADMIN") return null;',
    'const isStaff = user.role === "ADMIN" || user.role === "MODERATOR";',
    'if (me?.role !== "ADMIN") throw new Error();',
    'if ("ADMIN" === user.role) {',
    'if (["ADMIN", "MODERATOR"].includes(user.role)) {',
    "if (['ADMIN'].includes(staff.role)) {",
  ])("flags: %s", (line) => {
    expect(hasDirectRoleCheck(line)).toBe(true);
  });

  it.each([
    "const role = staffRoleOf(user);",
    "if (await isActiveAdmin(ctx, user)) return null;",
    'role: v.union(v.literal("USER"), v.literal("ADMIN")),',
    'await ctx.db.insert("users", { role: "ADMIN" });',
    '// user.role === "ADMIN" would skip the rules',
    ' * user.role === "ADMIN" would skip the rules',
    'return { state: "BLOCKED", role, block };',
  ])("leaves alone: %s", (line) => {
    expect(hasDirectRoleCheck(line)).toBe(false);
  });

  it("reports the file and line of an offender", () => {
    const result = violations({
      "./example.ts": 'const a = 1;\nif (user.role === "ADMIN") {}\n',
      "./lib/staff.ts": 'return user.role === "ADMIN";',
      "./thing.test.ts": 'expect(user.role === "ADMIN")',
    });
    expect(result).toEqual(['./example.ts:2: if (user.role === "ADMIN") {}']);
  });
});
