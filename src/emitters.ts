import * as vscode from "vscode";
import { KafkaCluster } from "./models/kafkaCluster";
import { SchemaRegistryCluster } from "./models/schemaRegistry";

// NOTE: these are kept at the global level to allow for easy access from any file and track where
// we .fire() events and where we react to them via .event()

/** Indicate whether or not we have a CCloud connection (controlled by our auth provider). */
export const ccloudConnected = new vscode.EventEmitter<boolean>();
/** Signal to the auth provider that we no longer have a valid auth status for the current CCloud connection. */
export const ccloudAuthSessionInvalidated = new vscode.EventEmitter<void>();
export const ccloudOrganizationChanged = new vscode.EventEmitter<void>();

export const localKafkaConnected = new vscode.EventEmitter<boolean>();

/**
 * Fired whenever a Kafka cluster is selected from the Resources view, chosen from the "Select Kafka
 * Cluster" action from the Topics view, or cleared out from a connection (or CCloud organization)
 * change.
 */
export const currentKafkaClusterChanged = new vscode.EventEmitter<KafkaCluster | null>();
/**
 * Fired whenever a Schema Registry cluster is selected from the Resources view, chosen from the
 * "Select Schema Registry" action from the Schemas view, or cleared out from a connection
 * (or CCloud organization) change.
 */
export const currentSchemaRegistryChanged = new vscode.EventEmitter<SchemaRegistryCluster | null>();
