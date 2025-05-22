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
    return new LanguageModelToolResult(summarizeTopics(sampleTopics));
  }
  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<TextOnlyToolResultPart> {
    const parameters = toolCall.input as IListTopicsParameters;
    const progressMessage = [
      "Retrieving available topics for:",
      `- Cluster ID: ${parameters.kafkaClusterId}`,
      `- Connection ID: ${parameters.connectionId}`,
      `- Environment ID: ${parameters.environmentId}`,
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
    logger.debug("Tool invocation listtopics result:", result);
    if (!result.content.length) {
      const noResultsMessage = new LanguageModelTextPart(
        `No topics found in cluster ${parameters.kafkaClusterId}. ` +
          `Make sure the cluster exists and you have the correct permissions.`,
      );
      resultParts.push(noResultsMessage);
      stream.progress("No topics found.");
      return new TextOnlyToolResultPart(toolCall.callId, resultParts);
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
