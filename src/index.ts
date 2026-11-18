import { Hono } from "hono";
import { checkoutRoutes } from "./routes/checkout.ts";
import { stripeRoutes } from "./routes/stripe-checkout.ts";

const app = new Hono();

app.get("/", (c) => c.json({ name: "diso-pay", status: "ok" }));

app.get("/health", (c) =>
  c.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }),
);

app.route("/checkout", checkoutRoutes);
app.route("/stripe", stripeRoutes);

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};
