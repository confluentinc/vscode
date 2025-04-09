import * as vscode from "vscode";
import { Logger } from "./logging";
import { applyTemplate } from "./scaffold";
import { ScaffoldV1Template } from "./clients/scaffoldingService";

const logger = new Logger("uriHandler");

/**
 * Minimal handler for `vscode://confluentinc.vscode-confluent/*` URIs, which will then fire the
 * URI as an event.
 * @remarks As of August 2024, this is only used by the Confluent Cloud authentication provider to
 * capture auth completion events from the sidecar.
 */
export class UriEventHandler extends vscode.EventEmitter<vscode.Uri> implements vscode.UriHandler {
  private static instance: UriEventHandler | null = null;

  // enforce singleton pattern since extension UriHandlers can only be registered once anyways, so
  // there's no point in having multiple instances of this class
  private constructor() {
    super();
  }

  static getInstance(): UriEventHandler {
    if (!UriEventHandler.instance) {
      UriEventHandler.instance = new UriEventHandler();
    }
    return UriEventHandler.instance;
  }

  public async handleUri(uri: vscode.Uri) {
    const { authority, path, query } = uri;
    switch (path) {
      case "/authCallback":
        logger.debug("Got authCallback URI, firing as Event", uri);
        this.fire(uri);
        break;
      case "/consume":
        vscode.commands.executeCommand("confluent.topic.consume.fromUri", uri);
        break;
      case "/projectScaffold":
        // Ensure the authority and path match the expected URI
        if (authority === "confluentinc.vscode-confluent" && path === "/projectScaffold") {
          const params = new URLSearchParams(query);

          const collection = params.get("collection");
          const template = params.get("template");
          const bootstrapServer = params.get("cc_bootstrap_server");
          const apiKey = params.get("cc_api_key");
          const apiSecret = params.get("cc_api_secret");
          const topic = params.get("cc_topic");

          // Prepare the options for the template
          const options: { [key: string]: string } = {};
          if (bootstrapServer) options["cc_bootstrap_server"] = bootstrapServer;
          if (apiKey) options["cc_api_key"] = apiKey;
          if (apiSecret) options["cc_api_secret"] = apiSecret;
          if (topic) options["cc_topic"] = topic;

          if (!collection || !template) {
            vscode.window.showErrorMessage(
              "Missing required parameters for project generation. Please check the URI.",
            );
            break;
          }

          console.log("Project Scaffold Parameters:", {
            collection,
            template,
            bootstrapServer,
            apiKey,
            apiSecret,
            topic,
          });
          try {
            const result = await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: "Generating Project...",
                cancellable: true,
              },
              async (progress) => {
                progress.report({ message: "Applying template..." });
                return await applyTemplate(
                  {
                    spec: {
                      name: template,
                      template_collection: { id: collection },
                      display_name: template,
                    },
                  } as ScaffoldV1Template,
                  options,
                );
              },
            );
            if (result.success) {
              vscode.window.showInformationMessage("Project generated successfully!");
            } else {
              vscode.window.showErrorMessage(`Failed to generate project: ${result.message}`);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Error generating project: ${errorMessage}`);
          }
        } else {
          vscode.window.showErrorMessage("Unsupported URI path.");
        }
    }
  }
}

export function getUriHandler(): UriEventHandler {
  return UriEventHandler.getInstance();
}
