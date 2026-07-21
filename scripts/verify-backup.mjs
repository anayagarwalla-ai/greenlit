import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { required } from "./ops-lib.mjs";
import { resolveInside } from "./ops-lib.mjs";

function run(command, args, capture = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
    let output = "";
    if (capture) child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolvePromise(output.trim()) : reject(new Error(`${command} exited with ${code}.`)));
  });
}

const encryptedBackup = resolve(process.argv[2] || required("BACKUP_FILE"));
const restoreUrl = required("RESTORE_DATABASE_URL");
const databaseName = decodeURIComponent(new URL(restoreUrl).pathname.replace(/^\//, ""));
if (!/(restore|test|scratch)/i.test(databaseName)) throw new Error("RESTORE_DATABASE_URL must name an isolated database containing restore, test, or scratch.");
const temporary = await mkdtemp(join(tmpdir(), "milestoneproof-restore-"));

try {
  const archive = join(temporary, basename(encryptedBackup).replace(/\.gpg$/, ""));
  await run("gpg", ["--batch", "--yes", "--output", archive, "--decrypt", encryptedBackup]);
  await run("tar", ["-C", temporary, "-xzf", archive]);
  const bundleName = (await readdir(temporary)).find((name) => name.startsWith("milestoneproof-") && !name.endsWith(".tar.gz"));
  if (!bundleName) throw new Error("Backup bundle is missing.");
  const bundle = join(temporary, bundleName);
  const manifest = JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8"));
  const database = await readFile(join(bundle, manifest.database.file));
  if (createHash("sha256").update(database).digest("hex") !== manifest.database.sha256) throw new Error("Database dump hash mismatch.");
  for (const artifact of manifest.evidence) {
    const bytes = await readFile(resolveInside(join(bundle, "evidence"), artifact.path));
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error(`Evidence hash mismatch: ${artifact.path}`);
  }

  const publicTables = await run("psql", [restoreUrl, "-Atc", "select count(*) from pg_tables where schemaname='public'"], true);
  if (Number(publicTables) !== 0) throw new Error("The restore database is not empty; refusing to overwrite it.");
  await run("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", `--dbname=${restoreUrl}`, join(bundle, manifest.database.file)]);
  const verification = await run("psql", [restoreUrl, "-Atc", "select json_build_object('records',count(*),'latestAuditHead',max(audit_chain_head)) from public.transaction_records"], true);
  console.log(JSON.stringify({ ok: true, backup: encryptedBackup, evidenceHashesVerified: manifest.evidence.length, restoredDatabase: databaseName, databaseVerification: JSON.parse(verification) }, null, 2));
} finally {
  if (temporary.startsWith(`${tmpdir()}/milestoneproof-restore-`)) await rm(temporary, { recursive: true, force: true });
}
