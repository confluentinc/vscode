import { extensions, workspace } from "vscode";
import { EXTENSION_ID } from "../constants";
import { Logger } from "../logging";

const logger = new Logger("extensionSettings.base");

export interface ExtensionConfigurations {
  title: string;
  properties: { [key: string]: any };
}

/** @see https://code.visualstudio.com/api/references/contribution-points#contributes.configuration */
const CONFIGURATION: ExtensionConfigurations[] =
  extensions.getExtension(EXTENSION_ID)!.packageJSON.contributes.configuration;

/** Each "title" section under `contributes.configuration` in package.json */
export enum SettingsSection {
  GENERAL = "General",
  CCLOUD = "Confluent Cloud",
  LOCAL = "Local",
  DIRECT_CONNECTIONS = "Connections",
  FLINK = "Flink SQL Defaults",
  COPILOT = "Copilot Chat Participant",
}

/** Object representing an extension {@link https://code.visualstudio.com/api/references/contribution-points#contributes.configuration configuration}. */
export class ExtensionSetting<T> {
  constructor(
    /**
     * The full setting ID, found in the extension's package.json under
     * `contributes.configuration.properties` for a given section.
     * @example "confluent.debugging.showSidecarExceptions"
     */
    public readonly id: string,
    /** The title of the section this setting belongs to. */
    public readonly sectionTitle: SettingsSection = SettingsSection.GENERAL,
  ) {}

  /** Get the configuration section for this setting based on its title. */
  get configSection(): ExtensionConfigurations {
    const section = CONFIGURATION.find((config) => config.title === this.sectionTitle);
    if (!section) {
      throw new Error(`Configuration section "${this.sectionTitle}" not found.`);
    }
    return section;
  }

  /** Get the default value for this setting from the extension's configuration. */
  get defaultValue(): T {
    const result = this.configSection.properties[this.id].default;
    if (result === undefined) {
      throw new Error(
        `Default value must be set for setting "${this.id}" in section "${this.sectionTitle}".`,
      );
    }
    return result;
  }

  /** Get the **current** default/user/workspace value of this setting. */
  get value(): T {
    const result = workspace.getConfiguration().get<T>(this.id, this.defaultValue);
    logger.info(this.id, { value: result });
    return result;
  }

  async update(value: T, global?: boolean): Promise<void> {
    return await workspace.getConfiguration().update(this.id, value, global);
  }
}
