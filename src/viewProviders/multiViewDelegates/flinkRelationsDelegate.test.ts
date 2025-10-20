import * as sinon from "sinon";
import { getStubbedCCloudResourceLoader } from "../../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../../tests/unit/testResources";
import {
  TEST_FLINK_RELATION,
  TEST_VARCHAR_COLUMN,
} from "../../../tests/unit/testResources/flinkRelations";
import type { CCloudResourceLoader } from "../../loaders";
import { FlinkRelationsDelegate } from "./flinkRelationsDelegate";

describe("flinkRelationsDelegate.ts", () => {
  let sandbox: sinon.SinonSandbox;
  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });
  describe("FlinkRelationsDelegate", () => {
    let delegate: FlinkRelationsDelegate;

    beforeEach(() => {
      delegate = new FlinkRelationsDelegate();
    });

    describe("getChildren()", () => {
      it("returns columns when a relation is provided", () => {
        const children = delegate.getChildren(TEST_FLINK_RELATION);
        sinon.assert.match(children, TEST_FLINK_RELATION.columns);
      });

      it("returns relations when no parent is provided", () => {
        delegate["children"] = [TEST_FLINK_RELATION];
        const children = delegate.getChildren();
        sinon.assert.match(children, [TEST_FLINK_RELATION]);
      });
    });

    describe("fetchChildren()", () => {
      let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

      beforeEach(() => {
        stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
      });

      it("fetches relations from the loader and returns them", async () => {
        const expectedRelations = [TEST_FLINK_RELATION];
        stubbedLoader.getFlinkRelations.resolves(expectedRelations);

        const children = await delegate.fetchChildren(TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);

        sinon.assert.match(children, expectedRelations);
        sinon.assert.match(delegate["children"], expectedRelations);
        sinon.assert.calledOnce(stubbedLoader.getFlinkRelations);
      });
    });

    describe("getTreeItem()", () => {
      it("returns the TreeItem from the element", () => {
        const treeItem = delegate.getTreeItem(TEST_VARCHAR_COLUMN);
        sinon.assert.match(treeItem, TEST_VARCHAR_COLUMN.getTreeItem());
      });
    });
  });
});
