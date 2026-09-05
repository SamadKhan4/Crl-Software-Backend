import request from "supertest";
import { createApp } from "../src/app.js";
describe("HTTP validation", () => {
  const app = createApp();
  test("health check responds", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
  test("blocks unvalidated login data", async () => {
    const response = await request(app).post("/api/auth/login").send({ email: "bad" });
    expect(response.status).toBe(422);
    expect(response.body.errorCode).toBe("VALIDATION_ERROR");
  });
  test("protects internal routes", async () => {
    const response = await request(app).get("/api/customers");
    expect(response.status).toBe(401);
  });
});
