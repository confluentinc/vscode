import * as assert from "assert";
import * as sinon from "sinon";
import { Uri } from "vscode";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { TEST_CCLOUD_FLINK_STATEMENT } from "../../tests/unit/testResources/flinkStatement";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { uriMetadataSet } from "../emitters";
import { FLINK_CONFIG_STATEMENT_PREFIX } from "../extensionSettings/constants";
import { FlinkSpecProperties } from "../models/flinkStatement";
import { UriMetadataKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import {
  determineFlinkStatementName,
  FlinkStatementWebviewPanelCache,
  setFlinkDocumentMetadata,
} from "./statementUtils";

describe("flinkSql/statementUtils.ts", function () {
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("FlinkSpecProperties", function () {
    it("toProperties() returns empty object if FlinkSpecProperties is constructed with empty object.", function () {
      const properties = new FlinkSpecProperties({});
      assert.deepStrictEqual(properties.toProperties(), {});
    });

    it("toProperties returns properties with currentCatalog and currentDatabase", function () {
      const properties = new FlinkSpecProperties({
        currentCatalog: "my_catalog",
        currentDatabase: "my_database",
      });
      assert.deepStrictEqual(properties.toProperties(), {
        "sql.current-catalog": "my_catalog",
        "sql.current-database": "my_database",
      });
    });

    it("union() merges properties preferring from other first", function () {
      // only with timezone
      const properties1 = new FlinkSpecProperties({
        currentCatalog: "my_catalog", // will be exposed.
        localTimezone: "GMT-0700", // will be occluded
      });
      const properties2 = new FlinkSpecProperties({
        currentDatabase: "my_database", // will be preferred.
        localTimezone: "GMT-0900", // will be preferred.
      });

      const merged = properties1.union(properties2);
      assert.deepStrictEqual(
        merged,
        new FlinkSpecProperties({
          localTimezone: "GMT-0900",
          currentCatalog: "my_catalog",
          currentDatabase: "my_database",
        }),
      );
    });
  });

  describe("determineFlinkStatementName()", function () {
    const now = new Date("2024-10-21 12:00:00.0000Z");
    const expectedDatePart = "2024-10-21t12-00-00";
    const defaultPrefix = FLINK_CONFIG_STATEMENT_PREFIX.value || "flink";

    beforeEach(() => {
      sandbox.useFakeTimers(now);
    });

    it("Should include the spice parameter in the statement name", async function () {
      const statementName = await determineFlinkStatementName("test-spice");

      assert.strictEqual(statementName, `${defaultPrefix}-vscode-test-spice-${expectedDatePart}`);
    });

    it("Should return a name without spice if spice is not provided", async function () {
      const statementName = await determineFlinkStatementName();

      assert.strictEqual(statementName, `${defaultPrefix}-vscode-${expectedDatePart}`);
    });

    it("Should prepend the user-configured prefix to the statement name if set", async function () {
      const statementName = await determineFlinkStatementName();
      assert.strictEqual(
        statementName,
        `${FLINK_CONFIG_STATEMENT_PREFIX.value}-vscode-${expectedDatePart}`,
      );
    });
  });

  // TODO(sidecar-removal): Re-enable these tests after implementing direct Flink API client.
  // These tests depend on getSidecarHandle() which has been removed during sidecar migration.
  describe.skip("utils.refreshFlinkStatement", function () {
    it("should return the statement if it exists", async function () {});
    it("should return null if the statement is not found", async function () {});
    it("should throw an error if statement is not completed after timeout", async function () {});
  });

  // TODO(sidecar-removal): Re-enable these tests after implementing direct Flink API client.
  // These tests depend on getSidecarHandle() which has been removed during sidecar migration.
  describe.skip("submitFlinkStatement()", function () {
    it("submits a Flink statement with the correct parameters", async function () {});
  });

  // TODO(sidecar-removal): Re-enable these tests after implementing direct Flink API client.
  // These tests depend on getSidecarHandle() which has been removed during sidecar migration.
  describe.skip("waitForStatement* tests", () => {
    describe("waitForResultsFetchable()", function () {
      it("returns when statement is running", async function () {});
      it("throws an error if statement is not found", async function () {});
      it("throws an error if statement is not running after timeout", async function () {});
    });

    describe("waitForStatementCompletion()", () => {
      it("returns when statement is completed", async function () {});
      it("throws an error if statement is not found", async function () {});
      it("throws an error if statement is not completed after timeout", async function () {});
    });
  });

  describe("FlinkStatementWebviewPanelCache", function () {
    it("getPanelForStatement() should downcall into findOrCreate()", async function () {
      const instance = new FlinkStatementWebviewPanelCache();
      const findOrCreateStub = sandbox.stub(instance, "findOrCreate");

      await instance.getPanelForStatement(TEST_CCLOUD_FLINK_STATEMENT);

      assert.strictEqual(findOrCreateStub.calledOnce, true, "findOrCreate should be called once");
    });
  });

  // TODO(sidecar-removal): Re-enable these tests after implementing direct Flink API client.
  // These tests depend on getSidecarHandle() which has been removed during sidecar migration.
  describe.skip("parseAllFlinkStatementResults()", () => {
    it("should parse results with no following page token", async () => {});
    it("should parse results with multiple pages", async () => {});
  });

  describe("setFlinkDocumentMetadata()", function () {
    let rmSetUriMetadataStub: sinon.SinonStub;
    let uriMetadataSetFireStub: sinon.SinonStub;

    const uri = Uri.parse("file:///test/flink_statement.flink.sql");

    beforeEach(() => {
      rmSetUriMetadataStub = sandbox.stub(getResourceManager(), "setUriMetadata");
      uriMetadataSetFireStub = sandbox.stub(uriMetadataSet, "fire");
    });

    it("should set the catalog metadata from environment when provided", async () => {
      await setFlinkDocumentMetadata(uri, {
        catalog: TEST_CCLOUD_ENVIRONMENT,
      });

      sinon.assert.calledWith(rmSetUriMetadataStub, uri, {
        [UriMetadataKeys.FLINK_CATALOG_ID]: TEST_CCLOUD_ENVIRONMENT.id,
        [UriMetadataKeys.FLINK_CATALOG_NAME]: TEST_CCLOUD_ENVIRONMENT.name,
      });

      sinon.assert.calledWith(uriMetadataSetFireStub, uri);
    });

    it("should set the database metadata from kafka cluster when provided", async () => {
      await setFlinkDocumentMetadata(uri, {
        database: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
      });

      sinon.assert.calledWith(rmSetUriMetadataStub, uri, {
        [UriMetadataKeys.FLINK_DATABASE_ID]: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.name,
      });

      sinon.assert.calledWith(uriMetadataSetFireStub, uri);
    });

    it("should set the compute pool id when compute pool provided", async () => {
      await setFlinkDocumentMetadata(uri, {
        computePool: TEST_CCLOUD_FLINK_COMPUTE_POOL,
      });

      sinon.assert.calledWith(rmSetUriMetadataStub, uri, {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
      });

      sinon.assert.calledWith(uriMetadataSetFireStub, uri);
    });
  });
});
