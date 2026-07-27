import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exportedString(source, name) {
  const value = source.match(new RegExp(`export const ${name} = "([^"]+)"`))?.[1];
  if (!value) throw new Error(`${name} could not be read.`);
  return value;
}

const root = resolve(import.meta.dirname, "..");
const [packageJson, lockfile, runnerVersionSource, databaseVersionSource, migrations] = await Promise.all([
  readFile(resolve(root, "package.json"), "utf8"),
  readFile(resolve(root, "pnpm-lock.yaml")),
  readFile(resolve(root, "apps/web/lib/runner-version.ts"), "utf8"),
  readFile(resolve(root, "apps/web/lib/health-version.ts"), "utf8"),
  readdir(resolve(root, "supabase/migrations")),
]);
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).trim().length > 0;
const parsedPackage = JSON.parse(packageJson);
const sqlMigrations = migrations.filter((name) => name.endsWith(".sql")).sort();
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit,
  sourceTreeClean: !dirty,
  applicationVersion: parsedPackage.version,
  packageManager: parsedPackage.packageManager,
  runnerVersion: exportedString(runnerVersionSource, "EXPECTED_RUNNER_VERSION"),
  databaseVersion: exportedString(databaseVersionSource, "DATABASE_VERSION"),
  migrations: {
    count: sqlMigrations.length,
    first: sqlMigrations[0],
    last: sqlMigrations.at(-1),
  },
  lockfileSha256: sha256(lockfile),
};
const outputDirectory = resolve(root, "artifacts/release");
await mkdir(outputDirectory, { recursive: true });
const output = resolve(outputDirectory, "release-manifest.json");
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(output);
