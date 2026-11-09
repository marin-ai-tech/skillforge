import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { existsSync, readFileSync } from "node:fs";

// Extra ignores of this checkout (gitignore-style lines, shared with Prettier), if the file exists.
const LOCAL_IGNORES = existsSync(".lint-ignore.local")
  ? readFileSync(".lint-ignore.local", "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => (l.endsWith("/") ? `${l}**` : l))
  : [];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/data/**",
      "**/coverage/**",
      "tests/**",
      "docs/**",
      ".agents/**",
      ".claude/**",
      "packages/server/starter-packs/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/.reckon/**",
      "**/.codegraph/**",
      "**/.tmp-test/**",
      "**/out/**",
      ...LOCAL_IGNORES,
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        AbortSignal: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Cyclomatic complexity threshold (code-that-fits-in-your-head). There are no
      // exceptions in eslint-suppressions.json, and new ones are not accepted.
      complexity: ["error", 15],
    },
  },
  // Package boundaries (direction of dependencies): core is the kernel with no knowledge of server/cli/web; cli and web do not know about server; server does not know about cli/web.
  ...[
    ["packages/core/**", ["@skillforge/server", "@skillforge/cli", "@skillforge/web"]],
    ["packages/cli/**", ["@skillforge/server", "@skillforge/web"]],
    ["packages/web/**", ["@skillforge/server", "@skillforge/cli"]],
    ["packages/server/**", ["@skillforge/cli", "@skillforge/web"]],
  ].map(([glob, forbidden]) => ({
    files: [glob],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: forbidden.map((name) => ({
            group: [name, `${name}/*`],
            message: `Package boundary violation: ${glob.split("/")[1]} must not depend on ${name}.`,
          })),
        },
      ],
    },
  })),
);
