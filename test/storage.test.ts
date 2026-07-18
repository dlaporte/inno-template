import { env } from "cloudflare:test";
import { handleStorage } from "../src/gateway/storage";

const S = (path: string, init?: RequestInit) => handleStorage(new Request(`http://storage.internal${path}`, init), env);

beforeAll(async () => {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, v TEXT)").run();
});

it("executes and queries SQL", async () => {
  const ex = await S("/_storage/sql/execute", { method: "POST", body: JSON.stringify({ sql: "INSERT INTO t (v) VALUES (?)", params: ["hi"] }) });
  expect(ex.status).toBe(200);
  expect((await ex.json() as any).changes).toBe(1);
  const q = await S("/_storage/sql/query", { method: "POST", body: JSON.stringify({ sql: "SELECT v FROM t" }) });
  expect((await q.json() as any).results[0].v).toBe("hi");
});

it("puts, gets, lists, deletes files", async () => {
  expect((await S("/_storage/files/a.txt", { method: "PUT", body: "hello" })).status).toBe(200);
  const g = await S("/_storage/files/a.txt");
  expect(await g.text()).toBe("hello");
  const list = await S("/_storage/files");
  expect((await list.json() as any).keys).toContain("a.txt");
  expect((await S("/_storage/files/a.txt", { method: "DELETE" })).status).toBe(200);
  expect((await S("/_storage/files/a.txt")).status).toBe(404);
});

it("400s malformed sql body, 404s unknown route", async () => {
  expect((await S("/_storage/sql/query", { method: "POST", body: "{bad" })).status).toBe(400);
  expect((await S("/_storage/nope")).status).toBe(404);
});
