import jwt from "jsonwebtoken";
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
  const fullLrDetails = {
    consignorCode: "TEST-001",
    consignorAddress: "MIDC Nagpur",
    consignorAddress2: "Maharashtra",
    consignorPincode: "440016",
    consignorGstin: "27ABCDE1234F1Z5",
    consigneeAddress: "Andheri East",
    consigneeAddress2: "Mumbai",
    consigneeAddress3: "Maharashtra",
    consigneePincode: "400093",
    consigneeGstin: "27ABCDE1234F1Z5",
    bookingDate: "2026-09-10T09:30:00.000Z",
    bookingBranch: "Test Nagpur",
    from: "Nagpur",
    to: "Mumbai",
    deliveryAddress: "Mumbai delivery address",
    contactNo: "+919876543210",
    invoiceNo: "INV-001",
    invoiceDate: "2026-09-09T00:00:00.000Z",
    eWayBillNo: "EWB-001",
    eWayBillDate: "2026-09-09T00:00:00.000Z",
    poStnNo: "PO-001",
    customerReference: "Customer reference",
    packageNumber: "1/2",
    packageType: "Carton",
    actualWeight: 10,
    chargedWeight: 10.5,
    dimensions: "100 x 50 x 40 cm",
    volume: 0.2,
    declaredValue: 10000,
    shipperSignature: "shipper-signature-ref",
    remarks: "Handle with care",
    receiverNamePrint: "Test Receiver",
    receiverMobilePrint: "+919876543211",
    receiverDateTime: "2026-09-11T14:20:00.000Z",
    receiverSignature: "receiver-signature-ref",
    paymentMode: "TO_PAY",
    riskType: "CARRIER_RISK",
    insuranceType: "INSURED",
    freightCharges: 1500,
    fuelCharges: 150,
    handlingCharges: 50,
    fodCodCharges: 25,
    rovCharges: 10,
    docketCharges: 15,
    gstRate: 18,
    gstAmount: 315,
    totalAmount: 2065,
  };

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
        lrNumber: "MANUAL-001",
        packageCount: 2,
        weightKg: 10.5,
        lrDetails: fullLrDetails,
      });
    expect(created.status).toBe(201);
    const shipment = created.body.data;
    expect(shipment.lrNumber).toBe("MANUAL-001");
    expect(shipment.lrDetails).toMatchObject(fullLrDetails);
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
        lrNumber: "MANUAL-001",
        packageCount: 2,
        weightKg: 10.5,
        lrDetails: fullLrDetails,
      });
    expect(replay.status).toBe(200);
    expect(replay.body.data.lrNumber).toBe(shipment.lrNumber);
    expect(replay.body.data.lrDetails).toMatchObject(fullLrDetails);
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
    expect(detail.body.data.lrDetails).toMatchObject(fullLrDetails);
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

  test("persists manual LR goods, rejects duplicates, replays safely and recalculates edits", async () => {
    const goods = [
      { description: "Cartons", quantity: 2, actualWeight: 5, length: 30, breadth: 30, height: 30, dimensionUnit: "CM" },
      { description: "Machine", quantity: 1, actualWeight: 20, length: 12, breadth: 12, height: 12, dimensionUnit: "IN" },
    ];
    const payload = { lrNumber: "  manual/42  ", customerId: customer.id, originBranchId: originBranch.id, destinationBranchId: destinationBranch.id,
      senderName: "Goods Sender", receiverName: "Goods Receiver", packageCount: 1, weightKg: 1,
      lrDetails: { goods, fodCharges: 0, codCharges: 75, freightCharges: 1000, gstRate: 18, gstAmount: 1, totalAmount: 1, chargedWeight: 1, remarks: "Keep this" } };
    const create = (body, key) => request(app).post("/api/shipments").set({ ...auth(), "Idempotency-Key": key }).send(body);
    const created = await create(payload, "goods-create");
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ lrNumber: "MANUAL/42", packageCount: 3, weightKg: 25,
      lrDetails: { actualWeight: 25, volume: 3, volumetricWeight: 21, chargedWeight: 25, fodCharges: 0, codCharges: 75, gstAmount: 193.5, totalAmount: 1268.5 } });
    expect((await create(payload, "goods-create")).status).toBe(200);
    expect((await create({ ...payload, lrNumber: "MANUAL/43" }, "goods-create")).body.errorCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect((await create(payload, "goods-duplicate")).body.errorCode).toBe("LR_NUMBER_EXISTS");
    expect((await request(app).get(`/api/shipments/${id}`).set(auth())).body.data.lrDetails.goods).toHaveLength(2);
    expect((await request(app).get('/api/public/track/MANUAL%2F42')).status).toBe(200);
    const edited = await request(app).patch(`/api/shipments/${id}`).set(auth()).send({ lrDetails: { goods: [{ ...goods[0], quantity: 4 }] } });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ packageCount: 4, weightKg: 5, lrDetails: { volume: 4, volumetricWeight: 28, chargedWeight: 28, codCharges: 75, remarks: "Keep this" } });
    const forged = await request(app).patch(`/api/shipments/${id}`).set(auth()).send({ weightKg: 999, lrDetails: { chargedWeight: 1 } });
    expect(forged.body.data).toMatchObject({ weightKg: 5, lrDetails: { chargedWeight: 28 } });
    const charges = await request(app).patch(`/api/shipments/${id}`).set(auth()).send({ lrDetails: { freightCharges: 1500, gstAmount: 1, totalAmount: 1 } });
    expect(charges.status).toBe(200);
    expect(charges.body.data.lrDetails).toMatchObject({ codCharges: 75, gstRate: 18, gstAmount: 283.5, totalAmount: 1858.5 });
    const racing = await Promise.all([create({ ...payload, lrNumber: "RACE-42" }, "race-a"), create({ ...payload, lrNumber: "RACE-42" }, "race-b")]);
    expect(racing.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await Shipment.countDocuments({ lrNumber: "RACE-42" })).toBe(1);
  }, 15000);

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
  }, 15000);

  test("supports partial updates and guarded CRUD deletion", async () => {
    for (const [resource, payload] of [
      ["branches", { branchCode: "DEL", name: "Delete Branch", city: "Nagpur" }],
      ["customers", { name: "Delete Customer", mobile: "9876543210" }],
      [
        "users",
        {
          name: "Delete Employee",
          email: "delete@example.test",
          branchId: originBranch.id,
          password: "SafeEmployeePassword123!",
        },
      ],
    ]) {
      const created = await request(app).post(`/api/${resource}`).set(auth()).send(payload);
      expect(created.status).toBe(201);
      const id = created.body.data.id;
      expect((await request(app).get(`/api/${resource}/${id}`).set(auth())).status).toBe(200);
      expect((await request(app).patch(`/api/${resource}/${id}`).set(auth()).send({})).status).toBe(422);
      expect(
        (await request(app).patch(`/api/${resource}/${id}`).set(auth()).send({ name: "Updated Name" })).body.data.name,
      ).toBe("Updated Name");
      expect((await request(app).delete(`/api/${resource}/${id}`).set(auth())).status).toBe(409);
      expect(
        (await request(app).patch(`/api/${resource}/${id}/status`).set(auth()).send({ status: "INACTIVE" })).status,
      ).toBe(200);
      expect((await request(app).delete(`/api/${resource}/${id}`).set(auth())).status).toBe(200);
      expect((await request(app).get(`/api/${resource}/${id}`).set(auth())).status).toBe(404);
    }
    const payload = {
      customerId: customer.id,
      originBranchId: originBranch.id,
      destinationBranchId: destinationBranch.id,
      senderName: "Sender",
      receiverName: "Receiver",
      lrNumber: "MANUAL-003",
      packageCount: 1,
      weightKg: 2,
    };
    const created = await request(app).post("/api/shipments").set(auth()).send(payload);
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(
      (await request(app).patch(`/api/shipments/${id}`).set(auth()).send({ packageCount: 3 })).body.data.packageCount,
    ).toBe(3);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "employee@example.test", password: "SafeEmployeePassword123!" });
    const employeeAuth = { Authorization: `Bearer ${login.body.data.accessToken}` };
    expect((await request(app).get(`/api/shipments/${id}`).set(employeeAuth)).status).toBe(200);
    expect((await request(app).get(`/api/shipments/${id}`).set(auth())).body.data.lrDetails).toBeUndefined();
    expect((await request(app).get("/api/branches/options").set(employeeAuth)).body.data.length).toBeGreaterThanOrEqual(
      2,
    );
    expect((await request(app).delete(`/api/shipments/${id}`).set(employeeAuth)).status).toBe(403);
    expect((await request(app).delete(`/api/shipments/${id}`).set(auth())).status).toBe(200);
    expect(await ShipmentEvent.countDocuments({ shipmentId: id })).toBe(0);
    expect(await AuditLog.countDocuments({ entityId: id, action: "SHIPMENT_DELETED" })).toBe(1);
    expect((await request(app).get(`/api/shipments/${id}`).set(auth())).status).toBe(404);
    expect(
      (
        await request(app)
          .post("/api/shipments")
          .set({ ...auth(), "Idempotency-Key": "workflow-create-001" })
          .send(payload)
      ).status,
    ).toBe(409);
    expect(
      (await request(app).patch(`/api/customers/${customer.id}/status`).set(auth()).send({ status: "INACTIVE" }))
        .status,
    ).toBe(200);
    expect((await request(app).delete(`/api/customers/${customer.id}`).set(auth())).body.errorCode).toBe(
      "RECORD_IN_USE",
    );
    await request(app).patch(`/api/customers/${customer.id}/status`).set(auth()).send({ status: "ACTIVE" });
  });

  test("enforces Admin > Manager > Employee hierarchy and manager delivery workflow", async () => {
    const managerResponse = await request(app).post("/api/managers").set(auth()).send({
      name: "Branch Manager",
      email: "manager@example.test",
      branchId: destinationBranch.id,
      password: "SafeManagerPassword123!",
    });
    expect(managerResponse.status).toBe(201);
    const manager = managerResponse.body.data;
    expect(manager.role).toBe("MANAGER");
    expect((await request(app).get("/api/managers").set(auth())).body.data.map((u) => u.id)).toContain(manager.id);
    expect(
      (await request(app).patch(`/api/managers/${manager.id}`).set(auth()).send({ name: "Mumbai Manager" })).status,
    ).toBe(200);
    const managerLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "manager@example.test", password: "SafeManagerPassword123!" });
    expect(managerLogin.status).toBe(200);
    const managerAuth = { Authorization: `Bearer ${managerLogin.body.data.accessToken}` };
    const refreshCookie = managerLogin.headers["set-cookie"][0].split(";")[0];
    expect((await request(app).get("/api/auth/me").set(managerAuth)).body.data.role).toBe("MANAGER");
    expect(
      (await request(app).post("/api/auth/refresh").set("Cookie", refreshCookie).send({})).body.data.user.role,
    ).toBe("MANAGER");
    expect((await request(app).get("/api/managers").set(managerAuth)).status).toBe(403);
    expect((await request(app).post("/api/branches").set(managerAuth).send({})).status).toBe(403);
    const staffPayload = {
      name: "Managed Employee",
      email: "managed@example.test",
      branchId: destinationBranch.id,
      password: "SafeEmployeePassword123!",
    };
    const employeeResponse = await request(app).post("/api/users").set(managerAuth).send(staffPayload);
    expect(employeeResponse.status).toBe(201);
    const employeeId = employeeResponse.body.data.id;
    expect(
      (
        await request(app)
          .post("/api/users")
          .set(managerAuth)
          .send({ ...staffPayload, email: "escape@example.test", branchId: originBranch.id })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post("/api/users")
          .set(managerAuth)
          .send({ ...staffPayload, role: "ADMIN" })
      ).status,
    ).toBe(422);
    expect(
      (await request(app).patch(`/api/users/${employeeId}`).set(managerAuth).send({ branchId: originBranch.id }))
        .status,
    ).toBe(403);
    expect(
      (await request(app).patch(`/api/users/${employeeId}`).set(managerAuth).send({ name: "Updated Employee" })).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/users/${employeeId}/reset-password`)
          .set(managerAuth)
          .send({ newPassword: "UpdatedEmployeePassword123!" })
      ).status,
    ).toBe(200);
    expect(
      (await request(app).patch(`/api/users/${employeeId}/status`).set(managerAuth).send({ status: "INACTIVE" }))
        .status,
    ).toBe(200);
    const staff = await request(app).get("/api/users").set(managerAuth);
    expect(staff.body.data.every((u) => u.role === "EMPLOYEE" && u.branchId._id === destinationBranch.id)).toBe(true);
    const outsideEmployee = await User.findOne({ email: "employee@example.test" });
    for (const operation of ["get", "patch"]) {
      expect(
        (
          await request(app)
            [operation](`/api/users/${outsideEmployee._id}`)
            .set(managerAuth)
            .send(operation === "patch" ? { name: "Invalid Update" } : undefined)
        ).status,
      ).toBe(403);
    }
    expect((await request(app).get(`/api/users/${manager.id}`).set(managerAuth)).status).toBe(403);
    const created = await request(app).post("/api/shipments").set(auth()).send({
      customerId: customer.id,
      originBranchId: originBranch.id,
      destinationBranchId: destinationBranch.id,
      senderName: "Manager Sender",
      receiverName: "Manager Receiver",
      lrNumber: "MANUAL-004",
      packageCount: 1,
      weightKg: 2,
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(
      (
        await request(app)
          .patch(`/api/shipments/${id}`)
          .set(managerAuth)
          .send({ lrDetails: { remarks: "No" } })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/shipments/${id}/status`)
          .set(managerAuth)
          .send({ status: "IN_TRANSIT", location: "Mumbai" })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/shipments/${id}/admin-override`)
          .set(managerAuth)
          .send({ reason: "Attempt override", changes: { senderName: "Changed" } })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/shipments/${id}/status`)
          .set(auth())
          .send({ status: "IN_TRANSIT", location: "Nagpur" })
      ).status,
    ).toBe(200);
    expect(
      (await request(app).post(`/api/shipments/${id}/receive`).set(managerAuth).send({ location: "Mumbai" })).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/shipments/${id}/lr-image`)
          .set(managerAuth)
          .attach("lrImage", Buffer.from("%PDF-1.7\n"), { filename: "lr.pdf", contentType: "application/pdf" })
      ).status,
    ).toBe(201);
    // Moving the manager to the origin must not grant destination verification rights.
    await request(app).patch(`/api/managers/${manager.id}`).set(auth()).send({ branchId: originBranch.id });
    expect(
      (
        await request(app)
          .post(`/api/shipments/${id}/lr-image/verify`)
          .set(managerAuth)
          .send({ status: "VERIFIED", remarks: "Valid document" })
      ).status,
    ).toBe(403);
    await request(app).patch(`/api/managers/${manager.id}`).set(auth()).send({ branchId: destinationBranch.id });
    expect(
      (
        await request(app)
          .post(`/api/shipments/${id}/lr-image/verify`)
          .set(managerAuth)
          .send({ status: "VERIFIED", remarks: "Valid document" })
      ).status,
    ).toBe(200);
    expect((await request(app).post(`/api/shipments/${id}/complete`).set(managerAuth).send({})).status).toBe(200);
    expect((await request(app).post(`/api/shipments/${id}/close`).set(managerAuth).send({})).status).toBe(200);
    expect((await request(app).get("/api/dashboard/summary").set(managerAuth)).status).toBe(200);
    expect((await request(app).get("/api/reports/shipments").set(managerAuth)).status).toBe(200);
    expect((await request(app).delete(`/api/users/${employeeId}`).set(managerAuth)).status).toBe(403);
    expect(
      (await request(app).patch(`/api/managers/${manager.id}/status`).set(auth()).send({ status: "INACTIVE" })).status,
    ).toBe(200);
    expect((await request(app).get("/api/dashboard/summary").set(managerAuth)).status).toBe(401);
  }, 15000);

  test("activity feed records actor identity and enforces historical branch isolation", async () => {
    const manager = await User.findOneAndUpdate({ email: "manager@example.test" }, { status: "ACTIVE" }, { new: true });
    const employee = await User.findOneAndUpdate(
      { email: "managed@example.test" },
      { status: "ACTIVE" },
      { new: true },
    );
    const tokenFor = (user) => ({
      Authorization: `Bearer ${jwt.sign({ userId: String(user._id) }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" })}`,
    });
    const employeeAuth = tokenFor(employee),
      managerAuth = tokenFor(manager);
    const created = await request(app)
      .post("/api/customers")
      .set(employeeAuth)
      .send({ name: "Activity Test Customer", mobile: "9876543210" });
    expect(created.status).toBe(201);
    const event = await AuditLog.findOne({ entityId: created.body.data.id, action: "CUSTOMER_CREATED" });
    expect(event.actorName).toBe(employee.name);
    expect(String(event.actorBranchId)).toBe(destinationBranch.id);
    const adminOnly = await AuditLog.create({
      userId: manager._id,
      actorName: "Other branch actor",
      actorBranchId: originBranch.id,
      action: "USER_UPDATED",
      entityType: "User",
      entityId: String(manager._id),
      oldValue: { passwordHash: "private-hash" },
      newValue: { passwordHash: "other-private-hash" },
    });
    const outsideEmployee = await User.findOne({ email: "employee@example.test" });
    const hidden = await AuditLog.create({
      userId: outsideEmployee._id,
      actorName: "Outside actor",
      actorBranchId: originBranch.id,
      action: "USER_UPDATED",
      entityType: "User",
      entityId: String(outsideEmployee._id),
    });
    const legacy = await AuditLog.create({
      userId: employee._id,
      action: "USER_UPDATED",
      entityType: "User",
      entityId: String(employee._id),
    });
    const getEvents = async (authHeaders) => request(app).get("/api/activity?limit=100").set(authHeaders);
    const own = await getEvents(employeeAuth);
    expect(own.status).toBe(200);
    expect(own.body.data.every((item) => item.actor.id === String(employee._id))).toBe(true);
    const branch = await getEvents(managerAuth);
    const ids = branch.body.data.map((item) => item.id);
    expect(ids).toContain(String(event._id));
    expect(ids).toContain(String(adminOnly._id));
    expect(ids).not.toContain(String(hidden._id));
    expect(ids).not.toContain(String(legacy._id));
    expect(JSON.stringify(branch.body)).not.toContain("private-hash");
    expect(branch.body.data.every((item) => !("oldValue" in item) && !("ipAddress" in item))).toBe(true);
    await User.updateOne({ _id: employee._id }, { branchId: originBranch.id, name: "Transferred Employee" });
    const historical = await request(app)
      .get("/api/activity")
      .query({ search: "Activity Test Customer" })
      .set(managerAuth);
    expect(historical.body.data[0].actor.name).toBe(employee.name);
    expect(historical.body.pagination.total).toBe(1);
    const all = await getEvents(auth());
    expect(all.body.data.map((item) => item.id)).toContain(String(hidden._id));
    expect((await request(app).get("/api/activity")).status).toBe(401);
    expect((await request(app).get("/api/activity?dateFrom=2026-10-01&dateTo=2026-01-01").set(auth())).status).toBe(
      422,
    );
  });

  test("literal search, stable pagination and CSV reports retain their contracts", async () => {
    const { Customer } = await import("../src/models/customer.model.js");
    const sameTime = new Date("2020-01-01T00:00:00Z");
    const administrator = await User.findOne({ role: "ADMIN" });
    const fixtures = await Customer.create([
      {
        customerCode: "SORT001",
        name: "Literal [abc]",
        mobile: "9876543210",
        createdBy: administrator._id,
        createdAt: sameTime,
      },
      {
        customerCode: "SORT002",
        name: "Literal abc",
        mobile: "9876543210",
        createdBy: administrator._id,
        createdAt: sameTime,
      },
    ]);
    const searched = await request(app).get("/api/customers").query({ search: "[abc]" }).set(auth());
    expect(searched.status).toBe(200);
    expect(searched.body.data.map((item) => item._id)).toEqual([String(fixtures[0]._id)]);
    const pages = [];
    for (const page of [1, 2]) {
      const response = await request(app)
        .get("/api/customers")
        .query({ search: "Literal", sortBy: "createdAt", sortOrder: "asc", limit: 1, page })
        .set(auth());
      expect(response.status).toBe(200);
      pages.push(response.body.data[0]._id);
    }
    expect(pages).toEqual(fixtures.map((item) => String(item._id)).sort());
    const csv = await request(app).get("/api/reports/shipments/export").set(auth());
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("LR Number,Customer,Origin,Destination,Status,Packages,Weight Kg,Booked At");
    expect(csv.text).toContain("MANUAL-001");
  });

  test("report pagination keeps totals over the complete filtered result", async () => {
    const response = await request(app)
      .get("/api/reports/shipments")
      .query({ limit: 1, customer: customer.id })
      .set(auth());
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination.total).toBeGreaterThan(1);
    expect(response.body.summary.total).toBe(response.body.pagination.total);
    expect(Object.values(response.body.summary.statuses).reduce((sum, value) => sum + value, 0)).toBe(
      response.body.summary.total,
    );
    const second = await request(app)
      .get("/api/reports/shipments")
      .query({ limit: 1, page: 2, customer: customer.id })
      .set(auth());
    expect(second.body.data[0]._id).not.toBe(response.body.data[0]._id);
    const empty = await request(app)
      .get("/api/reports/shipments")
      .query({ customer: "f".repeat(24) })
      .set(auth());
    expect(empty.body.data).toEqual([]);
    expect(empty.body.summary.total).toBe(0);
    app.locals.draining = true;
    expect((await request(app).get("/api/health/ready")).status).toBe(503);
    app.locals.draining = false;
    expect((await request(app).get("/api/health/ready")).status).toBe(200);
  });

  stressTest(
    "preserves 100 unique manual LRs during concurrent creation",
    async () => {
      const payload = {
        customerId: customer.id,
        originBranchId: originBranch._id,
        destinationBranchId: destinationBranch._id,
        senderName: "Bulk Sender",
        receiverName: "Bulk Receiver",
        lrNumber: "MANUAL-005",
        packageCount: 1,
        weightKg: 1,
      };
      const responses = await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          request(app)
            .post("/api/shipments")
            .set({ ...auth(), "Idempotency-Key": `concurrency-${index}` })
            .send({ ...payload, lrNumber: `BULK-${index}` }),
        ),
      );
      expect(responses.every((response) => response.status === 201)).toBe(true);
      const numbers = responses.map((response) => response.body.data.lrNumber);
      expect(new Set(numbers).size).toBe(100);
      expect(numbers).toEqual(Array.from({ length: 100 }, (_, index) => `BULK-${index}`));
    },
    120000,
  );
});
