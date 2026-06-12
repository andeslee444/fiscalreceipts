import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated/copied assets — not authored code
    "public/duckdb/**",
    "public/pdf.worker.min.mjs",
    "public/json-lite/**",
    "public/assets/**",
  ]),
]);

export default eslintConfig;
