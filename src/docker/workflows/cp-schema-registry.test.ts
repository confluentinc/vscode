import * as assert from "assert";
import * as sinon from "sinon";
import { commands, window, workspace } from "vscode";
import {
  TEST_BROKER_CONFIGS,
  TEST_CANCELLATION_TOKEN,
  TEST_KAFKA_CONTAINERS,
} from "../../../tests/unit/testResources/docker";
import { getTestExtensionContext } from "../../../tests/unit/testUtils";
import {
  ContainerCreateOperationRequest,
  ContainerCreateResponse,
  ContainerInspectResponse,
} from "../../clients/docker";
import {
  LOCAL_DOCKER_SOCKET_PATH,
  LOCAL_KAFKA_IMAGE,
  LOCAL_KAFKA_IMAGE_TAG,
} from "../../preferences/constants";
import * as connections from "../../sidecar/connections";
import { DEFAULT_UNIX_SOCKET_PATH } from "../configs";
import {
  DEFAULT_DOCKER_NETWORK,
  DEFAULT_KAFKA_IMAGE_REPO,
  DEFAULT_KAFKA_IMAGE_TAG,
  LocalResourceKind,
} from "../constants";
import * as dockerContainers from "../containers";
import * as ports from "../ports";
import { brokerConfigsToRestBootstrapServers } from "./confluent-local";
import {
  ConfluentPlatformSchemaRegistryWorkflow,
  CONTAINER_NAME,
  determineKafkaBootstrapServers,
  determineKafkaDockerNetworks,
  IMAGE_SETTINGS_BUTTON,
  START_KAFKA_BUTTON,
} from "./cp-schema-registry";

describe("docker/workflows/cp-schema-registry.ts ConfluentPlatformSchemaRegistryWorkflow", () => {
  let sandbox: sinon.SinonSandbox;

  // vscode stubs
  let showErrorMessageStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let getConfigurationStub: sinon.SinonStub;

  // docker/containers.ts wrapper function stubs
  let createContainerStub: sinon.SinonStub;
  let getContainersForImageStub: sinon.SinonStub;
  let getContainerStub: sinon.SinonStub;

  let workflow: ConfluentPlatformSchemaRegistryWorkflow;
  // base class stubs
  let checkForImageStub: sinon.SinonStub;
  let handleExistingContainersStub: sinon.SinonStub;
  let workflowShowErrorNotificationStub: sinon.SinonStub;
  let fetchAndFilterKafkaContainersStub: sinon.SinonStub;
  let startContainerStub: sinon.SinonStub;
  let stopContainerStub: sinon.SinonStub;
  let waitForLocalResourceEventChangeStub: sinon.SinonStub;

  let updateLocalConnectionStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();
    executeCommandStub = sandbox.stub(commands, "executeCommand").resolves();
    // this should probably live in a separate test helper file
    getConfigurationStub = sandbox.stub(workspace, "getConfiguration");
    const configMap = {
      [LOCAL_KAFKA_IMAGE]: DEFAULT_KAFKA_IMAGE_REPO,
      [LOCAL_KAFKA_IMAGE_TAG]: DEFAULT_KAFKA_IMAGE_TAG,
      [LOCAL_DOCKER_SOCKET_PATH]: DEFAULT_UNIX_SOCKET_PATH,
      // add others as needed
    };
    getConfigurationStub.returns({
      get: sandbox.stub().callsFake((arg) => configMap[arg]),
    });

    // assume no running containers matching this workflow image for most tests
    getContainersForImageStub = sandbox
      .stub(dockerContainers, "getContainersForImage")
      .resolves([]);
    getContainerStub = sandbox.stub(dockerContainers, "getContainer");

    workflow = ConfluentPlatformSchemaRegistryWorkflow.getInstance();

    checkForImageStub = sandbox.stub(workflow, "checkForImage").resolves();
    handleExistingContainersStub = sandbox.stub(workflow, "handleExistingContainers").resolves();
    workflowShowErrorNotificationStub = sandbox.stub(workflow, "showErrorNotification").resolves();
    // assume we have Kafka containers to work off of for most tests
    fetchAndFilterKafkaContainersStub = sandbox
      .stub(workflow, "fetchAndFilterKafkaContainers")
      .resolves(TEST_KAFKA_CONTAINERS);
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

    updateLocalConnectionStub = sandbox.stub(connections, "updateLocalConnection");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it(".imageRepo should return the correct image repository for this workflow", () => {
    // making sure the getter method is working as expected against the static property
    assert.equal(workflow.imageRepo, ConfluentPlatformSchemaRegistryWorkflow.imageRepo);
  });

  it("start() should create and start Schema Registry container", async () => {
    getContainersForImageStub.resolves([]);
    createContainerStub.resolves({ Id: "1" });

    await workflow.start(TEST_CANCELLATION_TOKEN);

    // happy path: no existing containers, Kafka container(s) exist to work off of
    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce); // twice if fetchAndFilterKafkaContainersStub is not stubbed
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(fetchAndFilterKafkaContainersStub.calledOnce);

    assert.ok(createContainerStub.calledOnce);
    assert.ok(startContainerStub.calledOnce);
    assert.ok(workflowShowErrorNotificationStub.notCalled);

    assert.ok(updateLocalConnectionStub.calledOnce);

    assert.ok(waitForLocalResourceEventChangeStub.calledOnce);
  });

  it("start() should handle existing containers and not create new ones", async () => {
    const fakeContainers = [{ Id: "1", Names: ["container1"] }];
    getContainersForImageStub.resolves(fakeContainers);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.calledOnceWith(fakeContainers));
    // bailing here

    assert.ok(fetchAndFilterKafkaContainersStub.notCalled);

    assert.ok(createContainerStub.notCalled);
    assert.ok(startContainerStub.notCalled);

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("start() should exit early when no Kafka containers are found", async () => {
    fetchAndFilterKafkaContainersStub.resolves([]);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(fetchAndFilterKafkaContainersStub.calledOnce);
    assert.ok(showErrorMessageStub.calledOnce);
    // bailing here

    assert.ok(createContainerStub.notCalled);
    assert.ok(startContainerStub.notCalled);

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("start() should allow users to start Kafka resources via the notification buttons if no Kafka containers are available", async () => {
    fetchAndFilterKafkaContainersStub.resolves([]);
    // stub the user clicking the 'Start Kafka' button
    showErrorMessageStub.resolves(START_KAFKA_BUTTON);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(fetchAndFilterKafkaContainersStub.calledOnce);
    assert.ok(
      showErrorMessageStub.calledOnceWith(
        `No running Kafka containers found for image "${DEFAULT_KAFKA_IMAGE_REPO}:${DEFAULT_KAFKA_IMAGE_TAG}". Please start Kafka and try again.`,
        START_KAFKA_BUTTON,
        IMAGE_SETTINGS_BUTTON,
      ),
    );
    assert.ok(
      executeCommandStub.calledOnceWith("confluent.docker.startLocalResources", [
        LocalResourceKind.Kafka,
      ]),
    );
    // bailing here

    assert.ok(createContainerStub.notCalled);
    assert.ok(startContainerStub.notCalled);

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("start() should allow users to access Docker image settings via the notification buttons if no Kafka containers are available", async () => {
    fetchAndFilterKafkaContainersStub.resolves([]);
    // stub the user clicking the 'Configure Image Settings' button
    showErrorMessageStub.resolves(IMAGE_SETTINGS_BUTTON);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(fetchAndFilterKafkaContainersStub.calledOnce);
    assert.ok(
      showErrorMessageStub.calledOnceWith(
        `No running Kafka containers found for image "${DEFAULT_KAFKA_IMAGE_REPO}:${DEFAULT_KAFKA_IMAGE_TAG}". Please start Kafka and try again.`,
        START_KAFKA_BUTTON,
        IMAGE_SETTINGS_BUTTON,
      ),
    );
    assert.ok(
      executeCommandStub.calledOnceWith(
        "workbench.action.openSettings",
        `@id:${LOCAL_KAFKA_IMAGE} @id:${LOCAL_KAFKA_IMAGE_TAG}`,
      ),
    );
    // bailing here

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

    assert.ok(fetchAndFilterKafkaContainersStub.calledOnce);
    assert.ok(showErrorMessageStub.notCalled);

    assert.ok(createContainerStub.calledOnce);
    assert.ok(workflowShowErrorNotificationStub.calledOnce);
    // bailing here
    assert.ok(startContainerStub.notCalled);

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("start() should exit early and if a container fails to start", async () => {
    startContainerStub.resolves(undefined);

    await workflow.start(TEST_CANCELLATION_TOKEN);

    assert.ok(checkForImageStub.calledOnce);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(handleExistingContainersStub.notCalled);

    assert.ok(fetchAndFilterKafkaContainersStub.calledOnce);

    assert.ok(createContainerStub.calledOnce);
    assert.ok(startContainerStub.calledOnce);
    // notification tested in base.test.ts as part of .startContainer() tests

    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("stop() should stop Schema Registry container", async () => {
    const fakeContainers = [{ Id: "1", Names: ["container1"] }];
    getContainersForImageStub.resolves(fakeContainers);

    await workflow.stop(TEST_CANCELLATION_TOKEN);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(stopContainerStub.calledOnce);
    assert.ok(waitForLocalResourceEventChangeStub.calledOnce);
  });

  it("stop() should exit early if there are no running Schema Registry containers", async () => {
    getContainersForImageStub.resolves([]);

    await workflow.stop(TEST_CANCELLATION_TOKEN);

    assert.ok(getContainersForImageStub.calledOnce);
    assert.ok(stopContainerStub.notCalled);
    assert.ok(waitForLocalResourceEventChangeStub.notCalled);
  });

  it("fetchAndFilterKafkaContainers() should return Kafka containers", async () => {
    // restore normal functionality so we can actually test this method
    fetchAndFilterKafkaContainersStub.restore();
    getContainersForImageStub.resolves(TEST_KAFKA_CONTAINERS);
    // each time `getContainer()` is called, we should expect to get back our test container
    TEST_KAFKA_CONTAINERS.forEach((container, index) => {
      getContainerStub.onCall(index).resolves(container);
    });

    const kafkaContainers = await workflow.fetchAndFilterKafkaContainers();

    assert.deepEqual(kafkaContainers, TEST_KAFKA_CONTAINERS);
  });

  it("fetchAndFilterKafkaContainers() should return an empty array if no Kafka containers are found", async () => {
    // restore normal functionality so we can actually test this method
    fetchAndFilterKafkaContainersStub.restore();
    getContainersForImageStub.resolves([]);

    const kafkaContainers = await workflow.fetchAndFilterKafkaContainers();

    assert.deepEqual(kafkaContainers, []);
  });

  it("createSchemaRegistryContainer() should create the correct container body", async () => {
    const kafkaBootstrapServers = ["localhost:9092"];
    const kafkaNetworks = [DEFAULT_DOCKER_NETWORK];

    const restProxyPort = 8081;
    sandbox.stub(ports, "findFreePort").resolves(restProxyPort);

    const container = await workflow.createSchemaRegistryContainer(
      kafkaBootstrapServers,
      kafkaNetworks,
    );

    assert.ok(createContainerStub.calledOnce);
    assert.ok(container);

    const createBody: ContainerCreateOperationRequest = {
      body: {
        Image: workflow.imageRepoTag,
        Hostname: CONTAINER_NAME,
        ExposedPorts: { [`${restProxyPort}/tcp`]: {} },
        HostConfig: {
          NetworkMode: workflow.networkName,
          PortBindings: {
            [`${restProxyPort}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: restProxyPort.toString() }],
          },
        },
        Env: [
          `SCHEMA_REGISTRY_KAFKASTORE_BOOTSTRAP_SERVERS=PLAINTEXT://${kafkaBootstrapServers.join(",")}`,
          `SCHEMA_REGISTRY_HOST_NAME=${CONTAINER_NAME}`,
          `SCHEMA_REGISTRY_LISTENERS=http://0.0.0.0:${restProxyPort}`,
          "SCHEMA_REGISTRY_DEBUG=true",
        ],
        Tty: false,
      },
      name: CONTAINER_NAME,
    };
    assert.ok(
      createContainerStub.calledWith(workflow.imageRepo, workflow.imageTag, createBody),
      `createContainerStub called with: ${JSON.stringify(createContainerStub.args, null, 2)}\n\nand not ${JSON.stringify([workflow.imageRepo, workflow.imageTag, createBody], null, 2)}`,
    );
  });
});

describe("docker/workflows/cp-schema-registry.ts helper functions", () => {
  it("determineKafkaDockerNetworks() should return the expected Docker network from extension-managed Kafka containers", () => {
    // should already have the DEFAULT_DOCKER_NETWORK set
    const networks = determineKafkaDockerNetworks(TEST_KAFKA_CONTAINERS);

    assert.deepEqual(networks, [DEFAULT_DOCKER_NETWORK]);
  });

  it("determineKafkaDockerNetworks() should return the array of unique Docker networks if available in ContainerInspectResponses", () => {
    const kafkaContainers: ContainerInspectResponse[] = [
      {
        NetworkSettings: {
          Networks: {
            bridge: {},
            host: {},
          },
        },
      },
      {
        NetworkSettings: {
          Networks: {
            bridge: {},
          },
        },
      },
    ];

    const networks = determineKafkaDockerNetworks(kafkaContainers);

    assert.deepEqual(networks, ["bridge", "host"]);
  });

  it("determineKafkaDockerNetworks() should return an empty array if no networks are found in the ContainerInspectResponses", () => {
    const kafkaContainers: ContainerInspectResponse[] = [
      {
        NetworkSettings: {
          Networks: {},
        },
      },
    ];

    const networks = determineKafkaDockerNetworks(kafkaContainers);

    assert.deepEqual(networks, []);
  });

  it("determineKafkaBootstrapServers() should return the correct bootstrap servers", () => {
    const bootstrapServers = determineKafkaBootstrapServers(TEST_KAFKA_CONTAINERS);

    // use the same function the Kafka workflow uses to determine bootstrap servers
    assert.deepEqual(bootstrapServers, brokerConfigsToRestBootstrapServers(TEST_BROKER_CONFIGS));
  });

  it("determineKafkaBootstrapServers() should return an empty array if no bootstrap servers are found", () => {
    const kafkaContainers: ContainerInspectResponse[] = [
      {
        Config: {
          Env: [],
        },
      },
    ];

    const bootstrapServers = determineKafkaBootstrapServers(kafkaContainers);

    assert.deepEqual(bootstrapServers, []);
  });
});
