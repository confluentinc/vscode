import * as assert from "assert";
import { normalize } from "path";
import sinon from "sinon";
import type { RequestInit as UndiciRequestInit } from "undici";
import { Agent } from "undici";
import { window } from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { ResponseError, SystemApi } from "../clients/docker";
import { LOCAL_DOCKER_SOCKET_PATH } from "../extensionSettings/constants";
import * as configs from "./configs";
import * as diagnostics from "./diagnostics";
import { DockerConfigStatus, DockerSocketStatus } from "./diagnostics";

describe("docker/configs functions", function () {
  let sandbox: sinon.SinonSandbox;
  let showErrorMessageStub: sinon.SinonStub;
  let checkSocketAccessStub: sinon.SinonStub;
  let checkConfigFileStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();
    // default to an accessible socket so the non-ResponseError tests fall through to the
    // install/fetchAdditionalSupport handling; the socket-permission tests override this.
    checkSocketAccessStub = sandbox
      .stub(diagnostics, "checkDockerSocketAccess")
      .returns(DockerSocketStatus.ACCESSIBLE);
    // default to a healthy config file so notification messages stay deterministic; the
    // config-hint test overrides this.
    checkConfigFileStub = sandbox
      .stub(diagnostics, "checkDockerConfigFile")
      .returns(DockerConfigStatus.VALID);
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
    sinon.assert.calledOnceWithExactly(stubbedConfigs.get, LOCAL_DOCKER_SOCKET_PATH.id);
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

  it("showDockerUnavailableErrorNotification() should surface a permissions hint when the socket exists but is inaccessible", async () => {
    sandbox.stub(process, "platform").value("linux");
    checkSocketAccessStub.returns(DockerSocketStatus.PERMISSION_DENIED);
    const stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    stubbedConfigs.stubGet(LOCAL_DOCKER_SOCKET_PATH, "/var/run/docker.sock");
    const error = new Error("connect EACCES /var/run/docker.sock");

    await configs.showDockerUnavailableErrorNotification(error);

    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      `Docker is not available: The Docker socket at "/var/run/docker.sock" exists but isn't accessible. Ensure your user has permission to use it (on Linux, add your user to the "docker" group and restart your session).`,
      "View Docs",
      "Open Logs",
      "",
    );
  });

  it("showDockerUnavailableErrorNotification() should append a config-file hint when the socket is inaccessible and the Docker config is empty/missing", async () => {
    sandbox.stub(process, "platform").value("linux");
    checkSocketAccessStub.returns(DockerSocketStatus.PERMISSION_DENIED);
    checkConfigFileStub.returns(DockerConfigStatus.EMPTY);
    const stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    stubbedConfigs.stubGet(LOCAL_DOCKER_SOCKET_PATH, "/var/run/docker.sock");
    const error = new Error("connect EACCES /var/run/docker.sock");

    await configs.showDockerUnavailableErrorNotification(error);

    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      `Docker is not available: The Docker socket at "/var/run/docker.sock" exists but isn't accessible. Ensure your user has permission to use it (on Linux, add your user to the "docker" group and restart your session). Also ensure "~/.docker/config.json" exists and contains at least "{}".`,
      "View Docs",
      "Open Logs",
      "",
    );
  });

  it("showDockerUnavailableErrorNotification() should not append the config-file hint when the config is present but unreadable/malformed", async () => {
    sandbox.stub(process, "platform").value("linux");
    checkSocketAccessStub.returns(DockerSocketStatus.PERMISSION_DENIED);
    checkConfigFileStub.returns(DockerConfigStatus.INVALID);
    const stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    stubbedConfigs.stubGet(LOCAL_DOCKER_SOCKET_PATH, "/var/run/docker.sock");
    const error = new Error("connect EACCES /var/run/docker.sock");

    await configs.showDockerUnavailableErrorNotification(error);

    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      `Docker is not available: The Docker socket at "/var/run/docker.sock" exists but isn't accessible. Ensure your user has permission to use it (on Linux, add your user to the "docker" group and restart your session).`,
      "View Docs",
      "Open Logs",
      "",
    );
  });

  it("showDockerUnavailableErrorNotification() should not treat a permission-denied socket as a permissions issue on Windows", async () => {
    sandbox.stub(process, "platform").value("win32");
    checkSocketAccessStub.returns(DockerSocketStatus.PERMISSION_DENIED);
    const stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    stubbedConfigs.get.withArgs("http.fetchAdditionalSupport").returns(false);
    const error = new Error("connect EACCES //./pipe/docker_engine");

    await configs.showDockerUnavailableErrorNotification(error);

    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      "Docker is not available: Please install Docker and try again once it's running.",
      "Install Docker",
      "Open Logs",
      "",
    );
    sinon.assert.notCalled(checkSocketAccessStub);
  });
});
