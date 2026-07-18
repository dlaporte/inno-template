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
