import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  Command,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
  MarkdownString,
} from "vscode";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "../../authn/constants";
import {
  Connection,
  ConnectionsList,
  ConnectionsResourceApi,
  ConnectionType,
} from "../../clients/sidecar";
import { ContextValues, getContextValue } from "../../context/values";
import { Logger } from "../../logging";
import { getConnectionLabel } from "../../models/resource";
import { getSidecar } from "../../sidecar";
import { titleCase } from "../../utils";
import { summarizeConnection } from "../summarizers/connections";
import { BaseLanguageModelTool, TextOnlyToolResultPart } from "./base";

const logger = new Logger("chat.tools.getConnections");

export interface IGetConnectionsParameters {
  connectionType: ConnectionType;
}

export class GetConnectionsTool extends BaseLanguageModelTool<IGetConnectionsParameters> {
  readonly name = "get_connections";

  foundConnectionTypes: ConnectionType[] = [];
  missingConnectionTypes: ConnectionType[] = [];

  async invoke(
    options: LanguageModelToolInvocationOptions<IGetConnectionsParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;

    // reset for each invocation
    this.foundConnectionTypes = [];
    this.missingConnectionTypes = [];

    // use the Connections API to get the list of connections
    const sidecar = await getSidecar();
    const client: ConnectionsResourceApi = sidecar.getConnectionsResourceApi();
    const connectionsList: ConnectionsList = await client.gatewayV1ConnectionsGet();

    // keep track of how many connections of each type there are in case we need to add hints to the
    // model to help the user connect to other resources
    const connectionCounts: Map<ConnectionType, number> = new Map([
      [ConnectionType.Ccloud, 0],
      [ConnectionType.Local, 0],
      [ConnectionType.Direct, 0],
    ]);

    // go through each connection type to determine whether to summarize the connection(s) or to
    // provide hints to the user
    const connectionStrings: LanguageModelTextPart[] = [];
    for (const connectionType of connectionCounts.keys()) {
      const connections: Connection[] = connectionsList.data.filter(
        (connection: Connection) => connection.spec.type === connectionType,
      );
      // keep general awareness of how many connections there are per type, even when filtering
      connectionCounts.set(connectionType, connections.length);
      if (params.connectionType && connectionType !== params.connectionType) {
        // if the model is filtering by connection type, skip any other types
        continue;
      }

      // explicitly ignore the LOCAL connection if Kafka isn't running so we can hint at
      // starting local resources
      if (connectionType === ConnectionType.Local) {
        const kafkaAvailable: boolean =
          getContextValue(ContextValues.localKafkaClusterAvailable) ?? false;
        if (!kafkaAvailable) {
          this.missingConnectionTypes.push(connectionType);
          continue;
        }
      }

      if (connections.length) {
        this.foundConnectionTypes.push(connectionType);
        // give each connection type its own markdown header
        const plural = connections.length === 1 ? "" : "s";
        let connectionGroupSummary = new MarkdownString(
          `\n## ${getConnectionLabel(connectionType)} Connection${plural} (${connections.length})`,
        );
        // then summarize each connection
        connections.forEach((connection: Connection) => {
          const connectionSummary: string = summarizeConnection(connection).trim();
          connectionGroupSummary = connectionGroupSummary.appendMarkdown(
            `\n\n${connectionSummary}`,
          );
        });
        connectionStrings.push(new LanguageModelTextPart(connectionGroupSummary.value));
      } else {
        // no connections of this type, so provide a hint to the model about how the user can connect
        this.missingConnectionTypes.push(connectionType);
      }
    }

    if (!connectionStrings.length) {
      connectionStrings.push(new LanguageModelTextPart("No connections available."));
    }

    if (token.isCancellationRequested) {
      logger.debug("Tool invocation cancelled");
      return new LanguageModelToolResult([]);
    }
    return new LanguageModelToolResult(connectionStrings);
  }

  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<TextOnlyToolResultPart> {
    const parameters = toolCall.input as IGetConnectionsParameters;
    if (!parameters.connectionType) {
      stream.progress(`Retrieving available connections with no connection type specified...`);
    } else {
      stream.progress(
        `Retrieving available connections for connectionType: ${parameters.connectionType}...`,
      );
    }

    // handle the core tool invocation
    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );
    if (!parameters.connectionType) {
      stream.progress(`Found ${result.content.length} connections.`);
    } else {
      stream.progress(
        `Found ${result.content.length} connections for connectionType: ${parameters.connectionType}.`,
      );
    }
    if (!result.content.length) {
      // cancellation / no results
      return new TextOnlyToolResultPart(toolCall.callId, []);
    }

    // format the results before sending them back to the model
    const resultParts: LanguageModelTextPart[] = [];

    if (this.foundConnectionTypes.length) {
      const resultsHeader = new LanguageModelTextPart(`Here are your available connections:`);
      resultParts.push(resultsHeader);
      resultParts.push(...(result.content as LanguageModelTextPart[]));
      // Add footer hint for providing the connection type/ID for looking up resource details
      const footerHint = new LanguageModelTextPart(
        "\nTo interact with these connections, use their IDs in follow-up tool calls, such as 'list_environments' or 'list_topics'.",
      );
      resultParts.push(footerHint);
    }

    if (parameters.connectionType && this.missingConnectionTypes.length) {
      stream.markdown(`**No ${getConnectionLabel(parameters.connectionType)} connection found.**`);

      // summarize missing connection types
      const missingTypes = this.missingConnectionTypes.map((ctype) => titleCase(ctype)).join(", ");
      const resultsHeader = new LanguageModelTextPart(
        `The following connection types are not available: ${missingTypes}.`,
      );
      resultParts.push(resultsHeader);

      // then add system-message hints about showing buttons for connecting
      let buttonInstructions = "Based on what the user is trying to accomplish, recommend:";
      if (this.missingConnectionTypes.includes(ConnectionType.Ccloud)) {
        buttonInstructions += `\n- Click the '${CCLOUD_SIGN_IN_BUTTON_LABEL}' button above to sign in to Confluent Cloud for managed Kafka services (recommended for production use cases)`;
        const ccloudCommand: Command = {
          command: "confluent.connections.ccloud.signIn",
          title: CCLOUD_SIGN_IN_BUTTON_LABEL,
        };
        stream.button(ccloudCommand);
      }
      if (this.missingConnectionTypes.includes(ConnectionType.Local)) {
        buttonInstructions +=
          "\n- Click the 'Start Local Resources' button above to launch a local development environment with Kafka and Schema Registry using Docker (ideal for learning and development)";
        const localCommand: Command = {
          command: "confluent.docker.startLocalResources",
          title: "Start Local Resources",
        };
        stream.button(localCommand);
      }
      if (this.missingConnectionTypes.includes(ConnectionType.Direct)) {
        buttonInstructions +=
          "\n- Click the 'Add New Connection' button above to connect to an existing Kafka cluster and/or Schema Registry instance (for Confluent Platform, self-managed clusters, or other Kafka deployments)";
        const directCommand: Command = {
          command: "confluent.connections.direct",
          title: "Add New Connection",
        };
        stream.button(directCommand);
      }
      const resultsFooter = new LanguageModelTextPart(buttonInstructions);
      resultParts.push(resultsFooter);
    }

    return new TextOnlyToolResultPart(toolCall.callId, resultParts);
  }
}
