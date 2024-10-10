import * as assert from "assert";
import { normalize } from "path";
import sinon from "sinon";
import { Agent, RequestInit as UndiciRequestInit } from "undici";
import { workspace } from "vscode";
import { SystemApi } from "../clients/docker";
import { LOCAL_DOCKER_SOCKET_PATH } from "../preferences/constants";
import * as configs from "./configs";

describe("docker/configs functions", function () {
  let sandbox: sinon.SinonSandbox;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("getSocketPath() should return default socket path for Windows", function () {
    sandbox.stub(process, "platform").value("win32");

    const path = configs.getSocketPath();

    assert.strictEqual(path, normalize(configs.DEFAULT_WINDOWS_SOCKET_PATH));
  });

  it("getSocketPath() should return default socket path for non-Windows", function () {
    sandbox.stub(process, "platform").value("linux");

    const path = configs.getSocketPath();

    assert.strictEqual(path, configs.DEFAULT_UNIX_SOCKET_PATH);
  });

  it("getSocketPath() should return socket path from user settings", function () {
    const getConfigStub = sandbox.stub(workspace, "getConfiguration").returns({
      get: sandbox.stub().callsFake((key: string) => {
        if (key === LOCAL_DOCKER_SOCKET_PATH) return "/custom/path/docker.sock";
      }),
    } as any);

    const path: string = configs.getSocketPath();

    assert.strictEqual(path, "/custom/path/docker.sock");
    assert.ok(getConfigStub.calledOnce);
  });

  it("defaultRequestInit() should set the dispatcher as an Agent", function () {
    sandbox.stub(configs, "getSocketPath").returns("/var/run/docker.sock");

    const init = configs.defaultRequestInit() as UndiciRequestInit;

    assert.ok(init.dispatcher);
    assert.ok(init.dispatcher instanceof Agent);
    // TODO: assert dispatcher options somehow
  });

  it("isDockerAvailable() should return true when Docker is available", async function () {
    const systemPingStub = sandbox.stub(SystemApi.prototype, "systemPing").resolves("OK");

    const result = await configs.isDockerAvailable();

    assert.strictEqual(result, true);
    assert.ok(systemPingStub.calledOnce);
  });

  it("isDockerAvailable() should return false when Docker is not available", async function () {
    const systemPingStub = sandbox
      .stub(SystemApi.prototype, "systemPing")
      .rejects(new Error("Docker not available"));

    const result = await configs.isDockerAvailable();

    assert.strictEqual(result, false);
    assert.ok(systemPingStub.calledOnce);
  });
});
