import * as vscode from "vscode";

export class SupportViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  /** Disposables belonging to this provider to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: vscode.Disposable[] = [];

  constructor() {
    // register to the Support view
    const provider: vscode.Disposable = vscode.window.registerTreeDataProvider(
      "confluent-support",
      this,
    );

    this.disposables.push(provider);
  }

  getTreeItem(element: vscode.TreeItem) {
    return element;
  }

  // no expansions allowed here, just a flat list of static items
  getChildren(): vscode.TreeItem[] {
    return [walkthroughItem, feedbackItem, issueItem, scaffoldItem, settingsItem];
  }
}

const walkthroughItem: vscode.TreeItem = new vscode.TreeItem("Confluent Extension Walkthrough");
walkthroughItem.iconPath = new vscode.ThemeIcon("book");
walkthroughItem.command = {
  command: "confluent.support.confluent-walkthrough.launch",
  title: "Launch Kafka Cluster Walkthrough",
  tooltip: "Click to Launch Kafka Cluster Walkthrough",
};

const feedbackItem: vscode.TreeItem = new vscode.TreeItem("Give Feedback");
feedbackItem.iconPath = new vscode.ThemeIcon("comment-discussion");
feedbackItem.command = {
  command: "confluent.support.feedback",
  title: "Give Feedback",
  tooltip: "Click to Give Feedback",
};

const issueItem: vscode.TreeItem = new vscode.TreeItem("Report an Issue");
issueItem.iconPath = new vscode.ThemeIcon("bug");
issueItem.command = {
  command: "confluent.support.issue",
  title: "Report an Issue",
  tooltip: "Click to Report an Issue",
};

const scaffoldItem: vscode.TreeItem = new vscode.TreeItem("Generate Project from Template");
scaffoldItem.iconPath = new vscode.ThemeIcon("rocket");
scaffoldItem.command = {
  command: "confluent.scaffold",
  title: "Generate Project from Template",
  tooltip: "Click to generate a project from a pre-defined template",
};

const settingsItem: vscode.TreeItem = new vscode.TreeItem("Open Settings");
settingsItem.iconPath = new vscode.ThemeIcon("gear");
settingsItem.command = {
  command: "confluent.support.openSettings",
  title: "Open Settings",
  tooltip: "Click to open the Confluent Extension settings",
};
