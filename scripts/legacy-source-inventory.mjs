import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { listStorageObjects, required, restRows, safeTimestamp, supabaseConfig } from "./ops-lib.mjs";

const config = supabaseConfig();
const reportDir = resolve(process.env.LEGACY_SOURCE_REPORT_DIR || "docs/operations");
const purge = process.argv.includes("--purge");
const { rows, count } = await restRows("source_documents", "id,milestone_id,storage_path,file_name,mime_type,byte_size,page_count,source_sha256,original_deleted_at,expires_at,created_at", config);
const objects = await listStorageObjects("source-documents", config);
const report = {
  checkedAt: new Date().toISOString(),
  supabaseHost: new URL(config.url).host,
  action: purge ? "PURGE" : "INVENTORY_ONLY",
  databaseRows: count,
  storageObjects: objects.length,
  storageBytes: objects.reduce((total, object) => total + Number(object.metadata?.size || 0), 0),
  rows,
  objects: objects.map((object) => ({ path: object.name, bytes: Number(object.metadata?.size || 0), createdAt: object.created_at || null })),
};

if (purge) {
  if (required("PURGE_LEGACY_SOURCE_DATA") !== "YES") throw new Error("Set PURGE_LEGACY_SOURCE_DATA=YES for the explicitly verified production host before purging.");
  if (objects.length > 0) {
    const response = await fetch(`${config.url}/storage/v1/object/source-documents`, {
      method: "DELETE",
      headers: { ...config.headers, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: objects.map((object) => object.name) }),
    });
    if (!response.ok) throw new Error(`Legacy storage purge failed: ${response.status} ${await response.text()}`);
  }
  const response = await fetch(`${config.url}/rest/v1/source_documents?id=not.is.null`, { method: "DELETE", headers: { ...config.headers, Prefer: "return=representation" } });
  if (!response.ok) throw new Error(`Legacy row purge failed: ${response.status} ${await response.text()}`);
  const deletedRows = await response.json();
  report.deletedRows = deletedRows.length;
  report.deletedObjects = objects.length;
}

await mkdir(reportDir, { recursive: true });
const reportPath = `${reportDir}/legacy-source-${purge ? "purge" : "inventory"}-${safeTimestamp()}.json`;
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ok: true, reportPath, action: report.action, databaseRows: count, storageObjects: objects.length }, null, 2));
