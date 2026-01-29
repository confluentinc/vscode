import assert from "assert";
import sinon from "sinon";
import {
  AclOperationTypes,
  AclPermissionTypes,
  AclResourceTypes,
  ResourcePatternTypes,
  type Admin,
  type DescribeAclResponse,
} from "kafkajs";
import { CredentialType } from "../connections";
import { DirectKafkaCluster, type KafkaCluster } from "../models/kafkaCluster";
import { AclService, getAclService, TOPIC_OPERATIONS } from "./aclService";
import * as adminClientManager from "./adminClientManager";

describe("kafka/aclService", () => {
  let sandbox: sinon.SinonSandbox;
  let mockAdmin: sinon.SinonStubbedInstance<Admin>;
  let mockCluster: KafkaCluster;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    AclService.resetInstance();

    // Create mock admin client
    mockAdmin = {
      describeAcls: sandbox.stub(),
    } as unknown as sinon.SinonStubbedInstance<Admin>;

    // Stub getAdminClientManager to return our mock
    const mockManager = {
      getAdmin: sandbox.stub().resolves(mockAdmin),
    };
    sandbox.stub(adminClientManager, "getAdminClientManager").returns(mockManager as never);

    // Create mock cluster using DirectKafkaCluster.create()
    mockCluster = DirectKafkaCluster.create({
      connectionId: "conn-456" as never,
      id: "cluster-123",
      name: "Test Cluster",
      bootstrapServers: "localhost:9092",
    });
  });

  afterEach(() => {
    sandbox.restore();
    AclService.resetInstance();
  });

  describe("getAclService", () => {
    it("should return singleton instance", () => {
      const instance1 = getAclService();
      const instance2 = getAclService();
      assert.strictEqual(instance1, instance2);
    });
  });

  describe("getTopicAuthorizedOperations", () => {
    it("should return aclsAvailable: false when credentials cannot derive principal", async () => {
      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "test-topic", {
        type: CredentialType.OAUTH,
        tokensUrl: "https://auth.example.com/token",
        clientId: "client-id",
      });

      assert.strictEqual(result.aclsAvailable, false);
      assert.strictEqual(result.authorizedOperations.length, 0);
      assert.ok(result.error?.includes("OAuth"));
    });

    it("should return all operations when no ACLs are configured", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [],
      } as DescribeAclResponse);

      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "test-topic", {
        type: CredentialType.BASIC,
        username: "alice",
        password: "secret",
      });

      assert.strictEqual(result.aclsAvailable, true);
      assert.deepStrictEqual(result.authorizedOperations.sort(), [...TOPIC_OPERATIONS].sort());
    });

    it("should return all operations when no ACLs match the topic", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [
          {
            resourceType: AclResourceTypes.TOPIC,
            resourceName: "other-topic",
            resourcePatternType: ResourcePatternTypes.LITERAL,
            acls: [
              {
                principal: "User:alice",
                host: "*",
                operation: AclOperationTypes.READ,
                permissionType: AclPermissionTypes.ALLOW,
              },
            ],
          },
        ],
      } as DescribeAclResponse);

      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "test-topic", {
        type: CredentialType.BASIC,
        username: "alice",
        password: "secret",
      });

      assert.strictEqual(result.aclsAvailable, true);
      assert.deepStrictEqual(result.authorizedOperations.sort(), [...TOPIC_OPERATIONS].sort());
    });

    it("should return allowed operations for matching ACLs", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [
          {
            resourceType: AclResourceTypes.TOPIC,
            resourceName: "test-topic",
            resourcePatternType: ResourcePatternTypes.LITERAL,
            acls: [
              {
                principal: "User:alice",
                host: "*",
                operation: AclOperationTypes.READ,
                permissionType: AclPermissionTypes.ALLOW,
              },
              {
                principal: "User:alice",
                host: "*",
                operation: AclOperationTypes.WRITE,
                permissionType: AclPermissionTypes.ALLOW,
              },
            ],
          },
        ],
      } as DescribeAclResponse);

      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "test-topic", {
        type: CredentialType.BASIC,
        username: "alice",
        password: "secret",
      });

      assert.strictEqual(result.aclsAvailable, true);
      assert.deepStrictEqual(result.authorizedOperations.sort(), ["READ", "WRITE"]);
    });

    it("should apply DENY precedence over ALLOW", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [
          {
            resourceType: AclResourceTypes.TOPIC,
            resourceName: "test-topic",
            resourcePatternType: ResourcePatternTypes.LITERAL,
            acls: [
              {
                principal: "User:alice",
                host: "*",
                operation: AclOperationTypes.READ,
                permissionType: AclPermissionTypes.ALLOW,
              },
              {
                principal: "User:alice",
                host: "*",
                operation: AclOperationTypes.WRITE,
                permissionType: AclPermissionTypes.ALLOW,
              },
              {
                principal: "User:alice",
                host: "*",
                operation: AclOperationTypes.WRITE,
                permissionType: AclPermissionTypes.DENY,
              },
            ],
          },
        ],
      } as DescribeAclResponse);

      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "test-topic", {
        type: CredentialType.BASIC,
        username: "alice",
        password: "secret",
      });

      assert.strictEqual(result.aclsAvailable, true);
      assert.deepStrictEqual(result.authorizedOperations, ["READ"]);
    });

    it("should match wildcard principal User:*", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [
          {
            resourceType: AclResourceTypes.TOPIC,
            resourceName: "test-topic",
            resourcePatternType: ResourcePatternTypes.LITERAL,
            acls: [
              {
                principal: "User:*",
                host: "*",
                operation: AclOperationTypes.READ,
                permissionType: AclPermissionTypes.ALLOW,
              },
            ],
          },
        ],
      } as DescribeAclResponse);

      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "test-topic", {
        type: CredentialType.BASIC,
        username: "bob",
        password: "secret",
      });

      assert.strictEqual(result.aclsAvailable, true);
      assert.deepStrictEqual(result.authorizedOperations, ["READ"]);
    });

    it("should match wildcard topic *", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [
          {
            resourceType: AclResourceTypes.TOPIC,
            resourceName: "*",
            resourcePatternType: ResourcePatternTypes.LITERAL,
            acls: [
              {
                principal: "User:alice",
                host: "*",
                operation: AclOperationTypes.DESCRIBE,
                permissionType: AclPermissionTypes.ALLOW,
              },
            ],
          },
        ],
      } as DescribeAclResponse);

      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "any-topic", {
        type: CredentialType.BASIC,
        username: "alice",
        password: "secret",
      });

      assert.strictEqual(result.aclsAvailable, true);
      assert.deepStrictEqual(result.authorizedOperations, ["DESCRIBE"]);
    });

    it("should match prefixed topic patterns", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [
          {
            resourceType: AclResourceTypes.TOPIC,
            resourceName: "test-",
            resourcePatternType: ResourcePatternTypes.PREFIXED,
            acls: [
              {
                principal: "User:alice",
                host: "*",
                operation: AclOperationTypes.READ,
                permissionType: AclPermissionTypes.ALLOW,
              },
            ],
          },
        ],
      } as DescribeAclResponse);

      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "test-topic", {
        type: CredentialType.BASIC,
        username: "alice",
        password: "secret",
      });

      assert.strictEqual(result.aclsAvailable, true);
      assert.deepStrictEqual(result.authorizedOperations, ["READ"]);
    });

    it("should expand ALL operation to all topic operations", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [
          {
            resourceType: AclResourceTypes.TOPIC,
            resourceName: "test-topic",
            resourcePatternType: ResourcePatternTypes.LITERAL,
            acls: [
              {
                principal: "User:admin",
                host: "*",
                operation: AclOperationTypes.ALL,
                permissionType: AclPermissionTypes.ALLOW,
              },
            ],
          },
        ],
      } as DescribeAclResponse);

      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "test-topic", {
        type: CredentialType.BASIC,
        username: "admin",
        password: "secret",
      });

      assert.strictEqual(result.aclsAvailable, true);
      assert.deepStrictEqual(result.authorizedOperations.sort(), [...TOPIC_OPERATIONS].sort());
    });

    it("should return empty operations when principal has no matching ACLs", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [
          {
            resourceType: AclResourceTypes.TOPIC,
            resourceName: "test-topic",
            resourcePatternType: ResourcePatternTypes.LITERAL,
            acls: [
              {
                principal: "User:bob",
                host: "*",
                operation: AclOperationTypes.READ,
                permissionType: AclPermissionTypes.ALLOW,
              },
            ],
          },
        ],
      } as DescribeAclResponse);

      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "test-topic", {
        type: CredentialType.BASIC,
        username: "alice",
        password: "secret",
      });

      assert.strictEqual(result.aclsAvailable, true);
      assert.deepStrictEqual(result.authorizedOperations, []);
    });

    it("should cache results and return cached value on subsequent calls", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [
          {
            resourceType: AclResourceTypes.TOPIC,
            resourceName: "test-topic",
            resourcePatternType: ResourcePatternTypes.LITERAL,
            acls: [
              {
                principal: "User:alice",
                host: "*",
                operation: AclOperationTypes.READ,
                permissionType: AclPermissionTypes.ALLOW,
              },
            ],
          },
        ],
      } as DescribeAclResponse);

      const service = getAclService();
      const credentials = {
        type: CredentialType.BASIC as const,
        username: "alice",
        password: "secret",
      };

      // First call
      await service.getTopicAuthorizedOperations(mockCluster, "test-topic", credentials);

      // Second call should use cache
      await service.getTopicAuthorizedOperations(mockCluster, "test-topic", credentials);

      // describeAcls should only be called once
      assert.strictEqual(mockAdmin.describeAcls.callCount, 1);
    });

    it("should handle describeAcls errors gracefully", async () => {
      mockAdmin.describeAcls.rejects(new Error("Connection refused"));

      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "test-topic", {
        type: CredentialType.BASIC,
        username: "alice",
        password: "secret",
      });

      assert.strictEqual(result.aclsAvailable, false);
      assert.strictEqual(result.authorizedOperations.length, 0);
      assert.ok(result.error?.includes("Connection refused"));
    });

    it("should handle SECURITY_DISABLED error", async () => {
      mockAdmin.describeAcls.rejects(new Error("SECURITY_DISABLED: ACLs are not supported"));

      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "test-topic", {
        type: CredentialType.BASIC,
        username: "alice",
        password: "secret",
      });

      assert.strictEqual(result.aclsAvailable, false);
      assert.ok(result.error?.includes("not available"));
    });

    it("should handle response with error code", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 35, // AUTHORIZATION_FAILED
        errorMessage: "Not authorized to describe ACLs",
        resources: [],
      } as DescribeAclResponse);

      const service = getAclService();
      const result = await service.getTopicAuthorizedOperations(mockCluster, "test-topic", {
        type: CredentialType.BASIC,
        username: "alice",
        password: "secret",
      });

      assert.strictEqual(result.aclsAvailable, false);
      assert.ok(result.error?.includes("Not authorized"));
    });
  });

  describe("getTopicsAuthorizedOperations", () => {
    it("should return results for multiple topics", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [
          {
            resourceType: AclResourceTypes.TOPIC,
            resourceName: "topic-a",
            resourcePatternType: ResourcePatternTypes.LITERAL,
            acls: [
              {
                principal: "User:alice",
                host: "*",
                operation: AclOperationTypes.READ,
                permissionType: AclPermissionTypes.ALLOW,
              },
            ],
          },
          {
            resourceType: AclResourceTypes.TOPIC,
            resourceName: "topic-b",
            resourcePatternType: ResourcePatternTypes.LITERAL,
            acls: [
              {
                principal: "User:alice",
                host: "*",
                operation: AclOperationTypes.WRITE,
                permissionType: AclPermissionTypes.ALLOW,
              },
            ],
          },
        ],
      } as DescribeAclResponse);

      const service = getAclService();
      const results = await service.getTopicsAuthorizedOperations(
        mockCluster,
        ["topic-a", "topic-b"],
        {
          type: CredentialType.BASIC,
          username: "alice",
          password: "secret",
        },
      );

      assert.strictEqual(results.size, 2);
      assert.deepStrictEqual(results.get("topic-a")?.authorizedOperations, ["READ"]);
      assert.deepStrictEqual(results.get("topic-b")?.authorizedOperations, ["WRITE"]);
    });

    it("should use cached results for some topics", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [
          {
            resourceType: AclResourceTypes.TOPIC,
            resourceName: "topic-a",
            resourcePatternType: ResourcePatternTypes.LITERAL,
            acls: [
              {
                principal: "User:alice",
                host: "*",
                operation: AclOperationTypes.READ,
                permissionType: AclPermissionTypes.ALLOW,
              },
            ],
          },
        ],
      } as DescribeAclResponse);

      const service = getAclService();
      const credentials = {
        type: CredentialType.BASIC as const,
        username: "alice",
        password: "secret",
      };

      // Pre-cache topic-a
      await service.getTopicAuthorizedOperations(mockCluster, "topic-a", credentials);

      // Now request both topics
      const results = await service.getTopicsAuthorizedOperations(
        mockCluster,
        ["topic-a", "topic-b"],
        credentials,
      );

      assert.strictEqual(results.size, 2);
      // topic-a should come from cache, topic-b queried fresh
      // describeAcls called once for pre-cache, once for topic-b
      assert.strictEqual(mockAdmin.describeAcls.callCount, 2);
    });
  });

  describe("clearCacheForCluster", () => {
    it("should clear cache entries for specific cluster", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [],
      } as DescribeAclResponse);

      const service = getAclService();
      const credentials = {
        type: CredentialType.BASIC as const,
        username: "alice",
        password: "secret",
      };

      // Cache a result
      await service.getTopicAuthorizedOperations(mockCluster, "test-topic", credentials);

      // Clear cache for cluster
      service.clearCacheForCluster(mockCluster);

      // Next call should query again
      await service.getTopicAuthorizedOperations(mockCluster, "test-topic", credentials);

      assert.strictEqual(mockAdmin.describeAcls.callCount, 2);
    });
  });

  describe("clearCache", () => {
    it("should clear all cache entries", async () => {
      mockAdmin.describeAcls.resolves({
        throttleTime: 0,
        errorCode: 0,
        resources: [],
      } as DescribeAclResponse);

      const service = getAclService();
      const credentials = {
        type: CredentialType.BASIC as const,
        username: "alice",
        password: "secret",
      };

      // Cache results
      await service.getTopicAuthorizedOperations(mockCluster, "topic-a", credentials);
      await service.getTopicAuthorizedOperations(mockCluster, "topic-b", credentials);

      // Clear all cache
      service.clearCache();

      // Next calls should query again
      await service.getTopicAuthorizedOperations(mockCluster, "topic-a", credentials);
      await service.getTopicAuthorizedOperations(mockCluster, "topic-b", credentials);

      // 2 initial + 2 after clear = 4
      assert.strictEqual(mockAdmin.describeAcls.callCount, 4);
    });
  });
});
