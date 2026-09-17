# CRL Transport API Documentation

Version: `1.0.0`  
Base URL: `http://localhost:5000/api` (development)

This document is the shareable REST API reference for the CRL Transport shipment and LR workflow. The interactive OpenAPI UI is also available at `GET /api/docs` while the application runs in development.

## Contents

- [Conventions](#conventions)
- [Authentication and authorization](#authentication-and-authorization)
- [Shipment lifecycle](#shipment-lifecycle)
- [Public APIs](#public-apis)
- [Internal APIs](#internal-apis)
- [Error handling](#error-handling)
- [Postman / frontend setup](#postman--frontend-setup)

## Conventions

### IDs, dates, and pagination

- All resource IDs are 24-character MongoDB ObjectIds.
- Dates use ISO 8601 format, for example `2026-09-05T10:30:00.000Z`.
- List endpoints accept `page`, `limit` (maximum `100`), `search`, `sortBy`, and `sortOrder` (`asc` or `desc`) where applicable.
- Send JSON requests with `Content-Type: application/json`.
- File uploads use `multipart/form-data`, with the file field named `lrImage`.

### Standard success response

```json
{
  "success": true,
  "message": "Shipment created successfully",
  "data": {}
}
```

Paginated endpoints also return:

```json
{
  "success": true,
  "message": "Shipments fetched",
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "pages": 3,
    "totalPages": 3
  }
}
```

### Request IDs

The API returns `X-Request-ID` for every request. Clients may provide their own safe UUID in this header to correlate support tickets and logs.

## Authentication and authorization

Only internal CRL users authenticate. There is no customer account, registration, or customer JWT flow.

| Role       | Access                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN`    | Full access; manager and employee administration, all branches, LR verification, shipment closure, and audited overrides. |
| `MANAGER`  | Assigned-branch employee management and shipment operations; destination LR verification and closure.                     |
| `EMPLOYEE` | Internal operations restricted to their assigned origin/destination branch.                                               |
| Customer   | Public tracking and a short-lived, one-time LR upload token only.                                                         |

For every internal endpoint, send:

```http
Authorization: Bearer <accessToken>
```

`POST /auth/login` and `POST /auth/refresh` set an HTTP-only `refreshToken` cookie. Non-browser clients can instead send the refresh token in the request body. Refresh tokens rotate on every use; reusing an old one invalidates its token family.

### Auth endpoints

| Method | Path                    | Authentication | Request body                                     | Result                                           |
| ------ | ----------------------- | -------------- | ------------------------------------------------ | ------------------------------------------------ |
| `POST` | `/auth/login`           | Public         | `email`, `password`                              | Access token, safe user profile, refresh cookie. |
| `POST` | `/auth/refresh`         | Public         | Optional `refreshToken` if cookie is unavailable | Rotated access token and refresh cookie.         |
| `POST` | `/auth/logout`          | Public         | Optional `refreshToken` if cookie is unavailable | Revokes the supplied/current refresh token.      |
| `GET`  | `/auth/me`              | Internal       | —                                                | Current safe user profile.                       |
| `POST` | `/auth/change-password` | Internal       | `currentPassword`, `newPassword`                 | Changes password and revokes active sessions.    |

Login example:

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@crl.local","password":"your-password"}'
```

The `newPassword` and employee-password fields must have at least 12 characters. Login passwords require 8–128 characters.

## Shipment lifecycle

```text
BOOKED -> IN_TRANSIT -> RECEIVED -> LR_IMAGE_UPLOADED
       -> LR_IMAGE_VERIFIED -> COMPLETED -> CLOSED
```

| Current status        | Allowed next status             | Operation                                                         |
| --------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `BOOKED`              | `IN_TRANSIT`, `CANCELLED`       | `POST /shipments/:id/status`                                      |
| `IN_TRANSIT`          | `RECEIVED`, `CANCELLED`         | `POST /shipments/:id/receive` or status endpoint for cancellation |
| `RECEIVED`            | `LR_IMAGE_UPLOADED`             | Upload LR document                                                |
| `LR_IMAGE_UPLOADED`   | `LR_IMAGE_VERIFIED`, `RECEIVED` | Admin or destination manager verifies or rejects document         |
| `LR_IMAGE_VERIFIED`   | `COMPLETED`                     | Complete shipment                                                 |
| `COMPLETED`           | `CLOSED`                        | Admin or destination manager closes shipment                      |
| `CLOSED`, `CANCELLED` | None                            | Terminal statuses                                                 |

Each valid status change writes an immutable tracking event and an audit record. Shipments can be normally edited only while `BOOKED`; later corrections require an administrator override with a recorded reason.

## Public APIs

Public endpoints are rate limited. No bearer token is required.

### Track a shipment

| Method | Path                        | Purpose                   |
| ------ | --------------------------- | ------------------------- |
| `GET`  | `/public/track/:lrNumber`   | Track by URL path.        |
| `GET`  | `/track?lrNumber=:lrNumber` | Track by query parameter. |

Example:

```bash
curl "http://localhost:5000/api/track?lrNumber=CRL-MUM-2026-000001"
```

The public response exposes only LR number, origin/destination cities, current status/location, booking/expected delivery dates, and tracking history. It does not disclose customer contact data or documents.

### Request a customer LR-upload session

`POST /public/lr-upload/request`

```json
{
  "customerCode": "CRLCUST000001",
  "lrNumber": "CRL-MUM-2026-000001"
}
```

This endpoint always responds with `202 Accepted` and `accepted: true`. When the customer code and LR match an eligible received shipment, its response also includes a temporary `uploadToken`.

```json
{
  "success": true,
  "message": "If the provided shipment is eligible for document upload, an upload session has been created.",
  "data": {
    "accepted": true,
    "uploadToken": "64-character-hex-token"
  }
}
```

The token is one-time, stored only as a hash, and expires according to `UPLOAD_TOKEN_MINUTES` (20 minutes by default).

### Upload LR with a customer token

`POST /public/lr-upload/:token`

```bash
curl -X POST "http://localhost:5000/api/public/lr-upload/<uploadToken>" \
  -F "lrImage=@C:\\files\\signed-lr.pdf;type=application/pdf"
```

Accepted files: JPG/JPEG, PNG, WEBP, and PDF. The maximum size is 10 MB by default. The API checks MIME type, filename extension, magic bytes, size, and checksum.

## Internal APIs

Every endpoint in this section requires `Authorization: Bearer <accessToken>`. “Scoped” means managers and employees may operate only on their permitted branch; administrators can operate across all branches.

### Dashboard and reports

| Method | Path                        | Access   | Description                                                          |
| ------ | --------------------------- | -------- | -------------------------------------------------------------------- |
| `GET`  | `/dashboard/summary`        | Internal | Counts by status, today/month totals, and admin-only branch summary. |
| `GET`  | `/reports/shipments`        | Internal | Filtered shipment report in JSON.                                    |
| `GET`  | `/reports/shipments/export` | Internal | Same filter set, returned as CSV download.                           |

Reports accept optional `dateFrom`, `dateTo`, `status`, `branch`, and `customer` values. `branch` and `customer` must be ObjectIds.

### Employee management (administrator or assigned-branch manager)

| Method  | Path                        | Body                       | Description                                                   |
| ------- | --------------------------- | -------------------------- | ------------------------------------------------------------- |
| `POST`  | `/users`                    | Employee payload           | Creates an `EMPLOYEE`; the employee code is server generated. |
| `GET`   | `/users`                    | —                          | Lists employees.                                              |
| `GET`   | `/users/:id`                | —                          | Fetches an employee.                                          |
| `PUT`   | `/users/:id`                | Partial employee payload   | Updates employee details.                                     |
| `PATCH` | `/users/:id/status`         | `{ "status": "ACTIVE" }`   | Activates or deactivates an employee.                         |
| `POST`  | `/users/:id/reset-password` | `{ "newPassword": "..." }` | Resets password and revokes sessions.                         |

Employee create payload:

```json
{
  "name": "Asha Patil",
  "email": "asha@crl.example",
  "mobile": "+919876543210",
  "branchId": "66d8f14124b86f067a916601",
  "password": "a-long-secure-password"
}
```

Administrators cannot be created, modified, disabled, or password-reset by these employee-management endpoints.

### Branches

| Method  | Path                   | Access   | Body                     |
| ------- | ---------------------- | -------- | ------------------------ |
| `POST`  | `/branches`            | `ADMIN`  | Branch payload           |
| `GET`   | `/branches`            | Internal | —                        |
| `GET`   | `/branches/:id`        | Scoped   | —                        |
| `PUT`   | `/branches/:id`        | `ADMIN`  | Branch payload           |
| `PATCH` | `/branches/:id/status` | `ADMIN`  | `{ "status": "ACTIVE" }` |

Branch payload:

```json
{
  "branchCode": "MUM",
  "name": "Mumbai Hub",
  "address": "Andheri East",
  "city": "Mumbai",
  "state": "Maharashtra",
  "pincode": "400093",
  "phone": "+919876543210",
  "email": "mumbai@crl.example"
}
```

`branchCode` must contain 2–20 uppercase letters, numbers, or hyphens.

### Customers

| Method  | Path                            | Access   | Description                                            |
| ------- | ------------------------------- | -------- | ------------------------------------------------------ |
| `POST`  | `/customers`                    | Internal | Creates a customer and server-generated customer code. |
| `GET`   | `/customers`                    | Internal | Lists/searches customers.                              |
| `GET`   | `/customers/:id`                | Internal | Fetches customer by ObjectId.                          |
| `GET`   | `/customers/code/:customerCode` | Internal | Fetches customer by CRL customer code.                 |
| `PUT`   | `/customers/:id`                | Internal | Updates customer details.                              |
| `PATCH` | `/customers/:id/status`         | Internal | Activates or deactivates customer.                     |

Customer create/update payload:

```json
{
  "name": "Ravi Enterprises",
  "companyName": "Ravi Enterprises Pvt Ltd",
  "mobile": "+919876543210",
  "alternateMobile": "+919812345678",
  "email": "dispatch@ravi.example",
  "address": "MIDC Road",
  "city": "Pune",
  "state": "Maharashtra",
  "pincode": "411019",
  "gstNumber": "27ABCDE1234F1Z5"
}
```

### Shipments

| Method | Path                            | Access                           | Description                                          |
| ------ | ------------------------------- | -------------------------------- | ---------------------------------------------------- |
| `POST` | `/shipments`                    | Origin scoped                    | Creates a shipment with a required manual LR number.   |
| `GET`  | `/shipments`                    | Scoped                           | Lists shipments.                                     |
| `GET`  | `/shipments/:id`                | Scoped                           | Full shipment details and document metadata.         |
| `PUT`  | `/shipments/:id`                | Origin scoped                    | Edits a `BOOKED` shipment only.                      |
| `GET`  | `/shipments/:id/history`        | Scoped                           | Immutable status/event timeline.                     |
| `POST` | `/shipments/:id/status`         | Origin/destination scoped        | Moves to `IN_TRANSIT` or cancels as workflow allows. |
| `POST` | `/shipments/:id/receive`        | Destination scoped               | Marks an in-transit shipment as received.            |
| `POST` | `/shipments/:id/complete`       | Destination scoped               | Completes a verified shipment.                       |
| `POST` | `/shipments/:id/close`          | `ADMIN` or destination `MANAGER` | Closes an eligible completed shipment.               |
| `POST` | `/shipments/:id/admin-override` | `ADMIN`                          | Applies an explicit audited correction.              |

Create shipment payload:

```json
{
  "lrNumber": "MANUAL-001",
  "customerId": "66d8f14124b86f067a916602",
  "originBranchId": "66d8f14124b86f067a916601",
  "destinationBranchId": "66d8f14124b86f067a916603",
  "senderName": "Ravi Enterprises",
  "receiverName": "Neha Traders",
  "receiverMobile": "+919876543210",
  "packageCount": 4,
  "weightKg": 125.5,
  "description": "Electrical components",
  "expectedDeliveryDate": "2026-09-10T00:00:00.000Z",
  "lrDetails": {
    "consignorCode": "RAVI-001",
    "consignorAddress": "MIDC, Nagpur",
    "consignorPincode": "440016",
    "consignorGstin": "27ABCDE1234F1Z5",
    "consigneeAddress": "Andheri East, Mumbai",
    "consigneePincode": "400093",
    "bookingDate": "2026-09-10T09:30:00.000Z",
    "bookingBranch": "Nagpur",
    "from": "Nagpur",
    "to": "Mumbai",
    "contactNo": "+919876543210",
    "invoiceNo": "INV-2026-0091",
    "invoiceDate": "2026-09-09T00:00:00.000Z",
    "packageNumber": "1/4",
    "packageType": "Carton",
    "actualWeight": 120.5,
    "chargedWeight": 125.5,
    "dimensions": "100 x 50 x 40 cm",
    "declaredValue": 85000,
    "paymentMode": "TO_PAY",
    "riskType": "CARRIER_RISK",
    "insuranceType": "INSURED",
    "freightBasis": "PER_KG",
    "freightRate": 12,
    "fuelRatePercent": 10,
    "handlingCharges": 50,
    "rovRatePercent": 0,
    "gstRate": 18
  }
}
```

### Manual LR and multiple goods

New bookings require a manually entered, globally unique `lrNumber` (1-50 characters; letters, digits, slash, dot, underscore or hyphen). The server trims and uppercases it. No LR number is generated. Duplicate numbers return `409 LR_NUMBER_EXISTS`; the same idempotency key and identical request replay the original booking. Existing LR numbers remain unchanged. LR numbers cannot be edited after booking.

Send rows in `lrDetails.goods` (1-100). Each row contains `description`, `quantity`, `actualWeight` (total kg for that row), `dimensionUnit` (`CM`, `IN`, `FT`), optional `packageNumber`, `packageType`, `declaredValue`, and optional `length`, `breadth`, `height`. Supply all three dimensions or omit all three. Dimensions describe one package; volume is multiplied by quantity.

- CM: CFT = L * B * H * quantity / 27000.
- Inches: CFT = L * B * H * quantity / 1728.
- Feet: CFT = L * B * H * quantity.
- Volumetric kg = CFT * 7 for every unit.
- Invoice chargeable kg = max(total actual kg, total volumetric kg), rounded to six decimal places after comparing.

The server recalculates row `volume`, `volumetricWeight`, `chargedWeight` and LR totals on create, edit and admin override. It derives `packageCount` and `weightKg` from rows; supply these existing required top-level fields on create, but client totals are not trusted. `lrDetails.chargedWeight` is the invoice weight; `weightKg` remains actual transport weight. Row charged weights are individual comparisons; invoice weight compares shipment totals, not their sum.

Customer Master stores the customer type but does not store commercial rates. Define pricing for each LR in `lrDetails`: `freightBasis` (`PER_KG`, `PER_BOX`, or `FIXED`), `freightRate`, `fuelRatePercent`, `rovRatePercent`, direct handling/FOD/COD/docket charges, and `gstRate`. Credit customers are forced to `CREDIT` payment mode; non-credit customers cannot use it.

The server calculates freight from the selected basis, fuel as a percentage of freight, ROV as a percentage of declared value, and GST on the sum of freight, fuel, handling, FOD, COD, ROV and docket charges. `totalAmount` is charges plus GST. Amounts round to two decimal places. Blank charges or rates count as zero. Create, PATCH and admin override recalculate computed amounts after merging details; client-supplied totals are ignored.

`fodCharges` and `codCharges` are separate nonnegative amounts. `fodCodCharges` remains readable for legacy records. A PATCH replaces the supplied goods array and merges other LR fields. Existing records without goods keep their original print data.

Example row: `{ "description": "Cartons", "quantity": 2, "actualWeight": 5, "length": 30, "breadth": 30, "height": 30, "dimensionUnit": "CM" }` produces 2 CFT, 14 volumetric kg and 14 chargeable kg.

`lrDetails` is an optional nested print-data object. It contains the LR template fields: consignor/consignee address and tax details; booking, invoice and e-way bill data; package, measurement and declared-value data; receiver/signature data; payment/risk/insurance modes; and all charge values. Supplied fields are strictly validated: PIN codes are six digits, GSTIN uses the Indian GSTIN format, mobile fields use the internal mobile format, date fields must be valid dates, weights and dimensions must be positive; charges may be zero, and enum values are limited to the documented choices. Unknown fields are rejected with `422 VALIDATION_ERROR`.

`GET /shipments/:id` returns the complete `lrDetails` object so the frontend can regenerate its LR PDF. `GET /shipments` intentionally omits it to keep listing responses light. Legacy shipments created before this addition remain valid and simply return no `lrDetails` field.

Detail response excerpt:

```json
{
  "success": true,
  "message": "Shipment fetched",
  "data": {
    "id": "66d8f14124b86f067a916604",
    "lrNumber": "CRL-NGP-2026-000001",
    "currentStatus": "BOOKED",
    "lrDetails": {
      "invoiceNo": "INV-2026-0091",
      "paymentMode": "TO_PAY",
      "totalAmount": 2006
    },
    "documents": []
  }
}
```

Use a unique `Idempotency-Key` header when creating a shipment. Retrying the same request with the same key and identical top-level and `lrDetails` data returns the originally created shipment without creating another shipment. A changed LR field with the same key returns `409 IDEMPOTENCY_KEY_CONFLICT`.

```bash
curl -X POST http://localhost:5000/api/shipments \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 6ac271f2-00cb-4f14-b36d-20494305f307" \
  -d @shipment.json
```

Shipment list filters include `status`, `customerId`, `originBranchId`, `destinationBranchId`, `lrNumber`, `dateFrom`, and `dateTo`, in addition to the shared pagination fields.

#### Shipment operations

Dispatch or cancel:

`POST /shipments/:id/status`

```json
{
  "status": "IN_TRANSIT",
  "location": "Mumbai Hub",
  "remarks": "Loaded for dispatch"
}
```

Only `IN_TRANSIT` and `CANCELLED` are accepted by this endpoint. Cancellation is valid only from `BOOKED` or `IN_TRANSIT`.

Receive shipment:

`POST /shipments/:id/receive`

```json
{
  "location": "Pune Hub",
  "remarks": "Received in good condition"
}
```

Administrator override:

`POST /shipments/:id/admin-override`

```json
{
  "reason": "Corrected verified package weight from branch manifest",
  "changes": {
    "weightKg": 128.25,
    "description": "Electrical components - corrected manifest"
  }
}
```

The reason must be 8–500 characters. `changes` can include only editable shipment fields, not customer or branch references.

Edit a booked shipment's LR print data with `PUT /shipments/:id` or `PATCH /shipments/:id`. The caller must retain the normal origin-branch authorization. A supplied `lrDetails` object is merged into existing LR details, so a partial print-data edit does not remove fields that were previously saved.

```json
{
  "lrDetails": {
    "receiverNamePrint": "Neha Sharma",
    "receiverMobilePrint": "+919876543211",
    "receiverDateTime": "2026-09-11T14:20:00.000Z"
  }
}
```

LR creation and LR-detail edits create audit/activity entries containing only changed field names, never signature data, addresses, invoice values, or other full print payload.

### LR document operations

| Method | Path                                            | Access                           | Description                                    |
| ------ | ----------------------------------------------- | -------------------------------- | ---------------------------------------------- |
| `POST` | `/shipments/:id/lr-image`                       | Destination scoped               | Internal LR upload after receipt.              |
| `POST` | `/shipments/:id/lr-image/verify`                | `ADMIN` or destination `MANAGER` | Verifies or rejects the pending LR document.   |
| `POST` | `/shipments/:id/lr-upload-token`                | Destination scoped               | Generates a customer one-time upload token.    |
| `GET`  | `/shipments/:id/documents/:documentId/download` | Scoped                           | Streams/downloads only an authorized document. |

Internal upload example:

```bash
curl -X POST "http://localhost:5000/api/shipments/<shipmentId>/lr-image" \
  -H "Authorization: Bearer <accessToken>" \
  -F "lrImage=@C:\\files\\signed-lr.pdf;type=application/pdf"
```

Verification request:

```json
{
  "status": "VERIFIED",
  "remarks": "Signature and receiver stamp are clear"
}
```

For rejection use `"status": "REJECTED"`. Rejection returns the shipment to `RECEIVED`; uploading a replacement creates a new document version instead of overwriting the rejected file.

An internal upload-token response is:

```json
{
  "success": true,
  "message": "One-time customer upload token created",
  "data": {
    "token": "64-character-hex-token",
    "expiresInMinutes": 20
  }
}
```

## Error handling

All errors follow this stable shape:

```json
{
  "success": false,
  "message": "Invalid shipment status transition",
  "errorCode": "INVALID_STATUS_TRANSITION",
  "errors": [],
  "requestId": "0b2d1eac-91d6-49cb-a99d-3dd6a802fc5b"
}
```

| HTTP status | Meaning                                                        | Common code examples                                                        |
| ----------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `400`       | Malformed request                                              | `BAD_REQUEST`                                                               |
| `401`       | Missing, invalid, expired, or unavailable authentication/token | `UNAUTHORIZED`, `INVALID_UPLOAD_TOKEN`                                      |
| `403`       | Role or branch scope denied                                    | `FORBIDDEN`                                                                 |
| `404`       | Route or resource absent                                       | `SHIPMENT_NOT_FOUND`, `DOCUMENT_NOT_FOUND`                                  |
| `409`       | Duplicate value, invalid state, or business rule conflict      | `DUPLICATE_RECORD`, `INVALID_STATUS_TRANSITION`, `CLOSING_CONDITIONS_UNMET` |
| `422`       | Zod/body/file validation failure                               | `VALIDATION_ERROR`, `INVALID_FILE_TYPE`, `FILE_TOO_LARGE`                   |
| `429`       | Too many requests                                              | `RATE_LIMIT_EXCEEDED`                                                       |
| `500`       | Unexpected server failure                                      | `INTERNAL_ERROR`                                                            |

Do not retry `409`, `422`, or `403` responses without changing the request. It is safe to retry a network-failed shipment creation only with the same `Idempotency-Key`.

## Postman / frontend setup

Create these environment variables:

```text
baseUrl = http://localhost:5000/api
accessToken = <value returned by login>
shipmentId = <shipment ObjectId>
```

Set the collection authorization to **Bearer Token** and use `{{accessToken}}`. Keep cookie handling enabled in Postman if using refresh/logout without explicitly sending `refreshToken` in the JSON body.

For a browser frontend, send `credentials: "include"` for login, refresh, and logout so the HTTP-only refresh cookie can be stored and sent. Keep the access token in memory rather than long-lived browser storage.

## CRUD completion

All four resources (`users`, `branches`, `customers`, `shipments`) support `PATCH /api/{resource}/:id` for nonempty partial updates and `DELETE /api/{resource}/:id`. Existing PUT routes remain available. PATCH preserves existing role restrictions and BOOKED-only shipment editing.

DELETE is ADMIN-only and returns `data: { id, deleted: true }`. Employees, branches and customers must first be INACTIVE. Referenced records return 409 `RECORD_IN_USE`; retain them inactive for history. Administrator accounts cannot be deleted. Only BOOKED shipments without documents or an idempotency key can be deleted; use cancellation for other eligible shipments. Deletion and audit logging are transactional. Eligible shipment booking events and upload sessions are removed; audit history is retained.

`GET /api/branches/options` returns active branch IDs, codes, names and cities for internal destination selection, including employees. Existing branch details remain scoped.

Shipment details now correctly authorize populated branch IDs. Idempotency replay requires the original creator, permitted origin branch and matching supplied fields; mismatches return 409 `IDEMPOTENCY_KEY_CONFLICT`.

## Manager panel and role hierarchy

The internal hierarchy is **ADMIN > MANAGER > EMPLOYEE**. Managers have an assigned branch and sign in through the existing `/api/auth/login` endpoint; login, refresh and `/auth/me` return `role: "MANAGER"`. No customer login is added.

| Capability                                      | Admin        | Manager                            | Employee                           |
| ----------------------------------------------- | ------------ | ---------------------------------- | ---------------------------------- |
| Manage manager accounts                         | Yes          | No                                 | No                                 |
| Create/edit/activate/deactivate/reset employees | All branches | Assigned branch only               | No                                 |
| Create/edit branches                            | Yes          | No                                 | No                                 |
| Shipment dashboard, reports and details         | All branches | Assigned origin/destination branch | Assigned origin/destination branch |
| Booking/dispatch/edit/cancel                    | All branches | Assigned origin branch             | Assigned origin branch             |
| Receive/upload/complete                         | All branches | Assigned destination branch        | Assigned destination branch        |
| Verify/reject LR and close shipment             | All branches | Assigned destination branch        | No                                 |
| Admin override and guarded deletion             | Yes          | No                                 | No                                 |
| Customer directory                              | Yes          | Yes                                | Yes                                |

Admin-only manager directory: `POST/GET /api/managers`, `GET/PUT/PATCH/DELETE /api/managers/:id`, `PATCH /api/managers/:id/status`, `POST /api/managers/:id/reset-password`. Creation uses the employee fields: name, email, optional mobile, active branchId, password (12?128 characters). The server assigns MANAGER; clients cannot set or promote roles. Manager deletion follows inactive/unreferenced checks. Existing `/users` endpoints remain employee-only.

Frontend: Admin uses `/admin/managers` to provision managers. Manager login redirects to `/manager/dashboard`, with shipments, create LR, customers, employees, receive parcel, documents, reports, activity and password settings. Assigned-branch limits are enforced by the backend on each request. Managers can use the existing active-branch options endpoint for destination selection.

## Activity feed

`GET /api/activity` returns paginated activity records with `actor` (ID/name/role), action, entityType, entityId, entityLabel, createdAt and changedFields. Filters: page, limit (up to 100), search (actor snapshot name, action, record label/type/ID), action, entityType, dateFrom and dateTo. Dates must be ordered. Results are newest first.

Admin sees all audit events. Manager sees events performed by team members in their assigned branch at the time of the event, plus their own events. Employee sees only their own events. New events preserve actor name, role and branch snapshots across account updates/deletion/transfers. Legacy events have no historical branch snapshot: Admin and the original actor can see them; they are not assigned to a manager retroactively. Existing actor names are used as a fallback for legacy display. Passwords, tokens, raw before/after objects, IP addresses and user agents are not returned.

Tracked operations include record creation/update/status changes/deletion, password changes/reset, shipment transitions, document upload/verification and overrides. This is an operations feed, not page-view or login tracking. Admin panel: Team Activity (`/admin/audit`); Manager: Branch Activity (`/manager/activity`); Employee: My Activity (`/employee/activity`). The feed refreshes every 30 seconds and supports manual refresh.

## Bounded report responses

`GET /api/reports/shipments` now uses server-side pagination: `page` defaults to 1, `limit` defaults to 20 and is capped at 100. `data` remains an array but contains only the requested page. `pagination` supplies page/limit/total/pages. `summary: { total, statuses }` counts the complete authorized filtered result, not only the current page. Frontend reports consume these fields. CSV export remains a full filtered stream with backpressure and disconnect cleanup; page/limit do not restrict the export.

## Transport ERP / TMS modules

These modules extend the LR workflow and use the same bearer authentication, response envelope, pagination, request ID, branch scope, audit log and validation rules.

### Vendor master

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/vendors` | Admin | Create vendor code, commercial structure and vehicle mappings. |
| `GET` | `/vendors` | Internal | Search vendors and mapped vehicle numbers. |
| `GET` | `/vendors/:id` | Internal | Vendor commercial and vehicle detail. |
| `PUT/PATCH` | `/vendors/:id` | Admin | Replace/partially update vendor data. |
| `PATCH` | `/vendors/:id/status` | Admin | Activate or deactivate a vendor. |

Vendor types are `TRANSPORTER`, `CO_LOADER`, `VEHICLE_OWNER`, and `LAST_MILE`. Commercial rate bases are `PER_KG`, `PER_BOX`, `PER_TRIP`, and `FIXED`.

### Manifest and co-loader status

`POST/GET /manifests`, `GET /manifests/:id`, and `PATCH /manifests/:id/status` create branch-scoped manifests and update co-loader movement. Create requires `vendorId`, `destination`, and unique `shipmentIds`; Admin also supplies `branchId`. Only active co-loaders/transporters and eligible origin-branch LRs are accepted. Status values are `BOOKED`, `PICKED_UP`, `IN_TRANSIT`, `AT_HUB`, `OUT_FOR_DELIVERY`, `DELIVERED`, and `EXCEPTION`. `IN_TRANSIT` dispatches booked LRs through shipment history; `DELIVERED` closes the manifest.

### Trips

`POST/GET /trips`, `GET /trips/:id`, and `PATCH /trips/:id/status` manage vehicle, driver, route, dates, freight/advance and assigned LRs. Transitions are `PLANNED -> DISPATCHED -> ARRIVED -> CLOSED`, with `CANCELLED` allowed from `PLANNED`. Dispatch moves booked LRs to `IN_TRANSIT` and writes tracking events.

### Delivery run sheet and POD

| Method | Path | Purpose |
| --- | --- | --- |
| `POST/GET` | `/drs` | Create/list DRS records for eligible destination-branch LRs. |
| `GET` | `/drs/:id` | DRS, assigned LRs, Part B rows and POD checklist. |
| `PATCH` | `/drs/:id/vehicle` | Correct vehicle number and e-way bill Part B rows. |
| `POST` | `/drs/:id/pod/:shipmentId` | Upload POD using multipart field `pod`. |
| `POST` | `/drs/:id/close` | Close only after every assigned LR has POD. |

POD accepts signature-checked JPG/JPEG/PNG/WEBP/PDF files up to 10 MB. Files are versioned shipment documents of type `POD`; raw contents are never written to audit logs.

### Credit billing, receipts and receivables

`POST/GET /invoices`, `GET /invoices/:id`, and `PATCH /invoices/:id/status` are Admin/Manager endpoints. Invoices accept only completed/closed, unbilled LRs for one active credit customer. The server derives subtotal from saved LR charges and recalculates GST, total and balance.

`POST/GET /money-receipts`, `GET /money-receipts/:id`, and `GET /receivables/summary` record collections and report billed, received, outstanding and overdue totals. Allocations must equal the receipt amount, cannot exceed invoice balances and atomically update invoices to `PART_PAID` or `PAID`. Non-cash receipts require a transaction reference.

### Quotations

`POST /public/quotations` is public and rate-limited. It accepts contact/mobile, optional company/email, origin, destination, goods, package count and weight. It returns only a quotation reference and `REQUESTED`; public callers cannot set prices.

Internal Admin/Manager endpoints are `POST/GET /quotations`, `GET /quotations/:id`, and `PATCH /quotations/:id/status`. Internal updates set freight, GST, validity, notes and status; the server recalculates the total.

### Stationery

`POST/GET /stationery` records `RECEIVE` and `ISSUE` for `LR_BOOK`, `POD_BOOK`, `MONEY_RECEIPT_BOOK`, `LABEL`, or `OTHER`. Entries can carry serial ranges and a `VENDOR`, `FE`, or `BRANCH` recipient. `GET /stationery/stock` returns received, issued and available quantities. Over-issuing returns `409 INSUFFICIENT_STOCK`.

### External integration boundary

GST/e-way bill submission and WhatsApp/SMS delivery require production credentials, consent templates and provider compliance. The TMS stores validated e-way bill/Part B and notification-ready operational data, but does not fabricate provider success. Adapters should be enabled only after CRL supplies approved credentials and test access.
