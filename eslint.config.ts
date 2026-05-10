import js from "@eslint/js";
import nodePlugin from "eslint-plugin-n";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint, { type ConfigArray } from "typescript-eslint";

// eslint-disable-next-line sonarjs/deprecation -- tseslint.config() is the recommended API
export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "resources/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  unicorn.configs.recommended,
  sonarjs.configs!.recommended as ConfigArray[number],
  nodePlugin.configs["flat/recommended-module"],
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",

      // relaxed due to loose types in plantuml-parser (CJS, no strict typing)
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",

      // relaxed — existing codebase conventions
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-array-for-each": "off",
      "unicorn/no-null": "off",
      "unicorn/prefer-top-level-await": "off",
      "unicorn/no-process-exit": "off",
      "unicorn/filename-case": "off",
      "unicorn/no-await-expression-member": "off",
      "unicorn/no-array-reduce": "off",
      "unicorn/no-array-callback-reference": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/explicit-length-check": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/no-useless-collection-argument": "off",

      // node plugin
      "n/no-unsupported-features/node-builtins": "off",
      "n/no-missing-import": "off",

      // sonarjs relaxations
      "sonarjs/cognitive-complexity": "warn",
      "sonarjs/no-misleading-array-reverse": "warn",
      "sonarjs/no-commented-code": "off",
      "sonarjs/slow-regex": "warn",
      "sonarjs/prefer-regexp-exec": "warn",
      "sonarjs/deprecation": "warn",
    },
  },
  {
    files: ["test/**/*.ts", "examples/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "no-console": "off",
      "sonarjs/no-duplicate-string": "off",
      "sonarjs/cognitive-complexity": "off",
    },
  },
);
