import { jest } from "@jest/globals";
import { Readable } from "node:stream";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import request from "supertest";
const integration = process.env.RUN_MONGO_INTEGRATION === "true" ? describe : describe.skip;
integration("MIS report data and permissions", () => {
  let mongo, app, models, loaModel, admin, employee, branch, otherBranch, customer, secondCustomer, stock, delivered, unbilled, invoice, loa;
  const before = (days) => new Date(Date.now() - days * 86400000);
  const id = () => new mongoose.Types.ObjectId();
  const auth = (role = "admin") => ({ Authorization: `Bearer ${jwt.sign({ userId: role === "admin" ? admin : employee }, process.env.JWT_ACCESS_SECRET, { expiresIn: "1h" })}` });
  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = mongo.getUri("mis_tests");
    process.env.JWT_ACCESS_SECRET = "mis-test-access-secret-at-least-32-characters";
    process.env.JWT_REFRESH_SECRET = "mis-test-refresh-secret-at-least-32-characters";
    const db = await import("../src/config/db.js"); await db.connectDatabase();
    models = await import("../src/models/index.js");
    ({ LetterAuthorization: loaModel } = await import("../src/models/authorization.model.js"));
    app = (await import("../src/app.js")).createApp();
    admin = id(); employee = id(); branch = id(); otherBranch = id(); customer = id(); secondCustomer = id(); stock = id(); delivered = id(); unbilled = id(); invoice = id(); loa = id();
    await models.User.collection.insertMany([{ _id: admin, role: "ADMIN", status: "ACTIVE", name: "Admin" }, { _id: employee, role: "EMPLOYEE", status: "ACTIVE", branchId: branch }]);
    await models.Branch.collection.insertMany([{ _id: branch, name: "NGP", branchCode: "NGP" }, { _id: otherBranch, name: "Other", branchCode: "OTH" }]);
    await models.Customer.collection.insertMany([{ _id: customer, name: "Report Customer", customerCode: "RC1", status: "ACTIVE", customerType: "CREDIT" }, { _id: secondCustomer, name: "Other Customer", customerCode: "RC2", status: "ACTIVE", customerType: "CREDIT" }]);
    const shipment = (key, lr, status, extra = {}) => ({ _id: key, lrNumber: lr, customerId: customer, originBranchId: branch, destinationBranchId: otherBranch, currentHubId: branch, currentStatus: status, senderName: "Sender", receiverName: "Receiver", packageCount: 2, weightKg: 20, createdAt: before(20), lrDetails: { from: "Nagpur", to: "Mumbai", freightCharges: 100, totalAmount: 118, gstAmount: 18 }, ...extra });
    await models.Shipment.collection.insertMany([shipment(stock, "STOCK-001", "RECEIVED"), shipment(delivered, "BILLED-001", "CLOSED"), shipment(unbilled, "UNBILLED-001", "COMPLETED"), shipment(id(), "CANCELLED-001", "CANCELLED")]);
    await models.PackageUnit.collection.insertMany([1, 2].map((sequence) => ({ shipmentId: stock, lrNumber: "STOCK-001", barcode: `P${sequence}`, sequence, status: "HUB_INWARD", currentCustodianType: "BRANCH", currentCustodianId: String(branch), currentLocation: "NGP godown", scans: [{ action: "HUB_INWARD", branchId: branch, scannedAt: before(5) }], updatedAt: before(4) })));
    await models.PackageUnit.collection.insertOne({ shipmentId: delivered, status: "DELIVERED", currentCustodianType: "CUSTOMER", currentCustodianId: String(branch) });
    await models.Invoice.collection.insertMany([
      { _id: invoice, invoiceNumber: "INV-001", branchId: branch, customerId: customer, shipmentIds: [delivered, stock], lineItems: [{ lrNumber: "BILLED-001" }, { lrNumber: "STOCK-001" }], subtotal: 200, gstAmount: 36, totalAmount: 236, paidAmount: 100, balanceAmount: 136, issueDate: before(15), dueDate: before(5), status: "PART_PAID" },
      { _id: id(), invoiceNumber: "INV-CANCELLED", branchId: branch, customerId: customer, shipmentIds: [unbilled], totalAmount: 500, balanceAmount: 500, status: "CANCELLED", issueDate: before(10) },
      { _id: id(), invoiceNumber: "INV-OTHER", branchId: otherBranch, customerId: secondCustomer, shipmentIds: [], totalAmount: 50, paidAmount: 0, balanceAmount: 50, status: "ISSUED", issueDate: before(2) },
    ]);
    await models.MoneyReceipt.collection.insertMany([{ receiptNumber: "MR1", status: "ACTIVE", receiptDate: before(1), allocations: [{ invoiceId: invoice, amount: 100 }], amount: 100, paymentMode: "CASH" }, { receiptNumber: "MR2", status: "CANCELLED", allocations: [{ invoiceId: invoice, amount: 999 }] }]);
    await models.Trip.collection.insertMany([{ _id: id(), tripNumber: "TRANSIT", tripType: "MIDDLE_MILE", status: "DISPATCHED", fromHubId: branch, toHubId: otherBranch, shipmentIds: [unbilled], origin: "Nagpur", destination: "Mumbai", vehicleNumber: "MH01", driverName: "Driver", dispatchedAt: before(2), expectedArrival: before(1) }, { _id: id(), tripNumber: "ARRIVED", tripType: "MIDDLE_MILE", status: "ARRIVED", fromHubId: branch, toHubId: otherBranch, shipmentIds: [delivered], dispatchedAt: before(4), arrivedAt: before(2), expectedArrival: before(3) }]);
    await models.DeliveryRunSheet.collection.insertOne({ drsNumber: "DRS-001", branchId: branch, driverName: "Driver", deliveryDate: before(1), shipmentIds: [delivered, unbilled, stock], items: [{ shipmentId: delivered, attemptStatus: "DELIVERED" }, { shipmentId: unbilled, attemptStatus: "PENDING" }, { shipmentId: stock, attemptStatus: "UNDELIVERED" }], status: "OPEN" });
    await loaModel.collection.insertMany([{ _id: loa, loaNumber: "LOA-REAL-001", branchId: branch, authorizedTo: "Authorized Company", purpose: "Pickup", issueDate: before(10), effectiveFrom: before(9), validUntil: before(-10) }, { loaNumber: "LOA-EXPIRED", branchId: branch, issueDate: before(20), effectiveFrom: before(19), validUntil: before(1) }, { loaNumber: "LOA-REVOKED", branchId: branch, issueDate: before(20), effectiveFrom: before(19), validUntil: before(-10), revokedAt: before(2) }]);
  }, 120000);
  afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
  test.each(["godown-stock", "hub-in-transits", "drs-details", "invoice-details", "branch-outstanding", "customer-business", "branch-loa", "stock-ageing", "unbilled-details"])("%s returns real rows and summary with protected export", async (key) => {
    const response = await request(app).get(`/api/reports/mis/${key}`).set(auth());
    expect(response.status).toBe(200); expect(response.body.data.length).toBeGreaterThan(0); expect(response.body.columns.length).toBeGreaterThan(0);
    const csv = await request(app).get(`/api/reports/mis/${key}/export`).set(auth());
    expect(csv.status).toBe(200); expect(csv.headers["content-type"]).toContain("text/csv"); expect(csv.text.split("\n").length).toBeGreaterThan(2);
    expect((await request(app).get(`/api/reports/mis/${key}`).set(auth("employee"))).status).toBe(403);
    expect((await request(app).get(`/api/reports/mis/${key}/export`).set(auth("employee"))).status).toBe(403);
  });
  test("stock uses receipt age and excludes delivered packages", async () => {
    const response = await request(app).get("/api/reports/mis/stock-ageing?bucket=4-7&threshold=3").set(auth());
    expect(response.status).toBe(200); expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({ lrNumber: "STOCK-001", quantity: 2, weight: 20, days: 5, bucket: "4-7" });
    expect(response.body.summary).toMatchObject({ records: 1, quantity: 2, aboveThreshold: 1 });
  });
  test("invoice totals remain complete across pages and do not double-count LR references", async () => {
    const response = await request(app).get("/api/reports/mis/invoice-details?limit=1&page=2").set(auth());
    expect(response.status).toBe(200); expect(response.body.data).toHaveLength(1); expect(response.body.pagination.total).toBe(2);
    expect(response.body.summary).toMatchObject({ records: 2, total: 286, paid: 100, balance: 186 });
    const branchResult = await request(app).get(`/api/reports/mis/branch-outstanding?branch=${branch}`).set(auth());
    expect(branchResult.body.summary).toMatchObject({ balance: 136, overdue: 136, customers: 1, overdueInvoices: 1 });
    expect(branchResult.body.data[0]).toMatchObject({ age30: 136, pending: 1 });
    const payments = await request(app).get(`/api/reports/invoice-payments/${invoice}`).set(auth());
    expect(payments.body.data).toHaveLength(1); expect(payments.body.data[0].allocatedAmount).toBe(100);
  });
  test("transit receipt and DRS outcomes have distinct counts", async () => {
    const transit = await request(app).get("/api/reports/mis/hub-in-transits").set(auth());
    expect(transit.body.summary).toMatchObject({ records: 2, inTransit: 1, delayed: 1, received: 1 });
    const drs = await request(app).get("/api/reports/mis/drs-details").set(auth());
    expect(drs.body.summary).toMatchObject({ records: 1, assigned: 3, delivered: 1, pending: 1, failed: 1 });
  });
  test("unbilled excludes consolidated invoices and allows cancelled invoice LRs", async () => {
    const response = await request(app).get("/api/reports/mis/unbilled-details").set(auth());
    expect(response.body.data).toHaveLength(1); expect(response.body.data[0]).toMatchObject({ lrNumber: "UNBILLED-001", eligible: true, estimated: 118 });
  });
  test("customer booked and billed metrics are distinct and include invoice-only customers", async () => {
    const response = await request(app).get(`/api/reports/mis/customer-business?customer=${customer}`).set(auth());
    expect(response.status).toBe(200); expect(response.body.data[0]).toMatchObject({ consignments: 3, freight: 300, total: 236, paid: 100, balance: 136 });
  });
  test("LOA validity is derived and missing document is a protected 404", async () => {
    const response = await request(app).get("/api/reports/mis/branch-loa").set(auth());
    expect(response.body.summary).toMatchObject({ records: 3, active: 1, expired: 1, revoked: 1 });
    expect((await request(app).get(`/api/reports/authorizations/${loa}/document`).set(auth())).status).toBe(404);
    expect((await request(app).get(`/api/reports/authorizations/${loa}`).set(auth("employee"))).status).toBe(403);
  });
  test("stock uses latest movement receipt when an internal office reference is reused", async () => {
    const leg = id();
    await models.MovementLeg.collection.insertOne({ _id: leg, shipmentId: stock, toHubId: branch, arrivedAt: before(1) });
    await models.Shipment.updateOne({ _id: stock }, { $set: { activeMovementLegId: leg } });
    const response = await request(app).get("/api/reports/mis/stock-ageing").set(auth());
    expect(response.body.data[0].days).toBe(1);
    await models.Shipment.updateOne({ _id: stock }, { $unset: { activeMovementLegId: 1 } });
  });
  test("exports all matching pages and escapes spreadsheet formula text", async () => {
    const { csvCell } = await import("../src/services/mis-report.service.js");
    expect(csvCell("=CMD()")).toBe("\"'=CMD()\"");
    expect(csvCell("  +SUM(1,2)")).toBe("\"'  +SUM(1,2)\"");
    const response = await request(app).get("/api/reports/mis/invoice-details/export?limit=1&page=2").set(auth());
    expect(response.text).toContain("INV-001"); expect(response.text).toContain("INV-OTHER"); expect(response.text).not.toContain("INV-CANCELLED");
  });
  test("document preview streams a stored PDF only to an authorized role", async () => {
    const { storageService } = await import("../src/services/storage.service.js");
    await loaModel.updateOne({ _id: loa }, { $set: { document: { storageKey: "test/authorization.pdf", mimeType: "application/pdf" } } });
    const open = jest.spyOn(storageService, "open").mockResolvedValue({ stream: Readable.from(Buffer.from("%PDF-1.4 authorization")) });
    const response = await request(app).get(`/api/reports/authorizations/${loa}/document`).set(auth());
    expect(response.status).toBe(200); expect(response.headers["content-type"]).toContain("application/pdf");
    expect((await request(app).get(`/api/reports/authorizations/${loa}/document`).set(auth("employee"))).status).toBe(403);
    open.mockRestore();
  });
  test("calendar-day filters and customer comparison use the selected periods", async () => {
    const receiptDay = new Date(before(5).getTime() + 330 * 60000).toISOString().slice(0, 10);
    const stockResult = await request(app).get(`/api/reports/mis/godown-stock?dateFrom=${receiptDay}&dateTo=${receiptDay}`).set(auth());
    expect(stockResult.status).toBe(200); expect(stockResult.body.summary.records).toBe(1);
    const tomorrow = new Date(before(-1).getTime() + 330 * 60000).toISOString().slice(0, 10);
    const empty = await request(app).get(`/api/reports/mis/godown-stock?dateFrom=${tomorrow}`).set(auth()); expect(empty.body.data).toHaveLength(0);
    const start = new Date(before(21).getTime() + 330 * 60000).toISOString().slice(0, 10);
    const end = new Date(before(19).getTime() + 330 * 60000).toISOString().slice(0, 10);
    const business = await request(app).get(`/api/reports/mis/customer-business?customer=${customer}&dateFrom=${start}&dateTo=${end}`).set(auth());
    expect(business.status).toBe(200); expect(business.body.data[0]).toMatchObject({ freight: 300, previousFreight: 0, freightChange: 300, total: 0 });
  });
  test("validates filters, dates, pages and report names", async () => {
    for (const query of ["dateFrom=bad", "dateFrom=2026-02-30", "dateFrom=2026-10-12&dateTo=2026-10-01", "branch=bad", "page=0", "sortBy=$where"]) expect((await request(app).get(`/api/reports/mis/godown-stock?${query}`).set(auth())).status).toBe(422);
    expect((await request(app).get("/api/reports/mis/unknown").set(auth())).status).toBe(422);
    expect((await request(app).get("/api/reports/mis/godown-stock")).status).toBe(401);
    const search = await request(app).get("/api/reports/mis/godown-stock?search=STOCK-001").set(auth()); expect(search.body.data).toHaveLength(1);
    const noMatch = await request(app).get("/api/reports/mis/godown-stock?search=.*").set(auth()); expect(noMatch.body.data).toHaveLength(0);
  });
});
