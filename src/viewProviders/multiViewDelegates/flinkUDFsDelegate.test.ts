import * as assert from "assert";
import * as sinon from "sinon";
import { getStubbedCCloudResourceLoader } from "../../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../../tests/unit/testResources";
import { createFlinkUDF } from "../../../tests/unit/testResources/flinkUDF";
import { CCloudResourceLoader } from "../../loaders";
import { FlinkUdf } from "../../models/flinkSystemCatalog";
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

    const TEST_UDF: FlinkUdf = createFlinkUDF("TestUDF");

    beforeEach(() => {
      provider = FlinkDatabaseViewProvider.getInstance();
      udfsDelegate = new FlinkUDFsDelegate();
      stubbedCCloudResourceLoader = getStubbedCCloudResourceLoader(sandbox);
    });

    afterEach(() => {
      provider.dispose();
      FlinkDatabaseViewProvider["instanceMap"].clear();
    });

    for (const deepRefresh of [true, false]) {
      it(`.fetchChildren() should return a FlinkUdf array when a flinkable Kafka cluster is provided: deepRefresh ${deepRefresh}`, async () => {
        stubbedCCloudResourceLoader.getFlinkUDFs.resolves([TEST_UDF]);

        const udfs = await udfsDelegate.fetchChildren(
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          deepRefresh,
        );

        sinon.assert.calledOnce(stubbedCCloudResourceLoader.getFlinkUDFs);
        sinon.assert.calledWithExactly(
          stubbedCCloudResourceLoader.getFlinkUDFs,
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          deepRefresh,
        );
        assert.deepStrictEqual(udfs, [TEST_UDF]);
      });
    }
  });
});
