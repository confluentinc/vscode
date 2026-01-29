import assert from "assert";
import { CredentialType } from "../connections";
import { getCredentialsType } from "./credentials";

describe("directConnections/credentials", () => {
  describe("getCredentialsType", () => {
    it("should return 'None' for null or undefined credentials", () => {
      assert.strictEqual(getCredentialsType(null), "None");
      assert.strictEqual(getCredentialsType(undefined), "None");
    });

    it("should return 'None' for non-object credentials", () => {
      assert.strictEqual(getCredentialsType("string"), "None");
      assert.strictEqual(getCredentialsType(123), "None");
    });

    it("should detect modern API credentials with type discriminator", () => {
      const creds = {
        type: CredentialType.API_KEY,
        apiKey: "test-key",
        apiSecret: "test-secret",
      };
      assert.strictEqual(getCredentialsType(creds), "API");
    });

    it("should detect modern Basic credentials with type discriminator", () => {
      const creds = {
        type: CredentialType.BASIC,
        username: "user",
        password: "pass",
      };
      assert.strictEqual(getCredentialsType(creds), "Basic");
    });

    it("should detect legacy API credentials without type field (imported JSON)", () => {
      // This is the format from exported connection files
      const creds = {
        apiKey: "SXVSIKR3VZH2CGPY",
        apiSecret: "SECRET",
      };
      assert.strictEqual(getCredentialsType(creds), "API");
    });

    it("should detect legacy Basic credentials without type field", () => {
      const creds = {
        username: "user",
        password: "pass",
      };
      assert.strictEqual(getCredentialsType(creds), "Basic");
    });

    it("should detect legacy SCRAM credentials by hashAlgorithm", () => {
      const creds = {
        hashAlgorithm: "SCRAM_SHA_256",
        username: "user",
        password: "pass",
      };
      assert.strictEqual(getCredentialsType(creds), "SCRAM");
    });

    it("should detect legacy SCRAM credentials by scramUsername/scramPassword", () => {
      const creds = {
        scramUsername: "user",
        scramPassword: "pass",
      };
      assert.strictEqual(getCredentialsType(creds), "SCRAM");
    });

    it("should detect legacy OAuth credentials without type field", () => {
      const creds = {
        tokensUrl: "https://example.com/oauth/token",
        clientId: "my-client",
      };
      assert.strictEqual(getCredentialsType(creds), "OAuth");
    });

    it("should detect legacy Kerberos credentials without type field", () => {
      const creds = {
        principal: "user@REALM",
        keytabPath: "/path/to/keytab",
      };
      assert.strictEqual(getCredentialsType(creds), "Kerberos");
    });

    it("should return 'None' for empty object", () => {
      assert.strictEqual(getCredentialsType({}), "None");
    });
  });
});
