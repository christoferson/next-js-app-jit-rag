import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Layering boundaries (CLAUDE.md §5) — a violation is a build failure.
const AWS_AND_VECTOR = [
  { name: "@aws-sdk/client-bedrock-runtime", message: "Only lib/adapters may import AWS SDKs." },
  { name: "@aws-sdk/client-bedrock", message: "Only lib/adapters may import AWS SDKs." },
  { name: "@lancedb/lancedb", message: "Only lib/adapters may import LanceDB." },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // probe/verification scripts are throwaway tooling
    "scripts/**",
  ]),

  // app/** (routes + pages): facade/stream/errors/models/chunking-registry only —
  // never repositories, adapters, AWS, LanceDB.
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: AWS_AND_VECTOR,
          patterns: [
            { group: ["**/lib/repositories/*", "!**/lib/repositories/types"], message: "Routes must go through the facade, not repositories." },
            { group: ["**/lib/adapters/**"], message: "Routes must go through the facade, not adapters." },
            { group: ["**/lib/services/**"], message: "Routes must go through the facade, not services." },
          ],
        },
      ],
    },
  },

  // lib/services/**: interfaces only — no AWS/LanceDB/fs/app.
  {
    files: ["lib/services/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...AWS_AND_VECTOR,
            { name: "fs", message: "Services must not touch the filesystem — use repositories." },
            { name: "node:fs", message: "Services must not touch the filesystem — use repositories." },
          ],
          patterns: [
            { group: ["**/app/**"], message: "Services must not import from app/." },
            {
              group: [
                "**/repositories/file-*",
                "**/adapters/lancedb-*",
                "**/adapters/bedrock-*",
                "**/adapters/local-disk-*",
                "**/adapters/stub-*",
              ],
              message: "Services depend on interfaces, not concrete impls (constructor-injected).",
            },
          ],
        },
      ],
    },
  },

  // lib/facade/**: services + errors only (container.ts at lib/ root does the wiring).
  {
    files: ["lib/facade/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: AWS_AND_VECTOR,
          patterns: [
            { group: ["**/repositories/file-*"], message: "Facade orchestrates services; concrete repos are wired in lib/container.ts." },
            {
              group: [
                "**/adapters/lancedb-*",
                "**/adapters/bedrock-*",
                "**/adapters/local-disk-*",
                "**/adapters/stub-*",
              ],
              message: "Facade orchestrates services; concrete adapters are wired in lib/container.ts.",
            },
          ],
        },
      ],
    },
  },

  // components/**: typed client + event types + UI libs only.
  {
    files: ["components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: AWS_AND_VECTOR,
          patterns: [
            { group: ["**/lib/repositories/**"], message: "Components consume lib/api DTOs only." },
            { group: ["**/lib/adapters/**"], message: "Components consume lib/api DTOs only." },
            { group: ["**/lib/services/**"], message: "Components consume lib/api DTOs only." },
            { group: ["**/lib/facade/**"], message: "Components consume lib/api DTOs only." },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
