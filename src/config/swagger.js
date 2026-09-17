import swaggerJsdoc from "swagger-jsdoc";

const jsonResponse = {
  description: "Successful response",
  content: { "application/json": { schema: { $ref: "#/components/schemas/ApiResponse" } } },
};
const errors = {
  400: { description: "Invalid request" },
  401: { description: "Authentication required" },
  403: { description: "Role or branch access denied" },
  404: { description: "Resource not found" },
  409: { description: "Conflict or invalid workflow transition" },
  422: { description: "Validation failed" },
  429: { description: "Rate limit exceeded" },
};
const id = { name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" } };
const body = (schema) => ({
  required: true,
  content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } },
});
const operation = (summary, tag, options = {}) => ({
  summary,
  tags: [tag],
  ...(options.public ? {} : { security: [{ bearerAuth: [] }] }),
  ...(options.roles && { description: `Roles: ${options.roles}. ${options.description || ""}` }),
  ...(options.parameters && { parameters: options.parameters }),
  ...(options.body && { requestBody: body(options.body) }),
  responses: { 200: jsonResponse, ...(options.created && { 201: jsonResponse }), ...errors },
});
const resourcePaths = (base, tag, schema) => ({
  [base]: {
    get: operation(`List ${tag.toLowerCase()}`, tag, {
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", maximum: 100 } },
        { name: "search", in: "query", schema: { type: "string" } },
      ],
    }),
    post: operation(`Create ${tag.slice(0, -1).toLowerCase()}`, tag, { body: schema, created: true }),
  },
  [`${base}/{id}`]: {
    get: operation(`Get ${tag.slice(0, -1).toLowerCase()}`, tag, { parameters: [id] }),
    delete: operation("Delete inactive unreferenced record", tag, { roles: "ADMIN", parameters: [id] }),
    patch: {
      ...operation("Partially update record", tag, { parameters: [id] }),
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", minProperties: 1 } } },
      },
    },
    put: operation(`Replace ${tag.slice(0, -1).toLowerCase()}`, tag, { parameters: [id], body: schema }),
  },
  [`${base}/{id}/status`]: {
    patch: operation(`Change ${tag.slice(0, -1).toLowerCase()} status`, tag, { parameters: [id], body: "Status" }),
  },
});

const paths = {
  "/activity": {
    get: operation("List scoped team activity", "Activity", {
      roles: "ADMIN, MANAGER, EMPLOYEE",
      description:
        "Admin sees all events; manager sees historical assigned-branch actor events and their own; employee sees their own. Supports page, limit, search, action, entityType, dateFrom and dateTo.",
    }),
  },
  "/auth/login": { post: operation("Authenticate an internal user", "Auth", { public: true, body: "Login" }) },
  "/auth/refresh": { post: operation("Rotate refresh token", "Auth", { public: true, body: "Refresh" }) },
  "/auth/logout": { post: operation("Revoke refresh token", "Auth", { public: true, body: "Refresh" }) },
  "/auth/me": { get: operation("Get current authenticated user", "Auth") },
  "/auth/change-password": {
    post: operation("Change current password and revoke sessions", "Auth", { body: "ChangePassword" }),
  },
  "/users": {
    get: operation("List employees", "Users", { roles: "ADMIN" }),
    post: operation("Create employee", "Users", { roles: "ADMIN", body: "User", created: true }),
  },
  "/branches/options": { get: operation("List active branch options", "Branches") },
  "/users/{id}": {
    delete: operation("Delete inactive unreferenced employee", "Users", { roles: "ADMIN", parameters: [id] }),
    patch: operation("Partially update employee", "Users", { roles: "ADMIN", parameters: [id], body: "UserUpdate" }),
    get: operation("Get employee", "Users", { roles: "ADMIN", parameters: [id] }),
    put: operation("Update employee", "Users", { roles: "ADMIN", parameters: [id], body: "UserUpdate" }),
  },
  "/users/{id}/status": {
    patch: operation("Set employee active or inactive", "Users", { roles: "ADMIN", parameters: [id], body: "Status" }),
  },
  "/users/{id}/reset-password": {
    post: operation("Reset an employee password and revoke sessions", "Users", {
      roles: "ADMIN",
      parameters: [id],
      body: "ResetPassword",
    }),
  },
  ...resourcePaths("/branches", "Branches", "Branch"),
  ...resourcePaths("/customers", "Customers", "Customer"),
  "/customers/code/{customerCode}": {
    get: operation("Get customer by customer code", "Customers", {
      parameters: [{ name: "customerCode", in: "path", required: true, schema: { type: "string" } }],
    }),
  },
  "/shipments": {
    get: operation("List filtered shipments", "Shipments", {
      parameters: [
        { name: "page", in: "query", schema: { type: "integer" } },
        {
          name: "status",
          in: "query",
          schema: {
            type: "string",
            enum: [
              "BOOKED",
              "IN_TRANSIT",
              "RECEIVED",
              "LR_IMAGE_UPLOADED",
              "LR_IMAGE_VERIFIED",
              "COMPLETED",
              "CLOSED",
              "CANCELLED",
            ],
          },
        },
        { name: "lrNumber", in: "query", schema: { type: "string" } },
      ],
    }),
    post: operation("Create a shipment with a manual LR number", "Shipments", {
      body: "Shipment",
      created: true,
      parameters: [{ name: "Idempotency-Key", in: "header", schema: { type: "string", maxLength: 255 } }],
    }),
  },
  "/shipments/{id}": {
    delete: operation("Delete eligible booked shipment", "Shipments", { roles: "ADMIN", parameters: [id] }),
    patch: operation("Partially update booked shipment", "Shipments", { parameters: [id], body: "ShipmentUpdate" }),
    get: operation("Get shipment detail", "Shipments", { parameters: [id] }),
    put: operation("Update booked shipment", "Shipments", { parameters: [id], body: "ShipmentUpdate" }),
  },
  "/shipments/{id}/history": { get: operation("Get immutable tracking history", "Tracking", { parameters: [id] }) },
  "/shipments/{id}/documents/{documentId}/download": {
    get: operation("Download an authorized shipment document", "Documents", {
      parameters: [id, { name: "documentId", in: "path", required: true, schema: { type: "string" } }],
    }),
  },
  "/shipments/{id}/status": {
    post: operation("Dispatch or cancel shipment", "Shipments", { parameters: [id], body: "ShipmentStatus" }),
  },
  "/shipments/{id}/receive": {
    post: operation("Record parcel receipt", "Tracking", { parameters: [id], body: "Receive" }),
  },
  "/shipments/{id}/lr-image": {
    post: operation("Upload LR document", "Documents", {
      parameters: [id],
      description: "multipart/form-data field: lrImage; JPG, PNG, WEBP, or PDF; 10 MB maximum",
      roles: "ADMIN, MANAGER, EMPLOYEE",
    }),
  },
  "/shipments/{id}/lr-image/verify": {
    post: operation("Verify or reject LR document", "Documents", {
      parameters: [id],
      body: "Verification",
      roles: "ADMIN",
    }),
  },
  "/shipments/{id}/lr-upload-token": {
    post: operation("Create short-lived one-time customer upload token", "Documents", { parameters: [id] }),
  },
  "/shipments/{id}/complete": { post: operation("Complete verified shipment", "Shipments", { parameters: [id] }) },
  "/shipments/{id}/close": {
    post: operation("Close completed shipment", "Shipments", { parameters: [id], roles: "ADMIN" }),
  },
  "/shipments/{id}/admin-override": {
    post: operation("Explicit audited administrator override", "Shipments", {
      parameters: [id],
      body: "Override",
      roles: "ADMIN",
    }),
  },
  "/public/track/{lrNumber}": {
    get: operation("Public safe shipment tracking", "Public", {
      public: true,
      parameters: [{ name: "lrNumber", in: "path", required: true, schema: { type: "string" } }],
    }),
  },
  "/track": {
    get: operation("Public safe shipment tracking by query", "Public", {
      public: true,
      parameters: [{ name: "lrNumber", in: "query", required: true, schema: { type: "string" } }],
    }),
  },
  "/public/lr-upload/request": {
    post: operation("Request secure one-time customer LR upload session", "Public", {
      public: true,
      body: "PublicUploadRequest",
    }),
  },
  "/public/lr-upload/{token}": {
    post: operation("Upload document using one-time token", "Documents", {
      public: true,
      parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
      description: "multipart/form-data field: lrImage",
    }),
  },
  "/dashboard/summary": { get: operation("Get dashboard counts", "Dashboard") },
  "/reports/shipments": { get: operation("Get filtered shipment report", "Reports") },
  "/reports/shipments/export": { get: operation("Download filtered shipment CSV", "Reports") },
  "/health": { get: operation("Liveness with database state", "Health", { public: true }) },
  "/health/live": { get: operation("Process liveness", "Health", { public: true }) },
  "/health/ready": { get: operation("Deployment readiness", "Health", { public: true }) },
};

// Manager accounts use the same validated fields as employees, with an admin-only directory.
for (const suffix of ["", "/{id}", "/{id}/status", "/{id}/reset-password"]) {
  paths[`/managers${suffix}`] = Object.fromEntries(
    Object.entries(paths[`/users${suffix}`]).map(([method, spec]) => [
      method,
      {
        ...spec,
        tags: ["Managers"],
        summary: spec.summary.replaceAll("employee", "manager"),
        description: "Roles: ADMIN. Manage branch manager accounts.",
      },
    ]),
  );
  for (const [method, spec] of Object.entries(paths[`/users${suffix}`])) {
    if (method !== "delete")
      spec.description = "Roles: ADMIN, MANAGER. Managers can manage only employees in their assigned branch.";
  }
}
paths["/shipments/{id}/lr-image/verify"].post.description =
  "Roles: ADMIN, MANAGER. Managers may verify only destination-branch shipments.";
paths["/shipments/{id}/close"].post.description =
  "Roles: ADMIN, MANAGER. Managers may close only destination-branch shipments.";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "CRL Transport API",
      version: "1.0.0",
      description:
        "Versionless /api REST contract retained for compatibility. Customer authentication is intentionally not supported.",
    },
    servers: [{ url: "/api" }],
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: {
        ApiResponse: {
          type: "object",
          required: ["success", "message"],
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
            data: {},
            pagination: { type: "object" },
            requestId: { type: "string" },
          },
        },
        Login: {
          type: "object",
          required: ["email", "password"],
          properties: { email: { type: "string", format: "email" }, password: { type: "string", format: "password" } },
        },
        Refresh: { type: "object", properties: { refreshToken: { type: "string" } } },
        ChangePassword: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: { currentPassword: { type: "string" }, newPassword: { type: "string", minLength: 12 } },
        },
        ResetPassword: {
          type: "object",
          required: ["newPassword"],
          properties: { newPassword: { type: "string", minLength: 12 } },
        },
        Status: {
          type: "object",
          required: ["status"],
          properties: { status: { type: "string", enum: ["ACTIVE", "INACTIVE"] } },
        },
        User: {
          type: "object",
          required: ["name", "email", "mobile", "branchId", "password"],
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            mobile: { type: "string" },
            branchId: { type: "string" },
            password: { type: "string", minLength: 12 },
          },
        },
        UserUpdate: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string", format: "email" },
            mobile: { type: "string" },
            branchId: { type: "string" },
          },
        },
        Branch: {
          type: "object",
          required: ["branchCode", "name", "city"],
          properties: {
            branchCode: { type: "string" },
            name: { type: "string" },
            address: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            pincode: { type: "string" },
            phone: { type: "string" },
            email: { type: "string" },
          },
        },
        Customer: {
          type: "object",
          required: ["customerType", "name", "mobile"],
          properties: {
            customerCode: { type: "string", pattern: "^\\d{5}$", readOnly: true },
            customerType: { type: "string", enum: ["CREDIT", "TO_PAY_PAID"] },
            name: { type: "string" },
            companyName: { type: "string" },
            mobile: { type: "string" },
            alternateMobile: { type: "string" },
            email: { type: "string" },
            address: { type: "string" },
            city: { type: "string" },
            state: { type: "string" },
            pincode: { type: "string" },
            gstNumber: { type: "string" },
          },
        },
        Shipment: {
          type: "object",
          required: [
            "lrNumber",
            "customerId",
            "originBranchId",
            "destinationBranchId",
            "senderName",
            "receiverName",
            "packageCount",
            "weightKg",
          ],
          properties: {
            lrNumber: { type: "string", minLength: 1, maxLength: 50, description: "Required manual LR; trimmed, uppercase and globally unique." },
            customerId: { type: "string" },
            originBranchId: { type: "string" },
            destinationBranchId: { type: "string" },
            senderName: { type: "string" },
            receiverName: { type: "string" },
            receiverMobile: { type: "string" },
            packageCount: { type: "integer" },
            weightKg: { type: "number" },
            description: { type: "string" },
            expectedDeliveryDate: { type: "string", format: "date-time" },
            lrDetails: { $ref: "#/components/schemas/LrDetails" },
          },
        },
        ShipmentUpdate: {
          type: "object",
          properties: {
            senderName: { type: "string" },
            receiverName: { type: "string" },
            receiverMobile: { type: "string" },
            packageCount: { type: "integer" },
            weightKg: { type: "number" },
            description: { type: "string" },
            expectedDeliveryDate: { type: "string", format: "date-time" },
            lrDetails: { $ref: "#/components/schemas/LrDetails" },
          },
        },
        GoodsRow: {
          type: 'object', additionalProperties: false,
          required: ['description', 'quantity', 'actualWeight', 'dimensionUnit'],
          properties: {
            packageNumber: { type: 'string', maxLength: 80 },
            description: { type: 'string', minLength: 1, maxLength: 500 },
            packageType: { type: 'string', maxLength: 120 },
            quantity: { type: 'integer', minimum: 1, maximum: 10000 },
            actualWeight: { type: 'number', minimum: 0.01, maximum: 100000, description: 'Total actual kg for this row' },
            dimensionUnit: { type: 'string', enum: ['CM', 'IN', 'FT'] },
            length: { type: 'number', exclusiveMinimum: 0, maximum: 100000 },
            breadth: { type: 'number', exclusiveMinimum: 0, maximum: 100000 },
            height: { type: 'number', exclusiveMinimum: 0, maximum: 100000 },
            declaredValue: { type: 'number', minimum: 0 },
            volume: { type: 'number', readOnly: true },
            volumetricWeight: { type: 'number', readOnly: true },
            chargedWeight: { type: 'number', readOnly: true },
          },
        },
        LrDetails: {
          type: "object",
          additionalProperties: false,
          description: "Optional print-only LR fields. Returned by shipment detail, not shipment list.",
          properties: {
            goods: { type: "array", minItems: 1, maxItems: 100, items: { $ref: "#/components/schemas/GoodsRow" } },
            volumetricWeight: { type: "number", readOnly: true },
            fodCharges: { type: "number", minimum: 0 },
            codCharges: { type: "number", minimum: 0 },
            consignorCode: { type: "string" },
            consignorAddress: { type: "string" },
            consignorAddress2: { type: "string" },
            consignorPincode: { type: "string", pattern: "^\\d{6}$" },
            consignorGstin: { type: "string", pattern: "^\\d{2}[A-Z]{5}\\d{4}[A-Z]\\dZ[A-Z\\d]$" },
            consigneeAddress: { type: "string" },
            consigneeAddress2: { type: "string" },
            consigneeAddress3: { type: "string" },
            consigneePincode: { type: "string", pattern: "^\\d{6}$" },
            consigneeGstin: { type: "string", pattern: "^\\d{2}[A-Z]{5}\\d{4}[A-Z]\\dZ[A-Z\\d]$" },
            bookingDate: { type: "string", format: "date-time" },
            bookingBranch: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            deliveryAddress: { type: "string" },
            contactNo: { type: "string" },
            invoiceNo: { type: "string" },
            invoiceDate: { type: "string", format: "date-time" },
            eWayBillNo: { type: "string" },
            eWayBillDate: { type: "string", format: "date-time" },
            poStnNo: { type: "string" },
            customerReference: { type: "string" },
            packageNumber: { type: "string" },
            packageType: { type: "string" },
            actualWeight: { type: "number", exclusiveMinimum: 0 },
            chargedWeight: { type: "number", exclusiveMinimum: 0 },
            dimensions: { type: "string" },
            volume: { type: "number", minimum: 0 },
            declaredValue: { type: "number", minimum: 0 },
            shipperSignature: { type: "string" },
            remarks: { type: "string" },
            receiverNamePrint: { type: "string" },
            receiverMobilePrint: { type: "string" },
            receiverDateTime: { type: "string", format: "date-time" },
            receiverSignature: { type: "string" },
            paymentMode: { type: "string", enum: ["PAID", "TO_PAY", "CREDIT"] },
            riskType: { type: "string", enum: ["CARRIER_RISK", "OWNER_RISK"] },
            insuranceType: { type: "string", enum: ["INSURED", "NOT_INSURED"] },
            freightBasis: { type: "string", enum: ["PER_KG", "PER_BOX", "FIXED"] },
            freightRate: { type: "number", minimum: 0 },
            fuelRatePercent: { type: "number", minimum: 0, maximum: 100 },
            rovRatePercent: { type: "number", minimum: 0, maximum: 100 },
            freightCharges: { type: "number", minimum: 0, readOnly: true },
            fuelCharges: { type: "number", minimum: 0, readOnly: true },
            handlingCharges: { type: "number", minimum: 0 },
            fodCodCharges: { type: "number", minimum: 0 },
            rovCharges: { type: "number", minimum: 0, readOnly: true },
            docketCharges: { type: "number", minimum: 0 },
            gstRate: { type: "number", minimum: 0, maximum: 100 },
            gstAmount: { type: "number", minimum: 0, readOnly: true },
            totalAmount: { type: "number", minimum: 0, readOnly: true },
          },
        },
        ShipmentStatus: {
          type: "object",
          required: ["status", "location"],
          properties: {
            status: { type: "string", enum: ["IN_TRANSIT", "CANCELLED"] },
            location: { type: "string" },
            remarks: { type: "string" },
          },
        },
        Receive: {
          type: "object",
          required: ["location"],
          properties: { location: { type: "string" }, remarks: { type: "string" } },
        },
        Verification: {
          type: "object",
          required: ["status", "remarks"],
          properties: { status: { type: "string", enum: ["VERIFIED", "REJECTED"] }, remarks: { type: "string" } },
        },
        Override: {
          type: "object",
          required: ["reason", "changes"],
          properties: { reason: { type: "string" }, changes: { $ref: "#/components/schemas/ShipmentUpdate" } },
        },
        PublicUploadRequest: {
          type: "object",
          required: ["customerCode", "lrNumber"],
          properties: { customerCode: { type: "string" }, lrNumber: { type: "string" } },
        },
      },
    },
  },
  apis: [],
});
