import { version } from "ide-sidecar";
/**
 * Per-extension-instance singleton object for storing basic data to help debug issues, errors, etc.
 * This is created fresh each time the extension is activated, and will grow throughout the course
 * of the extension's lifecycle as actions are taken by the user.
 */
class ObservabilityContext {
  constructor(
    /** The version of the activated extension instance, from `package.json`. */
    public extensionVersion: string = "",
    /** Whether or not the extension activated successfully. */
    public extensionActivated: boolean = false,
    /** The version of the sidecar process associated with this extension instance. */
    public sidecarVersion: string = version,
    /** How many times the extension started the sidecar. Anything over one will indicate restarts were required. */
    public sidecarStartCount: number = 0,
    /** Did the user successfully sign in to Confluent Cloud? */
    public ccloudAuthCompleted: boolean = false,
  ) {}

  /** Converts the current state of the {@link ObservabilityContext} to a markdown table string. */
  toMarkdownTable(): string {
    const keys = Object.keys(this);
    // stringify all values so they can be displayed in the table
    const values = Object.values(this).map((value) => JSON.stringify(value));
    if (keys.length === 0) {
      return "";
    }
    const table = [
      "| Key | Value |",
      "| --- | --- |",
      ...keys.map((key, index) => `| ${key} | ${values[index]} |`),
    ];
    return table.join("\n");
  }
}

/** Singleton instance of the {@link ObservabilityContext} class. */
export const observabilityContext: ObservabilityContext = new ObservabilityContext();
