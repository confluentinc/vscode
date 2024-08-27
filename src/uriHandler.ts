import * as vscode from "vscode";
import { Logger } from "./logging";

const logger = new Logger("uriHandler");

/**
 * Minimal handler for `vscode://confluentinc.vscode-confluent/*` URIs, which will then fire the
 * URI as an event.
 * @remarks As of August 2024, this is only used by the Confluent Cloud authentication provider to
 * capture auth completion events from the sidecar.
 */
export class UriEventHandler extends vscode.EventEmitter<vscode.Uri> implements vscode.UriHandler {
  public handleUri(uri: vscode.Uri) {
    switch (uri.path) {
      case "/authCallback":
        logger.debug("Got authCallback URI, firing as Event", uri);
        this.fire(uri);
        break;
      default:
        logger.warn("Got unexpected URI, ignoring", uri);
    }
  }
}
