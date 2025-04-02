import { Disposable, TreeDataProvider, TreeItem } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { FlinkArtifact, FlinkArtifactTreeItem } from "../models/flinkArtifact";
import { EnvironmentId } from "../models/resource";
import { BaseViewProvider } from "./base";

export class FlinkArtifactsViewProvider
  extends BaseViewProvider<FlinkArtifact>
  implements TreeDataProvider<FlinkArtifact>
{
  viewId = "confluent-flink-artifacts";

  async getChildren(): Promise<FlinkArtifact[]> {
    const children: FlinkArtifact[] = [];

    // TODO: replace this with real data
    const fakeArtifact = new FlinkArtifact({
      connectionId: CCLOUD_CONNECTION_ID,
      connectionType: ConnectionType.Ccloud,
      environmentId: "env1" as EnvironmentId,
      computePoolId: "pool1",
      name: "artifact1",
      description: "This is a test artifact",
      provider: "aws",
      region: "us-west-2",
    });
    children.push(
      fakeArtifact,
      new FlinkArtifact({
        ...fakeArtifact,
        name: "artifact2",
        description: "Best test UDF ever",
      }),
    );

    return this.filterChildren(undefined, children);
  }

  getTreeItem(element: FlinkArtifact): TreeItem {
    return new FlinkArtifactTreeItem(element);
  }

  setEventListeners(): Disposable[] {
    return [];
  }
}
