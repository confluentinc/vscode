// Module defining the types used in messages between the topic-confit webview and the extension host.
import { type Data } from "dataclass";
import { KafkaTopic } from "../models/topic";

// Serialized form of a Kafka topic, with the data fields removed.
export type SimpleTopic = Omit<KafkaTopic, keyof Data>;
export const GETTOPIC = "GetTopic";

// An individual key/value pair representing a topic configuration setting.
export type TopicConfigSetting = Record<string, string>;

// A batch of topic configuration settings, either fetched or updated.
export type TopicConfigBatch = TopicConfigSetting[];
export const GETCONFIG = "GetConfig";
export const POSTCONFIG = "UpdateTopic";
