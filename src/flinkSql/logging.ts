import { LogOutputChannel, window } from "vscode";

let languageServerOutputChannel: LogOutputChannel | undefined;

/** Get the {@link LogOutputChannel} for the Flink SQL language server, creating it if it doesn't already exist. */
export function getFlinkSQLLanguageServerOutputChannel(): LogOutputChannel {
  if (!languageServerOutputChannel) {
    languageServerOutputChannel = window.createOutputChannel(
      "Confluent Flink SQL Language Server",
      {
        log: true,
      },
    );
  }
  return languageServerOutputChannel;
}

/**
 * Reset the Flink SQL language server output channel.
 * This is done whenever `FlinkLanguageClientManager` is disposed to ensure a new output channel is
 * created when the language client is restarted.
 */
export function clearFlinkSQLLanguageServerOutputChannel(): void {
  languageServerOutputChannel = undefined;
}
