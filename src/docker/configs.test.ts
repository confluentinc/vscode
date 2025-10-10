import * as assert from "assert";
import { normalize } from "path";
import sinon from "sinon";
import { Agent, RequestInit as UndiciRequestInit } from "undici";
import { window } from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { ResponseError, SystemApi } from "../clients/docker";
import { LOCAL_DOCKER_SOCKET_PATH } from "../extensionSettings/constants";
import * as configs from "./configs";

describe("docker/configs functions", function () {
  let sandbox: sinon.SinonSandbox;
  let showErrorMessageStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();
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
    const stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    stubbedConfigs.stubGet(LOCAL_DOCKER_SOCKET_PATH, "/custom/path/docker.sock");

    const path: string = configs.getSocketPath();

    // normalized to adjust slashes for Windows vs Unix
    assert.strictEqual(path, normalize("/custom/path/docker.sock"));
    sinon.assert.calledOnce(stubbedConfigs.get);
    sinon.assert.calledOnceWithExactly(
      stubbedConfigs.get,
      LOCAL_DOCKER_SOCKET_PATH.id,
      LOCAL_DOCKER_SOCKET_PATH.defaultValue,
    );
  });

  it("defaultRequestInit() should set the dispatcher as an Agent", async function () {
    sandbox.stub(configs, "getSocketPath").returns("/var/run/docker.sock");

    const init = (await configs.defaultRequestInit()) as UndiciRequestInit;

    assert.ok(init.dispatcher);
    assert.ok(init.dispatcher instanceof Agent);
    // TODO: assert dispatcher options somehow
  });

  it("isDockerAvailable() should return true when Docker is available", async function () {
    const systemPingStub = sandbox.stub(SystemApi.prototype, "systemPing").resolves("OK");

    const result = await configs.isDockerAvailable();

    assert.strictEqual(result, true);
    sinon.assert.calledOnce(systemPingStub);
    sinon.assert.notCalled(showErrorMessageStub);
  });

  it("isDockerAvailable() should return false when Docker is not available", async function () {
    const systemPingStub = sandbox
      .stub(SystemApi.prototype, "systemPing")
      .rejects(new Error("Docker not available"));

    const result = await configs.isDockerAvailable();

    assert.strictEqual(result, false);
    sinon.assert.calledOnce(systemPingStub);
  });

  it("isDockerAvailable() should show a notification if `showNotification` is set to true and Docker is not available", async function () {
    const systemPingStub = sandbox
      .stub(SystemApi.prototype, "systemPing")
      .rejects(new Error("Docker not available"));

    await configs.isDockerAvailable(true);

    sinon.assert.calledOnce(systemPingStub);
    sinon.assert.calledOnce(showErrorMessageStub);
  });

  it("showDockerUnavailableErrorNotification() should show ResponseError content in the error notification", async () => {
    const error = new ResponseError(new Response("uh oh", { status: 400 }));
    await configs.showDockerUnavailableErrorNotification(error);

    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      "Docker is not available: Error 400: uh oh",
      "Open Logs",
      "File Issue",
      "",
    );
  });

  it("showDockerUnavailableErrorNotification() should show a canned response when dealing with non-ResponseErrors", async () => {
    // assume "http.fetchAdditionalSupport" is disabled by default
    const stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    stubbedConfigs.get.withArgs("http.fetchAdditionalSupport").returns(false);

    const error = new Error("connect ENOENT /var/run/docker.sock");
    await configs.showDockerUnavailableErrorNotification(error);

    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      "Docker is not available: Please install Docker and try again once it's running.",
      "Install Docker",
      "Open Logs",
      "",
    );
  });

  // TODO(shoup): remove this once we have a better way to handle the behavior described in
  //   https://github.com/confluentinc/vscode/issues/751
  it("showDockerUnavailableErrorNotification() should suggest toggling the http.fetchAdditionalSupport setting if it's enabled when dealing with non-ResponseErrors", async () => {
    const stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    stubbedConfigs.get.withArgs("http.fetchAdditionalSupport").returns(true);

    const error = new Error("ECONNREFUSED: fetch failed, AggregateError");
    await configs.showDockerUnavailableErrorNotification(error);

    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      `Docker is not available: If Docker is currently running, please disable the "http.fetchAdditionalSupport" setting and try again.`,
      "Install Docker",
      "Open Logs",
      "Update Settings",
    );
  });
});
