/// <reference types="node" />
// @vitest-environment node
import fs from "node:fs";
import path from "node:path";

declare const __dirname: string;

it("Dockerfile meets the container contract", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const dockerfilePath = path.join(repoRoot, "Dockerfile");
  const df = fs.readFileSync(dockerfilePath, "utf8");
  expect(df).toMatch(/EXPOSE\s+8080/);
  expect(df).toMatch(/USER\s+(?!root)\w+/);            // non-root USER
  expect(df).toMatch(/HEALTHCHECK/);                    // declares a healthcheck
  expect(df.toLowerCase()).toContain("8080");
});
