import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { MongoMemoryReplSet } from "mongodb-memory-server";

const describeIntegration = process.env.RUN_MONGO_INTEGRATION === "true" ? describe : describe.skip;
const stressTest = process.env.RUN_STRESS === "true" ? test : test.skip;

describeIntegration("CRL API integration workflow", () => {
  let replicaSet;
  let app;
  let connectDatabase;
  let disconnectDatabase;
  let User;
  let Counter;
  let Shipment;
  let ShipmentEvent;
  let AuditLog;
  let adminToken;
  let originBranch;
  let destinationBranch;
  let customer;
  const testUploadDir = path.join(process.cwd(), "uploads-integration-test");

  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  beforeAll(async () => {
    replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = replicaSet.getUri("crl_transport_test");
    process.env.UPLOAD_DIR = testUploadDir;
    process.env.JWT_ACCESS_SECRET = "integration-test-access-secret-at-least-32-characters";
    process.env.JWT_REFRESH_SECRET = "integration-test-refresh-secret-at-least-32-characters";
    ({ connectDatabase, disconnectDatabase } = await import("../src/config/db.js"));
    ({ User, Counter, Shipment, ShipmentEvent, AuditLog } = await import("../src/models/index.js"));
    const { createApp } = await import("../src/app.js");
    await connectDatabase();
    await Promise.all(
      Object.values(await import("../src/models/index.js"))
        .filter((value) => value?.syncIndexes)
        .map((model) => model.syncIndexes()),
    );
    await User.create({
      employeeCode: "CRLEMP000001",
      name: "Test Administrator",
      email: "admin@example.test",
      passwordHash: await bcrypt.hash("SafeTestPassword123!", 12),
      role: "ADMIN",
    });
    await Counter.create({ key: "employee", value: 1 });
    app = createApp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@example.test", password: "SafeTestPassword123!" });
    adminToken = login.body.data.accessToken;
  }, 120000);

  afterAll(async () => {
    await disconnectDatabase();
    await replicaSet.stop();
    await fs.rm(testUploadDir, { recursive: true, force: true });
  });

  test("admin completes the customer-to-closed-shipment workflow", async () => {
    originBranch = (
      await request(app)
        .post("/api/branches")
        .set(auth())
        .send({ branchCode: "TNG", name: "Test Nagpur", city: "Nagpur", state: "Maharashtra", pincode: "440001" })
    ).body.data;
    destinationBranch = (
      await request(app)
        .post("/api/branches")
        .set(auth())
        .send({ branchCode: "TMB", name: "Test Mumbai", city: "Mumbai", state: "Maharashtra", pincode: "400001" })
    ).body.data;
    const customerResponse = await request(app).post("/api/customers").set(auth()).send({
      name: "Test Contact",
      companyName: "Test Logistics Customer",
      mobile: "9876543210",
      email: "customer@example.test",
      city: "Nagpur",
      state: "Maharashtra",
      pincode: "440001",
    });
    expect(customerResponse.status).toBe(201);
    customer = customerResponse.body.data;
    expect(customer.customerCode).toMatch(/^CRLCUST\d{6}$/);
    const created = await request(app)
      .post("/api/shipments")
      .set({ ...auth(), "Idempotency-Key": "workflow-create-001" })
      .send({
        customerId: customer.id,
        originBranchId: originBranch._id,
        destinationBranchId: destinationBranch._id,
        senderName: "Test Sender",
        receiverName: "Test Receiver",
        receiverMobile: "9876543211",
        packageCount: 2,
        weightKg: 10.5,
      });
    expect(created.status).toBe(201);
    const shipment = created.body.data;
    expect(shipment.lrNumber).toMatch(/^CRL-TNG-\d{4}-\d{6}$/);
    const replay = await request(app)
      .post("/api/shipments")
      .set({ ...auth(), "Idempotency-Key": "workflow-create-001" })
      .send({
        customerId: customer.id,
        originBranchId: originBranch._id,
        destinationBranchId: destinationBranch._id,
        senderName: "Test Sender",
        receiverName: "Test Receiver",
        receiverMobile: "9876543211",
        packageCount: 2,
        weightKg: 10.5,
      });
    expect(replay.status).toBe(200);
    expect(replay.body.data.lrNumber).toBe(shipment.lrNumber);
    expect(
      (
        await request(app)
          .post(`/api/shipments/${shipment.id}/status`)
          .set(auth())
          .send({ status: "IN_TRANSIT", location: "Nashik Hub", remarks: "Dispatched" })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/shipments/${shipment.id}/receive`)
          .set(auth())
          .send({ location: "Test Mumbai", remarks: "Received" })
      ).status,
    ).toBe(200);
    const tokenRequest = await request(app)
      .post("/api/public/lr-upload/request")
      .send({ customerCode: customer.customerCode, lrNumber: shipment.lrNumber });
    expect(tokenRequest.status).toBe(202);
    expect(tokenRequest.body.data.uploadToken).toMatch(/^[a-f\d]{64}$/);
    const uploaded = await request(app)
      .post(`/api/public/lr-upload/${tokenRequest.body.data.uploadToken}`)
      .attach("lrImage", Buffer.from("%PDF-1.7\n"), { filename: "lr.pdf", contentType: "application/pdf" });
    expect(uploaded.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`/api/shipments/${shipment.id}/lr-image/verify`)
          .set(auth())
          .send({ status: "VERIFIED", remarks: "Document is valid" })
      ).status,
    ).toBe(200);
    expect((await request(app).post(`/api/shipments/${shipment.id}/complete`).set(auth()).send({})).status).toBe(200);
    expect((await request(app).post(`/api/shipments/${shipment.id}/close`).set(auth()).send({})).status).toBe(200);
    const detail = await request(app).get(`/api/shipments/${shipment.id}`).set(auth());
    expect(detail.body.data.documents).toHaveLength(1);
    expect(
      (
        await request(app)
          .get(`/api/shipments/${shipment.id}/documents/${detail.body.data.documents[0].id}/download`)
          .set(auth())
      ).status,
    ).toBe(200);
    const tracked = await request(app).get(`/api/public/track/${shipment.lrNumber}`);
    expect(tracked.body.data.status).toBe("CLOSED");
    expect(tracked.body.data.trackingHistory).toHaveLength(7);
    expect(await ShipmentEvent.countDocuments({ shipmentId: shipment.id })).toBe(7);
    expect(await AuditLog.countDocuments({ entityId: shipment.id })).toBeGreaterThanOrEqual(6);
  });

  test("blocks invalid workflow operations and token reuse", async () => {
    const shipment = await Shipment.findOne({ currentStatus: "CLOSED" });
    expect(
      (
        await request(app)
          .post(`/api/shipments/${shipment._id}/status`)
          .set(auth())
          .send({ status: "IN_TRANSIT", location: "Test Nagpur" })
      ).status,
    ).toBe(409);
    const tokenAttempt = await request(app)
      .post("/api/public/lr-upload/request")
      .send({ customerCode: customer.customerCode, lrNumber: shipment.lrNumber });
    expect(tokenAttempt.body.data.uploadToken).toBeUndefined();
  });

  test("enforces employee and refresh-token restrictions", async () => {
    const employee = await request(app).post("/api/users").set(auth()).send({
      name: "Test Employee",
      email: "employee@example.test",
      mobile: "9876543212",
      branchId: originBranch.id,
      password: "SafeEmployeePassword123!",
    });
    expect(employee.status).toBe(201);
    const employeeLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "employee@example.test", password: "SafeEmployeePassword123!" });
    const employeeAuth = { Authorization: `Bearer ${employeeLogin.body.data.accessToken}` };
    expect((await request(app).get("/api/users").set(employeeAuth)).status).toBe(403);
    expect((await request(app).get("/api/branches").set(employeeAuth)).body.data).toHaveLength(1);
    expect((await request(app).get(`/api/branches/${destinationBranch.id}`).set(employeeAuth)).status).toBe(403);
    const agent = request.agent(app);
    const login = await agent
      .post("/api/auth/login")
      .send({ email: "admin@example.test", password: "SafeTestPassword123!" });
    const oldToken = login.headers["set-cookie"][0].match(/refreshToken=([^;]+)/)[1];
    expect((await agent.post("/api/auth/refresh").send({})).status).toBe(200);
    expect((await request(app).post("/api/auth/refresh").send({ refreshToken: oldToken })).status).toBe(401);
    expect((await agent.post("/api/auth/refresh").send({})).status).toBe(401);
  });

  stressTest(
    "allocates 100 unique sequential LRs during concurrent creation",
    async () => {
      const payload = {
        customerId: customer.id,
        originBranchId: originBranch._id,
        destinationBranchId: destinationBranch._id,
        senderName: "Bulk Sender",
        receiverName: "Bulk Receiver",
        packageCount: 1,
        weightKg: 1,
      };
      const responses = await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          request(app)
            .post("/api/shipments")
            .set({ ...auth(), "Idempotency-Key": `concurrency-${index}` })
            .send(payload),
        ),
      );
      expect(responses.every((response) => response.status === 201)).toBe(true);
      const numbers = responses.map((response) => response.body.data.lrNumber);
      expect(new Set(numbers).size).toBe(100);
      expect(numbers.every((number) => /^CRL-TNG-\d{4}-\d{6}$/.test(number))).toBe(true);
      expect(numbers.map((number) => Number(number.slice(-6))).sort((left, right) => left - right)).toEqual(
        Array.from({ length: 100 }, (_, index) => index + 2),
      );
    },
    120000,
  );
});
