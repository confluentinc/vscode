import { LogOutputChannel, window } from "vscode";

let languageServerOutputChannel: LogOutputChannel | undefined;

/** Get the {@link LogOutputChannel} for the Flink SQL language server, creating it if it doesn't already exist. */
export function getFlinkSQLLanguageServerOutputChannel(): LogOutputChannel {
  if (!languageServerOutputChannel) {
    languageServerOutputChannel = window.createOutputChannel("Confluent Flink SQL", {
      log: true,
    });
  }
  return languageServerOutputChannel;
}
