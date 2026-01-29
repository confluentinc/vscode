import * as assert from "assert";
import {
  CredentialType,
  ScramHashAlgorithm,
  type ApiKeyCredentials,
  type BasicCredentials,
  type KerberosCredentials,
  type MtlsCredentials,
  type NoCredentials,
  type OAuthCredentials,
  type ScramCredentials,
} from "../connections";
import { KafkaAdminError, KafkaAdminErrorCategory } from "./errors";
import { toSaslOptions } from "./saslConfig";

describe("kafka/saslConfig", function () {
  describe("toSaslOptions", function () {
    it("should return undefined for undefined credentials", function () {
      const result = toSaslOptions(undefined);
      assert.strictEqual(result, undefined);
    });

    it("should return undefined for NONE credentials", function () {
      const creds: NoCredentials = { type: CredentialType.NONE };
      const result = toSaslOptions(creds);
      assert.strictEqual(result, undefined);
    });

    it("should convert BASIC credentials to PLAIN SASL", function () {
      const creds: BasicCredentials = {
        type: CredentialType.BASIC,
        username: "testuser",
        password: "testpass",
      };
      const result = toSaslOptions(creds);
      assert.deepStrictEqual(result, {
        mechanism: "plain",
        username: "testuser",
        password: "testpass",
      });
    });

    it("should convert API_KEY credentials to PLAIN SASL", function () {
      const creds: ApiKeyCredentials = {
        type: CredentialType.API_KEY,
        apiKey: "mykey",
        apiSecret: "mysecret",
      };
      const result = toSaslOptions(creds);
      assert.deepStrictEqual(result, {
        mechanism: "plain",
        username: "mykey",
        password: "mysecret",
      });
    });

    it("should convert SCRAM SHA-256 credentials to scram-sha-256 SASL", function () {
      const creds: ScramCredentials = {
        type: CredentialType.SCRAM,
        hashAlgorithm: ScramHashAlgorithm.SHA_256,
        username: "scramuser",
        password: "scrampass",
      };
      const result = toSaslOptions(creds);
      assert.deepStrictEqual(result, {
        mechanism: "scram-sha-256",
        username: "scramuser",
        password: "scrampass",
      });
    });

    it("should convert SCRAM SHA-512 credentials to scram-sha-512 SASL", function () {
      const creds: ScramCredentials = {
        type: CredentialType.SCRAM,
        hashAlgorithm: ScramHashAlgorithm.SHA_512,
        username: "scramuser",
        password: "scrampass",
      };
      const result = toSaslOptions(creds);
      assert.deepStrictEqual(result, {
        mechanism: "scram-sha-512",
        username: "scramuser",
        password: "scrampass",
      });
    });

    it("should return undefined for MTLS credentials (handled via SSL)", function () {
      const creds: MtlsCredentials = {
        type: CredentialType.MTLS,
        keystore: { path: "/path/to/keystore.p12" },
      };
      const result = toSaslOptions(creds);
      assert.strictEqual(result, undefined);
    });

    it("should throw for KERBEROS credentials (not supported)", function () {
      const creds: KerberosCredentials = {
        type: CredentialType.KERBEROS,
        principal: "user@REALM",
        keytabPath: "/path/to/keytab",
      };
      assert.throws(
        () => toSaslOptions(creds),
        (error: KafkaAdminError) => {
          return (
            error instanceof KafkaAdminError &&
            error.category === KafkaAdminErrorCategory.INVALID &&
            error.message.includes("Kerberos") &&
            error.message.includes("not supported")
          );
        },
      );
    });

    it("should throw for OAUTH credentials (not supported for kafkajs)", function () {
      const creds: OAuthCredentials = {
        type: CredentialType.OAUTH,
        tokensUrl: "https://example.com/token",
        clientId: "client",
      };
      assert.throws(
        () => toSaslOptions(creds),
        (error: KafkaAdminError) => {
          return (
            error instanceof KafkaAdminError &&
            error.category === KafkaAdminErrorCategory.INVALID &&
            error.message.includes("OAuth")
          );
        },
      );
    });
  });
});
