import { defineConfig } from "orval";

export default defineConfig({
  cashmemo: {
    input: "../../openapi/cashmemo-v1.json",
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
