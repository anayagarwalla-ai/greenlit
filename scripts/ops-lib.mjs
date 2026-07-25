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
  const response = await fetch(`${config.url}/rest/v1/${table}?select=${encodeURIComponent(select)}`, {
    headers: { ...config.headers, Prefer: "count=exact" },
  });
  if (!response.ok) throw new Error(`Could not read ${table}: ${response.status} ${await response.text()}`);
  return { rows: await response.json(), count: Number(response.headers.get("content-range")?.split("/")[1] || 0) };
}

export function safeTimestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export function resolveInside(root, relative) {
  const destination = join(root, ...relative.split("/").filter(Boolean));
  if (!destination.startsWith(`${root}/`)) throw new Error("Unsafe backup path.");
  return destination;
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
