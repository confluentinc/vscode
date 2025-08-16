import * as assert from "assert";
import * as sinon from "sinon";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../../tests/unit/testResources/flinkComputePool";
import { FlinkUdf } from "../../models/flinkUDF";
import { FlinkArtifactsUDFsViewProvider } from "../flinkArtifacts";
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
    let provider: FlinkArtifactsUDFsViewProvider;
    let udfsDelegate: FlinkUDFsDelegate;

    beforeEach(() => {
      provider = FlinkArtifactsUDFsViewProvider.getInstance();
      udfsDelegate = new FlinkUDFsDelegate(provider);
    });

    afterEach(() => {
      provider.dispose();
      FlinkArtifactsUDFsViewProvider["instanceMap"].clear();
    });

    it("should return an empty array when no compute pool is selected", async () => {
      provider["resource"] = null;

      const items = await udfsDelegate.fetchChildren();

      assert.deepStrictEqual(items, []);
    });

    it("should return a UDF array when a compute pool is selected", async () => {
      // TODO: stub the actual loading here when https://github.com/confluentinc/vscode/issues/2310 is done
      provider["resource"] = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      const items = await udfsDelegate.fetchChildren();

      assert.ok(items.length > 0);
      assert.ok(items[0] instanceof FlinkUdf);
    });
  });
});
