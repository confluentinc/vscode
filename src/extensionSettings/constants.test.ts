import * as assert from "assert";
import { extensions } from "vscode";
import { EXTENSION_ID } from "../constants";
import { ExtensionConfigurations } from "./base";
import {
  ALLOW_OLDER_SCHEMA_VERSIONS,
  CHAT_SEND_ERROR_DATA,
  CHAT_SEND_TOOL_CALL_DATA,
  ENABLE_CHAT_PARTICIPANT,
  ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER,
  FLINK_CONFIG_COMPUTE_POOL,
  FLINK_CONFIG_DATABASE,
  KRB5_CONFIG_PATH,
  LOCAL_DOCKER_SOCKET_PATH,
  LOCAL_KAFKA_IMAGE,
  LOCAL_KAFKA_IMAGE_TAG,
  LOCAL_SCHEMA_REGISTRY_IMAGE_TAG,
  SCHEMA_RBAC_WARNINGS_ENABLED,
  SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS,
  SHOW_SIDECAR_EXCEPTIONS,
  SSL_PEM_PATHS,
  SSL_VERIFY_SERVER_CERT_DISABLED,
  STATEMENT_POLLING_CONCURRENCY,
  STATEMENT_POLLING_FREQUENCY_SECONDS,
  STATEMENT_POLLING_LIMIT,
  UPDATE_DEFAULT_DATABASE_FROM_LENS,
  UPDATE_DEFAULT_POOL_ID_FROM_LENS,
  USE_TOPIC_NAME_STRATEGY,
} from "./constants";

describe("extensionSettings/constants.ts", function () {
  let configurationSections: ExtensionConfigurations[];

  before(() => {
    const extension = extensions.getExtension(EXTENSION_ID);
    if (!extension) {
      throw new Error(`Extension with ID "${EXTENSION_ID}" not found`);
    }
    configurationSections = extension.packageJSON.contributes.configuration;
  });

  /** Helper function to find the `contributes.configuration` section for a given setting */
  function getSectionForSetting(settingId: string): ExtensionConfigurations | undefined {
    return configurationSections.find(
      (section) => section.properties && Object.keys(section.properties).includes(settingId),
    );
  }

  describe("individual ExtensionSetting instances", () => {
    it("should set the correct section and default value for USE_TOPIC_NAME_STRATEGY", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        USE_TOPIC_NAME_STRATEGY.id,
      );
      assert.ok(section);
      assert.strictEqual(USE_TOPIC_NAME_STRATEGY.sectionTitle, section.title);

      const expectedDefault = section.properties[USE_TOPIC_NAME_STRATEGY.id].default;
      assert.ok(USE_TOPIC_NAME_STRATEGY.defaultValue !== undefined);
      assert.strictEqual(USE_TOPIC_NAME_STRATEGY.defaultValue, expectedDefault);
      assert.ok(USE_TOPIC_NAME_STRATEGY.value !== undefined);
    });

    it("should set the correct section and default value for ALLOW_OLDER_SCHEMA_VERSIONS", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        ALLOW_OLDER_SCHEMA_VERSIONS.id,
      );
      assert.ok(section);
      assert.strictEqual(ALLOW_OLDER_SCHEMA_VERSIONS.sectionTitle, section.title);

      const expectedDefault = section.properties[ALLOW_OLDER_SCHEMA_VERSIONS.id].default;
      assert.ok(ALLOW_OLDER_SCHEMA_VERSIONS.defaultValue !== undefined);
      assert.strictEqual(ALLOW_OLDER_SCHEMA_VERSIONS.defaultValue, expectedDefault);
      assert.ok(ALLOW_OLDER_SCHEMA_VERSIONS.value !== undefined);
    });

    it("should set the correct section and default value for SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.id,
      );
      assert.ok(section);
      assert.strictEqual(SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.sectionTitle, section.title);

      const expectedDefault =
        section.properties[SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.id].default;
      assert.ok(SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.defaultValue !== undefined);
      assert.strictEqual(SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.defaultValue, expectedDefault);
      assert.ok(SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.value !== undefined);
    });

    it("should set the correct section and default value for SHOW_SIDECAR_EXCEPTIONS", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        SHOW_SIDECAR_EXCEPTIONS.id,
      );
      assert.ok(section);
      assert.strictEqual(SHOW_SIDECAR_EXCEPTIONS.sectionTitle, section.title);

      const expectedDefault = section.properties[SHOW_SIDECAR_EXCEPTIONS.id].default;
      assert.ok(SHOW_SIDECAR_EXCEPTIONS.defaultValue !== undefined);
      assert.strictEqual(SHOW_SIDECAR_EXCEPTIONS.defaultValue, expectedDefault);
      assert.ok(SHOW_SIDECAR_EXCEPTIONS.value !== undefined);
    });

    it("should set the correct section and default value for KRB5_CONFIG_PATH", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        KRB5_CONFIG_PATH.id,
      );
      assert.ok(section);
      assert.strictEqual(KRB5_CONFIG_PATH.sectionTitle, section.title);

      const expectedDefault = section.properties[KRB5_CONFIG_PATH.id].default;
      assert.ok(KRB5_CONFIG_PATH.defaultValue !== undefined);
      assert.strictEqual(KRB5_CONFIG_PATH.defaultValue, expectedDefault);
      assert.ok(KRB5_CONFIG_PATH.value !== undefined);
    });

    it("should set the correct section and default value for LOCAL_DOCKER_SOCKET_PATH", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        LOCAL_DOCKER_SOCKET_PATH.id,
      );
      assert.ok(section);
      assert.strictEqual(LOCAL_DOCKER_SOCKET_PATH.sectionTitle, section.title);

      const expectedDefault = section.properties[LOCAL_DOCKER_SOCKET_PATH.id].default;
      assert.ok(LOCAL_DOCKER_SOCKET_PATH.defaultValue !== undefined);
      assert.strictEqual(LOCAL_DOCKER_SOCKET_PATH.defaultValue, expectedDefault);
      assert.ok(LOCAL_DOCKER_SOCKET_PATH.value !== undefined);
    });

    it("should set the correct section and default value for LOCAL_KAFKA_IMAGE", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        LOCAL_KAFKA_IMAGE.id,
      );
      assert.ok(section);
      assert.strictEqual(LOCAL_KAFKA_IMAGE.sectionTitle, section.title);

      const expectedDefault = section.properties[LOCAL_KAFKA_IMAGE.id].default;
      assert.ok(LOCAL_KAFKA_IMAGE.defaultValue !== undefined);
      assert.strictEqual(LOCAL_KAFKA_IMAGE.defaultValue, expectedDefault);
      assert.ok(LOCAL_KAFKA_IMAGE.value !== undefined);
    });

    it("should set the correct section and default value for LOCAL_KAFKA_IMAGE_TAG", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        LOCAL_KAFKA_IMAGE_TAG.id,
      );
      assert.ok(section);
      assert.strictEqual(LOCAL_KAFKA_IMAGE_TAG.sectionTitle, section.title);

      const expectedDefault = section.properties[LOCAL_KAFKA_IMAGE_TAG.id].default;
      assert.ok(LOCAL_KAFKA_IMAGE_TAG.defaultValue !== undefined);
      assert.strictEqual(LOCAL_KAFKA_IMAGE_TAG.defaultValue, expectedDefault);
      assert.ok(LOCAL_KAFKA_IMAGE_TAG.value !== undefined);
    });

    it("should set the correct section and default value for LOCAL_SCHEMA_REGISTRY_IMAGE_TAG", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        LOCAL_SCHEMA_REGISTRY_IMAGE_TAG.id,
      );
      assert.ok(section);
      assert.strictEqual(LOCAL_SCHEMA_REGISTRY_IMAGE_TAG.sectionTitle, section.title);

      const expectedDefault = section.properties[LOCAL_SCHEMA_REGISTRY_IMAGE_TAG.id].default;
      assert.ok(LOCAL_SCHEMA_REGISTRY_IMAGE_TAG.defaultValue !== undefined);
      assert.strictEqual(LOCAL_SCHEMA_REGISTRY_IMAGE_TAG.defaultValue, expectedDefault);
      assert.ok(LOCAL_SCHEMA_REGISTRY_IMAGE_TAG.value !== undefined);
    });

    it("should set the correct section and default value for SCHEMA_RBAC_WARNINGS_ENABLED", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        SCHEMA_RBAC_WARNINGS_ENABLED.id,
      );
      assert.ok(section);
      assert.strictEqual(SCHEMA_RBAC_WARNINGS_ENABLED.sectionTitle, section.title);

      const expectedDefault = section.properties[SCHEMA_RBAC_WARNINGS_ENABLED.id].default;
      assert.ok(SCHEMA_RBAC_WARNINGS_ENABLED.defaultValue !== undefined);
      assert.strictEqual(SCHEMA_RBAC_WARNINGS_ENABLED.defaultValue, expectedDefault);
      assert.ok(SCHEMA_RBAC_WARNINGS_ENABLED.value !== undefined);
    });

    it("should set the correct section and default value for SSL_PEM_PATHS", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(SSL_PEM_PATHS.id);
      assert.ok(section);
      assert.strictEqual(SSL_PEM_PATHS.sectionTitle, section.title);

      const expectedDefault = section.properties[SSL_PEM_PATHS.id].default;
      assert.ok(SSL_PEM_PATHS.defaultValue !== undefined);
      assert.deepStrictEqual(SSL_PEM_PATHS.defaultValue, expectedDefault);
      assert.ok(SSL_PEM_PATHS.value !== undefined);
    });

    it("should set the correct section and default value for SSL_VERIFY_SERVER_CERT_DISABLED", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        SSL_VERIFY_SERVER_CERT_DISABLED.id,
      );
      assert.ok(section);
      assert.strictEqual(SSL_VERIFY_SERVER_CERT_DISABLED.sectionTitle, section.title);

      const expectedDefault = section.properties[SSL_VERIFY_SERVER_CERT_DISABLED.id].default;
      assert.ok(SSL_VERIFY_SERVER_CERT_DISABLED.defaultValue !== undefined);
      assert.strictEqual(SSL_VERIFY_SERVER_CERT_DISABLED.defaultValue, expectedDefault);
      assert.ok(SSL_VERIFY_SERVER_CERT_DISABLED.value !== undefined);
    });

    it("should set the correct section and default value for FLINK_CONFIG_COMPUTE_POOL", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        FLINK_CONFIG_COMPUTE_POOL.id,
      );
      assert.ok(section);
      assert.strictEqual(FLINK_CONFIG_COMPUTE_POOL.sectionTitle, section.title);

      const expectedDefault = section.properties[FLINK_CONFIG_COMPUTE_POOL.id].default;
      assert.ok(FLINK_CONFIG_COMPUTE_POOL.defaultValue !== undefined);
      assert.strictEqual(FLINK_CONFIG_COMPUTE_POOL.defaultValue, expectedDefault);
      assert.ok(FLINK_CONFIG_COMPUTE_POOL.value !== undefined);
    });

    it("should set the correct section and default value for FLINK_CONFIG_DATABASE", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        FLINK_CONFIG_DATABASE.id,
      );
      assert.ok(section);
      assert.strictEqual(FLINK_CONFIG_DATABASE.sectionTitle, section.title);

      const expectedDefault = section.properties[FLINK_CONFIG_DATABASE.id].default;
      assert.ok(FLINK_CONFIG_DATABASE.defaultValue !== undefined);
      assert.strictEqual(FLINK_CONFIG_DATABASE.defaultValue, expectedDefault);
      assert.ok(FLINK_CONFIG_DATABASE.value !== undefined);
    });

    it("should set the correct section and default value for UPDATE_DEFAULT_POOL_ID_FROM_LENS", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        UPDATE_DEFAULT_POOL_ID_FROM_LENS.id,
      );
      assert.ok(section);
      assert.strictEqual(UPDATE_DEFAULT_POOL_ID_FROM_LENS.sectionTitle, section.title);

      const expectedDefault = section.properties[UPDATE_DEFAULT_POOL_ID_FROM_LENS.id].default;
      assert.ok(UPDATE_DEFAULT_POOL_ID_FROM_LENS.defaultValue !== undefined);
      assert.strictEqual(UPDATE_DEFAULT_POOL_ID_FROM_LENS.defaultValue, expectedDefault);
      assert.ok(UPDATE_DEFAULT_POOL_ID_FROM_LENS.value !== undefined);
    });

    it("should set the correct section and default value for UPDATE_DEFAULT_DATABASE_FROM_LENS", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        UPDATE_DEFAULT_DATABASE_FROM_LENS.id,
      );
      assert.ok(section);
      assert.strictEqual(UPDATE_DEFAULT_DATABASE_FROM_LENS.sectionTitle, section.title);

      const expectedDefault = section.properties[UPDATE_DEFAULT_DATABASE_FROM_LENS.id].default;
      assert.ok(UPDATE_DEFAULT_DATABASE_FROM_LENS.defaultValue !== undefined);
      assert.strictEqual(UPDATE_DEFAULT_DATABASE_FROM_LENS.defaultValue, expectedDefault);
      assert.ok(UPDATE_DEFAULT_DATABASE_FROM_LENS.value !== undefined);
    });

    it("should set the correct section and default value for STATEMENT_POLLING_FREQUENCY_SECONDS", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        STATEMENT_POLLING_FREQUENCY_SECONDS.id,
      );
      assert.ok(section);
      assert.strictEqual(STATEMENT_POLLING_FREQUENCY_SECONDS.sectionTitle, section.title);

      const expectedDefault = section.properties[STATEMENT_POLLING_FREQUENCY_SECONDS.id].default;
      assert.ok(STATEMENT_POLLING_FREQUENCY_SECONDS.defaultValue !== undefined);
      assert.strictEqual(STATEMENT_POLLING_FREQUENCY_SECONDS.defaultValue, expectedDefault);
      assert.ok(STATEMENT_POLLING_FREQUENCY_SECONDS.value !== undefined);
    });

    it("should set the correct section and default value for STATEMENT_POLLING_LIMIT", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        STATEMENT_POLLING_LIMIT.id,
      );
      assert.ok(section);
      assert.strictEqual(STATEMENT_POLLING_LIMIT.sectionTitle, section.title);

      const expectedDefault = section.properties[STATEMENT_POLLING_LIMIT.id].default;
      assert.ok(STATEMENT_POLLING_LIMIT.defaultValue !== undefined);
      assert.strictEqual(STATEMENT_POLLING_LIMIT.defaultValue, expectedDefault);
      assert.ok(STATEMENT_POLLING_LIMIT.value !== undefined);
    });

    it("should set the correct section and default value for STATEMENT_POLLING_CONCURRENCY", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        STATEMENT_POLLING_CONCURRENCY.id,
      );
      assert.ok(section);
      assert.strictEqual(STATEMENT_POLLING_CONCURRENCY.sectionTitle, section.title);

      const expectedDefault = section.properties[STATEMENT_POLLING_CONCURRENCY.id].default;
      assert.ok(STATEMENT_POLLING_CONCURRENCY.defaultValue !== undefined);
      assert.strictEqual(STATEMENT_POLLING_CONCURRENCY.defaultValue, expectedDefault);
      assert.ok(STATEMENT_POLLING_CONCURRENCY.value !== undefined);
    });

    it("should set the correct section and default value for ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id,
      );
      assert.ok(section);
      assert.strictEqual(ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.sectionTitle, section.title);

      const expectedDefault = section.properties[ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id].default;
      assert.ok(ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.defaultValue !== undefined);
      assert.strictEqual(ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.defaultValue, expectedDefault);
      assert.ok(ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.value !== undefined);
    });

    it("should set the correct section and default value for CHAT_SEND_ERROR_DATA", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        CHAT_SEND_ERROR_DATA.id,
      );
      assert.ok(section);
      assert.strictEqual(CHAT_SEND_ERROR_DATA.sectionTitle, section.title);

      const expectedDefault = section.properties[CHAT_SEND_ERROR_DATA.id].default;
      assert.ok(CHAT_SEND_ERROR_DATA.defaultValue !== undefined);
      assert.strictEqual(CHAT_SEND_ERROR_DATA.defaultValue, expectedDefault);
      assert.ok(CHAT_SEND_ERROR_DATA.value !== undefined);
    });

    it("should set the correct section and default value for CHAT_SEND_TOOL_CALL_DATA", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        CHAT_SEND_TOOL_CALL_DATA.id,
      );
      assert.ok(section);
      assert.strictEqual(CHAT_SEND_TOOL_CALL_DATA.sectionTitle, section.title);

      const expectedDefault = section.properties[CHAT_SEND_TOOL_CALL_DATA.id].default;
      assert.ok(CHAT_SEND_TOOL_CALL_DATA.defaultValue !== undefined);
      assert.strictEqual(CHAT_SEND_TOOL_CALL_DATA.defaultValue, expectedDefault);
      assert.ok(CHAT_SEND_TOOL_CALL_DATA.value !== undefined);
    });

    it("should set the correct section and default value for ENABLE_CHAT_PARTICIPANT", () => {
      const section: ExtensionConfigurations | undefined = getSectionForSetting(
        ENABLE_CHAT_PARTICIPANT.id,
      );
      assert.ok(section);
      assert.strictEqual(ENABLE_CHAT_PARTICIPANT.sectionTitle, section.title);

      const expectedDefault = section.properties[ENABLE_CHAT_PARTICIPANT.id].default;
      assert.ok(ENABLE_CHAT_PARTICIPANT.defaultValue !== undefined);
      assert.strictEqual(ENABLE_CHAT_PARTICIPANT.defaultValue, expectedDefault);
      assert.ok(ENABLE_CHAT_PARTICIPANT.value !== undefined);
    });
  });
});
