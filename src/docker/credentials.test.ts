import * as assert from "assert";
import * as sinon from "sinon";
import {
  getStubbedSecretStorage,
  type StubbedSecretStorage,
} from "../../tests/stubs/extensionStorage";
import type { AuthConfig } from "../clients/docker";
import { SecretStorageKeys } from "../storage/constants";
import * as fsWrappers from "../utils/fsWrappers";
import {
  getDockerCredentials,
  getDockerCredsStore,
  isValidCredsStoreName,
  validateDockerCredentials,
} from "./credentials";

describe("docker/credentials.ts isValidCredsStoreName()", function () {
  it("should return true for valid credential store names", function () {
    const validNames = [
      "desktop",
      "osxkeychain",
      "test_store",
      "store-with-hyphens",
      "store123",
      "a",
    ];

    validNames.forEach((name) => {
      assert.strictEqual(isValidCredsStoreName(name), true, `Expected "${name}" to be valid`);
    });
  });

  it("should return false for invalid credential store names", function () {
    const invalidNames = [
      "store;rm -rf /", // command injection attempt
      "store && echo 'pwned'", // command chaining
      "store$(whoami)", // command substitution
      "store`id`", // backtick command substitution
      "store|cat /etc/passwd", // pipe injection
      "store > /tmp/file", // redirection
      "store < /etc/passwd", // input redirection
      "store & background", // background process
      "store'DROP TABLE users", // SQL injection style
      'store"DROP TABLE users', // SQL injection with double quotes
      "store/../../etc/passwd", // path traversal
      "store\\..\\..\\windows\\system32", // Windows path traversal
      "store%PATH%", // environment variable expansion
      "store$PATH", // Unix environment variable
      // other invalid character use:
      "store with spaces", // spaces not allowed
      "store\ttab", // tab character
      "store\nnewline", // newline character
      "store\rcarriage", // carriage return
      "store\0null", // null byte
      "store@hostname",
      "store#comment",
      "store*wildcard",
      "store?question",
      "store[bracket]",
      "store{brace}",
      "store(paren)",
      "store~tilde",
      "store!exclamation",
      "store+plus",
      "store=equals",
    ];

    invalidNames.forEach((name) => {
      assert.strictEqual(isValidCredsStoreName(name), false, `Expected "${name}" to be invalid`);
    });
  });

  it("should return false for empty strings", function () {
    assert.strictEqual(isValidCredsStoreName(""), false);
  });

  it("should return false for credential store names that are too long", function () {
    const longName = "a".repeat(100); // exactly 100 characters
    const tooLongName = "a".repeat(101); // 101 characters

    assert.strictEqual(isValidCredsStoreName(longName), false);
    assert.strictEqual(isValidCredsStoreName(tooLongName), false);
  });

  it("should return true for credential store names at the maximum allowed length", function () {
    const maxLengthName = "a".repeat(99); // 99 characters (just under limit)

    assert.strictEqual(isValidCredsStoreName(maxLengthName), true);
  });

  it("should not allow special unicode characters", function () {
    const unicodeNames = [
      "storeᄀ", // Korean character
      "store漢", // Chinese character
      "store🐳", // emoji
      "storeĠ", // accented character
    ];

    unicodeNames.forEach((name) => {
      assert.strictEqual(isValidCredsStoreName(name), false);
    });
  });
});

describe("docker/credentials.ts getDockerCredsStore()", function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(async function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should return undefined when the ~/.docker/config.json does not exist", function () {
    sandbox.stub(fsWrappers, "readFileSync").throws(new Error("ENOENT"));

    const result: string | undefined = getDockerCredsStore();

    assert.strictEqual(result, undefined);
  });

  it("should return undefined when the ~/.docker/config.json contains invalid JSON", function () {
    sandbox.stub(fsWrappers, "readFileSync").returns("invalid json{");

    const result: string | undefined = getDockerCredsStore();

    assert.strictEqual(result, undefined);
  });

  it("should return undefined when credsStore contains invalid characters", function () {
    sandbox.stub(fsWrappers, "readFileSync").returns(
      JSON.stringify({
        credsStore: "malicious;rm -rf /",
      }),
    );

    const result: string | undefined = getDockerCredsStore();

    assert.strictEqual(result, undefined);
  });

  it("should return valid credsStore when properly configured", function () {
    sandbox.stub(fsWrappers, "readFileSync").returns(
      JSON.stringify({
        credsStore: "desktop",
      }),
    );

    const result: string | undefined = getDockerCredsStore();

    assert.strictEqual(result, "desktop");
  });
});

describe("docker/credentials.ts validateDockerCredentials()", function () {
  it("should return undefined for null or undefined input", function () {
    assert.strictEqual(validateDockerCredentials(null), undefined);
    assert.strictEqual(validateDockerCredentials(undefined), undefined);
  });

  it("should return undefined for invalid credential formats", function () {
    assert.strictEqual(validateDockerCredentials({}), undefined);
    assert.strictEqual(validateDockerCredentials({ Username: "user" }), undefined);
    assert.strictEqual(validateDockerCredentials({ Secret: "pass" }), undefined);
    assert.strictEqual(validateDockerCredentials({ Username: 123, Secret: "pass" }), undefined);
  });

  for (const serverUrl of ["https://custom-registry.com/v2/", undefined]) {
    it(`should provide a valid auth config and use default Docker Hub URL even if ServerURL is ${serverUrl}`, function () {
      const result: AuthConfig | undefined = validateDockerCredentials({
        Username: "testuser",
        Secret: "testpass",
        ServerURL: serverUrl,
      });

      assert.deepStrictEqual(result, {
        username: "testuser",
        password: "testpass",
        serveraddress: "https://index.docker.io/v1/",
      });
    });
  }
});

describe("docker/credentials.ts getDockerCredentials()", function () {
  let sandbox: sinon.SinonSandbox;
  let secretStorage: StubbedSecretStorage;
  let readFileSyncStub: sinon.SinonStub;
  let execSyncStub: sinon.SinonStub;

  // a `~/.docker/config.json` pointing at a valid credential store
  const DOCKER_CONFIG_JSON = JSON.stringify({ credsStore: "desktop" });
  // valid output from the `docker-credential-<store> get` command
  const VALID_CREDS_OUTPUT = JSON.stringify({ Username: "testuser", Secret: "testpass" });
  const EXPECTED_AUTH_CONFIG: AuthConfig = {
    username: "testuser",
    password: "testpass",
    serveraddress: "https://index.docker.io/v1/",
  };

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    secretStorage = getStubbedSecretStorage(sandbox);
    readFileSyncStub = sandbox.stub(fsWrappers, "readFileSync");
    execSyncStub = sandbox.stub(fsWrappers, "execSync");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should return cached credentials without invoking the credential store", async function () {
    secretStorage.get.resolves("cached-creds");

    const result: string | undefined = await getDockerCredentials();

    assert.strictEqual(result, "cached-creds");
    sinon.assert.notCalled(execSyncStub);
    sinon.assert.notCalled(secretStorage.store);
  });

  it("should return undefined when no credsStore is configured", async function () {
    // no cache, and the Docker config has no credsStore
    readFileSyncStub.returns(JSON.stringify({}));

    const result: string | undefined = await getDockerCredentials();

    assert.strictEqual(result, undefined);
    sinon.assert.notCalled(execSyncStub);
  });

  it("should return undefined when the Docker config cannot be read", async function () {
    // e.g. a user with no `~/.docker/config.json` at all, the most common real-world state
    readFileSyncStub.throws(new Error("ENOENT"));

    const result: string | undefined = await getDockerCredentials();

    assert.strictEqual(result, undefined);
    sinon.assert.notCalled(execSyncStub);
  });

  it("should query the credential store, then cache and return the encoded credentials", async function () {
    readFileSyncStub.returns(DOCKER_CONFIG_JSON);
    execSyncStub.returns(VALID_CREDS_OUTPUT);

    const result: string | undefined = await getDockerCredentials();

    // the returned value should be a base64-encoding of the validated auth config
    assert.ok(result);
    const decoded = JSON.parse(Buffer.from(result, "base64").toString("utf-8"));
    assert.deepStrictEqual(decoded, EXPECTED_AUTH_CONFIG);
    // the "desktop" store should be queried via its `docker-credential-` command, with the Docker
    // Hub registry URL piped in on stdin (how the credential helper protocol receives the lookup)
    sinon.assert.calledOnce(execSyncStub);
    assert.strictEqual(execSyncStub.firstCall.args[0], "docker-credential-desktop get");
    assert.strictEqual(execSyncStub.firstCall.args[1].input, "https://index.docker.io/v1/");
    // and the encoded credentials should be cached for future lookups
    sinon.assert.calledOnceWithExactly(
      secretStorage.store,
      SecretStorageKeys.DOCKER_CREDS_SECRET_KEY,
      result,
    );
  });

  it("should not double-prefix a credsStore that already starts with `docker-credential-`", async function () {
    readFileSyncStub.returns(JSON.stringify({ credsStore: "docker-credential-desktop" }));
    execSyncStub.returns(VALID_CREDS_OUTPUT);

    await getDockerCredentials();

    assert.strictEqual(execSyncStub.firstCall.args[0], "docker-credential-desktop get");
  });

  it("should return undefined when the credential store command fails", async function () {
    readFileSyncStub.returns(DOCKER_CONFIG_JSON);
    execSyncStub.throws(new Error("command not found"));

    const result: string | undefined = await getDockerCredentials();

    assert.strictEqual(result, undefined);
    sinon.assert.notCalled(secretStorage.store);
  });

  it("should return undefined and not cache when the credential store returns invalid credentials", async function () {
    readFileSyncStub.returns(DOCKER_CONFIG_JSON);
    // missing the required `Secret` field, so validation fails
    execSyncStub.returns(JSON.stringify({ Username: "testuser" }));

    const result: string | undefined = await getDockerCredentials();

    assert.strictEqual(result, undefined);
    sinon.assert.notCalled(secretStorage.store);
  });

  it("should return undefined when the credential store emits non-JSON output", async function () {
    readFileSyncStub.returns(DOCKER_CONFIG_JSON);
    // some credential helpers print a plain-text error to stdout instead of JSON
    execSyncStub.returns("credentials not found in native keychain");

    const result: string | undefined = await getDockerCredentials();

    assert.strictEqual(result, undefined);
    sinon.assert.notCalled(secretStorage.store);
  });
});
