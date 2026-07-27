import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.");
  const actualHost = new URL(url).host;
  const expectedHost = required("EXPECTED_SUPABASE_HOST");
  if (actualHost !== expectedHost) throw new Error(`Refusing to operate on ${actualHost}; EXPECTED_SUPABASE_HOST is ${expectedHost}.`);
  return { url, key, headers: { apikey: key, authorization: `Bearer ${key}` } };
}

export async function listStorageObjects(bucket, config, prefix = "") {
  const objects = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`${config.url}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: { ...config.headers, "content-type": "application/json" },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!response.ok) throw new Error(`Could not list ${bucket}/${prefix}: ${response.status} ${await response.text()}`);
    const page = await response.json();
    for (const item of page) {
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id || item.metadata) objects.push({ ...item, name });
      else objects.push(...await listStorageObjects(bucket, config, name));
    }
    if (page.length < 100) break;
  }
  return objects;
}

export async function downloadStorageObject(bucket, name, destination, config) {
  const encoded = name.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${config.url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encoded}`, { headers: config.headers });
  if (!response.ok) throw new Error(`Could not download ${bucket}/${name}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { mode: 0o600 });
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function restRows(table, select, config) {
  const rows = [];
  let count = 0;
  for (let offset = 0; ; offset += 1_000) {
    const response = await fetch(`${config.url}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=id.asc`, {
      headers: {
        ...config.headers,
        Prefer: offset === 0 ? "count=exact" : "count=none",
        Range: `${offset}-${offset + 999}`,
        "Range-Unit": "items",
      },
    });
    if (!response.ok) throw new Error(`Could not read ${table}: ${response.status} ${await response.text()}`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error(`Could not read ${table}: response was not a row array.`);
    rows.push(...page);
    if (offset === 0) count = Number(response.headers.get("content-range")?.split("/")[1] || page.length);
    if (page.length < 1_000) break;
  }
  return { rows, count };
}

export function safeTimestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export function resolveInside(root, relative) {
  if (
    typeof relative !== "string"
    || !relative
    || relative.includes("\\")
    || relative.includes("\0")
    || relative.startsWith("/")
    || relative.split("/").some((part) => !part || part === "." || part === "..")
  ) throw new Error("Unsafe backup path.");
  const destination = join(root, ...relative.split("/"));
  if (!destination.startsWith(`${root}/`)) throw new Error("Unsafe backup path.");
  return destination;
}

export function validateBackupManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Backup manifest must be an object.");
  if (manifest.schemaVersion !== 2) throw new Error("Unsupported backup manifest version.");
  if (!Number.isFinite(Date.parse(manifest.createdAt))) throw new Error("Backup manifest createdAt is invalid.");
  if (typeof manifest.supabaseHost !== "string" || !manifest.supabaseHost) throw new Error("Backup manifest host is invalid.");
  if (
    !manifest.database
    || manifest.database.file !== "database.dump"
    || !Number.isSafeInteger(manifest.database.bytes)
    || manifest.database.bytes <= 0
    || !/^[a-f0-9]{64}$/.test(manifest.database.sha256 ?? "")
  ) throw new Error("Backup manifest database entry is invalid.");
  if (!Array.isArray(manifest.evidence)) throw new Error("Backup manifest evidence inventory is invalid.");
  const seen = new Set();
  for (const artifact of manifest.evidence) {
    resolveInside("/manifest-validation", artifact?.path);
    if (seen.has(artifact.path)) throw new Error(`Backup manifest contains duplicate evidence path: ${artifact.path}`);
    seen.add(artifact.path);
    if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0 || !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "")) {
      throw new Error(`Backup manifest evidence entry is invalid: ${artifact.path}`);
    }
  }
  const reconciliation = manifest.evidenceReconciliation;
  if (
    !reconciliation
    || !Number.isSafeInteger(reconciliation.databaseArtifacts)
    || !Number.isSafeInteger(reconciliation.storageObjects)
    || !Array.isArray(reconciliation.missingStoragePaths)
    || !Array.isArray(reconciliation.untrackedStoragePaths)
    || !Array.isArray(reconciliation.metadataMismatches)
    || reconciliation.missingStoragePaths.length > 0
    || reconciliation.metadataMismatches.length > 0
  ) throw new Error("Backup manifest evidence reconciliation is invalid.");
  return manifest;
}

export function compareEvidenceInventory(evidence, databaseRows) {
  const stored = new Map(evidence.map((item) => [item.path, item]));
  const referenced = new Map(
    databaseRows.flatMap((row) => typeof row.storage_path === "string" && row.storage_path
      ? [[row.storage_path, row]]
      : []),
  );
  const missingStoragePaths = [...referenced.keys()].filter((path) => !stored.has(path)).sort();
  const untrackedStoragePaths = [...stored.keys()].filter((path) => !referenced.has(path)).sort();
  const metadataMismatches = [...referenced].flatMap(([path, row]) => {
    const artifact = stored.get(path);
    if (!artifact) return [];
    return (
      Number(row.byte_size) !== artifact.bytes
      || String(row.sha256).toLowerCase() !== artifact.sha256
    ) ? [path] : [];
  }).sort();
  return {
    databaseArtifacts: referenced.size,
    storageObjects: stored.size,
    missingStoragePaths,
    untrackedStoragePaths,
    metadataMismatches,
  };
}

export function assertSafeArchiveEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Backup archive is empty.");
  const roots = new Set();
  for (const entry of entries) {
    if (typeof entry !== "string" || !entry) throw new Error("Backup archive contains an invalid entry.");
    const normalized = entry.replace(/\/$/, "");
    if (!normalized) throw new Error("Backup archive contains an invalid entry.");
    const parts = normalized.split("/");
    if (parts.some((part) => !part || part === "." || part === "..") || entry.startsWith("/") || entry.includes("\\") || entry.includes("\0")) {
      throw new Error(`Backup archive contains an unsafe path: ${entry}`);
    }
    roots.add(parts[0]);
  }
  if (roots.size !== 1) throw new Error("Backup archive must contain exactly one bundle directory.");
  return [...roots][0];
}

export function assertSafeArchiveTypes(verboseListing) {
  const lines = String(verboseListing).split("\n").filter(Boolean);
  if (lines.length === 0) throw new Error("Backup archive type listing is empty.");
  for (const line of lines) {
    const type = line[0];
    if (type !== "-" && type !== "d") throw new Error(`Backup archive contains a non-file entry type: ${type || "unknown"}`);
  }
}

function pgPassField(value) {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

export async function postgresClientEnvironment(databaseUrl, temporaryDirectory) {
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.pathname.slice(1)) {
    throw new Error("The database URL must be a complete postgres:// or postgresql:// connection string.");
  }
  const host = parsed.hostname;
  const port = parsed.port || "5432";
  const database = decodeURIComponent(parsed.pathname.slice(1));
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const passFile = join(temporaryDirectory, ".pgpass");
  await writeFile(passFile, `${[host, port, database, user, password].map(pgPassField).join(":")}\n`, { mode: 0o600 });

  // Do not copy raw connection URLs into child environments. PostgreSQL
  // clients receive non-secret coordinates plus a mode-0600 password file,
  // keeping credentials out of both argv and ordinary environment listings.
  const { DATABASE_URL: _databaseUrl, RESTORE_DATABASE_URL: _restoreDatabaseUrl, ...baseEnvironment } = process.env;
  void _databaseUrl;
  void _restoreDatabaseUrl;
  const environment = {
    ...baseEnvironment,
    PGHOST: host,
    PGPORT: port,
    PGDATABASE: database,
    PGUSER: user,
    PGPASSFILE: passFile,
  };
  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode) environment.PGSSLMODE = sslMode;
  return { database, environment };
}
