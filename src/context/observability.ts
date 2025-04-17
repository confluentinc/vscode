import { version } from "ide-sidecar";
import { env, version as ideVersion } from "vscode";
import { Status } from "../clients/sidecar";
/**
 * Per-extension-instance singleton object for storing basic data to help debug issues, errors, etc.
 * This is created fresh each time the extension is activated, and will grow throughout the course
 * of the extension's lifecycle as actions are taken by the user.
 *
 * This class is intended to be used as a singleton, and should be created once and then updated
 * as needed throughout the extension's lifecycle. Treat all properties as scoped to the lifetime of
 * this extension instance.
 *
 * When dealing with "internal" properties, it is recommended to prefix them with an underscore to
 * indicate that they are not intended to be exported to other formats (e.g. markdown table) but can
 * still be accessed within the codebase as a `public` property. (Example: `_uniqueTopicNames` as an
 * array of unique topic names that we _do not_ want to display in a markdown table, but may use
 * to calculate a `topicCount` property based on `_uniqueTopicNames` that _is_ displayed in a table.)
 */
class ObservabilityContext {
  constructor(
    /** The OS platform */
    public platform: string = process.platform,
    /** The OS CPU architecture */
    public arch: string = process.arch,
    /** Indicator that the extension is running in WSL or another remote host. */
    public remoteName: string | undefined = env.remoteName,

    /** The version of VS Code (or variant) in use. */
    public productVersion: string = ideVersion,
    /** The name of the VS Code (or variant) in use. */
    public productName: string = env.appName,
    /** The URI scheme of the VS Code (or variant) in use. */
    public productUriScheme: string = env.uriScheme,

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
    /** The expiration date of the Confluent Cloud auth session. */
    public ccloudAuthExpiration: Date | undefined = undefined,
    /** The last auth status seen for the Confluent Cloud auth session. */
    public ccloudAuthLastSeenStatus: Status | undefined = undefined,
    /** How many times the user signed in to Confluent Cloud. */
    public ccloudSignInCount: number = 0,
    /** How many times the user signed out of Confluent Cloud. */
    public ccloudSignOutCount: number = 0,
  ) {}

  /** Filter out any "internal" keys/properties. */
  get publicKeys(): string[] {
    return Object.keys(this).filter((key) => !key.startsWith("_"));
  }

  /** Converts the current state of the {@link ObservabilityContext} to a markdown table string. */
  toMarkdownTable(): string {
    const keys: string[] = this.publicKeys;
    // stringify all values so they can be displayed in the table
    const values: string[] = keys.map((key) => {
      return JSON.stringify((this as any)[key]);
    });

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

  /** Converts the current state of the {@link ObservabilityContext} to a `Record<string, any>`. */
  toRecord(): Record<string, any> {
    const record: Record<string, any> = {};

    const keys: string[] = this.publicKeys;
    keys.forEach((key) => {
      // also include any getter properties
      const descriptor = Object.getOwnPropertyDescriptor(this, key);
      if (descriptor && typeof descriptor.get === "function") {
        record[key] = this[key as keyof this];
      } else {
        record[key] = (this as any)[key];
      }
    });

    return record;
  }
}

/** Singleton instance of the {@link ObservabilityContext} class. */
export const observabilityContext: ObservabilityContext = new ObservabilityContext();
