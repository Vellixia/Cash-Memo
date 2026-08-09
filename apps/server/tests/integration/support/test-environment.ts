import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

const POSTGRES_IMAGE = "postgres:18.4-alpine";
const MAILPIT_IMAGE = "axllent/mailpit:v1.30.7";
const OBJECT_FAKE_IMAGE = "adobe/s3mock:5.1.0";

export type IntegrationService = "mailpit" | "object-fake" | "postgres";

export interface TestEnvironmentOptions {
  services?: readonly IntegrationService[];
}

export interface TestEnvironment {
  mailpit?: {
    apiUrl: string;
    smtpHost: string;
    smtpPort: number;
  };
  objectFake?: {
    endpoint: string;
  };
  postgres?: {
    connectionUri: string;
    container: StartedPostgreSqlContainer;
  };
  stop(): Promise<void>;
}

function includesService(
  selected: ReadonlySet<IntegrationService>,
  service: IntegrationService,
): boolean {
  return selected.has(service);
}

export async function startTestEnvironment(
  options: TestEnvironmentOptions = {},
): Promise<TestEnvironment> {
  const selected = new Set<IntegrationService>(
    options.services ?? ["postgres", "mailpit", "object-fake"],
  );
  const started: StartedTestContainer[] = [];
  let postgres: StartedPostgreSqlContainer | undefined;
  let mailpit: StartedTestContainer | undefined;
  let objectFake: StartedTestContainer | undefined;

  try {
    if (includesService(selected, "postgres")) {
      postgres = await new PostgreSqlContainer(POSTGRES_IMAGE)
        .withDatabase("cashmemo_test")
        .withUsername("cashmemo_test")
        .withPassword("cashmemo-test-only")
        .start();
      started.push(postgres);
    }

    const auxiliaryStarts: Promise<void>[] = [];
    if (includesService(selected, "mailpit")) {
      auxiliaryStarts.push(
        new GenericContainer(MAILPIT_IMAGE)
          .withExposedPorts(1025, 8025)
          .withWaitStrategy(Wait.forListeningPorts())
          .start()
          .then((container) => {
            mailpit = container;
            started.push(container);
          }),
      );
    }
    if (includesService(selected, "object-fake")) {
      auxiliaryStarts.push(
        new GenericContainer(OBJECT_FAKE_IMAGE)
          .withEnvironment({
            COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS:
              "cashmemo-test-exports,cashmemo-test-evidence,cashmemo-test-deletion-ledger",
            COM_ADOBE_TESTING_S3MOCK_STORE_RETAIN_FILES_ON_EXIT: "false",
          })
          .withExposedPorts(9090)
          .withWaitStrategy(Wait.forListeningPorts())
          .start()
          .then((container) => {
            objectFake = container;
            started.push(container);
          }),
      );
    }
    await Promise.all(auxiliaryStarts);

    return {
      ...(postgres === undefined
        ? {}
        : { postgres: { connectionUri: postgres.getConnectionUri(), container: postgres } }),
      ...(mailpit === undefined
        ? {}
        : {
            mailpit: {
              apiUrl: `http://${mailpit.getHost()}:${String(mailpit.getMappedPort(8025))}`,
              smtpHost: mailpit.getHost(),
              smtpPort: mailpit.getMappedPort(1025),
            },
          }),
      ...(objectFake === undefined
        ? {}
        : {
            objectFake: {
              endpoint: `http://${objectFake.getHost()}:${String(objectFake.getMappedPort(9090))}`,
            },
          }),
      async stop() {
        await Promise.allSettled(started.toReversed().map(async (container) => container.stop()));
      },
    };
  } catch (error) {
    await Promise.allSettled(started.toReversed().map(async (container) => container.stop()));
    throw error;
  }
}
