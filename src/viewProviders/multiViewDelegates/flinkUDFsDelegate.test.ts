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
      udfsDelegate = new FlinkUDFsDelegate();
    });

    afterEach(() => {
      provider.dispose();
      FlinkArtifactsUDFsViewProvider["instanceMap"].clear();
    });

    it(".fetchChildren() should return a FlinkUdf array when a compute pool is provided", async () => {
      // TODO: stub the actual loading here when https://github.com/confluentinc/vscode/issues/2310 is done
      const items = await udfsDelegate.fetchChildren(TEST_CCLOUD_FLINK_COMPUTE_POOL);

      assert.ok(items.length > 0);
      assert.ok(items[0] instanceof FlinkUdf);
    });
  });
});
