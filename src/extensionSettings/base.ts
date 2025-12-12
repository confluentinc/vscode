import { extensions, workspace } from "vscode";
import { EXTENSION_ID } from "../constants";

export interface ExtensionConfiguration {
  title: string;
  properties: { [key: string]: any };
}

/** @see https://code.visualstudio.com/api/references/contribution-points#contributes.configuration */
const CONFIGURATION: ExtensionConfiguration[] =
  extensions.getExtension(EXTENSION_ID)!.packageJSON.contributes.configuration;

/** Each "title" section under `contributes.configuration` in package.json */
export enum SettingsSection {
  GENERAL = "General",
  CCLOUD = "Confluent Cloud",
  LOCAL = "Local",
  DIRECT_CONNECTIONS = "Connections",
  FLINK = "Flink",
  COPILOT = "Copilot Chat Participant",
}

/**
 * Base class representing a VS Code {@link https://code.visualstudio.com/docs/configure/settings setting}
 * that may or may not be defined in this extension's `package.json`.
 *
 * If `sectionTitle` is not provided, the setting is assumed to not be defined in `package.json` and
 * therefore we cannot determine its {@link defaultValue}.
 */
export class Setting<T> {
  constructor(
    /**
     * The full setting ID, found in the extension's package.json under
     * `contributes.configuration.properties` for a given section.
     * @example "confluent.debugging.showSidecarExceptions"
     */
    public readonly id: string,
    /**
     * Optional title of the section this setting belongs to, if contributed in this extension's
     * `package.json`.
     */
    public readonly sectionTitle?: SettingsSection,
  ) {}

  /** Get the configuration section, if {@link sectionTitle} is set. */
  get configSection(): ExtensionConfiguration | undefined {
    if (!this.sectionTitle) {
      return undefined;
    }

    const section = CONFIGURATION.find((config) => config.title === this.sectionTitle);
    if (!section) {
      throw new Error(`Configuration section "${this.sectionTitle}" not found.`);
    }
    return section;
  }

  /**
   * Get the default value for this setting, if contributed in this extension's
   * `package.json`.
   */
  get defaultValue(): T | undefined {
    const section: ExtensionConfiguration | undefined = this.configSection;
    if (!section) {
      return undefined;
    }

    const result = section.properties[this.id]?.default;
    if (result === undefined) {
      throw new Error(
        `Default value must be set for setting "${this.id}" in section "${this.sectionTitle}".`,
      );
    }
    return result;
  }

  /** Get the **current** default/user/workspace value of this setting, if available. */
  get value(): T | undefined {
    const result = workspace.getConfiguration().get<T>(this.id);
    return result ?? this.defaultValue;
  }

  async update(value: T, global?: boolean): Promise<void> {
    return await workspace.getConfiguration().update(this.id, value, global);
  }
}

/**
 * A {@link Setting} that is contributed by this extension and defined in `package.json` under
 * `contributes.configuration`. Guarantees non-undefined {@link defaultValue} and {@link value}.
 */
export class ExtensionSetting<T> extends Setting<T> {
  /**
   * @param id - The full setting ID from package.json under `contributes.configuration.properties`
   * @param sectionTitle - The title of the section this setting belongs to
   */
  constructor(id: string, sectionTitle: SettingsSection) {
    super(id, sectionTitle);
  }

  /** Get the configuration section for this setting based on its title. */
  override get configSection(): ExtensionConfiguration {
    return super.configSection!;
  }

  /** Get the default value for this setting from the extension's configuration. */
  override get defaultValue(): T {
    return super.defaultValue!;
  }

  /** Get the **current** default/user/workspace value of this setting. */
  override get value(): T {
    return super.value!;
  }
}
