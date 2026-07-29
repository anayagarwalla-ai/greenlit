import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import path from "node:path";
import { sourceTreeDirty } from "./git-tree-state.mjs";

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

test("release manifests treat untracked files as a dirty source tree", async (context) => {
  const repository = await mkdtemp(path.join(tmpdir(), "greenlit-release-manifest-"));
  context.after(async () => {
    await rm(repository, { recursive: true, force: true });
  });

  execFileSync("git", ["init", "--quiet"], { cwd: repository });
  assert.equal(sourceTreeDirty(repository), false);

  await writeFile(path.join(repository, "untracked.txt"), "submission drift\n");
  assert.equal(sourceTreeDirty(repository), true);
});
