import { SignJWT, generateKeyPair, createLocalJWKSet, exportJWK } from "jose";
import { verifyAccessJwt } from "../src/gateway/access";

const TEAM = "davidlaporte.cloudflareaccess.com";
const AUD = "test-aud-tag";

async function make(claims: Record<string, unknown>, aud: string | string[] = AUD, iss = `https://${TEAM}`) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey); jwk.kid = "k1"; jwk.alg = "RS256";
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const token = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime("1h").sign(privateKey);
  return { token, jwks };
}

it("verifies a valid Access JWT and extracts email + inno- groups", async () => {
  const { token, jwks } = await make({ email: "a@x.org", groups: ["inno-demo-users", "other-group"] });
  const id = await verifyAccessJwt(token, { jwks, aud: AUD, teamDomain: TEAM });
  expect(id.email).toBe("a@x.org");
  expect(id.groups).toEqual(["inno-demo-users"]); // non-inno filtered out
});

it("defaults groups to [] when claim absent", async () => {
  const { token, jwks } = await make({ email: "a@x.org" });
  expect((await verifyAccessJwt(token, { jwks, aud: AUD, teamDomain: TEAM })).groups).toEqual([]);
});

it("rejects wrong aud", async () => {
  const { token, jwks } = await make({ email: "a@x.org" }, "other-aud");
  await expect(verifyAccessJwt(token, { jwks, aud: AUD, teamDomain: TEAM })).rejects.toThrow("access_invalid");
});

it("rejects wrong issuer", async () => {
  const { token, jwks } = await make({ email: "a@x.org" }, AUD, "https://evil.example");
  await expect(verifyAccessJwt(token, { jwks, aud: AUD, teamDomain: TEAM })).rejects.toThrow("access_invalid");
});

it("rejects a token with no email", async () => {
  const { token, jwks } = await make({ groups: ["inno-demo-users"] });
  await expect(verifyAccessJwt(token, { jwks, aud: AUD, teamDomain: TEAM })).rejects.toThrow("access_invalid");
});
