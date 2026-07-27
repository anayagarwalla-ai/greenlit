import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";

const root = process.cwd();

test("Vercel ignores only repository-root artifact folders", async () => {
  const ignore = await readFile(path.join(root, ".vercelignore"), "utf8");
  const entries = ignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  for (const entry of ["/outputs/", "/docs/audits/", "/artifacts/", "/test-results/", "/coverage/", "/supabase/tests/"]) {
    assert.ok(entries.includes(entry), `${entry} must remain root-anchored`);
  }
  assert.ok(entries.every((entry) => entry.startsWith("/")), "unanchored Vercel ignore rules can remove nested application routes");
  await access(path.join(root, "apps/web/app/api/internal/jobs/[jobId]/artifacts/route.ts"));
});
