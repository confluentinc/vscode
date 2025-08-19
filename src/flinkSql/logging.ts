import { LogOutputChannel, Uri } from "vscode";
import { RotatingLogOutputChannel } from "../logging";

let languageServerOutputChannel: RotatingLogOutputChannel | undefined;

/** Get the {@link LogOutputChannel} for the Flink SQL language server, creating it if it doesn't already exist. */
export function getFlinkSQLLanguageServerOutputChannel(): LogOutputChannel {
  if (!languageServerOutputChannel) {
    languageServerOutputChannel = new RotatingLogOutputChannel(
      "Confluent Flink SQL Language Server",
      `flink-language-server-${process.pid}`,
    );
  }
  return languageServerOutputChannel;
}

/** Gets the file URIs for the Flink SQL language server log file. */
export function getFlinkLSLogFileUris(): Uri[] {
  return languageServerOutputChannel?.getFileUris() ?? [];
}

/**
 * Reset the Flink SQL language server output channel.
 * This is done whenever `FlinkLanguageClientManager` is disposed to ensure a new output channel is
 * created when the language client is restarted.
 */
export function clearFlinkSQLLanguageServerOutputChannel(): void {
  languageServerOutputChannel?.dispose();
  languageServerOutputChannel = undefined;
}
