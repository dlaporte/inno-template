import { sanitizeAndInject } from "../src/gateway/identity";

it("strips spoofed identity headers and injects verified ones", async () => {
  const req = new Request("https://x/p", {
    headers: { "X-Forwarded-User": "attacker@evil.com", "X-Forwarded-Groups": "inno-admin", "X-Custom": "keep" },
  });
  const out = sanitizeAndInject(req, { email: "real@x.org", groups: ["inno-demo-users"] });
  expect(out.headers.get("X-Forwarded-User")).toBe("real@x.org");
  expect(out.headers.get("X-Forwarded-Email")).toBe("real@x.org");
  expect(out.headers.get("X-Forwarded-Groups")).toBe("inno-demo-users");
  expect(out.headers.get("X-Custom")).toBe("keep");
});

it("injects empty groups as empty string, single user", async () => {
  const req = new Request("https://x/p", { headers: { "X-Forwarded-Groups": "inno-spoof" } });
  const out = sanitizeAndInject(req, { email: "u@x.org", groups: [] });
  expect(out.headers.get("X-Forwarded-Groups")).toBe("");
  expect(out.headers.get("X-Forwarded-User")).toBe("u@x.org");
});

it("strips the cf-access-* family", async () => {
  const req = new Request("https://x/p", {
    headers: {
      "cf-access-jwt-assertion": "fake",
      "Cf-Access-Authenticated-User-Email": "attacker@evil.com",
      "X-Keep": "y",
    },
  });
  const out = sanitizeAndInject(req, { email: "real@x.org", groups: [] });
  expect(out.headers.get("cf-access-jwt-assertion")).toBeNull();
  expect(out.headers.get("cf-access-authenticated-user-email")).toBeNull();
  expect(out.headers.get("X-Keep")).toBe("y");
  expect(out.headers.get("X-Forwarded-User")).toBe("real@x.org");
});

it("overwrites a spoofed X-Forwarded-Email", async () => {
  const req = new Request("https://x/p", { headers: { "X-Forwarded-Email": "spoof@evil.com" } });
  const out = sanitizeAndInject(req, { email: "real@x.org", groups: [] });
  expect(out.headers.get("X-Forwarded-Email")).toBe("real@x.org");
});
