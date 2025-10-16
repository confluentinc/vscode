import * as assert from "assert";
import { graphql } from "gql.tada";
import "mocha";
import sinon from "sinon";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { BASE_PATH as SCAFFOLDING_SERVICE_BASE_PATH } from "../clients/scaffoldingService";
import { MicroProfileHealthApi, ResponseError } from "../clients/sidecar";
import * as constants from "../constants";
import * as notifications from "../notifications";
import * as sidecar from "../sidecar";
import type { Message } from "../ws/messageTypes";
import { MessageType, newMessageHeaders } from "../ws/messageTypes";
import { SIDECAR_PROCESS_ID_HEADER } from "./constants";
import type { GraphQLResponse } from "./sidecarHandle";
import { WebsocketManager } from "./websocketManager";

describe("getSidecarPid() tests", () => {
  let sandbox: sinon.SinonSandbox;
  let mockClient: sinon.SinonStubbedInstance<MicroProfileHealthApi>;
  let sidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // create the stubs for the sidecar + service client
    sidecarHandle = sandbox.createStubInstance(sidecar.SidecarHandle);
    mockClient = sandbox.createStubInstance(MicroProfileHealthApi);

    sidecarHandle.getMicroProfileHealthApi.returns(mockClient);

    // Want to call through to the actual implementation of getSidecarPid
    sidecarHandle.getSidecarPid.callThrough();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("getSidecarPid() should return the sidecar pid when health check rejection includes header", async function () {
    mockClient.microprofileHealthLiveness.throws(
      new ResponseError(
        new Response(null, {
          headers: new Headers([[SIDECAR_PROCESS_ID_HEADER, "1234"]]),
          status: 401,
          statusText: "Wrong access token",
        }),
      ),
    );

    const pid = await sidecarHandle.getSidecarPid();
    assert.strictEqual(pid, 1234);
  });

  it("getSidecarPid() should raise exception if claimed pid <= 1 or not an integer", async function () {
    for (const badPidStr of ["-1", "0", "notAnInt"]) {
      mockClient.microprofileHealthLiveness.throws(
        new ResponseError(
          new Response(null, {
            headers: new Headers([[SIDECAR_PROCESS_ID_HEADER, badPidStr]]),
            status: 401,
            statusText: "Wrong access token",
          }),
        ),
      );

      console.log("Trying bad pid: " + badPidStr);

      await assert.rejects(sidecarHandle.getSidecarPid(), /Failed to parse sidecar PID/);
    }
  });

  it("getSidecarPid() should raise exception if health check rejection does not include header", async function () {
    mockClient.microprofileHealthLiveness.throws(
      new ResponseError(
        new Response(null, {
          status: 401,
          statusText: "Wrong access token",
        }),
      ),
    );

    await assert.rejects(
      sidecarHandle.getSidecarPid(),
      /Failed to get sidecar PID: unexpected error/,
    );
  });

  it("getSidecarPid() should raise exception if health check rejection is not a ResponseError", async function () {
    mockClient.microprofileHealthLiveness.throws(new Error("Some other error"));

    await assert.rejects(sidecarHandle.getSidecarPid(), /Some other error/);
  });

  // This one is for us here at home.
  it("getSidecarPid() should raise exception if microprofileHealthLiveness() call succeeds (quarkus dev mode)", async function () {
    mockClient.microprofileHealthLiveness.resolves({});

    await assert.rejects(
      sidecarHandle.getSidecarPid(),
      /Failed to get sidecar PID: healthcheck did not raise 401 Unauthorized/,
    );
  });
});

describe("sidecarHandle websocket tests", () => {
  before(async () => {
    await getTestExtensionContext();
  });

  describe("wsSend() tests", () => {
    it("wsSend() hates messages with wrong originator", async () => {
      const badOriginatorMessage: Message<MessageType.WORKSPACE_HELLO> = {
        headers: {
          message_type: MessageType.WORKSPACE_HELLO,
          originator: "bad",
          message_id: "1",
        },
        body: {
          workspace_id: 1234,
        },
      };

      const handle = await sidecar.getSidecar();

      assert.throws(
        () => {
          handle.wsSend(badOriginatorMessage);
        },
        {
          message: `Expected message originator to be '${process.pid}', got 'bad'`,
        },
      );
    });

    it("wsSend() works with good message when connected", async () => {
      const goodMessage: Message<MessageType.WORKSPACE_HELLO> = {
        headers: newMessageHeaders(MessageType.WORKSPACE_HELLO),
        body: {
          workspace_id: 1234,
        },
      };

      const handle = await sidecar.getSidecar();

      // wsSend() will actually send message to sidecar, which will then
      // at this time consider relaying it to other workspaces,
      // but there aren't any, so will just evaporate there.

      // If/when sidecar message routing gets smarter and perhaps needs
      // a different message type to tickle that behavior (when we have
      // them), then we will need to switch this message type for this test.

      handle.wsSend(goodMessage);
    });
  });

  describe("wsSend() when disconnected tests", () => {
    const websocketManager = WebsocketManager.getInstance();

    after(async () => {
      // restore the websocket as side-effect of getting sidecar handle
      await sidecar.getSidecar();
      assert.equal(true, websocketManager.isConnected());
    });

    it("wsSend() should raise exception when disconnected", async () => {
      const message: Message<MessageType.WORKSPACE_HELLO> = {
        headers: newMessageHeaders(MessageType.WORKSPACE_HELLO),
        body: {
          workspace_id: process.pid,
        },
      };

      const handle = await sidecar.getSidecar();

      // Disconnect the websocket after having gotten the sidecar handle
      websocketManager.dispose();
      assert.equal(false, websocketManager.isConnected());

      // Act
      // Assert raises
      assert.throws(
        () => {
          handle.wsSend(message);
        },
        {
          message: "Websocket closed",
        },
      );
    });
  });
});

describe("sidecarHandle sandbox tests", () => {
  let handle: sidecar.SidecarHandle;
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    handle = await sidecar.getSidecar();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("sidecarHandle Flink API method tests", () => {
    it("constructFlinkDataPlaneClientHeaders() should return headers with correct values", async () => {
      const headers = handle.constructFlinkDataPlaneClientHeaders(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(headers["x-connection-id"], TEST_CCLOUD_FLINK_COMPUTE_POOL.connectionId);
      assert.strictEqual(headers["x-ccloud-provider"], TEST_CCLOUD_FLINK_COMPUTE_POOL.provider);
      assert.strictEqual(headers["x-ccloud-region"], TEST_CCLOUD_FLINK_COMPUTE_POOL.region);
    });

    it("getFlinkSqlStatementsApi() should return a FlinkSqlStatementsApi instance given a sample flink compute pool", async () => {
      const api = handle.getFlinkSqlStatementsApi(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(api.constructor.name, "StatementsSqlV1Api");
    });

    it("getFlinkArtifactsApi() should return a FlinkArtifactsApi instance given a provider region", async () => {
      const api = handle.getFlinkArtifactsApi(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      assert.strictEqual(api.constructor.name, "FlinkArtifactsArtifactV1Api");
    });

    it("getRegionsFcpmV2Api() should return a RegionsFcpmV2Api instance", async () => {
      const api = handle.getRegionsFcpmV2Api();
      assert.strictEqual(api.constructor.name, "RegionsFcpmV2Api");
    });
  });
  describe("query()", () => {
    let fetchStub: sinon.SinonStub;

    const organizationQuery = graphql(`
      query connectionById($id: String!) {
        ccloudConnectionById(id: $id) {
          organizations {
            id
            name
            current
          }
        }
      }
    `);

    const happyQueryResponseObj: GraphQLResponse = {
      data: {
        ccloudConnectionById: { organizations: [{ id: "123", name: "foo", current: true }] },
      },
    };

    beforeEach(() => {
      fetchStub = sandbox.stub(global, "fetch");

      // By default, happiness.
      fetchStub.resolves({
        ok: true,
        json: async () => happyQueryResponseObj,
      } as Response);
    });

    describe("partial errors tests", () => {
      let showWarningNotificationWithButtonsStub: sinon.SinonStub;

      beforeEach(() => {
        showWarningNotificationWithButtonsStub = sandbox.stub(
          notifications,
          "showWarningNotificationWithButtons",
        );
      });

      it("should return data and show warning if response has both data and single error and showPartialErrors is true", async () => {
        const responseWithErrors: GraphQLResponse = {
          data: {
            ccloudConnectionById: { organizations: [{ id: "123", name: "foo", current: true }] },
          },
          errors: [{ message: "Some error occurred" }],
        };

        fetchStub.resolves({
          ok: true,
          json: async () => responseWithErrors,
        } as Response);

        const result = await handle.query(
          organizationQuery,
          constants.CCLOUD_CONNECTION_ID,
          true, // DO show partial errors
          {
            id: "123",
          },
        );
        assert.deepStrictEqual(result, responseWithErrors.data);
        sinon.assert.calledOnceWithExactly(
          showWarningNotificationWithButtonsStub,
          'GraphQL query returned data but also an error: "Some error occurred"',
        );
      });

      it("should not show warning if response has both data and single error and showPartialErrors is false", async () => {
        const responseWithErrors: GraphQLResponse = {
          data: {
            ccloudConnectionById: { organizations: [{ id: "123", name: "foo", current: true }] },
          },
          errors: [{ message: "Some error occurred" }],
        };

        fetchStub.resolves({
          ok: true,
          json: async () => responseWithErrors,
        } as Response);

        const result = await handle.query(
          organizationQuery,
          constants.CCLOUD_CONNECTION_ID,
          false, // do NOT show partial errors
          {
            id: "123",
          },
        );
        assert.deepStrictEqual(result, responseWithErrors.data);
        sinon.assert.notCalled(showWarningNotificationWithButtonsStub);
      });

      for (const testCaseValue of [false, true]) {
        it(`should show error if response only had errors independent of showPartialErrors: ${testCaseValue}`, async () => {
          const responseWithOnlyErrors: GraphQLResponse = {
            data: null,
            errors: [{ message: "Some error occurred" }],
          };

          fetchStub.resolves({
            ok: true,
            json: async () => responseWithOnlyErrors,
          } as Response);

          await assert.rejects(
            handle.query(organizationQuery, constants.CCLOUD_CONNECTION_ID, testCaseValue, {
              id: "123",
            }),
            (err) => {
              assert.strictEqual(
                (err as Error).message,
                "GraphQL query failed: Some error occurred",
              );
              return true;
            },
          );
          sinon.assert.notCalled(showWarningNotificationWithButtonsStub);
        });
      }
    });
    it("should call fetch and de-json successfully with single in-flight query", async () => {
      const result = await handle.query(organizationQuery, constants.CCLOUD_CONNECTION_ID, true, {
        id: "123",
      });

      assert.deepStrictEqual(result, happyQueryResponseObj.data);
      sinon.assert.calledOnce(fetchStub);
      // Verify that the in-flight promise cache is empty after the query resolves.
      assert.strictEqual(handle["graphQlQueryPromises"].size, 0);
    });

    it("handles multiple awaiters for the same query", async () => {
      // Call the query twice concurrently, exercising the in-flight promise cache.
      const queryPromise1 = handle.query(organizationQuery, constants.CCLOUD_CONNECTION_ID, true, {
        id: "123",
      });
      const queryPromise2 = handle.query(organizationQuery, constants.CCLOUD_CONNECTION_ID, true, {
        id: "123",
      });

      // Should have one single entry in the cache. Both calls should map to same cache key.
      assert.strictEqual(handle["graphQlQueryPromises"].size, 1);

      const [result1, result2] = await Promise.all([queryPromise1, queryPromise2]);

      assert.deepStrictEqual(result1, happyQueryResponseObj.data);
      assert.deepStrictEqual(result2, happyQueryResponseObj.data);

      sinon.assert.calledOnce(fetchStub); // not twice!
      assert.strictEqual(handle["graphQlQueryPromises"].size, 0); // cache should be empty after the query resolves
    });

    it("Separate queries with different variables should not share the same cache entry", async () => {
      // Call the query twice with different variables, should not share the same cache entry.
      const queryPromise1 = handle.query(organizationQuery, constants.CCLOUD_CONNECTION_ID, true, {
        id: "123",
      });
      const queryPromise2 = handle.query(organizationQuery, constants.CCLOUD_CONNECTION_ID, true, {
        id: "456",
      });

      assert.strictEqual(handle["graphQlQueryPromises"].size, 2);

      const [result1, result2] = await Promise.all([queryPromise1, queryPromise2]);

      assert.deepStrictEqual(result1, happyQueryResponseObj.data);
      assert.deepStrictEqual(result2, happyQueryResponseObj.data);

      sinon.assert.calledTwice(fetchStub);
      assert.strictEqual(handle["graphQlQueryPromises"].size, 0); // cache should be empty after queries resolve
    });

    // Likewise separate connection ids
    it("Separate queries with different connection ids should not share the same cache entry", async () => {
      // Call the query twice with different variables, should not share the same cache entry.
      const queryPromise1 = handle.query(organizationQuery, constants.CCLOUD_CONNECTION_ID, true, {
        id: "123",
      });
      const queryPromise2 = handle.query(organizationQuery, constants.LOCAL_CONNECTION_ID, true, {
        id: "123",
      });

      assert.strictEqual(handle["graphQlQueryPromises"].size, 2);

      const [result1, result2] = await Promise.all([queryPromise1, queryPromise2]);

      assert.deepStrictEqual(result1, happyQueryResponseObj.data);
      assert.deepStrictEqual(result2, happyQueryResponseObj.data);

      sinon.assert.calledTwice(fetchStub);
      assert.strictEqual(handle["graphQlQueryPromises"].size, 0); // cache should be empty after queries resolve
    });

    it("Separate queries with no variables at all should share same cache entry", async () => {
      // Call the query twice with no variables at all, should share the same cache entry.
      const queryPromise1 = handle.query(
        organizationQuery,
        constants.CCLOUD_CONNECTION_ID,
        true,
        // @ts-expect-error We are intentionally passing undefined here to simulate no variables, but don't have a better query onhand.
        undefined,
      );
      const queryPromise2 = handle.query(
        organizationQuery,
        constants.CCLOUD_CONNECTION_ID,
        true,
        // @ts-expect-error See above.
        undefined,
      );

      assert.strictEqual(handle["graphQlQueryPromises"].size, 1);

      const [result1, result2] = await Promise.all([queryPromise1, queryPromise2]);

      assert.deepStrictEqual(result1, happyQueryResponseObj.data);
      assert.deepStrictEqual(result2, happyQueryResponseObj.data);

      sinon.assert.calledOnce(fetchStub);
      assert.strictEqual(handle["graphQlQueryPromises"].size, 0); // cache should be empty after queries resolve
    });

    // If the fetch fails, the promise should reject and the cache should be cleared.
    it("should reject promise and clear cache on fetch failure", async () => {
      const errorMessage = "Network error";
      fetchStub.rejects(new Error(errorMessage));

      await assert.rejects(
        handle.query(organizationQuery, constants.CCLOUD_CONNECTION_ID, true, { id: "123" }),
        (err) => {
          assert.strictEqual((err as Error).message, errorMessage);
          return true;
        },
      );

      sinon.assert.calledOnce(fetchStub);
      assert.strictEqual(handle["graphQlQueryPromises"].size, 0); // cache should be empty even on failure
    });

    // If the response is not ok, the promise should reject and the cache should be cleared.
    it("should reject promise and clear cache on non-ok response", async () => {
      fetchStub.resolves({
        json: async () => ({ errors: [{ message: "Bad Query" }] }),
      } as Response);

      await assert.rejects(
        handle.query(organizationQuery, constants.CCLOUD_CONNECTION_ID, true, { id: "123" }),
        (err) => {
          assert.strictEqual((err as Error).message, "GraphQL query failed: Bad Query");
          return true;
        },
      );

      sinon.assert.calledOnce(fetchStub);
      assert.strictEqual(handle["graphQlQueryPromises"].size, 0); // cache should be empty
    });

    // If the response is not ok, and is not of expected graphql response shape, gets handled.
    it("variant two: should reject promise and clear cache on non-ok response", async () => {
      fetchStub.resolves({
        json: async () => ({}),
      } as Response);

      await assert.rejects(
        handle.query(organizationQuery, constants.CCLOUD_CONNECTION_ID, true, { id: "123" }),
        (err) => {
          assert.strictEqual(
            (err as Error).message,
            "GraphQL returned unexpected response structure: {}",
          );
          return true;
        },
      );

      sinon.assert.calledOnce(fetchStub);
      assert.strictEqual(handle["graphQlQueryPromises"].size, 0); // cache should be empty
    });

    const testCases: Array<[string, { message: string }[]]> = [
      [
        'GraphQL query returned data but also an error: "Some error occurred"',
        [{ message: "Some error occurred" }],
      ],
      [
        'GraphQL query returned data but also 2 errors: "Error one" (and 1 more)',
        [{ message: "Error one" }, { message: "Error two" }],
      ],
    ];

    for (const [message, errors] of testCases) {
      it(`should return data but also show warning if response has both data and ${errors.length} error(s)`, async () => {
        const responseWithErrors: GraphQLResponse = {
          data: {
            ccloudConnectionById: { organizations: [{ id: "123", name: "foo", current: true }] },
          },
          errors: errors,
        };

        fetchStub.resolves({
          ok: true,
          json: async () => responseWithErrors,
        } as Response);

        const showWarningNotificationWithButtonsStub = sandbox.stub(
          notifications,
          "showWarningNotificationWithButtons",
        );

        const result = await handle.query(organizationQuery, constants.CCLOUD_CONNECTION_ID, true, {
          id: "123",
        });
        assert.deepStrictEqual(result, responseWithErrors.data);
        sinon.assert.calledOnceWithExactly(showWarningNotificationWithButtonsStub, message);
        assert.strictEqual(handle["graphQlQueryPromises"].size, 0); // cache should be empty
      });
    }
  });

  it("getFlinkPresignedUrlsApi() should return a PresignedUrlsArtifactV1Api instance given a provider region", async () => {
    const api = handle.getFlinkPresignedUrlsApi(TEST_CCLOUD_FLINK_COMPUTE_POOL);
    assert.strictEqual(api.constructor.name, "PresignedUrlsArtifactV1Api");
  });

  describe("Scaffolding Service class methods", () => {
    describe("getTemplatesApi()", () => {
      it("should return a TemplatesScaffoldV1Api instance", () => {
        const api = handle.getTemplatesApi();

        assert.strictEqual(api.constructor.name, "TemplatesScaffoldV1Api");
      });

      it("should include basePath in its configuration", () => {
        const api = handle.getTemplatesApi();

        assert.strictEqual(
          api["configuration"].basePath,
          SCAFFOLDING_SERVICE_BASE_PATH.replace("confluent.cloud", constants.CCLOUD_BASE_PATH),
        );
      });

      it("should update the basePath if IDE_SIDECAR_CONNECTIONS_CCLOUD_BASE_PATH is set to a non-default value", () => {
        const newBasePath = "test.cloud";
        sandbox.stub(constants, "CCLOUD_BASE_PATH").value(newBasePath);

        const api = handle.getTemplatesApi();

        assert.strictEqual(
          api["configuration"].basePath,
          SCAFFOLDING_SERVICE_BASE_PATH.replace("confluent.cloud", newBasePath),
        );
      });
    });
  });
});
