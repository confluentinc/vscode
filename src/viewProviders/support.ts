import * as vscode from "vscode";

export class SupportViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  constructor() {
    // register to the Support view
    vscode.window.registerTreeDataProvider("confluent-support", this);
  }

  getTreeItem(element: vscode.TreeItem) {
    return element;
  }

  getChildren(element?: vscode.TreeItem | undefined) {
    let children: vscode.TreeItem[] = [];

    if (!element) {
      // root-level items; no expanding supported here, just quick actions to open walkthrough(s),
      // feedback, and scaffold a project
      const walkthroughItem: vscode.TreeItem = new vscode.TreeItem(
        "Confluent Extension Walkthrough",
      );
      walkthroughItem.iconPath = new vscode.ThemeIcon("server");
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

      children.push(walkthroughItem, feedbackItem, issueItem, scaffoldItem);
    }

    return children;
  }
}
