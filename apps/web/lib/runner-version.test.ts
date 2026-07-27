import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_RUNNER_VERSION } from "./runner-version";

describe("runner version contract", () => {
  it("matches the deployable runner package version", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "../../workers/runner/package.json"), "utf8"),
    ) as { version: string };
    expect(EXPECTED_RUNNER_VERSION).toBe(packageJson.version);
  });
});
