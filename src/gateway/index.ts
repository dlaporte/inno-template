import { Hono } from "hono";
import { Container } from "@cloudflare/containers";
import type { Env } from "./env";

export class AppContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
}

const app = new Hono<{ Bindings: Env }>();
app.all("*", (c) => c.text("unauthorized", 401)); // replaced in Task 4

export default app;
