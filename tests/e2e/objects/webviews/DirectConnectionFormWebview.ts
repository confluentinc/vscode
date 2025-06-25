import { Locator, Page } from "@playwright/test";
import { Webview } from "./Webview";

// same as src/directConnections/types.ts
type FormConnectionType =
  | "Apache Kafka"
  | "Confluent Cloud"
  | "Confluent Platform"
  | "WarpStream"
  | "Other";
type SupportedAuthTypes = "None" | "Basic" | "API" | "SCRAM" | "OAuth" | "Kerberos";

/**
 * Object representing the Direct Connection form {@link https://code.visualstudio.com/api/ux-guidelines/webviews webview}.
 * This form is used to set up a direct connection to a Kafka cluster and/or Schema Registry.
 */
export class DirectConnectionForm extends Webview {
  constructor(page: Page) {
    super(page);
  }

  // top-level/general form fields
  get nameField(): Locator {
    return this.webview.locator("#name");
  }
  get connectionTypeDropdown(): Locator {
    return this.webview.locator("#formconnectiontype");
  }
  get otherTypeField(): Locator {
    return this.webview.locator("#othertype");
  }

  // general Kafka cluster config fields
  get kafkaBootstrapServersField(): Locator {
    return this.webview.locator("#kafka_cluster\\.bootstrap_servers");
  }
  get kafkaAuthTypeDropdown(): Locator {
    return this.webview.locator("#kafka_cluster\\.auth_type");
  }
  get kafkaSSLEnabledCheckbox(): Locator {
    return this.webview.locator("#kafka_cluster\\.ssl\\.enabled");
  }

  // general Schema Registry config fields
  get schemaRegistryUriField(): Locator {
    return this.webview.locator("#schema_registry\\.uri");
  }
  get schemaRegistryAuthTypeDropdown(): Locator {
    return this.webview.locator("#schema_registry\\.auth_type");
  }
  get schemaRegistrySSLEnabledCheckbox(): Locator {
    return this.webview.locator("#schema_registry\\.ssl\\.enabled");
  }

  /**
   * Get a specific credential field for a specific `namespace` and `credentialType`.
   * @example
   * // To get the Kafka config API key field:
   * const kafkaApiKeyField = form.getCredentialField("kafka_cluster", "api_key");
   */
  getCredentialField(
    namespace: "kafka_cluster" | "schema_registry",
    credentialType: string,
  ): Locator {
    return this.webview.locator(`#${namespace}\\.credentials\\.${credentialType}`);
  }

  // 1. Basic auth (username/password)
  get kafkaUsernameField(): Locator {
    return this.getCredentialField("kafka_cluster", "username");
  }
  get kafkaPasswordField(): Locator {
    return this.getCredentialField("kafka_cluster", "password");
  }
  get schemaRegistryUsernameField(): Locator {
    return this.getCredentialField("schema_registry", "username");
  }
  get schemaRegistryPasswordField(): Locator {
    return this.getCredentialField("schema_registry", "password");
  }

  // 2. API Key/Secret
  get kafkaApiKeyField(): Locator {
    return this.getCredentialField("kafka_cluster", "api_key");
  }
  get kafkaApiSecretField(): Locator {
    return this.getCredentialField("kafka_cluster", "api_secret");
  }
  get schemaRegistryApiKeyField(): Locator {
    return this.getCredentialField("schema_registry", "api_key");
  }
  get schemaRegistryApiSecretField(): Locator {
    return this.getCredentialField("schema_registry", "api_secret");
  }

  // FUTURE: add other auth type config fields here as needed

  // form submission buttons
  get testButton(): Locator {
    return this.webview.getByRole("button", { name: "Test" });
  }
  get saveButton(): Locator {
    return this.webview.getByRole("button", { name: "Save" });
  }

  // status and message elements
  get successMessage(): Locator {
    return this.webview.getByText("Connection test succeeded");
  }
  get errorMessage(): Locator {
    return this.webview.locator(".msg-banner.error");
  }
  get successBanner(): Locator {
    return this.webview.locator(".msg-banner.success");
  }

  /** Fill in the connection `name` field. */
  async fillConnectionName(name: string): Promise<void> {
    await this.nameField.click();
    await this.page.keyboard.type(name);
  }

  /** Select a {@link FormConnectionType} from the dropdown. */
  async selectConnectionType(connectionType: FormConnectionType): Promise<void> {
    await this.connectionTypeDropdown.click();
    await this.connectionTypeDropdown.selectOption(connectionType);
  }

  /** Fill in the connection type text input field when "Other" is selected. */
  async fillOtherConnectionType(otherType: string): Promise<void> {
    await this.otherTypeField.click();
    await this.page.keyboard.type(otherType);
  }

  /**
   * Configure Kafka cluster bootstrap servers.
   * @param bootstrapServers The bootstrap servers to configure
   */
  async fillKafkaBootstrapServers(bootstrapServers: string): Promise<void> {
    await this.kafkaBootstrapServersField.click();
    await this.page.keyboard.type(bootstrapServers);
  }

  /**
   * Select Kafka authentication type.
   * @param authType The authentication type to select
   */
  async selectKafkaAuthType(authType: SupportedAuthTypes): Promise<void> {
    await this.kafkaAuthTypeDropdown.click();
    await this.kafkaAuthTypeDropdown.selectOption(authType);
  }

  /** Fill credentials for the Kafka configuration. */
  async fillKafkaCredentials(credentials: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(credentials)) {
      const field = this.getCredentialField("kafka_cluster", key);
      await field.click();
      await this.page.keyboard.type(value);
    }
  }

  /**
   * Configure Schema Registry URI.
   * @param uri The Schema Registry URI to configure
   */
  async fillSchemaRegistryUri(uri: string): Promise<void> {
    await this.schemaRegistryUriField.click();
    await this.page.keyboard.type(uri);
  }

  /**
   * Select Schema Registry authentication type.
   * @param authType The authentication type to select
   */
  async selectSchemaRegistryAuthType(authType: SupportedAuthTypes): Promise<void> {
    await this.schemaRegistryAuthTypeDropdown.click();
    await this.schemaRegistryAuthTypeDropdown.selectOption(authType);
  }

  /** Fill credentials for the Schema Registry configuration. */
  async fillSchemaRegistryCredentials(credentials: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(credentials)) {
      const field = this.getCredentialField("schema_registry", key);
      await field.click();
      await this.page.keyboard.type(value);
    }
  }

  /** Test the connection configuration. */
  async testConnection(): Promise<void> {
    await this.testButton.click();
  }

  /** Save the connection configuration. */
  async saveConnection(): Promise<void> {
    await this.saveButton.click();
  }

  /** Set up a connection using API key/secret for Kafka and/or Schema Registry. */
  async configureWithApiKeyAndSecret(config: {
    name: string;
    connectionType: FormConnectionType;
    kafka?: {
      bootstrapServers: string;
      apiKey: string;
      apiSecret: string;
    };
    schemaRegistry?: {
      apiKey: string;
      apiSecret: string;
      uri: string;
    };
  }): Promise<void> {
    if (!config.kafka && !config.schemaRegistry) {
      throw new Error("At least one of Kafka or Schema Registry configuration is required");
    }

    await this.fillConnectionName(config.name);
    await this.selectConnectionType(config.connectionType);

    if (config.kafka) {
      await this.fillKafkaBootstrapServers(config.kafka.bootstrapServers);
      await this.selectKafkaAuthType("API");
      await this.fillKafkaCredentials({
        api_key: config.kafka?.apiKey,
        api_secret: config.kafka?.apiSecret,
      });
    }
    if (config.schemaRegistry) {
      await this.fillSchemaRegistryUri(config.schemaRegistry.uri);
      await this.selectSchemaRegistryAuthType("API");
      await this.fillSchemaRegistryCredentials({
        api_key: config.schemaRegistry?.apiKey,
        api_secret: config.schemaRegistry?.apiSecret,
      });
    }
  }
}
