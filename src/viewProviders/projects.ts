import * as vscode from "vscode";
import { getExtensionContext } from "../context";
import { ExtensionContextNotSetError } from "../errors";
import { Logger } from "../logging";
import { Project, ProjectTreeItem } from "../models/project";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("viewProviders.projects");

/**
 * The types managed by the {@link ProjectsViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type ProjectsViewProviderData = Project;

export class ProjectsViewProvider implements vscode.TreeDataProvider<ProjectsViewProviderData> {
  private _onDidChangeTreeData: vscode.EventEmitter<ProjectsViewProviderData | undefined | void> =
    new vscode.EventEmitter<ProjectsViewProviderData | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<ProjectsViewProviderData | undefined | void> =
    this._onDidChangeTreeData.event;
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  private treeView: vscode.TreeView<ProjectsViewProviderData>;

  private static instance: ProjectsViewProvider | null = null;
  private constructor() {
    if (!getExtensionContext()) {
      // getChildren() will fail without the extension context
      throw new ExtensionContextNotSetError("ProjectsViewProvider");
    }

    this.treeView = vscode.window.createTreeView("confluent-projects", { treeDataProvider: this });
  }

  static getInstance(): ProjectsViewProvider {
    if (!ProjectsViewProvider.instance) {
      ProjectsViewProvider.instance = new ProjectsViewProvider();
    }
    return ProjectsViewProvider.instance;
  }

  getTreeItem(element: ProjectsViewProviderData): vscode.TreeItem | ProjectTreeItem {
    if (element instanceof Project) {
      return new ProjectTreeItem(element);
    }
    return element;
  }

  async getChildren(element?: ProjectsViewProviderData): Promise<ProjectsViewProviderData[]> {
    if (!element) {
      const projects: Project[] = await getResourceManager().getProjects();
      logger.debug("loaded projects from global state:", projects);
      return projects.map((project) => {
        return Project.create(project);
      });
    }

    return [];
  }
}
