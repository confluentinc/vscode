/** Module describing workspace<-->sidecar websocket messages. */

import { randomUUID } from "crypto";

/**
 * All websocket message types, message.header_type values.
 * Some come in request/response pairs, others are individual events, either
 * directed at a single workspace or to sidecar or broadcast to all workspaces.
 */
export enum MessageType {
  // Extension <--> Sidecar messages, audience=sidecar or audience=extension

  // access request/response
  ACCESS_REQUEST = "ACCESS_REQUEST",
  ACCESS_RESPONSE = "ACCESS_RESPONSE",

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
export interface MessageHeaders {
  /** Type of message. Dictates what the message body structure should be. */
  message_type: MessageType;

  /** The intended recipient(s): A single workspace, Sidecar, or all other workspaces. */
  audience: Audience;

  /** Originator of the message. Either the sending workspace's process id, or "sidecar". */
  originator: string;

  /** Stringified UUID4 uniquely identifying the message. */
  message_id: string;
}

export interface ReplyMessageHeaders extends MessageHeaders {
  /** Used to correlate responses to requests. Holds message_id value of the message being replied to. */
  response_to_id: string;
}

/** Construct and return either a MessageHeaders or ReplyMessageHeaders given the message type, audience, and possible response_to_id value. */
export function newMessageHeaders<T extends MessageType>(
  message_type: T,
  audience: Audience,
  response_to_id?: string,
): MessageHeaderMap[T] {
  return {
    message_type,
    audience,
    originator: process.pid.toString(),
    message_id: randomUUID().toString(),
    ...(response_to_id ? { response_to_id } : {}),
  } as MessageHeaderMap[T];
}

/**
 * Websocket message structure. Generic over the body payload whose structure
 * is determined by the message type.
 **/
export interface Message<T extends MessageType> {
  headers: MessageHeaderMap[T];
  body: MessageBodyMap[T];
}

/** A message whose headers carry field "response_to_id", indicating is a response message. */
export interface ResponseMessage<T extends MessageType> extends Message<T> {
  headers: ReplyMessageHeaders;
}

/**
 * Workspace -> sidecar access message body, sent immediately after websocket connection established.
 * Corresponds to message_type {@link MessageType.ACCESS_REQUEST}
 */
export interface AccessRequestBody {
  access_token: string;
}

/**
 * Sidecar -> Workspace message body, response to an access request message.
 * Corresponds to message_type {@link MessageType.ACCESS_RESPONSE}
 */
export interface AccessResponseBody {
  authorized: boolean;
  current_workspace_count: number;
}

/**
 * Sidecar -> workspaces message body, sent whenever the total number of authorized websocket connections to sidecar changes.
 * Corresponds to message_type {@link MessageType.WORKSPACE_COUNT_CHANGED}
 */
export interface WorkspacesChangedBody {
  current_workspace_count: number;
}

/** Type mapping of message type -> corresponding message body type */
type MessageBodyMap = {
  [MessageType.ACCESS_REQUEST]: AccessRequestBody;
  [MessageType.ACCESS_RESPONSE]: AccessResponseBody;
  [MessageType.WORKSPACE_COUNT_CHANGED]: WorkspacesChangedBody;
};

/**
 * Type mapping of message type -> corresponding headers type.
 * Dictates which messages whose headers should have `response_to_id` field.`
 */
type MessageHeaderMap = {
  [MessageType.ACCESS_REQUEST]: MessageHeaders;
  [MessageType.ACCESS_RESPONSE]: ReplyMessageHeaders;
  [MessageType.WORKSPACE_COUNT_CHANGED]: MessageHeaders;
};

// Subset of message types that are request/response pairs.
export type RequestResponseMessageTypes = MessageType.ACCESS_REQUEST;

/** Relationships between request / response type pairs. */
export type RequestResponseTypeMap = {
  [MessageType.ACCESS_REQUEST]: MessageType.ACCESS_RESPONSE;
};
