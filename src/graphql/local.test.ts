import * as assert from "assert";
import * as sinon from "sinon";

import { getShowErrorNotificationWithButtonsStub } from "../../tests/stubs/notifications";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import {
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_MEDUSA,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { LOCAL_CONNECTION_ID } from "../constants";
import { ENABLE_MEDUSA_CONTAINER } from "../extensionSettings/constants";
import { SidecarHandle } from "../sidecar";
import * as sidecarLocalConnections from "../sidecar/connections/local";
import { getLocalResources } from "./local";

describe("local.ts getLocalResources()", () => {
  let sandbox: sinon.SinonSandbox;
  let sidecarStub: sinon.SinonStubbedInstance<SidecarHandle>;

  let showErrorNotificationStub: sinon.SinonStub;
  let discoverMedusaStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sidecarStub = getSidecarStub(sandbox);
    showErrorNotificationStub = getShowErrorNotificationWithButtonsStub(sandbox);

    discoverMedusaStub = sandbox
      .stub(sidecarLocalConnections, "discoverMedusa")
      .resolves(undefined);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("returns empty array and shows notification if error making graphql call", async () => {
    sidecarStub.query.rejects(new Error("Query failed"));

    const result = await getLocalResources();

    assert.deepStrictEqual(result, []);
    sinon.assert.calledOnce(showErrorNotificationStub);
  });

  it("calls query with showPartialErrors=false so that if we have kafka, but not schema reg, we won't show popup about it", async () => {
    sidecarStub.query.resolves({ localConnections: [] });

    await getLocalResources();

    sinon.assert.calledOnce(sidecarStub.query);
    assert.strictEqual(sidecarStub.query.firstCall.args[1], LOCAL_CONNECTION_ID);
    assert.strictEqual(sidecarStub.query.firstCall.args[2], false); // suppress partial error notifications
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

  describe("Medusa integration", () => {
    let stubbedConfigs: StubbedWorkspaceConfiguration;
    beforeEach(() => {
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
      // default to Medusa integration being enabled
      stubbedConfigs.stubGet(ENABLE_MEDUSA_CONTAINER, true);
    });

    it("calls discoverMedusa to check for Medusa containers", async () => {
      sidecarStub.query.resolves({ localConnections: [] });

      await getLocalResources();

      sinon.assert.calledOnce(discoverMedusaStub);
    });

    it("adds Medusa to existing environment when both sidecar resources and Medusa are available", async () => {
      sidecarStub.query.resolves({
        localConnections: [
          {
            id: "local-connection-id",
            kafkaCluster: TEST_LOCAL_KAFKA_CLUSTER,
            schemaRegistry: TEST_LOCAL_SCHEMA_REGISTRY,
          },
        ],
      });
      discoverMedusaStub.resolves(TEST_LOCAL_MEDUSA.uri);

      const result = await getLocalResources();

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].kafkaClusters.length, 1);
      assert.ok(result[0].schemaRegistry);
      assert.ok(result[0].medusa, "Medusa should be added to environment with existing resources");
      assert.strictEqual(result[0].medusa!.uri, TEST_LOCAL_MEDUSA.uri);
    });

    it("creates Medusa-only environment when no sidecar resources but Medusa is running", async () => {
      sidecarStub.query.resolves({ localConnections: [] });
      discoverMedusaStub.resolves(TEST_LOCAL_MEDUSA.uri);

      const result = await getLocalResources();

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].kafkaClusters.length, 0, "Should have no Kafka clusters");
      assert.strictEqual(result[0].schemaRegistry, undefined, "Should have no Schema Registry");
      assert.ok(result[0].medusa, "Should have Medusa");
      assert.strictEqual(result[0].medusa!.uri, TEST_LOCAL_MEDUSA.uri);
      assert.strictEqual(
        result[0].id,
        LOCAL_CONNECTION_ID as any,
        "Should use LOCAL_CONNECTION_ID as environment ID",
      );
    });

    it("does not create Medusa when discoverMedusa returns undefined", async () => {
      sidecarStub.query.resolves({
        localConnections: [
          {
            id: "local-connection-id",
            kafkaCluster: TEST_LOCAL_KAFKA_CLUSTER,
          },
        ],
      });
      discoverMedusaStub.resolves(undefined); // No Medusa running

      const result = await getLocalResources();

      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].medusa, undefined, "Should not have Medusa when not running");
    });

    it("returns empty array when no sidecar resources and no Medusa", async () => {
      sidecarStub.query.resolves({ localConnections: [] });
      discoverMedusaStub.resolves(undefined);

      const result = await getLocalResources();

      assert.deepStrictEqual(result, [], "Should return empty array when nothing is running");
    });

    it("does not call discoverMedusa() when Medusa integration is disabled", async () => {
      stubbedConfigs.stubGet(ENABLE_MEDUSA_CONTAINER, false);

      sidecarStub.query.resolves({
        localConnections: [
          {
            id: "local-connection-id",
            kafkaCluster: TEST_LOCAL_KAFKA_CLUSTER,
          },
        ],
      });

      const result = await getLocalResources();

      // Should not have even tried to discover Medusa since integration is disabled.
      sinon.assert.notCalled(discoverMedusaStub);

      assert.strictEqual(result.length, 1);
      assert.strictEqual(
        result[0].medusa,
        undefined,
        "Should not have Medusa when integration disabled",
      );
    });
  });
});
