import { Data, type Require as Enforced } from "dataclass";
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";

export class Project extends Data {
  name!: Enforced<string>;
  templateId!: Enforced<string>;
  createdAt!: Enforced<string>;
  fsPath!: Enforced<string>;
}

export class ProjectTreeItem extends TreeItem {
  resource: Project;

  constructor(resource: Project) {
    super(resource.name, TreeItemCollapsibleState.None);
    this.resource = resource;
    this.description = resource.createdAt;
    this.iconPath = new ThemeIcon("project");
    this.tooltip = JSON.stringify(resource, null, 2);
    this.command = {
      command: "confluent.projects.open",
      title: "Open Project",
      arguments: [resource],
    };
  }
}
