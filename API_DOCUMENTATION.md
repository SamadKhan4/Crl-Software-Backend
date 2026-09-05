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

| Role       | Access                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `ADMIN`    | Full access; employee administration, all branches, LR verification, shipment closure, and audited overrides. |
| `EMPLOYEE` | Internal operations restricted to their assigned origin/destination branch.                                   |
| Customer   | Public tracking and a short-lived, one-time LR upload token only.                                             |

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
| `LR_IMAGE_UPLOADED`   | `LR_IMAGE_VERIFIED`, `RECEIVED` | Admin verifies or rejects document                                |
| `LR_IMAGE_VERIFIED`   | `COMPLETED`                     | Complete shipment                                                 |
| `COMPLETED`           | `CLOSED`                        | Admin closes shipment                                             |
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

Every endpoint in this section requires `Authorization: Bearer <accessToken>`. “Scoped” means employees may operate only on their permitted branch; administrators can operate across all branches.

### Dashboard and reports

| Method | Path                        | Access   | Description                                                          |
| ------ | --------------------------- | -------- | -------------------------------------------------------------------- |
| `GET`  | `/dashboard/summary`        | Internal | Counts by status, today/month totals, and admin-only branch summary. |
| `GET`  | `/reports/shipments`        | Internal | Filtered shipment report in JSON.                                    |
| `GET`  | `/reports/shipments/export` | Internal | Same filter set, returned as CSV download.                           |

Reports accept optional `dateFrom`, `dateTo`, `status`, `branch`, and `customer` values. `branch` and `customer` must be ObjectIds.

### Employee management (administrator only)

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

| Method | Path                            | Access                    | Description                                          |
| ------ | ------------------------------- | ------------------------- | ---------------------------------------------------- |
| `POST` | `/shipments`                    | Origin scoped             | Creates a shipment and server-generated LR number.   |
| `GET`  | `/shipments`                    | Scoped                    | Lists shipments.                                     |
| `GET`  | `/shipments/:id`                | Scoped                    | Full shipment details and document metadata.         |
| `PUT`  | `/shipments/:id`                | Origin scoped             | Edits a `BOOKED` shipment only.                      |
| `GET`  | `/shipments/:id/history`        | Scoped                    | Immutable status/event timeline.                     |
| `POST` | `/shipments/:id/status`         | Origin/destination scoped | Moves to `IN_TRANSIT` or cancels as workflow allows. |
| `POST` | `/shipments/:id/receive`        | Destination scoped        | Marks an in-transit shipment as received.            |
| `POST` | `/shipments/:id/complete`       | Destination scoped        | Completes a verified shipment.                       |
| `POST` | `/shipments/:id/close`          | `ADMIN`                   | Closes an eligible completed shipment.               |
| `POST` | `/shipments/:id/admin-override` | `ADMIN`                   | Applies an explicit audited correction.              |

Create shipment payload:

```json
{
  "customerId": "66d8f14124b86f067a916602",
  "originBranchId": "66d8f14124b86f067a916601",
  "destinationBranchId": "66d8f14124b86f067a916603",
  "senderName": "Ravi Enterprises",
  "receiverName": "Neha Traders",
  "receiverMobile": "+919876543210",
  "packageCount": 4,
  "weightKg": 125.5,
  "description": "Electrical components",
  "expectedDeliveryDate": "2026-09-10T00:00:00.000Z"
}
```

Use a unique `Idempotency-Key` header when creating a shipment. Retrying the same request with the same key returns the originally created shipment instead of allocating another LR number.

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

### LR document operations

| Method | Path                                            | Access             | Description                                    |
| ------ | ----------------------------------------------- | ------------------ | ---------------------------------------------- |
| `POST` | `/shipments/:id/lr-image`                       | Destination scoped | Internal LR upload after receipt.              |
| `POST` | `/shipments/:id/lr-image/verify`                | `ADMIN`            | Verifies or rejects the pending LR document.   |
| `POST` | `/shipments/:id/lr-upload-token`                | Destination scoped | Generates a customer one-time upload token.    |
| `GET`  | `/shipments/:id/documents/:documentId/download` | Scoped             | Streams/downloads only an authorized document. |

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
