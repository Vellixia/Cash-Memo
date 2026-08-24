import { readFile, writeFile } from "node:fs/promises";

import { defineConfig } from "orval";

const generatedIndex = new URL("./generated/api/index.ts", import.meta.url);

export default defineConfig({
  cashmemo: {
    input: "../../openapi/cashmemo-v1.json",
    hooks: {
      afterAllFilesWrite: async () => {
        const source = await readFile(generatedIndex, "utf8");
        await writeFile(generatedIndex, `${source.trimEnd()}\n`);
      },
    },
    output: {
      mode: "split",
      target: "./generated/api/index.ts",
      schemas: "./generated/api/model",
      client: "react-query",
      httpClient: "axios",
      override: {
        mutator: {
          path: "./lib/api/axios.ts",
          name: "customAxios",
        },
      },
    },
  },
});
