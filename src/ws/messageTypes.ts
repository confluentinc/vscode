/** Module describing workspace<-->sidecar websocket messages. */

import { Schema } from "../models/schema";
import { KafkaTopic } from "../models/topic";

/**
 * All websocket message types, message.header.type values.
 * Some come in request/response pairs, others are individual events, either
 * directed at a single workspace or to sidecar or broadcast to all workspaces.
 */
export enum MessageType {
  // Extension <--> Sidecar messages, audience=sidecar or audience=extension

  // access request/response
  ACCESS_REQUEST = "ACCESS_REQUEST",
  ACCESS_RESPONSE = "ACCESS_RESPONSE",

  // Cache-sync messages, audience=sidecar
  CCLOUD_SCHEMA_REGISTRY_SCHEMAS = "CCLOUD_SCHEMA_REGISTRY_SCHEMAS",
  CCLOUD_KAFKA_TOPICS = "CCLOUD_KAFKA_TOPICS",

  // When a new workspace connects and is granted access, or when a workspace disconnects,
  // sidecar will send this message to all other workspaces.
  WORKSPACE_COUNT_CHANGED = "WORKSPACE_COUNT_CHANGED",
}

/** All message.header.audience values */
export enum Audience {
  /** Messages originating from extension directly and only to the sidecar. */
  SIDECAR = "sidecar",

  /**
   * Messages originating from sidecar to a single extension, usually in response
   * to an extension -> sidecar message.
   */
  WORKSPACE = "workspace",

  /**
   * Messages originating from a single extension to all other extensions, broadcasting
   * through the sidecar as a broadcast IPC mechanism.
   */
  WORKSPACES = "workspaces",
}

/** Header structure for websocket messages. */
export interface MessageHeader {
  /** Type of message. Dictates what the message body structure should be. */
  message_type: MessageType;

  /** The intended recipient(s): A single workspace, Sidecar, or all other workspaces. */
  audience: Audience;

  /** Originator of the message. Either the sending workspace's process id, or "sidecar". */
  originator: string;

  /** Stringified UUID4 uniquely identifying the message. */
  message_id: string;
}

export interface ReplyMessageHeader extends MessageHeader {
  /** Used to correlate responses to requests. Holds message_id value of the message being replied to. */
  response_to_id: string;
}

/**
 * Websocket message structure. Generic over the body payload whose structure
 * is determined by the message type.
 **/
export interface Message<T extends MessageType> {
  headers: MessageHeaderMap[T];
  body: MessageBodyMap[T];
}

/** Workspace -> Sidecar authorization message, sent immediately after websocket connection established. */
export interface AccessRequestBody {
  access_token: string;
}

/** Sidecar -> Workspace reply to an authorization request. */
export interface AccessResponseBody {
  authorized: boolean;
  current_workspace_count: number;
}

export interface WorkspacesChangedBody {
  current_workspace_count: number;
}

export interface CCloudSchemaRegistrySchemasBody {
  schema_registry_id: string;
  schemas: Schema[];
}

export interface CCloudKafkaTopicsBody {
  environment_id: string;
  cluster_id: string;
  topics: KafkaTopic[];
}

/** Type mapping of message type -> corresponding message body type */
type MessageBodyMap = {
  [MessageType.ACCESS_REQUEST]: AccessRequestBody;
  [MessageType.ACCESS_RESPONSE]: AccessResponseBody;
  [MessageType.WORKSPACE_COUNT_CHANGED]: WorkspacesChangedBody;
  [MessageType.CCLOUD_SCHEMA_REGISTRY_SCHEMAS]: CCloudSchemaRegistrySchemasBody;
  [MessageType.CCLOUD_KAFKA_TOPICS]: CCloudKafkaTopicsBody;
};

/** Type mapping of message type -> corresponding headers type. Dictates which messages should have `response_to_id` field.` */
type MessageHeaderMap = {
  [MessageType.ACCESS_REQUEST]: MessageHeader;
  [MessageType.ACCESS_RESPONSE]: ReplyMessageHeader;
  [MessageType.WORKSPACE_COUNT_CHANGED]: MessageHeader;
  [MessageType.CCLOUD_SCHEMA_REGISTRY_SCHEMAS]: MessageHeader;
  [MessageType.CCLOUD_KAFKA_TOPICS]: MessageHeader;
};

// Subset of message types that are request/response pairs.
export type RequestResponseMessageTypes = MessageType.ACCESS_REQUEST;

/** Relationships between request / response type pairs. */
export const RequestResponseTypeMap: { [key in RequestResponseMessageTypes]: MessageType } = {
  [MessageType.ACCESS_REQUEST]: MessageType.ACCESS_RESPONSE,
};
