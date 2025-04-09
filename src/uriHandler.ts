import * as vscode from "vscode";
import { Logger } from "./logging";
import { projectScaffoldUri } from "./emitters";

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
    const { path } = uri;
    switch (path) {
      case "/authCallback":
        logger.debug("Got authCallback URI, firing as Event", uri);
        this.fire(uri);
        break;
      case "/consume":
        vscode.commands.executeCommand("confluent.topic.consume.fromUri", uri);
        break;
      case "/projectScaffold":
        projectScaffoldUri.fire(uri);
        vscode.window.showErrorMessage("Unsupported URI path.");
        break;
    }
  }
}

export function getUriHandler(): UriEventHandler {
  return UriEventHandler.getInstance();
}
