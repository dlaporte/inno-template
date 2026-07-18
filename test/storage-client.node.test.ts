// @vitest-environment node
import { Storage } from "../lib/storage.js";

it("query posts to the sql/query endpoint and returns rows", async () => {
  const calls: any[] = [];
  const fetcher = async (url: string, init: any) => { calls.push({ url, init });
    return new Response(JSON.stringify({ results: [{ v: 1 }] }), { status: 200 }); };
  const s = new Storage({ base: "http://storage.internal", fetcher });
  const rows = await s.query("SELECT 1", []);
  expect(rows).toEqual([{ v: 1 }]);
  expect(calls[0].url).toBe("http://storage.internal/_storage/sql/query");
});
