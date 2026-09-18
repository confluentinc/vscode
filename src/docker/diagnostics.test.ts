import * as assert from "assert";
import sinon from "sinon";
import * as fsWrappers from "../utils/fsWrappers";
import {
  checkDockerConfigFile,
  checkDockerSocketAccess,
  DockerConfigStatus,
  DockerSocketStatus,
} from "./diagnostics";

const TEST_SOCKET_PATH = "/var/run/docker.sock";

/** Build an {@link NodeJS.ErrnoException} carrying the given `code`, as `fs.accessSync` would throw. */
function errnoError(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`${code}: permission denied, access`);
  error.code = code;
  return error;
}

describe("docker/diagnostics.ts checkDockerSocketAccess()", function () {
  let sandbox: sinon.SinonSandbox;
  let accessSyncStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    accessSyncStub = sandbox.stub(fsWrappers, "accessSync");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should return ACCESSIBLE when the socket can be read and written", function () {
    accessSyncStub.returns(undefined);

    const status = checkDockerSocketAccess(TEST_SOCKET_PATH);

    assert.strictEqual(status, DockerSocketStatus.ACCESSIBLE);
  });

  it("should return MISSING when the socket path does not exist (ENOENT)", function () {
    accessSyncStub.throws(errnoError("ENOENT"));

    const status = checkDockerSocketAccess(TEST_SOCKET_PATH);

    assert.strictEqual(status, DockerSocketStatus.MISSING);
  });

  for (const code of ["EACCES", "EPERM"]) {
    it(`should return PERMISSION_DENIED when access is denied (${code})`, function () {
      accessSyncStub.throws(errnoError(code));

      const status = checkDockerSocketAccess(TEST_SOCKET_PATH);

      assert.strictEqual(status, DockerSocketStatus.PERMISSION_DENIED);
    });
  }

  it("should return UNKNOWN for an unexpected error code", function () {
    accessSyncStub.throws(errnoError("EIO"));

    const status = checkDockerSocketAccess(TEST_SOCKET_PATH);

    assert.strictEqual(status, DockerSocketStatus.UNKNOWN);
  });

  it("should return UNKNOWN when the thrown error has no code", function () {
    accessSyncStub.throws(new Error("something odd"));

    const status = checkDockerSocketAccess(TEST_SOCKET_PATH);

    assert.strictEqual(status, DockerSocketStatus.UNKNOWN);
  });
});

describe("docker/diagnostics.ts checkDockerConfigFile()", function () {
  let sandbox: sinon.SinonSandbox;
  let readFileSyncStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    readFileSyncStub = sandbox.stub(fsWrappers, "readFileSync");
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should return VALID when the config file parses to an object", function () {
    readFileSyncStub.returns('{"credsStore":"desktop"}');

    const status = checkDockerConfigFile();

    assert.strictEqual(status, DockerConfigStatus.VALID);
  });

  it("should return VALID for an empty JSON object", function () {
    readFileSyncStub.returns("{}");

    const status = checkDockerConfigFile();

    assert.strictEqual(status, DockerConfigStatus.VALID);
  });

  it("should return MISSING when the config file does not exist (ENOENT)", function () {
    readFileSyncStub.throws(errnoError("ENOENT"));

    const status = checkDockerConfigFile();

    assert.strictEqual(status, DockerConfigStatus.MISSING);
  });

  it("should return EMPTY when the config file is empty or whitespace-only", function () {
    readFileSyncStub.returns("  \n  ");

    const status = checkDockerConfigFile();

    assert.strictEqual(status, DockerConfigStatus.EMPTY);
  });

  it("should return INVALID when the config file is not valid JSON", function () {
    readFileSyncStub.returns("not json at all");

    const status = checkDockerConfigFile();

    assert.strictEqual(status, DockerConfigStatus.INVALID);
  });

  it("should return INVALID when the config file parses to a non-object", function () {
    readFileSyncStub.returns("42");

    const status = checkDockerConfigFile();

    assert.strictEqual(status, DockerConfigStatus.INVALID);
  });

  it("should return INVALID when the config file cannot be read (non-ENOENT)", function () {
    readFileSyncStub.throws(errnoError("EACCES"));

    const status = checkDockerConfigFile();

    assert.strictEqual(status, DockerConfigStatus.INVALID);
  });
});
