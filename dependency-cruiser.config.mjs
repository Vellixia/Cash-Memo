const moduleNames = [
  "identity",
  "onboarding",
  "memo",
  "draft",
  "assisted-capture",
  "labels",
  "history",
  "reporting",
  "export",
  "deletion",
  "privacy",
  "operations",
];

const crossModuleRules = moduleNames.map((moduleName) => ({
  name: `module-${moduleName}-uses-other-modules-through-ports`,
  comment: "Cross-module calls must target the other module's project-owned application port.",
  severity: "error",
  from: { path: `^apps/server/src/modules/${moduleName}(?:/|$)` },
  to: {
    path: `^apps/server/src/modules/(?!${moduleName}(?:/|$))`,
    pathNot: "/application/ports(?:/|$)",
  },
}));

const config = {
  forbidden: [
    {
      name: "no-circular-dependencies",
      comment: "Cycles obscure module ownership and transaction direction.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolvable-dependencies",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "packages-never-import-apps",
      comment: "Shared/domain packages point inward and cannot depend on deployable entry points.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "web-never-imports-server",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: "^apps/server/" },
    },
    {
      name: "server-never-imports-web-source",
      severity: "error",
      from: { path: "^apps/server/" },
      to: { path: "^apps/web/src/" },
    },
    {
      name: "domain-never-imports-outer-layers",
      severity: "error",
      from: { path: "/domain(?:/|$)" },
      to: { path: "/(?:application|adapters|infrastructure|presentation)(?:/|$)" },
    },
    {
      name: "application-never-imports-adapters",
      severity: "error",
      from: { path: "/application(?:/|$)" },
      to: { path: "/(?:adapters|infrastructure|presentation)(?:/|$)" },
    },
    {
      name: "domain-has-no-framework-or-provider-types",
      severity: "error",
      from: { path: "/domain(?:/|$)" },
      to: {
        dependencyTypes: ["npm", "npm-bundled", "npm-optional", "npm-peer"],
        path: "^(?:@nestjs/|@aws-sdk/|better-auth$|drizzle-orm$|fastify$|openai$)",
      },
    },
    {
      name: "provider-sdks-stay-in-adapters",
      severity: "error",
      from: { pathNot: "/adapters(?:/|$)" },
      to: {
        dependencyTypes: ["npm", "npm-bundled", "npm-optional", "npm-peer"],
        path: "^(?:@aws-sdk/|better-auth$|drizzle-orm$|openai$)",
      },
    },
    {
      name: "active-code-never-imports-archive",
      severity: "error",
      from: { path: "^(?:apps|packages|tests)/" },
      to: { path: "^archive/" },
    },
    ...crossModuleRules,
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled"],
    },
    exclude: { path: "(?:^|/)(?:dist|build|coverage|generated)(?:/|$)" },
    tsConfig: { fileName: "tsconfig.base.json" },
    tsPreCompilationDeps: true,
  },
};

export { moduleNames };
export default config;
