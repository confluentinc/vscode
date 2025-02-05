import * as assert from "assert";
import * as ideSidecar from "ide-sidecar";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { preparePropertiesForTrack } from "./telemetryLogger";

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

  it("should include ide-sidecar version as currentSidecarVersion", () => {
    const version = "1.2.3";
    sandbox.stub(ideSidecar, "version").value(version);
    const result = preparePropertiesForTrack(undefined);
    assert.strictEqual(result.currentSidecarVersion, version);
  });
});
