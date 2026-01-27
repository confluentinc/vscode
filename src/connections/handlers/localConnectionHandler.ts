/**
 * Connection handler for Local (Docker-based) connections.
 *
 * Handles connections to locally running Kafka and Schema Registry containers,
 * typically managed by Docker or Docker Compose. Uses the Kafka REST proxy
 * for connectivity testing.
 */

import { ConnectedState, type ConnectionStatus, type KafkaClusterStatus } from "../types";
import type { ConnectionSpec } from "../spec";
import { ConnectionHandler, type ConnectionTestResult } from "./connectionHandler";

/** Default Kafka REST proxy port for local connections. */
const LOCAL_KAFKA_REST_PORT = 8082;

/** Default Kafka REST proxy URI for local connections. */
const DEFAULT_KAFKA_REST_URI = `http://localhost:${LOCAL_KAFKA_REST_PORT}`;

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
 * Handles local connections to Docker-based Kafka and Schema Registry containers.
 *
 * Local connections:
 * - Use the Kafka REST proxy (typically on port 8082) to interact with Kafka
 * - Support optional Schema Registry at a configurable URI
 * - Are typically managed by Docker Compose or the extension's container management
 */
export class LocalConnectionHandler extends ConnectionHandler {
  /** Flag indicating if connection is currently active. */
  private _connected = false;

  /** Kafka cluster status from last connection attempt. */
  private _kafkaStatus: KafkaClusterStatus = { state: ConnectedState.NONE };

  /** Schema Registry status from last connection attempt. */
  private _schemaRegistryStatus: KafkaClusterStatus = { state: ConnectedState.NONE };

  /** URI for the Kafka REST proxy. */
  private _kafkaRestUri: string = DEFAULT_KAFKA_REST_URI;

  /**
   * Creates a new local connection handler.
   * @param spec The connection specification with optional local config.
   */
  constructor(spec: ConnectionSpec) {
    super(spec);
  }

  /**
   * Initiates connections to local Kafka and Schema Registry.
   * Tests connectivity and updates status accordingly.
   */
  async connect(): Promise<void> {
    const newStatus: ConnectionStatus = {};

    // Always test Kafka for local connections
    this._kafkaStatus = { state: ConnectedState.ATTEMPTING };
    newStatus.kafkaCluster = this._kafkaStatus;
    this.updateStatus(newStatus);

    const kafkaResult = await this.testKafkaRestProxy();
    this._kafkaStatus = {
      state: kafkaResult.success ? ConnectedState.SUCCESS : ConnectedState.FAILED,
      clusterId: kafkaResult.clusterId,
      errors: kafkaResult.error ? [{ message: kafkaResult.error }] : undefined,
    };
    newStatus.kafkaCluster = this._kafkaStatus;

    // Test Schema Registry if configured
    const srUri = this._spec.localConfig?.schemaRegistryUri;
    if (srUri) {
      this._schemaRegistryStatus = { state: ConnectedState.ATTEMPTING };
      newStatus.schemaRegistry = this._schemaRegistryStatus;
      this.updateStatus(newStatus);

      const srResult = await this.testSchemaRegistryConnection(srUri);
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

    const newStatus: ConnectionStatus = {
      kafkaCluster: this._kafkaStatus,
    };
    if (this._spec.localConfig?.schemaRegistryUri) {
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

    // Always test Kafka REST proxy for local connections
    const kafkaResult = await this.testKafkaRestProxy();
    status.kafkaCluster = {
      state: kafkaResult.success ? ConnectedState.SUCCESS : ConnectedState.FAILED,
      clusterId: kafkaResult.clusterId,
      errors: kafkaResult.error ? [{ message: kafkaResult.error }] : undefined,
    };
    if (!kafkaResult.success) {
      overallSuccess = false;
      errors.push(`Kafka REST Proxy: ${kafkaResult.error}`);
    }

    // Test Schema Registry if configured
    const srUri = this._spec.localConfig?.schemaRegistryUri;
    if (srUri) {
      const srResult = await this.testSchemaRegistryConnection(srUri);
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
    const status: ConnectionStatus = {
      kafkaCluster: this._kafkaStatus,
    };
    if (this._spec.localConfig?.schemaRegistryUri) {
      status.schemaRegistry = this._schemaRegistryStatus;
    }
    return status;
  }

  /**
   * Refreshes credentials if needed.
   * Local connections typically don't require credential refresh.
   * @returns false since local connections don't use expiring credentials.
   */
  async refreshCredentials(): Promise<boolean> {
    // Local connections don't use credentials that expire
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
   * Gets the overall connected state.
   * For local connections, Kafka must succeed. Schema Registry is optional.
   * @returns The overall connected state.
   */
  getOverallState(): ConnectedState {
    // Kafka is required for local connections
    if (this._kafkaStatus.state === ConnectedState.FAILED) {
      return ConnectedState.FAILED;
    }
    if (this._kafkaStatus.state === ConnectedState.ATTEMPTING) {
      return ConnectedState.ATTEMPTING;
    }

    // If SR is configured, it must also succeed
    const srUri = this._spec.localConfig?.schemaRegistryUri;
    if (srUri) {
      if (this._schemaRegistryStatus.state === ConnectedState.FAILED) {
        return ConnectedState.FAILED;
      }
      if (this._schemaRegistryStatus.state === ConnectedState.ATTEMPTING) {
        return ConnectedState.ATTEMPTING;
      }
    }

    // If Kafka succeeded and SR is either not configured or succeeded
    if (
      this._kafkaStatus.state === ConnectedState.SUCCESS &&
      (!srUri || this._schemaRegistryStatus.state === ConnectedState.SUCCESS)
    ) {
      return ConnectedState.SUCCESS;
    }

    return ConnectedState.NONE;
  }

  /**
   * Gets the Kafka REST proxy URI.
   * @returns The current Kafka REST proxy URI.
   */
  getKafkaRestUri(): string {
    return this._kafkaRestUri;
  }

  /**
   * Sets the Kafka REST proxy URI.
   * Useful for testing or when the port changes.
   * @param uri The new Kafka REST proxy URI.
   */
  setKafkaRestUri(uri: string): void {
    this._kafkaRestUri = uri;
  }

  /**
   * Tests connectivity to the Kafka REST proxy.
   * Uses the /clusters endpoint to verify cluster access.
   */
  private async testKafkaRestProxy(): Promise<EndpointTestResult> {
    try {
      // TODO: Phase 3 will implement actual HTTP calls to Kafka REST proxy
      // For now, we validate the URI and simulate the test
      const result = await this.validateKafkaRestProxyConfig(this._kafkaRestUri);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Connection failed: ${message}` };
    }
  }

  /**
   * Tests connectivity to the Schema Registry.
   * Uses REST API to verify cluster access.
   */
  private async testSchemaRegistryConnection(uri: string): Promise<EndpointTestResult> {
    try {
      // TODO: Phase 3 will implement actual Schema Registry API calls
      // For now, we validate the URI and simulate the test
      const result = await this.validateSchemaRegistryConfig(uri);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Connection failed: ${message}` };
    }
  }

  /**
   * Validates Kafka REST proxy configuration.
   * This is a placeholder until Phase 3 implements the actual proxy layer.
   */
  private async validateKafkaRestProxyConfig(uri: string): Promise<EndpointTestResult> {
    // Basic URI validation
    if (!uri.trim()) {
      return { success: false, error: "Kafka REST proxy URI cannot be empty" };
    }

    // Validate URI format
    try {
      new URL(uri);
    } catch {
      return { success: false, error: `Invalid URI format: ${uri}` };
    }

    // TODO: Actual connection test via HTTP GET /clusters (Phase 3)
    // For now, return success if validation passes
    return { success: true, clusterId: "local-cluster" };
  }

  /**
   * Validates Schema Registry configuration.
   * This is a placeholder until Phase 3 implements the actual proxy layer.
   */
  private async validateSchemaRegistryConfig(uri: string): Promise<EndpointTestResult> {
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

    // TODO: Actual connection test via Schema Registry API (Phase 3)
    // For now, return success if validation passes
    return { success: true, clusterId: "local-sr-cluster" };
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
