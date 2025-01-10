import * as assert from "assert";
import * as sinon from "sinon";
import { InputBoxValidationMessage, InputBoxValidationSeverity, window, workspace } from "vscode";
import {
  TEST_BROKER_CONFIGS,
  TEST_CANCELLATION_TOKEN,
} from "../../../tests/unit/testResources/docker";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import {
  ContainerCreateResponse,
  ContainerInspectResponse,
  ContainerSummary,
} from "../../clients/docker";
import { LOCAL_KAFKA_REST_PORT } from "../../constants";
import { localKafkaConnected } from "../../emitters";
import { LOCAL_DOCKER_SOCKET_PATH } from "../../preferences/constants";
import { DEFAULT_UNIX_SOCKET_PATH } from "../configs";
import * as dockerContainers from "../containers";
import * as dockerNetworks from "../networks";
import { LocalResourceContainer } from "./base";
import {
  brokerConfigsToControllerQuorumVoters,
  brokerConfigsToRestBootstrapServers,
  ConfluentLocalWorkflow,
  CONTAINER_NAME_PREFIX,
  validateBrokerInput,
} from "./confluent-local";

describe("docker/workflows/confluent-local.ts ConfluentLocalWorkflow", () => {
  let sandbox: sinon.SinonSandbox;

  // vscode stubs
  let showInputBoxStub: sinon.SinonStub;
  let showErrorMessageStub: sinon.SinonStub;
  let getConfigurationStub: sinon.SinonStub;

  // docker/containers.ts+networks.ts wrapper function stubs
  let createContainerStub: sinon.SinonStub;
  let getContainersForImageStub: sinon.SinonStub;
  let createNetworkStub: sinon.SinonStub;

  let workflow: ConfluentLocalWorkflow;
  // base class stubs
  let checkForImageStub: sinon.SinonStub;
  let handleExistingContainersStub: sinon.SinonStub;
  let showErrorNotificationStub: sinon.SinonStub;
  let startContainerStub: sinon.SinonStub;
  let stopContainerStub: sinon.SinonStub;
  let waitForLocalResourceEventChangeStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    showInputBoxStub = sandbox.stub(window, "showInputBox").resolves("1");
    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();
    // this should probably live in a separate test helper file
    getConfigurationStub = sandbox.stub(workspace, "getConfiguration");
    getConfigurationStub.returns({
      get: sandbox.stub().withArgs(LOCAL_DOCKER_SOCKET_PATH).returns(DEFAULT_UNIX_SOCKET_PATH),
    });

    // assume no running containers matching this workflow image for most tests
    getContainersForImageStub = sandbox
      .stub(dockerContainers, "getContainersForImage")
      .resolves([]);
    createNetworkStub = sandbox.stub(dockerNetworks, "createNetwork");

    workflow = ConfluentLocalWorkflow.getInstance();

    checkForImageStub = sandbox.stub(workflow, "checkForImage").resolves();
    handleExistingContainersStub = sandbox.stub(workflow, "handleExistingContainers").resolves();
    showErrorNotificationStub = sandbox.stub(workflow, "showErrorNotification").resolves();
    // assume the container is created successfully for most tests
    const fakeCreatedContainer: ContainerCreateResponse = { Id: "1", Warnings: [] };
    createContainerStub = sandbox
      .stub(dockerContainers, "createContainer")
      .resolves(fakeCreatedContainer);
    // assume the container starts successfully for most tests
    const fakeStartedContainer: ContainerInspectResponse = { Id: "1" };
    startContainerStub = sandbox.stub(workflow, "startContainer").resolves(fakeStartedContainer);
    // assume the container stops successfully for most tests
    stopContainerStub = sandbox.stub(workflow, "stopContainer").resolves();
    // don't block on waiting for the event to resolve for most tests
    waitForLocalResourceEventChangeStub = sandbox
      .stub(workflow, "waitForLocalResourceEventChange")
      .resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it(".imageRepo should return the correct image repository for this workflow", () => {
    // making sure the getter method is working as expected against the static property
    assert.equal(workflow.imageRepo, ConfluentLocalWorkflow.imageRepo);
  });

  it("start() should create and start Kafka containers", async () => {
    createNetworkStub.resolves();
    createContainerStub.resolves({ Id: "1" } as ContainerCreateResponse);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    // happy path: no existing containers, user selects 1 broker
    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(createNetworkStub.calledOnce);

    assert.ok(showInputBoxStub.calledOnce);
    assert.ok(createContainerStub.calledOnce);
    assert.ok(startContainerStub.calledOnce);

    assert.ok(waitForLocalResourceEventChangeStub.calledOnce);
  });

  it("start() should handle existing containers and not create new ones", async () => {
    const fakeContainers: ContainerSummary[] = [{ Id: "1", Names: ["container1"] }];
    getContainersForImageStub.resolves(fakeContainers);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.calledOnceWith(fakeContainers));

    assert.ok(createNetworkStub.notCalled);

    assert.ok(showInputBoxStub.notCalled);
    assert.ok(createContainerStub.notCalled);
    assert.ok(startContainerStub.notCalled);

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("start() should exit early when the user exits the broker container input box", async () => {
    showInputBoxStub.resolves(undefined);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(createNetworkStub.calledOnce);

    assert.ok(showInputBoxStub.calledOnce);
    assert.ok(createContainerStub.notCalled);
    assert.ok(startContainerStub.notCalled);

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("start() should exit early and show an error notification if a container fails to be created", async () => {
    createContainerStub.rejects(new Error("uh oh"));

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(createNetworkStub.calledOnce);

    assert.ok(showInputBoxStub.calledOnce);
    assert.ok(createContainerStub.calledOnce);
    assert.ok(showErrorNotificationStub.calledOnce);
    assert.ok(startContainerStub.notCalled);

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("start() should exit early and if a container fails to start", async () => {
    startContainerStub.resolves(undefined);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(createNetworkStub.calledOnce);

    assert.ok(showInputBoxStub.calledOnce);
    assert.ok(createContainerStub.calledOnce);
    assert.ok(startContainerStub.calledOnce);
    // notification tested in base.test.ts as part of .startContainer() tests

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("stop() should stop a Kafka container", async () => {
    const containerId = "1";
    // the container name will likely have a leading slash
    const containerName = "/container1";
    const fakeContainers: ContainerSummary[] = [{ Id: containerId, Names: [containerName] }];
    getContainersForImageStub.resolves(fakeContainers);

    await workflow.stop(TEST_CANCELLATION_TOKEN);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(stopContainerStub.calledOnceWith({ id: containerId, name: containerName }));
    assert.ok(waitForLocalResourceEventChangeStub.calledOnce);
  });

  it("stop() should exit early if there are no running Kafka containers", async () => {
    getContainersForImageStub.resolves([]);

    await workflow.stop(TEST_CANCELLATION_TOKEN);

    assert.ok(getContainersForImageStub.calledOnce);
    // not the usual "Open Logs"+"File Issue" notification, just a basic error message with a button to open settings
    assert.ok(
      showErrorMessageStub.calledOnceWith(
        `No ${workflow.resourceKind} containers found to stop. Please ensure your Kafka image repo+tag settings match currently running containers and try again.`,
        "Open Settings",
      ),
    );
    assert.ok(stopContainerStub.notCalled);
    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("waitForLocalResourceEventChange() should resolve when the localKafkaConnected event is emitted", async () => {
    const promise = workflow.waitForLocalResourceEventChange();
    localKafkaConnected.fire(true);
    await assert.doesNotReject(promise);
  });

  it("generateBrokerConfigs() should generate the correct number of broker configs", async () => {
    const numBrokers = 3;
    const brokerConfigs = await workflow["generateBrokerConfigs"](numBrokers);

    assert.equal(brokerConfigs.length, numBrokers);
    // skip checking ports, that's tested separately
    assert.equal(brokerConfigs[0].brokerNum, 1);
    assert.equal(brokerConfigs[0].containerName, `${CONTAINER_NAME_PREFIX}-1`);
    assert.equal(brokerConfigs[1].brokerNum, 2);
    assert.equal(brokerConfigs[1].containerName, `${CONTAINER_NAME_PREFIX}-2`);
    assert.equal(brokerConfigs[2].brokerNum, 3);
    assert.equal(brokerConfigs[2].containerName, `${CONTAINER_NAME_PREFIX}-3`);
  });

  it("configurePorts() should return unique ports for each broker", async () => {
    const ports = await workflow["configurePorts"]();

    assert.ok(ports.plainText);
    assert.ok(ports.broker);
    assert.ok(ports.controller);
    // can't easily test that these aren't occupied ports, just that they're different
    assert.notEqual(ports.plainText, ports.broker);
    assert.notEqual(ports.plainText, ports.controller);
    assert.notEqual(ports.broker, ports.controller);
  });

  it("generateHostConfig() should generate the correct HostConfig for a Kafka container based on the provided broker config", () => {
    const hostConfig = workflow["generateHostConfig"](TEST_BROKER_CONFIGS[0]);

    const plainTextPort = TEST_BROKER_CONFIGS[0].ports.plainText;
    assert.deepStrictEqual(hostConfig, {
      NetworkMode: workflow.networkName,
      PortBindings: {
        [`${plainTextPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: plainTextPort.toString() }],
        [`${LOCAL_KAFKA_REST_PORT}/tcp`]: [
          { HostIp: "0.0.0.0", HostPort: LOCAL_KAFKA_REST_PORT.toString() },
        ],
      },
    });
  });

  it("generateHostConfig() should only expose the REST port on the first broker", () => {
    const hostConfig = workflow["generateHostConfig"](TEST_BROKER_CONFIGS[1]);

    const plainTextPort = TEST_BROKER_CONFIGS[1].ports.plainText;
    assert.deepStrictEqual(hostConfig, {
      NetworkMode: workflow.networkName,
      PortBindings: {
        [`${plainTextPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: plainTextPort.toString() }],
      },
    });
  });

  it("generateContainerEnv() should generate the correct environment variables for a broker", () => {
    const brokerNum = 1;
    const brokerConfig = TEST_BROKER_CONFIGS[0];

    const envVars = workflow["generateContainerEnv"](brokerNum, TEST_BROKER_CONFIGS);

    const advertisedListeners = `KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://${brokerConfig.containerName}:${brokerConfig.ports.broker},PLAINTEXT_HOST://localhost:${brokerConfig.ports.plainText}`;
    const brokerId = `KAFKA_BROKER_ID=${brokerNum}`;
    const controllerQuorumVoters = `KAFKA_CONTROLLER_QUORUM_VOTERS=${brokerConfigsToControllerQuorumVoters(
      TEST_BROKER_CONFIGS,
    ).join(",")}`;
    const listeners = `KAFKA_LISTENERS=PLAINTEXT://${brokerConfig.containerName}:${brokerConfig.ports.broker},CONTROLLER://${brokerConfig.containerName}:${brokerConfig.ports.controller},PLAINTEXT_HOST://0.0.0.0:${brokerConfig.ports.plainText}`;
    const nodeId = `KAFKA_NODE_ID=${brokerNum}`;

    assert.ok(envVars.includes(brokerId));
    assert.ok(envVars.includes(advertisedListeners));
    assert.ok(envVars.includes(controllerQuorumVoters));
    assert.ok(envVars.includes(listeners));
    assert.ok(envVars.includes(nodeId));
    // all the rest are hard-coded and don't depend on the broker configs; if these pass, the rest should be fine
  });

  it("createKafkaContainer() should create a Kafka container with the correct configuration", async () => {
    const fakeResponse: ContainerCreateResponse = { Id: "1", Warnings: [] };
    createContainerStub.resolves(fakeResponse);

    // env var generation tested separately, not relevant here
    const envVars = ["KAFKA_BROKER_ID=1"];
    const plainTextPort = TEST_BROKER_CONFIGS[0].ports.plainText;

    const result: LocalResourceContainer | undefined = await workflow.createKafkaContainer(
      TEST_BROKER_CONFIGS[0],
      envVars,
    );

    const containerName = TEST_BROKER_CONFIGS[0].containerName;
    assert.ok(result);
    assert.equal(result.id, "1");
    assert.equal(result.name, containerName);
    assert.ok(createContainerStub.calledOnce);
    assert.ok(
      createContainerStub.calledWith(workflow.imageRepo, workflow.imageTag, {
        body: {
          Image: workflow.imageRepoTag,
          Hostname: containerName,
          ExposedPorts: { [`${plainTextPort}/tcp`]: {} },
          HostConfig: {
            NetworkMode: workflow.networkName,
            PortBindings: {
              [`${plainTextPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: plainTextPort.toString() }],
              [`${LOCAL_KAFKA_REST_PORT}/tcp`]: [
                { HostIp: "0.0.0.0", HostPort: LOCAL_KAFKA_REST_PORT.toString() },
              ],
            },
          },
          Cmd: ["bash", "-c", "'/etc/confluent/docker/run'"],
          Env: envVars,
          Tty: false,
        },
        name: containerName,
      }),
      `createContainerStub called with: ${JSON.stringify(createContainerStub.args, null, 2)}`,
    );
  });
});

describe("docker/workflows/confluent-local.ts helper functions", () => {
  it("brokerConfigsToControllerQuorumVoters() should return the correct controller quorum voters string array", () => {
    const result = brokerConfigsToControllerQuorumVoters(TEST_BROKER_CONFIGS);

    assert.deepStrictEqual(result, [
      `${TEST_BROKER_CONFIGS[0].brokerNum}@${TEST_BROKER_CONFIGS[0].containerName}:${TEST_BROKER_CONFIGS[0].ports.controller}`,
      `${TEST_BROKER_CONFIGS[1].brokerNum}@${TEST_BROKER_CONFIGS[1].containerName}:${TEST_BROKER_CONFIGS[1].ports.controller}`,
    ]);
  });

  it("brokerConfigsToControllerQuorumVoters() should return an empty array if no brokers are passed", () => {
    const result = brokerConfigsToControllerQuorumVoters([]);

    assert.deepEqual(result, []);
  });

  it("brokerConfigsToRestBootstrapServers() should return the correct REST bootstrap servers string array", () => {
    const result = brokerConfigsToRestBootstrapServers(TEST_BROKER_CONFIGS);

    assert.deepStrictEqual(result, [
      `${TEST_BROKER_CONFIGS[0].containerName}:${TEST_BROKER_CONFIGS[0].ports.broker}`,
      `${TEST_BROKER_CONFIGS[1].containerName}:${TEST_BROKER_CONFIGS[1].ports.broker}`,
    ]);
  });

  it("brokerConfigsToRestBootstrapServers() should return an empty array if no brokers are passed", () => {
    const result = brokerConfigsToRestBootstrapServers([]);

    assert.deepEqual(result, []);
  });

  it("validateBrokerInput() should return nothing if the input is a valid number between 1-4 (inclusive)", () => {
    const result: InputBoxValidationMessage | undefined = validateBrokerInput("1");

    assert.strictEqual(result, undefined);
  });

  it("validateBrokerInput() should return an error InputBoxValidationMessage if the input is not a number", () => {
    const result: InputBoxValidationMessage | undefined = validateBrokerInput("a");

    assert.ok(result);
    assert.equal(result.message, "Please enter a number between 1 and 4 (inclusive)");
    assert.equal(result.severity, InputBoxValidationSeverity.Error);
  });

  it("validateBrokerInput() should return an error InputBoxValidationMessage if the input is not between 1-4 (inclusive)", () => {
    const result1: InputBoxValidationMessage | undefined = validateBrokerInput("0");
    assert.ok(result1);
    assert.equal(result1.message, "Please enter a number between 1 and 4 (inclusive)");
    assert.equal(result1.severity, InputBoxValidationSeverity.Error);

    const result2: InputBoxValidationMessage | undefined = validateBrokerInput("5");
    assert.ok(result2);
    assert.equal(result2.message, "Please enter a number between 1 and 4 (inclusive)");
    assert.equal(result2.severity, InputBoxValidationSeverity.Error);
  });
});
