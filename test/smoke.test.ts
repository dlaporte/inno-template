import { SELF } from "cloudflare:test";
it("gateway module loads and rejects unauthenticated request", async () => {
  const res = await SELF.fetch("https://x/anything");
  expect([401, 403]).toContain(res.status); // no Access JWT → rejected
});
