/**
 * Kafka module.
 *
 * Provides topic management services for Kafka clusters across different
 * connection types (CCloud, LOCAL, DIRECT) and runtime environments
 * (desktop VS Code, VS Code for Web).
 */

// Core types and interfaces
export type {
  CreateTopicOptions,
  ListTopicsOptions,
  PartitionInfo,
  TopicInfo,
  TopicService,
} from "./topicService";

// Error types
export { KafkaAdminError, KafkaAdminErrorCategory } from "./errors";

// Environment detection
export { isDesktopEnvironment, isWebEnvironment } from "./environment";

// Service implementations
export { getKafkaAdminTopicService, KafkaAdminTopicService } from "./kafkaAdminTopicService";
export { getRestApiTopicService, RestApiTopicService } from "./restApiTopicService";

// Factory and utilities
export {
  getTopicService,
  topicDataToTopicInfo,
  topicInfoToTopicData,
  type SimpleTopicData,
} from "./topicServiceFactory";

// Admin client management
export {
  AdminClientManager,
  disposeTopicServices,
  getAdminClientManager,
} from "./adminClientManager";

// SASL configuration
export { toSaslOptions } from "./saslConfig";

// Principal derivation for ACL evaluation
export { derivePrincipal, type PrincipalResult } from "./principalDerivation";

// ACL service for authorized operations
export { AclService, getAclService, TOPIC_OPERATIONS, type TopicAclResult } from "./aclService";
