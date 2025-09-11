import * as assert from "assert";
import * as sinon from "sinon";
import { getStubbedCCloudResourceLoader } from "../../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../../tests/unit/testResources";
import { CCloudResourceLoader } from "../../loaders";
import { FlinkUdf } from "../../models/flinkUDF";
import { FlinkDatabaseViewProvider } from "../flinkDatabase";
import { FlinkUDFsDelegate } from "./flinkUDFsDelegate";

describe("viewProviders/multiViewDelegates/flinkUDFsDelegate.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("FlinkUDFsDelegate", () => {
    let provider: FlinkDatabaseViewProvider;
    let udfsDelegate: FlinkUDFsDelegate;
    let stubbedCCloudResourceLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

    const TEST_UDF: FlinkUdf = new FlinkUdf({
      connectionId: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.connectionId,
      connectionType: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.connectionType,
      environmentId: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.environmentId,
      id: "TestUDF", // No unique ID available, so use name as ID.
      name: "TestUDF",
      description: "",
      provider: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.provider,
      region: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.region,
    });

    beforeEach(() => {
      provider = FlinkDatabaseViewProvider.getInstance();
      udfsDelegate = new FlinkUDFsDelegate();
      stubbedCCloudResourceLoader = getStubbedCCloudResourceLoader(sandbox);
    });

    afterEach(() => {
      provider.dispose();
      FlinkDatabaseViewProvider["instanceMap"].clear();
    });

    it(".fetchChildren() should return a FlinkUdf array when a flinkable Kafka cluster is provided", async () => {
      stubbedCCloudResourceLoader.getFlinkUDFs.resolves([TEST_UDF]);

      const udfs = await udfsDelegate.fetchChildren(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);

      sinon.assert.calledOnce(stubbedCCloudResourceLoader.getFlinkUDFs);
      assert.deepStrictEqual(udfs, [TEST_UDF]);
    });
  });
});
