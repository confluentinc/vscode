import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  LanguageModelChatMessage,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
  MarkdownString,
} from "vscode";
import {
  CCloudStatus,
  Connection,
  ConnectionsList,
  ConnectionsResourceApi,
  ConnectionType,
  KafkaClusterConfig,
  SchemaRegistryConfig,
} from "../../clients/sidecar";
import { Logger } from "../../logging";
import { getSidecar } from "../../sidecar";
import { titleCase } from "../../utils";
import { BaseLanguageModelTool } from "./base";

const logger = new Logger("chat.tools.getConnections");

export interface IGetConnectionsParameters {
  connectionType: ConnectionType;
}

export class GetConnectionsTool extends BaseLanguageModelTool<IGetConnectionsParameters> {
  readonly name = "get_connections";
  readonly progressMessage = "Checking available connections...";

  async invoke(
    options: LanguageModelToolInvocationOptions<IGetConnectionsParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;
    logger.debug("params:", params);

    // use the Connections API to get the list of connections
    const sidecar = await getSidecar();
    const client: ConnectionsResourceApi = sidecar.getConnectionsResourceApi();
    const connections: ConnectionsList = await client.gatewayV1ConnectionsGet();

    const connectionStrings: LanguageModelTextPart[] = [];
    connections.data.forEach((connection: Connection) => {
      // filter connections by type
      if (params.connectionType && connection.spec.type !== params.connectionType) {
        return;
      }
      const connectionSummary: string = makeConnectionSummary(connection);
      connectionStrings.push(new LanguageModelTextPart(connectionSummary));
    });
    logger.debug(`connectionStrings:\n\n${connectionStrings.join("\n")}`);

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
  ): Promise<LanguageModelChatMessage[]> {
    const parameters = toolCall.input as IGetConnectionsParameters;

    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );

    const messages: LanguageModelChatMessage[] = [];
    if (result.content && Array.isArray(result.content)) {
      let message = `Below are the details of available connections for you to reference and summarize to the user:\n`;
      for (const part of result.content as LanguageModelTextPart[]) {
        message = `${message}\n\n${part.value}`;
      }
      messages.push(this.toolMessage(message, "result"));
    }
    logger.debug(
      `messages:\n\n${messages.map((msg) => `${msg.role} ${msg.name}: ${msg.content}`).join("\n")}`,
    );
    return messages;
  }
}

/** Create a string representation of a {@link Connection} object for usage by Copilot models. */
export function makeConnectionSummary(connection: Connection): string {
  const type: ConnectionType = connection.spec.type!;
  let summary = new MarkdownString().appendMarkdown(
    `# ${titleCase(type)} Connection: "${connection.spec.name}"`,
  );

  // add spec/status details depending on the connection type
  switch (type) {
    case ConnectionType.Ccloud: {
      const status: CCloudStatus = connection.status.ccloud!;
      summary = summary
        .appendMarkdown(`\n\n**State:** ${status.state}`)
        .appendMarkdown(
          `\n\n**Auth Session Expires At:** ${status.requires_authentication_at?.toString()}`,
        )
        .appendMarkdown(`(Sign-in link: ${connection.metadata.sign_in_uri})`);
      if (status.errors) {
        summary = summary
          .appendMarkdown(`\n\n**Errors:**`)
          .appendCodeblock(JSON.stringify(status.errors, null, 2), "json");
      }
      break;
    }
    case ConnectionType.Local: {
      // const config: LocalConfig = connection.spec.local_config!;
      summary = summary.appendMarkdown(`\n\n## Local Connection Status`);
      // TODO: look up Docker container details

      break;
    }
    case ConnectionType.Direct: {
      const kafkaConfig: KafkaClusterConfig | undefined = connection.spec.kafka_cluster;
      if (kafkaConfig) {
        summary = summary.appendMarkdown(
          `\n\n**Bootstrap Servers:** ${kafkaConfig.bootstrap_servers}`,
        );
      }

      const schemaRegistryConfig: SchemaRegistryConfig | undefined =
        connection.spec.schema_registry;
      if (schemaRegistryConfig) {
        summary = summary.appendMarkdown(
          `\n\n**Schema Registry URL:** ${schemaRegistryConfig.uri}`,
        );
      }

      break;
    }
  }
  return summary.value;
}
