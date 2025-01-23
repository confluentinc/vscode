/** Sample test suite spellings of complex websocket messages */

import { ConnectionEventAction, Message, MessageType } from "../../../src/ws/messageTypes";

export const GOOD_CCLOUD_CONNECTION_EVENT_MESSAGE: Message<MessageType.CONNECTION_EVENT> = {
  headers: {
    message_type: MessageType.CONNECTION_EVENT,
    originator: "sidecar",
    message_id: "1",
  },
  body: {
    action: ConnectionEventAction.CONNECTED,
    connection: {
      api_version: "gateway/v1",
      kind: "Connection",
      id: "vscode-confluent-cloud-connection",
      metadata: {
        resource_name: undefined,
        self: "http://localhost:26636/gateway/v1/connections/vscode-confluent-cloud-connection",
        sign_in_uri: "https://login.confluent.io/oauth/authorize?...",
      },
      spec: {
        id: "vscode-confluent-cloud-connection",
        name: "Confluent Cloud",
        type: "CCLOUD",
        ccloud_config: {
          organization_id: undefined,
          ide_auth_callback_uri: "vscode://confluentinc.vscode-confluent/authCallback",
        },
        kafka_cluster: undefined,
        local_config: undefined,
        schema_registry: undefined,
      },
      status: {
        authentication: {
          status: "VALID_TOKEN",
          user: {
            id: "u-n9dv06",
            username: "foo@bar.com",
            first_name: "Foo",
            last_name: "Bar",
            social_connection: "",
            auth_type: "AUTH_TYPE_LOCAL",
          },
          requires_authentication_at: new Date("2025-01-24T04:25:01.242072Z"),
          errors: undefined,
        },
        ccloud: {
          state: "SUCCESS",
          user: {
            id: "u-n3234",
            username: "foo@bar.com",
            first_name: "Foo",
            last_name: "Bar",
            social_connection: "",
            auth_type: "AUTH_TYPE_LOCAL",
          },
          requires_authentication_at: new Date("2025-01-24T04:25:01.242072Z"),
          errors: undefined,
        },
        kafka_cluster: undefined,
        schema_registry: undefined,
      },
    },
  },
};
