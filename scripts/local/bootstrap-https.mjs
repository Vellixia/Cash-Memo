import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const certificateDirectory = path.join(repositoryRoot, ".secrets", "local-dev");
const caKey = path.join(certificateDirectory, "cashmemo-local-ca.key");
const caCertificate = path.join(certificateDirectory, "cashmemo-local-ca.crt");
const serverKey = path.join(certificateDirectory, "localhost.key");
const serverRequest = path.join(certificateDirectory, "localhost.csr");
const serverCertificate = path.join(certificateDirectory, "localhost.crt");
const serialFile = path.join(certificateDirectory, "cashmemo-local-ca.srl");
const opensslConfiguration = path.join(certificateDirectory, "openssl-san.cnf");

const exists = async (target) => {
  try {
    await access(target, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const run = (command, arguments_) => {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const safeReason = result.error?.code ?? `exit-${String(result.status)}`;
    throw new Error(`${command} failed (${safeReason}); output withheld`);
  }
};

await mkdir(certificateDirectory, { recursive: true, mode: 0o700 });

await writeFile(
  opensslConfiguration,
  `[req]
prompt = no
distinguished_name = subject
req_extensions = v3_req

[subject]
CN = localhost

[v3_req]
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
`,
  { mode: 0o600 },
);

if (!(await exists(caKey)) || !(await exists(caCertificate))) {
  run("openssl", [
    "req",
    "-x509",
    "-new",
    "-nodes",
    "-newkey",
    "rsa:3072",
    "-sha256",
    "-days",
    "3650",
    "-subj",
    "/CN=Cashmemo Local Development CA",
    "-keyout",
    caKey,
    "-out",
    caCertificate,
  ]);
}

if (!(await exists(serverKey)) || !(await exists(serverCertificate))) {
  run("openssl", [
    "req",
    "-new",
    "-nodes",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-keyout",
    serverKey,
    "-out",
    serverRequest,
    "-config",
    opensslConfiguration,
  ]);
  run("openssl", [
    "x509",
    "-req",
    "-sha256",
    "-days",
    "825",
    "-in",
    serverRequest,
    "-CA",
    caCertificate,
    "-CAkey",
    caKey,
    "-CAcreateserial",
    "-CAserial",
    serialFile,
    "-extensions",
    "v3_req",
    "-extfile",
    opensslConfiguration,
    "-out",
    serverCertificate,
  ]);
}

await Promise.all([chmod(caKey, 0o600), chmod(serverKey, 0o600)]);

process.stdout.write(
  `Local HTTPS material ready:\n- certificate: ${serverCertificate}\n- private key: ${serverKey}\n- local CA (trust manually if needed): ${caCertificate}\n`,
);
