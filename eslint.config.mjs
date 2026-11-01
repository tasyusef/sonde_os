import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "build/**",
    // React Router typegen output.
    ".react-router/**",
    // Other agents' checkouts and their build output.
    ".claude/worktrees/**",
    // The relay is Rust; its build and wrangler state are generated JS.
    "relay/build/**",
    "relay/target/**",
    "relay/.wrangler/**",
  ]),
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      react.configs.flat.recommended,
      react.configs.flat["jsx-runtime"],
      reactHooks.configs.flat["recommended-latest"],
      jsxA11y.flatConfigs.recommended,
    ],
    settings: { react: { version: "detect" } },
    rules: {
      // TypeScript checks props.
      "react/prop-types": "off",
      // Components decide what `autoFocus` means (the search overlay
      // focuses its field on open); only flag it on DOM elements.
      "jsx-a11y/no-autofocus": ["error", { ignoreNonDOM: true }],
    },
  },
]);
