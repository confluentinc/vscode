import * as assert from "assert";
import * as sinon from "sinon";

import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { getSidecarStub } from "../../tests/stubs/sidecar";

import * as localConnections from "../sidecar/connections/local";

import { TEST_LOCAL_CONNECTION } from "../../tests/unit/testResources/connection";
import { SidecarHandle } from "../sidecar";
import { getLocalResources } from "./local";

describe("local.ts getLocalResources()", () => {
  let sandbox: sinon.SinonSandbox;
  let sidecarStub: sinon.SinonStubbedInstance<SidecarHandle>;

  let getLocalConnectionStub: sinon.SinonStub;
  let showErrorNotificationStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sidecarStub = getSidecarStub(sandbox);
    showErrorNotificationStub = getShowErrorNotificationWithButtonsStub(sandbox);

    getLocalConnectionStub = sandbox
      .stub(localConnections, "getLocalConnection")
      .resolves(TEST_LOCAL_CONNECTION);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("creates a local connection if none exists", async () => {
    // rerrange to smell like a local connection doesn't yet exist
    getLocalConnectionStub.resolves(undefined);

    const createLocalConnectionStub = sandbox
      .stub(localConnections, "createLocalConnection")
      .resolves(TEST_LOCAL_CONNECTION);

    sidecarStub.query.resolves({ resources: [] });

    await getLocalResources();

    sinon.assert.calledOnce(createLocalConnectionStub);
    sinon.assert.calledOnce(getLocalConnectionStub);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("handles error creating local connection", async () => {
    // rerrange to smell like a local connection doesn't yet exist
    getLocalConnectionStub.resolves(undefined);
    // and then stub the createLocalConnection to throw an error
    const createLocalConnectionStub = sandbox
      .stub(localConnections, "createLocalConnection")
      .rejects(new Error("Failed to create local connection"));

    const result = await getLocalResources();
    assert.deepStrictEqual(result, []);

    sinon.assert.calledOnce(createLocalConnectionStub);
    sinon.assert.calledOnce(getLocalConnectionStub);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("returns empty array ans shows notification if error making graphql call", async () => {
    sidecarStub.query.rejects(new Error("Query failed"));

    const result = await getLocalResources();

    assert.deepStrictEqual(result, []);
    sinon.assert.calledOnce(showErrorNotificationStub);
  });

  it("returns empty array if no local connections are returned", async () => {
    sidecarStub.query.resolves({ localConnections: null });

    const result = await getLocalResources();

    assert.deepStrictEqual(result, []);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Returns empty array if no local connections are found (null within array)", async () => {
    sidecarStub.query.resolves({ localConnections: [null] });

    const result = await getLocalResources();

    assert.deepStrictEqual(result, []);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("Returns empty array if local connection described w/o a kafka cluster", async () => {
    sidecarStub.query.resolves({ localConnections: [{ somethingUnexpected: true }] });

    const result = await getLocalResources();

    assert.deepStrictEqual(result, []);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("returns local resources with a kafka cluster", async () => {
    sidecarStub.query.resolves({
      localConnections: [
        {
          id: "local-connection-id",
          kafkaCluster: {
            id: "kafka-cluster-id",
            name: "Local Kafka Cluster",
            bootstrapServers: "localhost:9092",
            uri: "kafka://localhost:9092",
          },
        },
      ],
    });

    const result = await getLocalResources();

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, "local-connection-id");
    assert.strictEqual(result[0].kafkaClusters[0].id, "kafka-cluster-id");
    assert.strictEqual(result[0].schemaRegistry, undefined);

    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("returns local resources with both a kafka cluster and a schema registry", async () => {
    sidecarStub.query.resolves({
      localConnections: [
        {
          id: "local-connection-id",
          kafkaCluster: {
            id: "kafka-cluster-id",
            name: "Local Kafka Cluster",
            bootstrapServers: "localhost:9092",
            uri: "kafka://localhost:9092",
          },
          schemaRegistry: {
            id: "schema-registry-id",
            uri: "http://localhost:8081",
          },
        },
      ],
    });

    const result = await getLocalResources();

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, "local-connection-id");
    assert.strictEqual(result[0].kafkaClusters[0].id, "kafka-cluster-id");
    assert.strictEqual(result[0].schemaRegistry!.id, "schema-registry-id");

    sinon.assert.notCalled(showErrorNotificationStub);
  });
});
