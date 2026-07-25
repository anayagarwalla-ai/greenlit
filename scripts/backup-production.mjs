import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { downloadStorageObject, listStorageObjects, postgresClientEnvironment, required, resolveInside, safeTimestamp, supabaseConfig } from "./ops-lib.mjs";

function run(command, args, environment) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: environment });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}.`)));
  });
}

const databaseUrl = required("DATABASE_URL");
const outputDir = resolve(required("BACKUP_OUTPUT_DIR"));
const recipient = required("BACKUP_ENCRYPTION_RECIPIENT");
const supabase = supabaseConfig();
const stamp = safeTimestamp();
const temporary = await mkdtemp(join(tmpdir(), "greenlit-backup-"));
const bundle = join(temporary, `greenlit-${stamp}`);
const encryptedOutput = join(outputDir, `greenlit-${stamp}.tar.gz.gpg`);

try {
  await mkdir(join(bundle, "evidence"), { recursive: true, mode: 0o700 });
  const postgres = await postgresClientEnvironment(databaseUrl, temporary);
  const databaseFile = join(bundle, "database.dump");
  await run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--file=${databaseFile}`], postgres.environment);

  const storageObjects = await listStorageObjects("evidence", supabase);
  const evidence = [];
  for (const object of storageObjects) {
    const result = await downloadStorageObject("evidence", object.name, resolveInside(join(bundle, "evidence"), object.name), supabase);
    evidence.push({ path: object.name, ...result });
  }
  const databaseBytes = await readFile(databaseFile);
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    supabaseHost: new URL(supabase.url).host,
    database: { file: "database.dump", bytes: databaseBytes.length, sha256: createHash("sha256").update(databaseBytes).digest("hex") },
    evidence,
  };
  await writeFile(join(bundle, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  const archive = join(temporary, `${basename(bundle)}.tar.gz`);
  await run("tar", ["-C", temporary, "-czf", archive, basename(bundle)]);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await run("gpg", ["--batch", "--yes", "--trust-model", "always", "--recipient", recipient, "--output", encryptedOutput, "--encrypt", archive]);
  console.log(JSON.stringify({ ok: true, encryptedBackup: encryptedOutput, evidenceObjects: evidence.length, createdAt: manifest.createdAt }, null, 2));
} finally {
  if (temporary.startsWith(`${tmpdir()}/greenlit-backup-`)) await rm(temporary, { recursive: true, force: true });
}
