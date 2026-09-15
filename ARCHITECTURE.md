# CRL runtime architecture

The application is a modular monolith with domain-specific routers, controllers and services. It is not a fleet of independently deployed microservices. This keeps shipment, document, event and audit writes in one MongoDB transaction while addressing the measured query and response-size bottlenecks. Existing endpoint paths remain stable.

| Module              | Routes and controllers | Responsibility                                            |
| ------------------- | ---------------------- | --------------------------------------------------------- |
| Identity            | auth, users            | Authentication and Admin/Manager/Employee hierarchy       |
| Directory           | branches, customers    | Branch and customer records                               |
| Shipment operations | shipments, public      | Booking, tracking, receiving, LR documents and completion |
| Analytics           | analytics              | Dashboard, activity and shipment reports                  |

`src/routes/index.js` composes routers and applies internal authentication once. Domain controllers call existing service modules. Compatibility exports in `controllers/controllers.js` and `models/index.js` remain available. Deletion/reference checks and audit writes are intentionally shared transactional dependencies.

## Runtime bounds

- Each process has a configurable MongoDB connection limit (default 30), a 5-second queue wait and idle connection eviction. Allocate the database connection budget across all application replicas.
- Reports return at most 100 records per request, with totals calculated separately in MongoDB. CSV exports stream projected lean records with backpressure and close their cursor on completion, error or disconnect.
- Graceful shutdown marks readiness unavailable, stops new connections, drains active requests and disconnects MongoDB. The deadline forces exit if a request never completes.
- Existing compound indexes, literal searches, deterministic pagination and projected reads remain in place.

## Frontend state

Redux Toolkit owns the public session profile, restore status and sidebar state. Access tokens remain in the API client's memory and are excluded from Redux, persistence and Redux actions. Existing AuthContext is a compatibility adapter to Redux so page interfaces remain stable. Logout clears session/workspace state; role, account or branch changes clear query caches.

TanStack Query remains the single cache for server data. Duplicating shipments/customers in Redux would create additional synchronization work. Redux does not speed up MongoDB queries.

## Deployment limits and extraction path

This change does not claim production throughput numbers. Before adding replicas, use shared document storage (the existing Cloudinary adapter or a supported shared filesystem), enforce distributed rate limits at the ingress or a shared rate-limit store, and test the target database/storage/network capacity. Current Express rate-limit counters are process-local; local uploads are not automatically shared. MongoDB must run as a replica set or through Atlas.

If workloads justify service extraction, analytics is the first candidate: introduce versioned event contracts, a transactional outbox, an idempotent consumer and a separate read database before independent deployment. Shipping only folders as different processes would retain database coupling without providing safe data ownership. Identity and shipment extraction require additional authorization, failure handling, observability and distributed consistency design.

Operational commands: `npm run db:indexes:check`, `npm run db:indexes`, `npm run db:explain`, `npm run test:integration`, and `npm run test:stress` (isolated test replica set).
