/**
 * Connection handler for Direct (custom endpoint) connections.
 *
 * Handles connections to user-specified Kafka clusters and Schema Registries
 * with support for various authentication methods (Basic, API Key, SCRAM, mTLS, Kerberos).
 */

import { CredentialType, type Credentials } from "../credentials";
import type { ConnectionSpec } from "../spec";
import { ConnectedState, type ConnectionStatus, type KafkaClusterStatus } from "../types";
import { ConnectionHandler, type ConnectionTestResult } from "./connectionHandler";
import { createSchemaRegistryProxy } from "../../proxy/schemaRegistryProxy";
import { HttpError, type AuthConfig } from "../../proxy/httpClient";

/** Result of testing a specific endpoint. */
interface EndpointTestResult {
  /** Whether the endpoint test was successful. */
  success: boolean;
  /** Error message if the test failed. */
  error?: string;
  /** Cluster ID if the test succeeded. */
  clusterId?: string;
}

/**
 * Handles direct connections to user-specified Kafka and Schema Registry endpoints.
 *
 * Direct connections support:
 * - Custom bootstrap servers for Kafka
 * - Custom Schema Registry URI
 * - Multiple authentication methods
 * - TLS configuration
 */
export class DirectConnectionHandler extends ConnectionHandler {
  /** Flag indicating if connection is currently active. */
  private _connected = false;

  /** Kafka cluster status from last connection attempt. */
  private _kafkaStatus: KafkaClusterStatus = { state: ConnectedState.NONE };

  /** Schema Registry status from last connection attempt. */
  private _schemaRegistryStatus: KafkaClusterStatus = { state: ConnectedState.NONE };

  /**
   * Creates a new direct connection handler.
   * @param spec The connection specification with kafka and/or schema registry config.
   */
  constructor(spec: ConnectionSpec) {
    super(spec);
  }

  /**
   * Initiates connections to configured endpoints.
   * Tests connectivity and updates status accordingly.
   */
  async connect(): Promise<void> {
    const newStatus: ConnectionStatus = {};

    // Test Kafka cluster if configured
    if (this._spec.kafkaCluster?.bootstrapServers) {
      this._kafkaStatus = { state: ConnectedState.ATTEMPTING };
      newStatus.kafkaCluster = this._kafkaStatus;
      this.updateStatus(newStatus);

      const kafkaResult = await this.testKafkaConnection();
      this._kafkaStatus = {
        state: kafkaResult.success ? ConnectedState.SUCCESS : ConnectedState.FAILED,
        clusterId: kafkaResult.clusterId,
        errors: kafkaResult.error ? [{ message: kafkaResult.error }] : undefined,
      };
      newStatus.kafkaCluster = this._kafkaStatus;
    }

    // Test Schema Registry if configured
    if (this._spec.schemaRegistry?.uri) {
      this._schemaRegistryStatus = { state: ConnectedState.ATTEMPTING };
      newStatus.schemaRegistry = this._schemaRegistryStatus;
      this.updateStatus(newStatus);

      const srResult = await this.testSchemaRegistryConnection();
      this._schemaRegistryStatus = {
        state: srResult.success ? ConnectedState.SUCCESS : ConnectedState.FAILED,
        clusterId: srResult.clusterId,
        errors: srResult.error ? [{ message: srResult.error }] : undefined,
      };
      newStatus.schemaRegistry = this._schemaRegistryStatus;
    }

    // Determine overall connection state
    this._connected = this.getOverallState() === ConnectedState.SUCCESS;
    this.updateStatus(newStatus);
  }

  /**
   * Disconnects and resets connection status.
   */
  async disconnect(): Promise<void> {
    this._connected = false;
    this._kafkaStatus = { state: ConnectedState.NONE };
    this._schemaRegistryStatus = { state: ConnectedState.NONE };

    const newStatus: ConnectionStatus = {};
    if (this._spec.kafkaCluster) {
      newStatus.kafkaCluster = this._kafkaStatus;
    }
    if (this._spec.schemaRegistry) {
      newStatus.schemaRegistry = this._schemaRegistryStatus;
    }
    this.updateStatus(newStatus);
  }

  /**
   * Tests the connection without establishing a persistent connection.
   * @returns The result of the connection test.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    const status: ConnectionStatus = {};
    let overallSuccess = true;
    const errors: string[] = [];

    // Test Kafka if configured
    if (this._spec.kafkaCluster?.bootstrapServers) {
      const kafkaResult = await this.testKafkaConnection();
      status.kafkaCluster = {
        state: kafkaResult.success ? ConnectedState.SUCCESS : ConnectedState.FAILED,
        clusterId: kafkaResult.clusterId,
        errors: kafkaResult.error ? [{ message: kafkaResult.error }] : undefined,
      };
      if (!kafkaResult.success) {
        overallSuccess = false;
        errors.push(`Kafka: ${kafkaResult.error}`);
      }
    }

    // Test Schema Registry if configured
    if (this._spec.schemaRegistry?.uri) {
      const srResult = await this.testSchemaRegistryConnection();
      status.schemaRegistry = {
        state: srResult.success ? ConnectedState.SUCCESS : ConnectedState.FAILED,
        clusterId: srResult.clusterId,
        errors: srResult.error ? [{ message: srResult.error }] : undefined,
      };
      if (!srResult.success) {
        overallSuccess = false;
        errors.push(`Schema Registry: ${srResult.error}`);
      }
    }

    // Must have at least one endpoint configured
    if (!this._spec.kafkaCluster?.bootstrapServers && !this._spec.schemaRegistry?.uri) {
      return {
        success: false,
        error: "No endpoints configured. Provide Kafka bootstrap servers or Schema Registry URI.",
        status,
      };
    }

    return {
      success: overallSuccess,
      error: errors.length > 0 ? errors.join("; ") : undefined,
      status,
    };
  }

  /**
   * Gets the current detailed status of the connection.
   * @returns The current connection status.
   */
  async getStatus(): Promise<ConnectionStatus> {
    const status: ConnectionStatus = {};
    if (this._spec.kafkaCluster) {
      status.kafkaCluster = this._kafkaStatus;
    }
    if (this._spec.schemaRegistry) {
      status.schemaRegistry = this._schemaRegistryStatus;
    }
    return status;
  }

  /**
   * Refreshes credentials if needed.
   * For direct connections, this is typically a no-op unless using OAuth.
   * @returns true if credentials were refreshed, false otherwise.
   */
  async refreshCredentials(): Promise<boolean> {
    const kafkaCreds = this._spec.kafkaCluster?.credentials;
    const srCreds = this._spec.schemaRegistry?.credentials;

    // Only OAuth credentials might need refresh
    if (kafkaCreds?.type === CredentialType.OAUTH || srCreds?.type === CredentialType.OAUTH) {
      // TODO: Implement OAuth token refresh when Phase 2 is complete
      return false;
    }

    return false;
  }

  /**
   * Checks if the connection is currently usable.
   * @returns true if connected successfully.
   */
  isConnected(): boolean {
    return this._connected;
  }

  /**
   * Gets the overall connected state based on configured endpoints.
   * Returns the "worst" state if multiple endpoints are configured.
   * @returns The overall connected state.
   */
  getOverallState(): ConnectedState {
    const hasKafka = !!this._spec.kafkaCluster?.bootstrapServers;
    const hasSR = !!this._spec.schemaRegistry?.uri;

    // No endpoints configured
    if (!hasKafka && !hasSR) {
      return ConnectedState.NONE;
    }

    const kafkaState = hasKafka ? this._kafkaStatus.state : null;
    const srState = hasSR ? this._schemaRegistryStatus.state : null;

    // If any is FAILED, overall is FAILED
    if (kafkaState === ConnectedState.FAILED || srState === ConnectedState.FAILED) {
      return ConnectedState.FAILED;
    }

    // If any is ATTEMPTING, overall is ATTEMPTING
    if (kafkaState === ConnectedState.ATTEMPTING || srState === ConnectedState.ATTEMPTING) {
      return ConnectedState.ATTEMPTING;
    }

    // If any is EXPIRED, overall is EXPIRED
    if (kafkaState === ConnectedState.EXPIRED || srState === ConnectedState.EXPIRED) {
      return ConnectedState.EXPIRED;
    }

    // If both configured endpoints are SUCCESS, overall is SUCCESS
    if (
      (!hasKafka || kafkaState === ConnectedState.SUCCESS) &&
      (!hasSR || srState === ConnectedState.SUCCESS)
    ) {
      return ConnectedState.SUCCESS;
    }

    // Default to NONE if no clear state
    return ConnectedState.NONE;
  }

  /**
   * Tests connectivity to the Kafka cluster.
   * Validates the configuration; actual connectivity is verified when connecting.
   */
  private async testKafkaConnection(): Promise<EndpointTestResult> {
    const config = this._spec.kafkaCluster;
    if (!config?.bootstrapServers) {
      return { success: false, error: "No bootstrap servers configured" };
    }

    // Validate the configuration
    // Actual connectivity to Kafka brokers is verified via the native protocol
    // when the connection is established (using kafkajs AdminClient)
    const validationResult = await this.validateKafkaConfig(
      config.bootstrapServers,
      config.credentials,
    );
    if (!validationResult.success) {
      return validationResult;
    }

    return { success: true, clusterId: "pending-cluster-id" };
  }

  /**
   * Tests connectivity to the Schema Registry.
   * Uses REST API to verify cluster access.
   */
  private async testSchemaRegistryConnection(): Promise<EndpointTestResult> {
    const config = this._spec.schemaRegistry;
    if (!config?.uri) {
      return { success: false, error: "No Schema Registry URI configured" };
    }

    // First validate the configuration
    const validationResult = await this.validateSchemaRegistryConfig(
      config.uri,
      config.credentials,
    );
    if (!validationResult.success) {
      return validationResult;
    }

    try {
      const auth = this.getAuthConfigFromCredentials(config.credentials);
      const proxy = createSchemaRegistryProxy({
        baseUrl: config.uri,
        auth,
      });

      // Call listSubjects() to test connectivity
      await proxy.listSubjects();
      return { success: true, clusterId: "schema-registry" };
    } catch (error) {
      if (error instanceof HttpError) {
        return {
          success: false,
          error: `Schema Registry API error (${error.status}): ${error.message}`,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Connection failed: ${message}` };
    }
  }

  /**
   * Validates Kafka configuration.
   * This is a placeholder until Phase 3 implements the actual proxy layer.
   */
  private async validateKafkaConfig(
    bootstrapServers: string,
    credentials?: Credentials,
  ): Promise<EndpointTestResult> {
    // Basic validation
    if (!bootstrapServers.trim()) {
      return { success: false, error: "Bootstrap servers cannot be empty" };
    }

    // Validate bootstrap server format (host:port pairs)
    const serverParts = bootstrapServers.split(",").map((s) => s.trim());
    for (const server of serverParts) {
      if (!server.includes(":")) {
        return { success: false, error: `Invalid server format: ${server}. Expected host:port` };
      }
    }

    // Validate credentials if provided
    if (credentials) {
      const credError = this.validateCredentials(credentials);
      if (credError) {
        return { success: false, error: credError };
      }
    }

    // TODO: Actual connection test via Kafka REST Proxy (Phase 3)
    // For now, return success if validation passes
    return { success: true, clusterId: "pending-cluster-id" };
  }

  /**
   * Validates Schema Registry configuration.
   * This is a placeholder until Phase 3 implements the actual proxy layer.
   */
  private async validateSchemaRegistryConfig(
    uri: string,
    credentials?: Credentials,
  ): Promise<EndpointTestResult> {
    // Basic URI validation
    if (!uri.trim()) {
      return { success: false, error: "Schema Registry URI cannot be empty" };
    }

    // Validate URI format
    try {
      new URL(uri);
    } catch {
      return { success: false, error: `Invalid URI format: ${uri}` };
    }

    // Validate credentials if provided
    if (credentials) {
      const credError = this.validateCredentials(credentials);
      if (credError) {
        return { success: false, error: credError };
      }
    }

    // TODO: Actual connection test via Schema Registry API (Phase 3)
    // For now, return success if validation passes
    return { success: true, clusterId: "pending-sr-cluster-id" };
  }

  /**
   * Validates that credentials are properly configured.
   * Handles both modern credentials (with `type` discriminator) and
   * legacy/imported credentials (without `type`, detected by property names).
   * @returns Error message if invalid, undefined if valid.
   */
  private validateCredentials(credentials: Credentials): string | undefined {
    // Detect credential type - use discriminator if present, otherwise detect from properties
    const credType = this.detectCredentialType(credentials);
    // Use unknown first to satisfy TypeScript when treating as record
    const creds = credentials as unknown as Record<string, unknown>;

    switch (credType) {
      case CredentialType.NONE:
        return undefined;

      case CredentialType.BASIC:
        if (!creds.username) return "Basic auth requires username";
        if (!creds.password) return "Basic auth requires password";
        return undefined;

      case CredentialType.API_KEY:
        // Check both camelCase and snake_case (for imported JSON)
        if (!creds.apiKey && !creds.api_key) return "API key auth requires key";
        if (!creds.apiSecret && !creds.api_secret) return "API key auth requires secret";
        return undefined;

      case CredentialType.SCRAM: {
        const hasUsername = creds.username || creds.scramUsername || creds.scram_username;
        const hasPassword = creds.password || creds.scramPassword || creds.scram_password;
        if (!hasUsername) return "SCRAM auth requires username";
        if (!hasPassword) return "SCRAM auth requires password";
        return undefined;
      }

      case CredentialType.OAUTH:
        // Check both camelCase and snake_case (for imported JSON)
        if (!creds.tokensUrl && !creds.tokens_url) return "OAuth requires token endpoint";
        if (!creds.clientId && !creds.client_id) return "OAuth requires client ID";
        return undefined;

      case CredentialType.MTLS: {
        const keystore = creds.keystore as Record<string, unknown> | undefined;
        if (!keystore?.path) return "mTLS requires certificate path";
        return undefined;
      }

      case CredentialType.KERBEROS:
        if (!creds.principal) return "Kerberos requires principal";
        return undefined;

      default:
        return `Unknown credential type: ${credType}`;
    }
  }

  /**
   * Detects the credential type from a credentials object.
   * Uses the `type` discriminator if present, otherwise detects from property names.
   */
  private detectCredentialType(credentials: Credentials): CredentialType {
    // If type discriminator is present, use it
    if (credentials.type) {
      return credentials.type;
    }

    // Otherwise detect from property names (for imported JSON without type)
    // Use unknown first to satisfy TypeScript when treating as record
    const creds = credentials as unknown as Record<string, unknown>;

    // API Key - check both camelCase and snake_case
    if ((creds.apiKey && creds.apiSecret) || (creds.api_key && creds.api_secret)) {
      return CredentialType.API_KEY;
    }

    // SCRAM - check for scram-specific fields
    if (
      creds.scramUsername ||
      creds.scram_username ||
      creds.hashAlgorithm ||
      creds.hash_algorithm
    ) {
      return CredentialType.SCRAM;
    }

    // Basic - username/password without scram-specific fields
    if (creds.username && creds.password) {
      return CredentialType.BASIC;
    }

    // OAuth
    if ((creds.tokensUrl && creds.clientId) || (creds.tokens_url && creds.client_id)) {
      return CredentialType.OAUTH;
    }

    // Kerberos
    if (creds.principal && (creds.keytabPath || creds.keytab_path)) {
      return CredentialType.KERBEROS;
    }

    // mTLS
    if (creds.keystore) {
      return CredentialType.MTLS;
    }

    return CredentialType.NONE;
  }

  /**
   * Converts credentials to AuthConfig for the HTTP client.
   * Handles both modern credentials (with `type` discriminator) and
   * legacy/imported credentials (without `type`, detected by property names).
   * @param credentials The credentials to convert.
   * @returns AuthConfig for the HTTP client, or undefined for unsupported types.
   */
  private getAuthConfigFromCredentials(credentials?: Credentials): AuthConfig | undefined {
    if (!credentials) {
      return undefined;
    }

    const credType = this.detectCredentialType(credentials);
    // Use unknown first to satisfy TypeScript when treating as record
    const creds = credentials as unknown as Record<string, unknown>;

    switch (credType) {
      case CredentialType.NONE:
        return undefined;

      case CredentialType.BASIC:
        return {
          type: "basic",
          username: (creds.username as string) ?? "",
          password: (creds.password as string) ?? "",
        };

      case CredentialType.API_KEY:
        // API keys are sent as basic auth with key:secret
        // Handle both camelCase and snake_case (for imported JSON)
        return {
          type: "basic",
          username: ((creds.apiKey ?? creds.api_key) as string) ?? "",
          password: ((creds.apiSecret ?? creds.api_secret) as string) ?? "",
        };

      case CredentialType.SCRAM:
        // SCRAM credentials are sent as basic auth
        // Handle both camelCase and snake_case (for imported JSON)
        return {
          type: "basic",
          username:
            ((creds.username ?? creds.scramUsername ?? creds.scram_username) as string) ?? "",
          password:
            ((creds.password ?? creds.scramPassword ?? creds.scram_password) as string) ?? "",
        };

      case CredentialType.OAUTH:
      case CredentialType.MTLS:
      case CredentialType.KERBEROS:
        // These credential types require more complex handling
        // and are not yet supported for direct HTTP requests
        return undefined;

      default:
        return undefined;
    }
  }

  /**
   * Disposes of the handler and cleans up resources.
   */
  dispose(): void {
    // Disconnect before disposing
    this._connected = false;
    this._kafkaStatus = { state: ConnectedState.NONE };
    this._schemaRegistryStatus = { state: ConnectedState.NONE };
    super.dispose();
  }
}
