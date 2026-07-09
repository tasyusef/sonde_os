import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    // Match build outputs anywhere in the tree (not just root). Without
    // this, lint walks into per-worktree .next/ dirs under
    // `.claude/worktrees/*/.next/` and chokes on webpack-generated JS.
    "**/.next/**",
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
