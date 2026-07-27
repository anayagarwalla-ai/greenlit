import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSafeArchiveEntries,
  assertSafeArchiveTypes,
  compareEvidenceInventory,
  resolveInside,
  validateBackupManifest,
} from "./ops-lib.mjs";

const manifest = {
  schemaVersion: 2,
  createdAt: "2026-07-26T00:00:00.000Z",
  supabaseHost: "project.supabase.co",
  database: { file: "database.dump", bytes: 10, sha256: "a".repeat(64) },
  evidence: [{ path: "record/job/check.png", bytes: 5, sha256: "b".repeat(64) }],
  evidenceReconciliation: {
    databaseArtifacts: 1,
    storageObjects: 1,
    missingStoragePaths: [],
    untrackedStoragePaths: [],
    metadataMismatches: [],
  },
};

describe("backup path and manifest validation", () => {
  it("rejects traversal, absolute, empty-segment, and backslash paths", () => {
    for (const path of ["../secret", "/absolute", "record//file", "record/./file", "record\\file"]) {
      assert.throws(() => resolveInside("/safe/root", path), /Unsafe backup path/);
    }
    assert.equal(resolveInside("/safe/root", "record/job/file.png"), "/safe/root/record/job/file.png");
  });

  it("rejects malformed and duplicate manifest evidence", () => {
    assert.equal(validateBackupManifest(structuredClone(manifest)).evidence.length, 1);
    const duplicate = structuredClone(manifest);
    duplicate.evidence.push(structuredClone(duplicate.evidence[0]));
    assert.throws(() => validateBackupManifest(duplicate), /duplicate evidence path/);
    assert.throws(() => validateBackupManifest({ ...manifest, schemaVersion: 99 }), /Unsupported/);
  });

  it("requires one safe archive root", () => {
    assert.equal(assertSafeArchiveEntries(["greenlit-1/", "greenlit-1/manifest.json", "greenlit-1/evidence/a.png"]), "greenlit-1");
    assert.throws(() => assertSafeArchiveEntries(["greenlit-1/manifest.json", "../escape"]), /unsafe path/);
    assert.throws(() => assertSafeArchiveEntries(["first/a", "second/b"]), /exactly one/);
    assert.doesNotThrow(() => assertSafeArchiveTypes("drwx------ user/group 0 date greenlit-1/\n-rw------- user/group 1 date greenlit-1/manifest.json"));
    assert.throws(() => assertSafeArchiveTypes("lrwxr-xr-x user/group 0 date greenlit-1/link -> /tmp/file"), /non-file entry/);
  });
});

describe("evidence reconciliation", () => {
  it("reports missing, untracked, and metadata-mismatched objects", () => {
    const evidence = [
      { path: "tracked.png", bytes: 5, sha256: "a".repeat(64) },
      { path: "wrong.png", bytes: 7, sha256: "b".repeat(64) },
      { path: "orphan.png", bytes: 2, sha256: "c".repeat(64) },
    ];
    const databaseRows = [
      { storage_path: "tracked.png", byte_size: 5, sha256: "a".repeat(64) },
      { storage_path: "wrong.png", byte_size: 8, sha256: "b".repeat(64) },
      { storage_path: "missing.png", byte_size: 3, sha256: "d".repeat(64) },
    ];
    assert.deepEqual(compareEvidenceInventory(evidence, databaseRows), {
      databaseArtifacts: 3,
      storageObjects: 3,
      missingStoragePaths: ["missing.png"],
      untrackedStoragePaths: ["orphan.png"],
      metadataMismatches: ["wrong.png"],
    });
  });
});
