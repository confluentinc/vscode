import * as assert from "assert";
import {
  apiKeyCredentials,
  basicCredentials,
  CredentialType,
  isCredentialType,
  noCredentials,
  requiresSecureStorage,
  ScramHashAlgorithm,
  StoreType,
  type ApiKeyCredentials,
  type BasicCredentials,
  type KerberosCredentials,
  type MtlsCredentials,
  type OAuthCredentials,
  type ScramCredentials,
} from "./credentials";

describe("connections/credentials", function () {
  describe("CredentialType enum", function () {
    it("should have all expected values", function () {
      assert.strictEqual(CredentialType.NONE, "NONE");
      assert.strictEqual(CredentialType.BASIC, "BASIC");
      assert.strictEqual(CredentialType.API_KEY, "API_KEY");
      assert.strictEqual(CredentialType.OAUTH, "OAUTH");
      assert.strictEqual(CredentialType.SCRAM, "SCRAM");
      assert.strictEqual(CredentialType.MTLS, "MTLS");
      assert.strictEqual(CredentialType.KERBEROS, "KERBEROS");
    });
  });

  describe("ScramHashAlgorithm enum", function () {
    it("should have SHA-256 and SHA-512 algorithms", function () {
      assert.strictEqual(ScramHashAlgorithm.SHA_256, "SCRAM-SHA-256");
      assert.strictEqual(ScramHashAlgorithm.SHA_512, "SCRAM-SHA-512");
    });
  });

  describe("StoreType enum", function () {
    it("should have all expected store types", function () {
      assert.strictEqual(StoreType.JKS, "JKS");
      assert.strictEqual(StoreType.PKCS12, "PKCS12");
      assert.strictEqual(StoreType.PEM, "PEM");
      assert.strictEqual(StoreType.UNKNOWN, "UNKNOWN");
    });
  });

  describe("noCredentials()", function () {
    it("should create NONE credentials", function () {
      const creds = noCredentials();
      assert.strictEqual(creds.type, CredentialType.NONE);
    });
  });

  describe("basicCredentials()", function () {
    it("should create Basic credentials with username and password", function () {
      const creds = basicCredentials("user", "pass");
      assert.strictEqual(creds.type, CredentialType.BASIC);
      assert.strictEqual(creds.username, "user");
      assert.strictEqual(creds.password, "pass");
    });
  });

  describe("apiKeyCredentials()", function () {
    it("should create API Key credentials", function () {
      const creds = apiKeyCredentials("key123", "secret456");
      assert.strictEqual(creds.type, CredentialType.API_KEY);
      assert.strictEqual(creds.apiKey, "key123");
      assert.strictEqual(creds.apiSecret, "secret456");
    });
  });

  describe("isCredentialType()", function () {
    it("should correctly identify NONE credentials", function () {
      const creds = noCredentials();
      assert.strictEqual(isCredentialType(creds, CredentialType.NONE), true);
      assert.strictEqual(isCredentialType(creds, CredentialType.BASIC), false);
    });

    it("should correctly identify BASIC credentials", function () {
      const creds = basicCredentials("user", "pass");
      assert.strictEqual(isCredentialType(creds, CredentialType.BASIC), true);
      assert.strictEqual(isCredentialType(creds, CredentialType.API_KEY), false);
    });

    it("should handle undefined credentials", function () {
      assert.strictEqual(isCredentialType(undefined, CredentialType.NONE), false);
    });
  });

  describe("requiresSecureStorage()", function () {
    it("should return false for NONE credentials", function () {
      assert.strictEqual(requiresSecureStorage(noCredentials()), false);
    });

    it("should return true for BASIC credentials", function () {
      assert.strictEqual(requiresSecureStorage(basicCredentials("u", "p")), true);
    });

    it("should return true for API_KEY credentials", function () {
      assert.strictEqual(requiresSecureStorage(apiKeyCredentials("k", "s")), true);
    });

    it("should return true for OAUTH credentials", function () {
      const oauthCreds: OAuthCredentials = {
        type: CredentialType.OAUTH,
        tokensUrl: "https://example.com/token",
        clientId: "client",
      };
      assert.strictEqual(requiresSecureStorage(oauthCreds), true);
    });

    it("should return true for SCRAM credentials", function () {
      const scramCreds: ScramCredentials = {
        type: CredentialType.SCRAM,
        hashAlgorithm: ScramHashAlgorithm.SHA_256,
        username: "user",
        password: "pass",
      };
      assert.strictEqual(requiresSecureStorage(scramCreds), true);
    });

    it("should return false for MTLS credentials (file paths only)", function () {
      const mtlsCreds: MtlsCredentials = {
        type: CredentialType.MTLS,
        keystore: { path: "/path/to/keystore.p12" },
      };
      assert.strictEqual(requiresSecureStorage(mtlsCreds), false);
    });

    it("should return false for KERBEROS credentials (file paths only)", function () {
      const kerberosCreds: KerberosCredentials = {
        type: CredentialType.KERBEROS,
        principal: "user@REALM",
        keytabPath: "/path/to/keytab",
      };
      assert.strictEqual(requiresSecureStorage(kerberosCreds), false);
    });

    it("should return false for undefined credentials", function () {
      assert.strictEqual(requiresSecureStorage(undefined), false);
    });
  });

  describe("type narrowing with isCredentialType", function () {
    it("should allow type-safe access after narrowing", function () {
      const creds: BasicCredentials = basicCredentials("admin", "secret");

      if (isCredentialType(creds, CredentialType.BASIC)) {
        // TypeScript should know creds is BasicCredentials here
        assert.strictEqual(creds.username, "admin");
        assert.strictEqual(creds.password, "secret");
      }
    });

    it("should work with API_KEY type narrowing", function () {
      const creds: ApiKeyCredentials = apiKeyCredentials("mykey", "mysecret");

      if (isCredentialType(creds, CredentialType.API_KEY)) {
        // TypeScript should know creds is ApiKeyCredentials here
        assert.strictEqual(creds.apiKey, "mykey");
        assert.strictEqual(creds.apiSecret, "mysecret");
      }
    });
  });
});
