import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from "vscode";
import { ResourceLoader } from "../../loaders";
import { Logger } from "../../logging";
import { KafkaCluster } from "../../models/kafkaCluster";
import { ConnectionId } from "../../models/resource";
import { KafkaTopic } from "../../models/topic";
import { summarizeTopics } from "../summarizers/topics";
import { BaseLanguageModelTool, TextOnlyToolResultPart } from "./base";

const logger = new Logger("chat.tools.listTemplates");

export interface IListTopicsParameters {
  kafkaClusterId: string;
  environmentId: string;
  topicNameSubstring?: string;
  connectionId: string;
}

export class ListTopicsTool extends BaseLanguageModelTool<IListTopicsParameters> {
  readonly name = "list_Topics";

  async invoke(
    options: LanguageModelToolInvocationOptions<IListTopicsParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;

    const connectionId = params.connectionId as ConnectionId;
    if (!connectionId) {
      return new LanguageModelToolResult([new LanguageModelTextPart("No connection ID provided.")]);
    }

    const environmentId = params.environmentId;
    if (!environmentId) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart("No environment ID provided."),
      ]);
    }

    const kafkaClusterId = params.kafkaClusterId;
    if (!kafkaClusterId) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart("No Kafka cluster ID provided."),
      ]);
    }

    const loader = ResourceLoader.getInstance(connectionId);

    const kafkaClusters: KafkaCluster[] =
      await loader.getKafkaClustersForEnvironmentId(environmentId);

    if (!(Array.isArray(kafkaClusters) && kafkaClusters.length)) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart("No Kafka clusters found for the given environment ID."),
      ]);
    }
    const kafkaCluster = kafkaClusters.find((cluster) => cluster.id === kafkaClusterId);
    if (!kafkaCluster) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart("No Kafka cluster found for the given ID."),
      ]);
    }

    const topics = await loader.getTopicsForCluster(kafkaCluster);
    if (!(Array.isArray(topics) && topics.length)) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart("No topics found for the given Kafka cluster."),
      ]);
    }

    let sampleTopics: KafkaTopic[] = [];
    const topicNameSubstring = params.topicNameSubstring;

    if (topicNameSubstring) {
      const filteredTopics = topics.filter((topic) =>
        topic.name.toLowerCase().includes(topicNameSubstring.toLowerCase()),
      );
      sampleTopics.push(...filteredTopics);
    }

    // if sample topics is more than 30, slice it to 30
    if (sampleTopics.length > 30) {
      sampleTopics = sampleTopics.slice(0, 30);
    }

    if (token.isCancellationRequested) {
      logger.debug("Tool invocation cancelled");
      return new LanguageModelToolResult([]);
    }

    return new LanguageModelToolResult(summarizeTopics(sampleTopics));
  }
  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<TextOnlyToolResultPart> {
    const parameters = toolCall.input as IListTopicsParameters;
    stream.progress(
      `Retrieving available topics with parameters: ${JSON.stringify(parameters)}...`,
    );

    // handle the core tool invocation
    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );
    stream.progress(`Found ${result.content.length} topics.`);
    if (!result.content.length) {
      // cancellation / no results
      return new TextOnlyToolResultPart(toolCall.callId, []);
    }

    // format the results before sending them back to the model
    const resultParts: LanguageModelTextPart[] = [];

    // Add header
    const resultsHeader = new LanguageModelTextPart(
      `Found ${result.content.length} topics in cluster ${parameters.kafkaClusterId}:\n`,
    );
    resultParts.push(resultsHeader);

    // Add content
    resultParts.push(...(result.content as LanguageModelTextPart[]));

    // Add footer
    const resultsFooter = new LanguageModelTextPart(
      `List up to 30 topic with relevant info on them (names, schema registry info) for the user. 
    1. First, call the getConnections tool to get the connection ID.
    2. Then, use the connection ID to set up the resource loader and eventually get the topics.`,
    );
    resultParts.push(resultsFooter);

    return new TextOnlyToolResultPart(toolCall.callId, resultParts);
  }
}
