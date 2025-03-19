/** Represents a version of the extension that is disabled. */
export interface DisabledVersion {
  /** The product associated with the disabled extension version (`vscode`, `vscode-insiders`, etc).*/
  product: string;
  /** The ID of the extension to be disabled. Should always be `confluentinc.vscode-confluent` here. */
  extensionId: string;
  /** The version of the extension that is disabled. */
  version: string;
  /** The reason for the version being disabled, to be displayed to the user on activation failure. */
  reason: string;
}
