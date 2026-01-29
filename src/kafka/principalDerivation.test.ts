import assert from "assert";
import { CredentialType, ScramHashAlgorithm } from "../connections";
import { derivePrincipal } from "./principalDerivation";

describe("kafka/principalDerivation", () => {
  describe("derivePrincipal", () => {
    it("should return canDerive: false for undefined credentials", () => {
      const result = derivePrincipal(undefined);

      assert.strictEqual(result.canDerive, false);
      assert.strictEqual(result.principal, undefined);
      assert.ok(result.reason?.includes("No credentials provided"));
    });

    it("should return canDerive: false for NONE credentials", () => {
      const result = derivePrincipal({ type: CredentialType.NONE });

      assert.strictEqual(result.canDerive, false);
      assert.strictEqual(result.principal, undefined);
      assert.ok(result.reason?.includes("No authentication configured"));
    });

    describe("BASIC credentials", () => {
      it("should derive principal from BASIC credentials", () => {
        const result = derivePrincipal({
          type: CredentialType.BASIC,
          username: "alice",
          password: "secret",
        });

        assert.strictEqual(result.canDerive, true);
        assert.strictEqual(result.principal, "User:alice");
        assert.strictEqual(result.reason, undefined);
      });

      it("should handle empty username in BASIC credentials", () => {
        const result = derivePrincipal({
          type: CredentialType.BASIC,
          username: "",
          password: "secret",
        });

        assert.strictEqual(result.canDerive, false);
        assert.ok(result.reason?.includes("missing username"));
      });
    });

    describe("API_KEY credentials", () => {
      it("should derive principal from API_KEY credentials (camelCase)", () => {
        const result = derivePrincipal({
          type: CredentialType.API_KEY,
          apiKey: "ABCD1234",
          apiSecret: "secret",
        });

        assert.strictEqual(result.canDerive, true);
        assert.strictEqual(result.principal, "User:ABCD1234");
      });

      it("should derive principal from legacy API_KEY credentials (snake_case)", () => {
        // Legacy credentials may have snake_case property names
        const result = derivePrincipal({
          type: CredentialType.API_KEY,
          api_key: "EFGH5678",
          api_secret: "secret",
        } as unknown as Parameters<typeof derivePrincipal>[0]);

        assert.strictEqual(result.canDerive, true);
        assert.strictEqual(result.principal, "User:EFGH5678");
      });

      it("should handle missing apiKey in API_KEY credentials", () => {
        const result = derivePrincipal({
          type: CredentialType.API_KEY,
          apiKey: "",
          apiSecret: "secret",
        });

        assert.strictEqual(result.canDerive, false);
        assert.ok(result.reason?.includes("missing apiKey"));
      });
    });

    describe("SCRAM credentials", () => {
      it("should derive principal from SCRAM credentials", () => {
        const result = derivePrincipal({
          type: CredentialType.SCRAM,
          hashAlgorithm: ScramHashAlgorithm.SHA_256,
          username: "bob",
          password: "secret",
        });

        assert.strictEqual(result.canDerive, true);
        assert.strictEqual(result.principal, "User:bob");
      });

      it("should handle legacy SCRAM credentials with scramUsername", () => {
        const result = derivePrincipal({
          type: CredentialType.SCRAM,
          hashAlgorithm: ScramHashAlgorithm.SHA_512,
          scramUsername: "charlie",
          scramPassword: "secret",
        } as unknown as Parameters<typeof derivePrincipal>[0]);

        assert.strictEqual(result.canDerive, true);
        assert.strictEqual(result.principal, "User:charlie");
      });

      it("should handle missing username in SCRAM credentials", () => {
        const result = derivePrincipal({
          type: CredentialType.SCRAM,
          hashAlgorithm: ScramHashAlgorithm.SHA_256,
          username: "",
          password: "secret",
        });

        assert.strictEqual(result.canDerive, false);
        assert.ok(result.reason?.includes("missing username"));
      });
    });

    describe("KERBEROS credentials", () => {
      it("should derive principal from KERBEROS credentials", () => {
        const result = derivePrincipal({
          type: CredentialType.KERBEROS,
          principal: "kafka/broker@EXAMPLE.COM",
          keytabPath: "/etc/security/keytabs/kafka.keytab",
        });

        assert.strictEqual(result.canDerive, true);
        assert.strictEqual(result.principal, "User:kafka/broker@EXAMPLE.COM");
      });

      it("should handle missing principal in KERBEROS credentials", () => {
        const result = derivePrincipal({
          type: CredentialType.KERBEROS,
          principal: "",
          keytabPath: "/etc/security/keytabs/kafka.keytab",
        });

        assert.strictEqual(result.canDerive, false);
        assert.ok(result.reason?.includes("missing principal"));
      });
    });

    describe("MTLS credentials", () => {
      it("should return canDerive: false for MTLS credentials", () => {
        const result = derivePrincipal({
          type: CredentialType.MTLS,
          keystore: {
            path: "/path/to/keystore.p12",
            password: "secret",
          },
        });

        assert.strictEqual(result.canDerive, false);
        assert.ok(result.reason?.includes("mTLS"));
        assert.ok(result.reason?.includes("certificate CN not accessible"));
      });
    });

    describe("OAUTH credentials", () => {
      it("should return canDerive: false for OAUTH credentials", () => {
        const result = derivePrincipal({
          type: CredentialType.OAUTH,
          tokensUrl: "https://auth.example.com/oauth/token",
          clientId: "my-client",
          clientSecret: "secret",
        });

        assert.strictEqual(result.canDerive, false);
        assert.ok(result.reason?.includes("OAuth"));
        assert.ok(result.reason?.includes("token claims not accessible"));
      });
    });

    describe("legacy credentials without type discriminator", () => {
      it("should detect and derive from legacy BASIC credentials", () => {
        // Legacy credentials without explicit type field
        const result = derivePrincipal({
          username: "legacy-user",
          password: "legacy-pass",
        } as unknown as Parameters<typeof derivePrincipal>[0]);

        assert.strictEqual(result.canDerive, true);
        assert.strictEqual(result.principal, "User:legacy-user");
      });

      it("should detect and derive from legacy API_KEY credentials", () => {
        // Legacy credentials with api_key/api_secret (snake_case)
        const result = derivePrincipal({
          api_key: "LEGACY123",
          api_secret: "secret",
        } as unknown as Parameters<typeof derivePrincipal>[0]);

        assert.strictEqual(result.canDerive, true);
        assert.strictEqual(result.principal, "User:LEGACY123");
      });
    });

    describe("edge cases", () => {
      it("should handle usernames with special characters", () => {
        const result = derivePrincipal({
          type: CredentialType.BASIC,
          username: "user@domain.com",
          password: "secret",
        });

        assert.strictEqual(result.canDerive, true);
        assert.strictEqual(result.principal, "User:user@domain.com");
      });

      it("should handle usernames with spaces", () => {
        const result = derivePrincipal({
          type: CredentialType.BASIC,
          username: "John Doe",
          password: "secret",
        });

        assert.strictEqual(result.canDerive, true);
        assert.strictEqual(result.principal, "User:John Doe");
      });

      it("should handle very long usernames", () => {
        const longUsername = "a".repeat(256);
        const result = derivePrincipal({
          type: CredentialType.BASIC,
          username: longUsername,
          password: "secret",
        });

        assert.strictEqual(result.canDerive, true);
        assert.strictEqual(result.principal, `User:${longUsername}`);
      });
    });
  });
});
