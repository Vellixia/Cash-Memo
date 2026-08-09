/** @type {import('@hey-api/openapi-ts').UserConfig} */
export default {
  input: "specs/001-cashmemo-mvp/contracts/openapi.yaml",
  output: {
    clean: true,
    entryFile: true,
    header: "// Generated from the authoritative Cashmemo OpenAPI contract. Do not edit.",
    module: { extension: ".js" },
    path: "packages/contracts/src/generated",
    postProcess: [
      {
        args: [
          "--config",
          "prettier.config.mjs",
          "--ignore-path",
          ".prettierignore",
          "--ignore-unknown",
          "{{path}}",
          "--write",
        ],
        command: "prettier",
      },
    ],
    source: false,
    tsConfigPath: "tsconfig.base.json",
  },
  plugins: [
    {
      enums: false,
      name: "@hey-api/typescript",
    },
  ],
};
