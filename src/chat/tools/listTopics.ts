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
import { ConnectionId, EnvironmentId } from "../../models/resource";
import { KafkaTopic } from "../../models/topic";
import { summarizeTopic } from "../summarizers/topics";
import { BaseLanguageModelTool, TextOnlyToolResultPart } from "./base";

const logger = new Logger("chat.tools.listTopics");

export interface IListTopicsParameters {
  kafkaClusterId: string;
  environmentId: string;
  topicNameSubstring?: string;
  connectionId: string;
}

export class ListTopicsTool extends BaseLanguageModelTool<IListTopicsParameters> {
  readonly name = "list_topics";
  async invoke(
    options: LanguageModelToolInvocationOptions<IListTopicsParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;

    const connectionId = params.connectionId as ConnectionId;
    if (!connectionId) {
      return new LanguageModelToolResult([new LanguageModelTextPart("No connection ID provided.")]);
    }

    let environmentId = params.environmentId as EnvironmentId;
    if (!environmentId) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart("No environment ID provided."),
      ]);
    }

    let kafkaClusterId = params.kafkaClusterId;
    if (!kafkaClusterId) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart("No Kafka cluster ID provided."),
      ]);
    }

    // Handle cases where all IDs are the same (local setup)
    if (kafkaClusterId === environmentId) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `Kafka cluster ID and environment ID are the same (${kafkaClusterId}). Please use get_environments to retrieve the Kafka cluster ID.`,
        ),
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
        new LanguageModelTextPart(
          `No Kafka cluster found for the given ID (${kafkaClusterId}). Available clusters: ${kafkaClusters
            .map((c) => c.id)
            .join(", ")}`,
        ),
      ]);
    }

    const topics = await loader.getTopicsForCluster(kafkaCluster);
    if (!(Array.isArray(topics) && topics.length)) {
      logger.debug(`No topics found for cluster ${kafkaClusterId}`);
      return new LanguageModelToolResult([
        new LanguageModelTextPart("No topics found for the given Kafka cluster."),
      ]);
    }

    let sampleTopics: KafkaTopic[] = [...topics]; // Create a copy of the topics array
    const topicNameSubstring = params.topicNameSubstring;

    if (topicNameSubstring) {
      sampleTopics = sampleTopics.filter((topic) =>
        topic.name.toLowerCase().includes(topicNameSubstring.toLowerCase()),
      );
      logger.debug(
        `Filtered topics by substring "${topicNameSubstring}": ${sampleTopics.length} matches`,
      );
    }

    // if sample topics is more than 30, slice it to 30
    if (sampleTopics.length > 30) {
      sampleTopics = sampleTopics.slice(0, 30);
      logger.debug(`Limited topics to 30 samples`);
    }

    if (token.isCancellationRequested) {
      logger.debug("Tool invocation cancelled");
      return new LanguageModelToolResult([]);
    }

    logger.debug(`Summarizing ${sampleTopics.length} topics`);
    const topicTextParts: LanguageModelTextPart[] = sampleTopics.map((topic) => {
      const topicSummary = summarizeTopic(topic);
      return new LanguageModelTextPart(topicSummary);
    });
    return new LanguageModelToolResult(topicTextParts);
  }
  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<TextOnlyToolResultPart> {
    const parameters = toolCall.input as IListTopicsParameters;
    const progressMessage = [
      `Retrieving available topics for Cluster ID: ${parameters.kafkaClusterId}`,
    ];

    if (parameters.topicNameSubstring) {
      progressMessage.push(`- Filter: "${parameters.topicNameSubstring}"`);
    }

    stream.progress(progressMessage.join("\n"));

    // handle the core tool invocation
    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );

    // format the results before sending them back to the model
    const resultParts: LanguageModelTextPart[] = [];

    if (!result.content.length) {
      return new TextOnlyToolResultPart(toolCall.callId, []);
    }

    stream.progress(`Found ${result.content.length} topics.`);

    // Add header for successful results
    const resultsHeader = new LanguageModelTextPart(
      `Found ${result.content.length} topics in cluster ${parameters.kafkaClusterId}:\n`,
    );
    resultParts.push(resultsHeader);
    // Add content
    resultParts.push(...(result.content as LanguageModelTextPart[]));

    return new TextOnlyToolResultPart(toolCall.callId, resultParts);
  }
}
