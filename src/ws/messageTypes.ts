/** All known websocket message types, message.header.type values. */
export enum MessageType {
  // Extension <--> Sidecar messages, audience=sidecar or audience=extension

  // access request/response
  ACCESS_REQUEST = "ACCESS_REQUEST",
  ACCESS_RESPONSE = "ACCESS_RESPONSE",

  // When a new workspace is granted access, sidecar sends this message to all of the
  // other workspaces along with message body type WorkspacesChangedBody describing
  // the new workspace's process id.
  ADDED_WORKSPACE = "ADDED_WORKSPACE",

  // When a workspace is closed, sidecar sends this message to all of the other
  // workspaces along with message body type WorkspacesChangedBody describing
  // the closed workspace's process id.
  CLOSED_WORKSPACE = "REMOVED_WORKSPACE",

  // Extension <--> Extension messages, audience=extensions
  HELLO = "HELLO",
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

export interface MessageHeader {
  message_type: MessageType;
  audience: Audience;
  originator: string;
  message_id: string;
  response_to_id?: string | undefined;
}

export interface Message<T> {
  headers: MessageHeader;
  body: T;
}

export interface AccessRequestBody {
  access_token: string;
}

export interface AccessResponseBody {
  authorized: boolean;
}

export interface HelloBody {
  message: string;
}

export interface WorkspacesChangedBody {
  workspace_pid: number;
}
