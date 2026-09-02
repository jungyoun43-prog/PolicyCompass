import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Baseline lint for a JavaScript codebase without a type checker: the
 * recommended core rules, React hooks correctness, and JSX awareness so
 * components used only in markup do not read as unused.
 */
export default [
  {
    ignores: [".next/**", "node_modules/**", "artifacts/**", "public/**", "outputs/**", "work/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node, ...globals.es2024 },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      "react/jsx-key": "error",
      // The two React Compiler-era rules below flag patterns the EMR components
      // were built on (DOM-slot lookups in effects, latest-state refs). They are
      // real debt, tracked as warnings until each component is reworked.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Input sanitizers strip control characters on purpose.
      "no-control-regex": "off",
    },
  },
];
