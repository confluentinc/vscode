/**
 * Abstract base class for connection type handlers.
 *
 * Each connection type (CCloud, Local, Direct) implements its own handler
 * that extends this class to provide type-specific connection logic.
 */

import { EventEmitter } from "vscode";
import { DisposableCollection } from "../../utils/disposables";
import type { ConnectionSpec } from "../spec";
import type { ConnectionId, ConnectionStatus, ConnectedState } from "../types";

/** Result of a connection test operation. */
export interface ConnectionTestResult {
  /** Whether the connection test was successful. */
  success: boolean;
  /** Error message if the test failed. */
  error?: string;
  /** Detailed status information. */
  status?: ConnectionStatus;
}

/** Event fired when connection status changes. */
export interface ConnectionStatusChangeEvent {
  /** The connection ID. */
  connectionId: ConnectionId;
  /** Previous status (undefined if this is initial status). */
  previousStatus?: ConnectionStatus;
  /** Current status. */
  currentStatus: ConnectionStatus;
}

/**
 * Abstract base class for connection type handlers.
 *
 * Subclasses must implement the abstract methods to provide connection
 * type-specific behavior for CCloud, Local, and Direct connections.
 *
 * @example
 * ```typescript
 * class DirectConnectionHandler extends ConnectionHandler {
 *   async connect(): Promise<void> {
 *     // Direct connection logic
 *   }
 *   // ... other implementations
 * }
 * ```
 */
export abstract class ConnectionHandler extends DisposableCollection {
  /** Event emitter for status changes. */
  protected readonly _onStatusChange = new EventEmitter<ConnectionStatusChangeEvent>();

  /** Event fired when connection status changes. */
  readonly onStatusChange = this._onStatusChange.event;

  /** The connection specification this handler manages. */
  protected _spec: ConnectionSpec;

  /** Current connection status. */
  protected _status: ConnectionStatus;

  /**
   * Creates a new connection handler.
   * @param spec The connection specification.
   */
  constructor(spec: ConnectionSpec) {
    super();
    this._spec = spec;
    this._status = {};
    this.disposables.push(this._onStatusChange);
  }

  /** Gets the connection ID. */
  get connectionId(): ConnectionId {
    return this._spec.id;
  }

  /** Gets the connection specification. */
  get spec(): ConnectionSpec {
    return this._spec;
  }

  /** Gets the current connection status. */
  get status(): ConnectionStatus {
    return this._status;
  }

  /**
   * Updates the connection specification.
   * Subclasses may override to handle spec changes (e.g., reconnect with new credentials).
   * @param spec The new connection specification.
   */
  updateSpec(spec: ConnectionSpec): void {
    if (spec.id !== this._spec.id) {
      throw new Error(`Cannot change connection ID: expected ${this._spec.id}, got ${spec.id}`);
    }
    this._spec = spec;
  }

  /**
   * Updates the connection status and fires the status change event.
   * @param status The new status.
   */
  protected updateStatus(status: ConnectionStatus): void {
    const previousStatus = this._status;
    this._status = status;
    this._onStatusChange.fire({
      connectionId: this.connectionId,
      previousStatus,
      currentStatus: status,
    });
  }

  /**
   * Initiates a connection using the current specification.
   * This method should establish connections to Kafka clusters, Schema Registries,
   * and/or CCloud services as appropriate for the connection type.
   */
  abstract connect(): Promise<void>;

  /**
   * Disconnects and cleans up any active connections.
   * This method should gracefully close all connections and release resources.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Tests the connection without fully establishing it.
   * Useful for validating connection parameters before saving.
   * @returns The result of the connection test.
   */
  abstract testConnection(): Promise<ConnectionTestResult>;

  /**
   * Gets the current detailed status of the connection.
   * This may involve querying the connected services for their current state.
   * @returns The current connection status.
   */
  abstract getStatus(): Promise<ConnectionStatus>;

  /**
   * Refreshes credentials if they have expired or are about to expire.
   * For OAuth-based connections, this may trigger a token refresh.
   * For other credential types, this may be a no-op.
   * @returns true if credentials were refreshed, false if no refresh was needed.
   */
  abstract refreshCredentials(): Promise<boolean>;

  /**
   * Determines if the connection is currently in a usable state.
   * @returns true if the connection can be used for operations.
   */
  abstract isConnected(): boolean;

  /**
   * Gets the overall connected state based on current status.
   * For connections with multiple sub-connections (Kafka + SR), returns
   * the "worst" state (e.g., if Kafka is SUCCESS but SR is FAILED, returns FAILED).
   * @returns The overall connected state.
   */
  abstract getOverallState(): ConnectedState;

  /**
   * Disposes of the handler and all its resources.
   * Subclasses should call super.dispose() after their own cleanup.
   */
  dispose(): void {
    // Subclasses should override to disconnect before disposing
    super.dispose();
  }
}
