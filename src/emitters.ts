import * as vscode from "vscode";
import { KafkaCluster } from "./models/kafkaCluster";
import { ConnectionId, EnvironmentId } from "./models/resource";
import { SchemaRegistry } from "./models/schemaRegistry";

// NOTE: these are kept at the global level to allow for easy access from any file and track where
// we .fire() events and where we react to them via .event()

/** Indicate whether or not we have a CCloud connection (controlled by our auth provider). */
export const ccloudConnected = new vscode.EventEmitter<boolean>();
/** Fires whenever we see a non-`INVALID_TOKEN` authentication status from the sidecar for the
 * current CCloud connection, and is only used to resolve any open progress notification(s). */
export const nonInvalidTokenStatus = new vscode.EventEmitter<void>();
/** Signal to the auth provider that we no longer have a valid auth status for the current CCloud connection. */
export const ccloudAuthSessionInvalidated = new vscode.EventEmitter<void>();
export const ccloudOrganizationChanged = new vscode.EventEmitter<void>();

/** Fired whenever the list of direct connections changes. */
export const directConnectionsChanged = new vscode.EventEmitter<void>();

export const localKafkaConnected = new vscode.EventEmitter<boolean>();
export const localSchemaRegistryConnected = new vscode.EventEmitter<boolean>();

/** Event type used by {@link environmentChanged} */
export type EnvironmentChangeEvent = {
  /** The environment that changed. */
  id: EnvironmentId;
  /** Was it that the env has been deleted? */
  wasDeleted: boolean;
};

/**
 * Fired whenever a property of an {@link Environment} has changed. (Mainly to affect watchers in
 * the Topics/Schemas views, or similar.)
 **/
export const environmentChanged = new vscode.EventEmitter<EnvironmentChangeEvent>();

/**
 * Fired whenever a Kafka cluster is selected from the Resources view, chosen from the "Select Kafka
 * Cluster" action from the Topics view, or cleared out from a connection (or CCloud organization)
 * change.
 */
export const currentKafkaClusterChanged = new vscode.EventEmitter<KafkaCluster | null>();
/**
 * Fired whenever a Schema Registry is selected from the Resources view, chosen from the
 * "Select Schema Registry" action from the Schemas view, or cleared out from a connection
 * (or CCloud organization) change.
 */
export const currentSchemaRegistryChanged = new vscode.EventEmitter<SchemaRegistry | null>();

export const connectionStable = new vscode.EventEmitter<ConnectionId>();

/** The user set/unset a filter for the Resources view. */
export const resourceSearchSet = new vscode.EventEmitter<string | null>();
/** The user set/unset a filter for the Topics view. */
export const topicSearchSet = new vscode.EventEmitter<string | null>();
/** The user set/unset a filter for the Schemas view. */
export const schemaSearchSet = new vscode.EventEmitter<string | null>();
