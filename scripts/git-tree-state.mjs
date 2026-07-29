import { execFileSync } from "node:child_process";

export function sourceTreeDirty(root, run = execFileSync) {
  return run("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim().length > 0;
}
