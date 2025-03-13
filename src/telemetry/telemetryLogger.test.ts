import * as assert from "assert";
import * as ideSidecar from "ide-sidecar";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { preparePropertiesForTrack } from "./telemetryLogger";

const VALID_PLATFORMS: NodeJS.Platform[] = [
  "aix",
  "android",
  "cygwin",
  "darwin",
  "freebsd",
  "linux",
  "openbsd",
  "sunos",
  "win32",
];

const VALID_ARCH: string[] = [
  "arm",
  "arm64",
  "ia32",
  "mips",
  "mipsel",
  "ppc",
  "ppc64",
  "s390",
  "s390x",
  "x64",
];

describe("preparePropertiesForTrack", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should remove identify and user from data", () => {
    const data = {
      user: {
        id: "123",
        email: "foo@bar.com",
      },
      identify: true,
      foo: "bar",
    };

    const result = preparePropertiesForTrack(data);

    // user and identify should be removed,
    assert.strictEqual(result.user, undefined);
    assert.strictEqual(result.identify, undefined);
    // ... but other call-provided properties should remain.
    assert.strictEqual(result.foo, "bar");
  });

  it("should include vscode.env.uriScheme as productName", () => {
    const vscodeEnvUriSchemeStub = sandbox.stub(vscode.env, "uriScheme");
    for (const uriScheme of ["vscode", "vscode-insiders", "vscode-test"]) {
      vscodeEnvUriSchemeStub.value(uriScheme);
      const result = preparePropertiesForTrack(undefined);
      assert.strictEqual(result.productName, uriScheme);
    }
  });

  it("should include vscode.version as productVersion", () => {
    // vscode.version is unstubbable and read-only, so just go with expecting current value.
    const result = preparePropertiesForTrack(undefined);
    assert.strictEqual(result.productVersion, vscode.version);
  });

  it("should include ide-sidecar version as currentSidecarVersion", () => {
    const version = "1.2.3";
    sandbox.stub(ideSidecar, "version").value(version);
    const result = preparePropertiesForTrack(undefined);
    assert.strictEqual(result.currentSidecarVersion, version);
  });
  it("should include platform", () => {
    const result = preparePropertiesForTrack(undefined);
    let isValisPlatform = false;
    if (VALID_PLATFORMS.includes(result.platform as NodeJS.Platform)) {
      isValisPlatform = true;
    }
    assert.ok(isValisPlatform, `platform "${result.platform}" should be a valid os.Platform type`);
  });
  it("should include arch", () => {
    const result = preparePropertiesForTrack(undefined);
    let isValidArch = false;
    if (VALID_ARCH.includes(result.arch as NodeJS.Architecture)) {
      isValidArch = true;
    }
    assert.ok(isValidArch, `platform "${result.arch}" should be a valid os.Platform type`);
  });
});
