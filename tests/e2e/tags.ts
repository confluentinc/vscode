/** {@see https://playwright.dev/docs/test-annotations#tag-tests} */
export enum Tag {
  Smoke = "@smoke",

  // Connection-specific tags

  /** Tests that require a CCloud connection to be set up and authenticated */
  CCloud = "@ccloud",
  /** Tests that require a direct connection to be set up */
  Direct = "@direct",
  /** Tests that require a local connection to be set up */
  Local = "@local",

  // Critical User Journey tags

  /** Tests that list Kafka topics, then view messages for a topic. */
  TopicMessageViewer = "@topic-message-viewer",
  /** Tests that create an initial subject and schema version, then update it to create another schema version. */
  EvolveSchema = "@evolve-schema",
  /** Tests that produce a message to a Kafka topic, with and without an associated schema. */
  ProduceMessageToTopic = "@produce-message-to-topic",
  /** Tests that generate streaming app project from one of our templates. */
  ProjectScaffolding = "@project-scaffolding",
  /** Tests that create and submit different kinds of Flink SQL statements. */
  FlinkStatements = "@flink-statements",
  /** Tests that create, edit, export, delete, and import direct connections. */
  DirectConnectionCRUD = "@direct-connection-crud",
  /** Tests that upload and delete Flink artifacts. */
  FlinkArtifacts = "@flink-artifacts",

  // Resource-/fixture-specific tags

  /** Tests that require a Kafka Topic to be set up before running. */
  RequiresTopic = "@requires-topic",
}
