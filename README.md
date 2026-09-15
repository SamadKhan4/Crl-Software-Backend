# CRL Transport Shipment & LR API

Production-oriented JavaScript backend for CRL Transport internal shipment operations and public LR tracking. It exposes a stable `/api` REST contract for a React/Vite client. Only `ADMIN`, `MANAGER`, and `EMPLOYEE` users authenticate—there is deliberately no customer account, password, JWT, dashboard, or registration flow.

## Stack and architecture

Node.js, Express, MongoDB/Mongoose, Zod, JWT, bcrypt, Multer, Pino, Helmet, CORS, rate limiting, Swagger UI, and Jest/Supertest. The request path is `routes -> controllers -> services -> Mongoose models`; controllers are intentionally thin. MongoDB is the selected datastore for this JavaScript project, so Prisma/PostgreSQL commands are not applicable.

```text
src/
  config/ constants/ controllers/ middlewares/ models/ routes/
  scripts/ services/ utils/ validators/
tests/
```

## Prerequisites

- Node.js 20+
- MongoDB 7+ replica set, or MongoDB Atlas. Transactions are required by shipment, status, document, and close workflows.
- A copy of `.env.example` as `.env`, with long unique JWT secrets.

```powershell
Copy-Item .env.example .env
npm install
npm run db:indexes
npm run seed
npm run dev
```

OpenAPI documentation is available in development at `http://localhost:5000/api/docs`. The detailed, shareable endpoint reference is in [API_DOCUMENTATION.md](./API_DOCUMENTATION.md). Health endpoints are `/api/health`, `/api/health/live`, and `/api/health/ready`.

## Environment variables

| Variable                                          | Required          | Purpose                                               |
| ------------------------------------------------- | ----------------- | ----------------------------------------------------- |
| `NODE_ENV`                                        | Yes               | `development`, `test`, or `production`                |
| `PORT`                                            | No                | HTTP port, default `5000`                             |
| `MONGODB_URI`                                     | Yes               | Replica-set or Atlas connection string                |
| `CORS_ORIGIN`                                     | Yes               | Comma-separated trusted frontend origins              |
| `JWT_ACCESS_SECRET`                               | Yes               | 32+ character access-token secret in production       |
| `JWT_REFRESH_SECRET`                              | Yes               | Different 32+ character refresh-token secret          |
| `ACCESS_TOKEN_EXPIRES_IN`                         | No                | Default `15m`                                         |
| `REFRESH_TOKEN_EXPIRES_IN` / `REFRESH_TOKEN_DAYS` | No                | Refresh-token lifetime                                |
| `COOKIE_SECURE`                                   | Yes in production | Must be `true` behind HTTPS                           |
| `STORAGE_DRIVER`                                  | No                | `local` or `cloudinary`                               |
| `UPLOAD_DIR` / `MAX_FILE_SIZE`                    | No                | Secure local root and file limit; default 10 MB       |
| `UPLOAD_TOKEN_MINUTES`                            | No                | One-time customer-upload session lifetime, default 20 |
| `CLOUDINARY_*`                                    | For Cloudinary    | Cloud name, API key, and secret                       |
| `SEED_ADMIN_PASSWORD`                             | Development only  | Seed password; never use in production                |

Production startup fails fast when database/JWT/CORS configuration is missing, JWT secrets are short, wildcard CORS is configured, or secure cookies are disabled.

## Authentication and permissions

`POST /api/auth/login` returns a short-lived access token and sets a refresh token in an HTTP-only, SameSite cookie. Send the access token as `Authorization: Bearer <token>`. Refresh tokens are SHA-256 hashed in the database, rotated for every refresh, revoked at logout, and their family is revoked if a previously used token is reused.

- `ADMIN`: full access, manager and employee management, all branches, document verification, closure, and explicit overrides.
- `MANAGER`: employee management within the assigned branch, branch shipment operations, destination document verification and closure.
- `EMPLOYEE`: customer access, only their assigned branch in branch views, and shipment operations tied to their origin/destination branch.
- Customer: no authentication. They use an LR number, customer code, and a short-lived one-time document-upload token.

Employees cannot create/modify/disable/reset administrators. Administrator accounts are therefore not mutable through employee-management APIs, protecting the last active admin account by design.

## Shipment workflow

```text
BOOKED -> IN_TRANSIT -> RECEIVED -> LR_IMAGE_UPLOADED
       -> LR_IMAGE_VERIFIED -> COMPLETED -> CLOSED
```

`BOOKED` and `IN_TRANSIT` may move to `CANCELLED`. A rejected document moves `LR_IMAGE_UPLOADED` back to `RECEIVED`. Every state change is checked by the single transition map in `src/constants/workflow.js`, creates an immutable `ShipmentEvent`, and writes an audit record in the same MongoDB transaction.

| Current            | Allowed next                           |
| ------------------ | -------------------------------------- |
| BOOKED             | IN_TRANSIT, CANCELLED                  |
| IN_TRANSIT         | RECEIVED, CANCELLED                    |
| RECEIVED           | LR_IMAGE_UPLOADED                      |
| LR_IMAGE_UPLOADED  | LR_IMAGE_VERIFIED, RECEIVED (rejected) |
| LR_IMAGE_VERIFIED  | COMPLETED                              |
| COMPLETED          | CLOSED                                 |
| CLOSED / CANCELLED | none                                   |

Shipments are editable only while `BOOKED`. Any later correction requires the audited `POST /api/shipments/:id/admin-override` endpoint with an explicit reason. A closed shipment is never silently modified.

## Customer document uploads

LR files may be JPG, JPEG, PNG, WEBP, or PDF, up to 10 MB. The API validates MIME type, filename extension, magic bytes, file size, server-generated filename, and SHA-256 checksum. It never serves the local uploads directory as a public static directory.

An internal operator can create a short-lived token through `POST /api/shipments/:id/lr-upload-token`. A customer-facing application may use `POST /api/public/lr-upload/request` with customer code and LR number, then submit `lrImage` using `POST /api/public/lr-upload/:token`. Tokens are cryptographically random, stored only as hashes, single-use, rate-limited, and expire in 5–60 minutes. Documents are versioned: a new image after rejection creates a later version rather than replacing history.

`LocalStorageService` is the default. `CloudStorageService` uploads to Cloudinary when `STORAGE_DRIVER=cloudinary`; it is isolated from business logic so an object-store provider can be changed without workflow changes.

## API reference

All internal endpoints require an access token unless marked public. List endpoints paginate with `page`, `limit` (maximum 100), `search`, `sortBy`, and `sortOrder`.

| Method            | Path                                                              | Role             | Purpose                                  |
| ----------------- | ----------------------------------------------------------------- | ---------------- | ---------------------------------------- |
| POST              | `/api/auth/login`, `/refresh`, `/logout`                          | Public           | Internal session lifecycle               |
| GET / POST        | `/api/users`                                                      | ADMIN            | List or create employees                 |
| GET / PUT         | `/api/users/:id`                                                  | ADMIN            | Read or update employee                  |
| PATCH / POST      | `/api/users/:id/status`, `/reset-password`                        | ADMIN            | Account control                          |
| POST / GET        | `/api/branches`                                                   | ADMIN / internal | Create or list branches                  |
| GET / PUT / PATCH | `/api/branches/:id`, `/:id/status`                                | Scoped / ADMIN   | Read or administer branch                |
| POST / GET        | `/api/customers`                                                  | Internal         | Create or list customers                 |
| GET               | `/api/customers/:id`, `/api/customers/code/:customerCode`         | Internal         | Customer lookup                          |
| PUT / PATCH       | `/api/customers/:id`, `/:id/status`                               | Internal         | Update or deactivate customer            |
| POST / GET        | `/api/shipments`                                                  | Internal         | Create/idempotently replay or filter LRs |
| GET / PUT         | `/api/shipments/:id`                                              | Branch scoped    | Detail or booked-only edit               |
| GET               | `/api/shipments/:id/history`                                      | Branch scoped    | Immutable tracking events                |
| GET               | `/api/shipments/:id/documents/:documentId/download`               | Branch scoped    | Authorized document download             |
| POST              | `/api/shipments/:id/status`, `/receive`, `/complete`              | Branch scoped    | Workflow operations                      |
| POST              | `/api/shipments/:id/lr-image`, `/lr-upload-token`                 | Branch scoped    | Internal document upload/token           |
| POST              | `/api/shipments/:id/lr-image/verify`, `/close`, `/admin-override` | ADMIN            | Verification, closure, correction        |
| GET               | `/api/public/track/:lrNumber`, `/api/track?lrNumber=`             | Public           | Rate-limited safe tracking               |
| POST              | `/api/public/lr-upload/request`, `/api/public/lr-upload/:token`   | Public token     | Secure no-login upload                   |
| GET               | `/api/dashboard/summary`, `/api/reports/shipments`, `/export`     | Internal         | Dashboard and CSV reporting              |
| GET               | `/api/health`, `/live`, `/ready`                                  | Public           | Liveness and readiness                   |

Swagger UI documents endpoint parameters, roles, bodies, and standard error responses in development.

## Database models and indexes

`Counter` atomically allocates customer and employee sequences; shipment LR numbers are entered manually and protected by a unique index. `User` has unique email/employee code and a branch assignment. `RefreshToken` belongs to users and refresh-token families. `Branch`, `Customer`, `Shipment`, `ShipmentEvent`, `ShipmentDocument`, `UploadSession`, and `AuditLog` cover the operational workflow.

Unique indexes protect user email/code, customer code, branch code, LR number, idempotency keys, document versions, and pending LR-document conflicts. Targeted indexes cover shipment filters, tracking history, document lookup, customer lookup, and token expiry. Run `npm run db:indexes` during deployment because production disables automatic index creation.

## Commands and test suite

```powershell
npm run dev
npm run build
npm start
npm run lint
npm run format
npm run format:check
npm test
npm run test:integration
npm run test:stress
npm run test:coverage
npm run test:coverage:integration
npm run db:indexes
npm run seed
```

`npm test` runs fast unit/request-validation checks. `npm run test:integration` starts an isolated MongoDB replica set and verifies the full shipment lifecycle, idempotency, events, audit logging, and public tracking. `npm run test:stress` additionally sends 100 simultaneous LR creation requests and verifies unique manually supplied LR numbers. Do not point either at a production database.

## Deployment

1. Provision MongoDB Atlas or a self-hosted replica set; create a least-privilege database user.
2. Configure the production environment—HTTPS URL(s), strong secrets, `COOKIE_SECURE=true`, private/durable object storage, and a safe `CORS_ORIGIN` list.
3. Deploy and run:

```powershell
npm ci
npm run db:indexes
npm run build
npm start
```

PM2 example:

```powershell
pm2 start src/server.js --name crl-api --time
pm2 save
pm2 startup
```

Place Nginx/HTTPS in front of Node, forward `X-Forwarded-For` and `X-Forwarded-Proto`, and proxy to the configured local port. Express is configured to trust one proxy hop. Do not expose `uploads/` through Nginx.

Backups for self-hosted MongoDB should follow daily/weekly/monthly retention, with encrypted off-host copies and regular restore drills:

```powershell
mongodump --uri="$env:MONGODB_URI" --out="backups\daily"
mongorestore --uri="$env:MONGODB_URI" "backups\daily\crl_transport"
```

For Atlas, configure scheduled snapshots and test point-in-time restore. Never delete backup sets automatically without an approved retention policy.

## Production security checklist

- No plaintext passwords, JWT secrets, refresh tokens, or customer documents are committed.
- Helmet, restrictive CORS, per-surface rate limits, 1 MB request body limits, and 10 MB file limits are enabled.
- `X-Request-ID` is generated or safely reused, returned to clients, and included in structured logs/audit entries.
- API errors are standardized and do not return stack traces, database details, token data, or filesystem paths.
- Closed shipments are protected, tracking events have no deletion API, and all critical workflows use transactions.

## Manager workspace

Admin can provision a manager from **Admin ? Managers ? Add manager**, assign an active branch and set the initial password. Managers use the same login screen and land at `/manager/dashboard`. They manage employees within their branch and can verify LR documents and close destination-branch shipments. Manager accounts and branch configuration remain admin-only. See `API_DOCUMENTATION.md` for the complete permissions matrix and manager CRUD endpoints. Existing accounts need no migration; restart the backend to load the new MANAGER role. No production accounts are created automatically.

## Local MongoDB status-update failure

If a write returns `DATABASE_TRANSACTIONS_UNAVAILABLE` (503), MongoDB is running standalone. Shipment changes must retain transactional event/audit writes. Do not remove transactions to bypass this error.

For the local Windows MongoDB 8.3 service, open PowerShell as Administrator from this backend directory and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\src\scripts\enable-local-replica-set.ps1
```

The helper requires a localhost-only service, backs up `mongod.cfg`, preserves the data directory, enables `rs0`, restarts MongoDB and initializes the single-node replica set. For a different installation, pass `-ConfigPath` and `-ServiceName`. If replication is already configured differently, it stops for inspection. This helper is for local development only; use your managed replica set or Atlas in production. Once MongoDB is primary, retry the failed action. The `.env.example` includes the rs0 connection URI.

## Database model structure and query optimization

`src/models/` contains separate `*.model.js` modules for User, Branch, Customer, Shipment, ShipmentEvent, ShipmentDocument, AuditLog, RefreshToken, UploadSession and Counter. `shared.js` holds common schema settings. `index.js` re-exports the same model names, so imports, collection names, existing data, unique constraints, TTL expiration and references remain compatible. Admin/Manager/Employee remain roles within User to retain one authentication system and globally unique user emails.

Compound indexes cover recent shipments, origin/destination/customer/status shipment lists, employee directories by role/branch, recent/branch/actor activity and active branch choices. Index definitions are registered before models compile. Pagination uses `_id` as a deterministic tie-breaker. Searches treat metacharacters as literal text. Activity reads project only display fields and allowed changed fields; CSV reads use projected lean documents.

- `npm run db:indexes:check`: inspect missing and extra indexes without building or dropping indexes.
- `npm run db:indexes`: add required indexes sequentially; never drop existing indexes.
- `npm run db:explain`: read-only execution plans for representative list queries in the configured database.

Index additions need no data migration. Extra indexes listed by the check command are retained intentionally; assess workload before manually removing them. Case-insensitive substring searches and arbitrary secondary sort combinations may still scan; large reports still return all matching rows for API compatibility. Offset pagination becomes more expensive at deep pages. Query-plan results on development data are not production load benchmarks.
