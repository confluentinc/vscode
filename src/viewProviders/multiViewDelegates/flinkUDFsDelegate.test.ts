import * as assert from "assert";
import * as sinon from "sinon";
import { TEST_CCLOUD_KAFKA_CLUSTER_WITH_POOL } from "../../../tests/unit/testResources";
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

    beforeEach(() => {
      provider = FlinkDatabaseViewProvider.getInstance();
      udfsDelegate = new FlinkUDFsDelegate();
    });

    afterEach(() => {
      provider.dispose();
      FlinkDatabaseViewProvider["instanceMap"].clear();
    });

    it(".fetchChildren() should return a FlinkUdf array when a flinkable Kafka cluster is provided", async () => {
      // TODO: stub the actual loading here when https://github.com/confluentinc/vscode/issues/2310 is done
      const items = await udfsDelegate.fetchChildren(TEST_CCLOUD_KAFKA_CLUSTER_WITH_POOL);

      assert.ok(items.length > 0);
      assert.ok(items[0] instanceof FlinkUdf);
    });
  });
});
