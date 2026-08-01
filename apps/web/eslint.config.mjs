import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "public/sw.js",
  ]),
  {
    rules: {
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "appwrite",
              message: "Browser must use Cashmemo API, not TablesDB directly.",
            },
            { name: "openai", message: "AI is outside Feature 001." },
            {
              name: "redis",
              message: "Redis is not approved for Feature 001.",
            },
          ],
        },
      ],
    },
  },
]);
