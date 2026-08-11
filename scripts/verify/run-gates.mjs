import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const localEnvironmentPath = path.join(repositoryRoot, ".env.local");

const acceptanceFiles = {
  us1: "tests/acceptance/us1-private-journal.spec.ts",
  us2: "tests/acceptance/us2-manual-journal.spec.ts",
  us3: "tests/acceptance/us3-assisted-capture.spec.ts",
  us4: "tests/acceptance/us4-current-month.spec.ts",
  us5: "tests/acceptance/us5-degraded-operation.spec.ts",
  us6: "tests/acceptance/us6-organize-find.spec.ts",
  us7: "tests/acceptance/us7-monthly-review.spec.ts",
  us8: "tests/acceptance/us8-data-ownership.spec.ts",
  "full-mvp": "tests/acceptance/full-mvp.spec.ts",
};

const externalEvidence = {
  aws: "ops/evidence/external/aws-environment.json",
  load: "ops/evidence/external/load-profile-approval.json",
  openai: "ops/evidence/external/openai-zdr-approval.json",
  owners: "ops/owners.yaml",
  ses: "ops/evidence/external/ses-production-approval.json",
};

class GateFailure extends Error {
  constructor(code, safeDetails = []) {
    super(code);
    this.name = "GateFailure";
    this.code = code;
    this.safeDetails = safeDetails;
  }
}

const relative = (target) => path.relative(repositoryRoot, target) || ".";

async function exists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function run(command, args, options = {}) {
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal === null ? (code ?? 1) : 1));
  });

  if (exitCode !== 0) {
    throw new GateFailure("COMMAND_FAILED", [options.label ?? command]);
  }
}

async function walkFiles(root) {
  if (!(await exists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (
      entry.name.startsWith(".") ||
      entry.name === "node_modules" ||
      entry.name === "archive" ||
      entry.name === "dist"
    ) {
      continue;
    }
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(target)));
    if (entry.isFile()) files.push(target);
  }

  return files;
}

async function discoverTestFiles(predicate) {
  const roots = ["apps", "packages", "tests"].map((root) => path.join(repositoryRoot, root));
  const files = (await Promise.all(roots.map(walkFiles))).flat();
  return files.filter((file) => predicate(relative(file))).sort();
}

function isSpecification(relativePath) {
  return /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(relativePath);
}

const suitePredicates = {
  auth: (file) => file === "tests/providers/better-auth.compat.spec.ts",
  contract: (file) =>
    isSpecification(file) &&
    (file.includes("/tests/contract/") || file.endsWith(".contract.spec.ts")),
  integration: (file) =>
    isSpecification(file) &&
    (file.includes("/tests/integration/") || file.includes("/tests/failure/")),
  operations: (file) => isSpecification(file) && file.startsWith("tests/operations/"),
  privacy: (file) =>
    isSpecification(file) &&
    (file.includes("/tests/privacy/") || file.startsWith("tests/privacy/")),
  property: (file) => file.endsWith(".property.spec.ts"),
  providers: (file) =>
    isSpecification(file) &&
    file.startsWith("tests/providers/") &&
    file !== "tests/providers/better-auth.compat.spec.ts",
  pwa: (file) =>
    isSpecification(file) &&
    (file.includes("/tests/pwa/") || file.startsWith("tests/accessibility/")),
  security: (file) => isSpecification(file) && file.startsWith("tests/security/"),
  unit: (file) =>
    isSpecification(file) &&
    !file.endsWith(".property.spec.ts") &&
    !file.includes("/tests/contract/") &&
    !file.includes("/tests/integration/") &&
    !file.includes("/tests/privacy/") &&
    !file.startsWith("tests/"),
};

async function runVitestSuite(suite) {
  const predicate = suitePredicates[suite];
  if (predicate === undefined) throw new GateFailure("UNKNOWN_TEST_SUITE", [suite]);
  const files = await discoverTestFiles(predicate);
  if (files.length === 0) throw new GateFailure("GATE_UNAVAILABLE", [`test:${suite}`]);
  await run("corepack", ["pnpm", "exec", "vitest", "run", ...files.map(relative)], {
    label: `test:${suite}`,
  });
}

async function runAuthCompatibility() {
  await runVitestSuite("auth");
  await runArtifactScript(
    "tests/providers/write-better-auth-compat-evidence.ts",
    "test:auth:evidence",
  );
}

async function requireRealMode({ evidence = [], flag, names = [] }) {
  const missingNames = [flag, ...names].filter((name) => process.env[name] === undefined);
  if (process.env[flag] !== "1" && !missingNames.includes(flag)) missingNames.push(flag);
  const missingEvidence = [];
  for (const item of evidence) {
    if (!(await exists(path.join(repositoryRoot, item)))) missingEvidence.push(item);
  }
  if (missingNames.length > 0 || missingEvidence.length > 0) {
    throw new GateFailure("REAL_MODE_BLOCKED", [
      ...missingNames.map((name) => `name:${name}`),
      ...missingEvidence.map((item) => `evidence:${item}`),
    ]);
  }
}

async function runAcceptance(story) {
  const target = acceptanceFiles[story];
  if (target === undefined) throw new GateFailure("UNKNOWN_ACCEPTANCE_SUITE", [story]);
  if (!(await exists(path.join(repositoryRoot, target)))) {
    throw new GateFailure("GATE_UNAVAILABLE", [`acceptance:${story}`]);
  }
  if (story === "full-mvp") {
    await requireRealMode({
      evidence: Object.values(externalEvidence),
      flag: "CASHMEMO_PRODUCTION_EQUIVALENT_ACCEPTANCE",
      names: ["PRODUCTION_BASE_URL"],
    });
  }
  await run("corepack", ["pnpm", "exec", "playwright", "test", target], {
    env:
      story === "us3" || story === "us5"
        ? { ...process.env, ASSISTED_CAPTURE_MODE: "fake" }
        : process.env,
    label: `acceptance:${story}`,
  });
}

async function runAllStoryAcceptance() {
  const stories = Object.keys(acceptanceFiles).filter((story) => story !== "full-mvp");
  for (const story of stories) await runAcceptance(story);
}

async function runTypecheck() {
  const configurations = [
    "apps/server/tsconfig.json",
    "apps/web/tsconfig.json",
    "packages/tsconfig.json",
    "tests/tsconfig.json",
    "ops/tsconfig.json",
    "scripts/tsconfig.json",
  ];
  for (const configuration of configurations) {
    const configurationDirectory = path.dirname(path.join(repositoryRoot, configuration));
    const inputs = (await walkFiles(configurationDirectory)).filter((file) =>
      /(?<!\.d)\.[cm]?[jt]sx?$/u.test(file),
    );
    if (inputs.length === 0) {
      console.log(`TYPECHECK_EMPTY=${configuration}`);
      continue;
    }
    await run("corepack", ["pnpm", "exec", "tsc", "--noEmit", "-p", configuration], {
      label: `typecheck:${configuration}`,
    });
  }
}

async function runArchitectureCheck() {
  await run(
    "corepack",
    ["pnpm", "exec", "depcruise", "--config", "dependency-cruiser.config.mjs", "apps", "packages"],
    {
      label: "architecture:dependencies",
    },
  );
  await run(
    "corepack",
    ["pnpm", "exec", "vitest", "run", "tests/architecture/module-boundaries.spec.ts"],
    {
      label: "architecture:topology",
    },
  );
}

async function runArtifactScript(target, label) {
  const absolute = path.join(repositoryRoot, target);
  if (!(await exists(absolute))) throw new GateFailure("GATE_UNAVAILABLE", [label, target]);
  await run("node", [absolute], { label });
}

async function runWorkspaceScript(script, environment = process.env) {
  const roots = ["apps", "packages"];
  const manifests = [];
  for (const root of roots) {
    for (const file of await walkFiles(path.join(repositoryRoot, root))) {
      if (path.basename(file) === "package.json") manifests.push(file);
    }
  }
  let ownerCount = 0;
  for (const manifest of manifests) {
    const value = JSON.parse(await readFile(manifest, "utf8"));
    if (typeof value.scripts?.[script] === "string") ownerCount += 1;
  }
  if (ownerCount === 0) throw new GateFailure("GATE_UNAVAILABLE", [`workspace:${script}`]);
  await run("corepack", ["pnpm", "-r", "--if-present", "run", script], {
    env: environment,
    label: `workspace:${script}`,
  });
}

function parseEnvironmentFile(source) {
  const output = {};
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    const name = separator === -1 ? "" : trimmed.slice(0, separator);
    if (!/^[A-Z][A-Z0-9_]*$/u.test(name) || Object.hasOwn(output, name)) {
      throw new GateFailure("ENVIRONMENT_FILE_INVALID", ["name-or-duplicate"]);
    }
    output[name] = trimmed.slice(separator + 1);
  }
  return output;
}

async function readLocalEnvironment() {
  if (!(await exists(localEnvironmentPath))) return {};
  return parseEnvironmentFile(await readFile(localEnvironmentPath, "utf8"));
}

async function checkEnvironment() {
  const localEnvironment = await readLocalEnvironment();
  const schemaUrl = pathToFileURL(
    path.join(repositoryRoot, "apps/server/src/bootstrap/environment.schema.ts"),
  ).href;
  const { parseEnvironment } = await import(schemaUrl);
  try {
    const parsed = parseEnvironment({ ...process.env, ...localEnvironment });
    console.log(`ENVIRONMENT_CHECK=PASS names=${Object.keys(parsed).length}`);
  } catch (error) {
    if (Array.isArray(error?.invalidNames)) {
      throw new GateFailure("ENVIRONMENT_INVALID", error.invalidNames.map(String));
    }
    throw new GateFailure("ENVIRONMENT_INVALID", ["ENVIRONMENT"]);
  }
}

const localSecret = () => randomBytes(48).toString("base64url");

async function initializeLocalEnvironment() {
  if (await exists(localEnvironmentPath)) {
    await checkEnvironment();
    console.log("LOCAL_ENVIRONMENT=EXISTS");
    return;
  }

  const values = [
    ["APP_ENV", "local"],
    ["APP_ORIGIN", "https://localhost:5173"],
    ["BUILD_VERSION", "local-development"],
    ["PROCESS_ROLE", "all"],
    ["PORT", "3000"],
    ["DATABASE_URL", "postgresql://cashmemo:cashmemo-local-only@127.0.0.1:5432/cashmemo"],
    [
      "AUTH_DATABASE_URL",
      "postgresql://cashmemo_identity_login:cashmemo-identity-local-only@127.0.0.1:5432/cashmemo",
    ],
    ["AUTH_SESSION_SECRET", localSecret()],
    ["AUTH_TOKEN_HMAC_KEY", localSecret()],
    ["PASSWORD_PEPPER", localSecret()],
    ["EVIDENCE_HMAC_KEY", localSecret()],
    ["DELETION_SUPPRESSION_HMAC_KEY", localSecret()],
    ["AWS_REGION", "local"],
    ["EXPORT_BUCKET", "cashmemo-local-exports"],
    ["EVIDENCE_BUCKET", "cashmemo-local-evidence"],
    ["DELETION_LEDGER_BUCKET", "cashmemo-local-deletion-ledger"],
    [
      "KMS_EXPORT_KEY_ARN",
      "arn:aws:kms:local:000000000000:key/00000000-0000-4000-8000-000000000001",
    ],
    [
      "KMS_EVIDENCE_KEY_ARN",
      "arn:aws:kms:local:000000000000:key/00000000-0000-4000-8000-000000000002",
    ],
    ["SES_FROM_ADDRESS", "mailpit@cashmemo.test"],
    ["ASSISTED_CAPTURE_MODE", "disabled"],
    ["STT_MODEL_SNAPSHOT", "gpt-4o-mini-transcribe-2025-12-15"],
    ["EXTRACTION_MODEL_SNAPSHOT", "gpt-5.4-mini-2026-03-17"],
    ["PROVIDER_DECISION_VERSION", "local-disabled-v1"],
    ["CURRENCY_REGISTRY_VERSION", "pending-cldr-pin"],
    ["TZDB_VERSION", "system-local"],
  ];
  await writeFile(
    localEnvironmentPath,
    `${values.map(([name, value]) => `${name}=${value}`).join("\n")}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  await chmod(localEnvironmentPath, 0o600);
  console.log("LOCAL_ENVIRONMENT=CREATED path=.env.local mode=0600");
  await checkEnvironment();
}

async function runDatabaseCommand(command) {
  const artifacts = {
    generate: "scripts/db/generate.mjs",
    migrate: "scripts/db/migrate.mjs",
    "reset-local": "scripts/db/reset-local.mjs",
    "seed-synthetic": "scripts/db/seed-synthetic.mjs",
    verify: "scripts/db/verify.mjs",
  };
  const target = artifacts[command];
  if (target === undefined) throw new GateFailure("UNKNOWN_DATABASE_COMMAND", [command]);
  await runArtifactScript(target, `db:${command}`);
}

async function runDevelopmentMode(mode) {
  const assistedMode = { fake: "fake", manual: "disabled", real: "openai" }[mode];
  if (assistedMode === undefined) throw new GateFailure("UNKNOWN_DEVELOPMENT_MODE", [mode]);
  if (mode === "real") {
    await requireRealMode({
      evidence: [externalEvidence.openai],
      flag: "CASHMEMO_REAL_PROVIDER_MODE",
      names: ["OPENAI_API_KEY", "OPENAI_PROJECT_ID", "OPENAI_BASE_URL"],
    });
  }
  await runWorkspaceScript("dev", { ...process.env, ASSISTED_CAPTURE_MODE: assistedMode });
}

async function runRealProviders() {
  await requireRealMode({
    evidence: [externalEvidence.openai],
    flag: "CASHMEMO_REAL_PROVIDER_TESTS",
    names: ["OPENAI_API_KEY", "OPENAI_PROJECT_ID", "OPENAI_BASE_URL"],
  });
  await runVitestSuite("providers");
}

async function runProtectedSuite(suite) {
  const policy = {
    operations: {
      evidence: [externalEvidence.aws, externalEvidence.owners],
      flag: "CASHMEMO_OPERATIONAL_TESTS",
      names: ["PRODUCTION_BASE_URL"],
    },
    performance: {
      evidence: [externalEvidence.load],
      flag: "CASHMEMO_PERFORMANCE_TESTS",
      names: ["PRODUCTION_BASE_URL"],
    },
  }[suite];
  if (policy === undefined) throw new GateFailure("UNKNOWN_PROTECTED_SUITE", [suite]);
  if (suite !== "operations") await requireRealMode(policy);
  if (suite === "operations") {
    const target = "tests/operations/operations-suite.ts";
    if (!(await exists(path.join(repositoryRoot, target)))) {
      throw new GateFailure("GATE_UNAVAILABLE", ["test:operations", target]);
    }
    await run("corepack", ["pnpm", "exec", "tsx", target], { label: "test:operations" });
  }
  if (suite === "performance") {
    for (const target of [
      "tests/performance/core-load.js",
      "tests/performance/audio-concurrency.js",
      "tests/performance/query-plans.spec.ts",
      "tests/performance/slo-probes.ts",
    ]) {
      if (!(await exists(path.join(repositoryRoot, target)))) {
        throw new GateFailure("GATE_UNAVAILABLE", ["test:performance", target]);
      }
    }
    await run(
      "corepack",
      ["pnpm", "exec", "vitest", "run", "tests/performance/query-plans.spec.ts"],
      {
        label: "test:performance:query-plans",
      },
    );
    await run("k6", ["run", "tests/performance/core-load.js"], {
      label: "test:performance:core-load",
    });
    await run("k6", ["run", "tests/performance/audio-concurrency.js"], {
      label: "test:performance:audio-concurrency",
    });
    await run("corepack", ["pnpm", "exec", "tsx", "tests/performance/slo-probes.ts"], {
      label: "test:performance:slo-probes",
    });
  }
}

async function runGate(gate) {
  const gates = {
    acceptance: async () => runAllStoryAcceptance(),
    "format-lint": async () => {
      await run("corepack", ["pnpm", "format:check"], { label: "format:check" });
      await run("corepack", ["pnpm", "lint"], { label: "lint" });
    },
    "integration-contract": async () => {
      await runVitestSuite("contract");
      await runVitestSuite("integration");
      await runVitestSuite("auth");
    },
    "privacy-security": async () => {
      await runVitestSuite("privacy");
      await runVitestSuite("security");
    },
    "typecheck-drift": async () => {
      await runTypecheck();
      await runArchitectureCheck();
      await runArtifactScript("scripts/contracts/verify-openapi.mjs", "contracts:check");
    },
    "unit-property": async () => {
      await runVitestSuite("unit");
      await runVitestSuite("property");
    },
  };
  const handler = gates[gate];
  if (handler === undefined) throw new GateFailure("UNKNOWN_GATE", [gate]);
  console.log(`GATE_START=${gate}`);
  await handler();
  console.log(`GATE_PASS=${gate}`);
}

async function runVerification() {
  for (const gate of [
    "format-lint",
    "typecheck-drift",
    "unit-property",
    "integration-contract",
    "privacy-security",
    "acceptance",
  ]) {
    await runGate(gate);
  }
  await runRealProviders();
  await runProtectedSuite("performance");
  await runProtectedSuite("operations");
  await runArtifactScript("scripts/verify/evidence.mjs", "evidence:verify");
  await runAcceptance("full-mvp");
}

function listCommands() {
  for (const command of [
    "acceptance:us1..us8",
    "acceptance:full-mvp",
    "architecture:check",
    "build",
    "contracts:check",
    "db:generate|migrate|reset:local|seed:synthetic|verify",
    "dev:manual|fake-providers|real-providers",
    "env:init:local|check",
    "evidence:verify",
    "gate:format-lint|typecheck-drift|unit-property|integration-contract|privacy-security|acceptance",
    "test:unit|property|contract|integration|auth:better-auth-compat|privacy|security|pwa",
    "test:acceptance|providers:real|performance|operations",
    "verify",
  ]) {
    console.log(command);
  }
}

async function main([command, subject]) {
  if (command === "acceptance") return runAcceptance(subject);
  if (command === "architecture") return runArchitectureCheck();
  if (command === "contracts")
    return runArtifactScript("scripts/contracts/verify-openapi.mjs", "contracts:check");
  if (command === "database") return runDatabaseCommand(subject);
  if (command === "dev") return runDevelopmentMode(subject);
  if (command === "environment" && subject === "check") return checkEnvironment();
  if (command === "environment" && subject === "init-local") return initializeLocalEnvironment();
  if (command === "evidence")
    return runArtifactScript("scripts/verify/evidence.mjs", "evidence:verify");
  if (command === "gate") return runGate(subject);
  if (command === "list") return listCommands();
  if (command === "protected") return runProtectedSuite(subject);
  if (command === "providers") return runRealProviders();
  if (command === "stories") return runAllStoryAcceptance();
  if (command === "test" && subject === "auth") return runAuthCompatibility();
  if (command === "test") return runVitestSuite(subject);
  if (command === "typecheck") return runTypecheck();
  if (command === "verify") return runVerification();
  if (command === "workspace") return runWorkspaceScript(subject);
  if (command === "release") {
    await requireRealMode({
      evidence: Object.values(externalEvidence),
      flag: "CASHMEMO_RELEASE_APPROVED",
      names: ["PRODUCTION_BASE_URL"],
    });
    return runArtifactScript("scripts/release/promote.mjs", "release");
  }
  throw new GateFailure("UNKNOWN_COMMAND", [command ?? "missing"]);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  const failure = error instanceof GateFailure ? error : new GateFailure("INTERNAL_GATE_FAILURE");
  console.error(`GATE_BLOCKED=${failure.code}`);
  for (const detail of failure.safeDetails) console.error(`GATE_DETAIL=${detail}`);
  process.exitCode = 1;
}
