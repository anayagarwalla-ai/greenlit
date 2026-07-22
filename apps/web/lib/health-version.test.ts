import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DATABASE_VERSION } from "./health-version";

describe("production health schema version", () => {
  it("matches the newest Supabase migration", () => {
    const migrations = readdirSync(resolve(process.cwd(), "../../supabase/migrations"))
      .map((filename) => filename.match(/^(\d+)_/)?.[1])
      .filter((version): version is string => Boolean(version))
      .sort();

    expect(DATABASE_VERSION).toBe(migrations.at(-1));
  });
});
