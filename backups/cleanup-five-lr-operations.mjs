import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// One-time, snapshot-guarded FM/MM/LM cleanup. Run from crl-backend.
const EJSON = mongoose.mongo.BSON.EJSON;
const encode = value => EJSON.stringify(value, null, 2, { relaxed: false });
const source = 'backups/operations-cleanup-snapshot.json';
const data = EJSON.parse(await fs.readFile(source, 'utf8'));
const expected = ['CRL1001', 'CRL1002', 'CRL1003', 'CRL207301', 'CRL207302'];
assert.deepEqual(data.shipments.map(d => d.lrNumber).sort(), expected);
const shipmentIds = new Set(data.shipments.map(d => String(d._id)));
const operationModules = new Set(['PICKUP', 'PTL', 'FTL', 'HUB', 'HANDLING']);
const inScope = (name, d) => name !== 'tmsregisters' || operationModules.has(d.module);
const direct = d => shipmentIds.has(String(d.shipmentId)) ||
  d.shipmentIds?.some(id => shipmentIds.has(String(id)));
const retained = Object.fromEntries(Object.entries(data).map(([name, docs]) =>
  [name, new Set(docs.filter(d => name === 'shipments' || !inScope(name, d) || direct(d)).map(d => String(d._id)))]));
const refs = {
  shipmentId: 'shipments', shipmentIds: 'shipments', podShipmentIds: 'shipments',
  pickupRequestId: 'pickuprequests', pickupRequestIds: 'pickuprequests', marketPickupRequestId: 'pickuprequests',
  pickupRunSheetId: 'pickuprunsheets', segregationId: 'segregations',
  loadingTallyId: 'loadingtallies', manifestId: 'manifests', manifestIds: 'manifests',
  tripId: 'trips', movementLegId: 'movementlegs', activeMovementLegId: 'movementlegs',
  unloadingTallyId: 'unloadingtallies', drsId: 'deliveryrunsheets', activeDrsId: 'deliveryrunsheets',
  podDocumentId: 'shipmentdocuments', documentId: 'shipmentdocuments',
};
function visit(value, fn) {
  if (!value || typeof value !== 'object' || value instanceof Date || value._bsontype) return;
  if (Array.isArray(value)) return value.forEach(v => visit(v, fn));
  for (const [key, item] of Object.entries(value)) {
    if (refs[key] && item != null) for (const id of Array.isArray(item) ? item : [item]) fn(refs[key], String(id), key);
    else visit(item, fn);
  }
}
// Follow explicit operational references, never shared customer/vendor/branch links.
let changed;
do {
  changed = false;
  for (const [name, docs] of Object.entries(data)) {
    for (const doc of docs.filter(d => inScope(name, d) && retained[name].has(String(d._id)))) {
      visit(doc, (target, id) => {
        assert(data[target].some(d => String(d._id) === id), `Missing ${target}/${id} from retained ${name}/${doc._id}`);
        if (target === 'shipments') assert(shipmentIds.has(id), 'Mixed LR record needs manual reconciliation');
        if (!retained[target].has(id)) { retained[target].add(id); changed = true; }
      });
    }
  }
} while (changed);
const plan = Object.fromEntries(Object.entries(data).filter(([name]) => name !== 'shipments').map(([name, docs]) =>
  [name, docs.filter(d => inScope(name, d) && !retained[name].has(String(d._id))).map(d => d._id)]));
const summary = Object.fromEntries(Object.entries(data).map(([name, docs]) =>
  [name, { before: docs.length, delete: plan[name]?.length || 0, remaining: retained[name].size }]));
console.log(JSON.stringify(summary, null, 2));
if (!process.argv.includes('--apply')) process.exit(0);

dotenv.config({ path: '.env', override: true });
const c = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }).asPromise();
const session = await c.startSession();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `backups/operations-before-cleanup-${stamp}.json`;
try {
  await fs.writeFile(backup, encode({ database: c.name, keep: expected, collections: data, plan }), { flag: 'wx' });
  const normalized = docs => encode([...docs].sort((a, b) => String(a._id).localeCompare(String(b._id))));
  await session.withTransaction(async () => {
    for (const [name, docs] of Object.entries(data)) {
      const live = await c.collection(name).find({}, { session }).toArray();
      assert.equal(normalized(live), normalized(docs), `${name} changed since snapshot; aborting`);
    }
    for (const [name, ids] of Object.entries(plan)) {
      if (!ids.length) continue;
      const result = await c.collection(name).deleteMany({ _id: { $in: ids } }, { session });
      assert.equal(result.deletedCount, ids.length, `Deletion count mismatch in ${name}`);
    }
    for (const [name, docs] of Object.entries(data)) {
      const remaining = await c.collection(name).find({}, { session }).toArray();
      const expectedDocs = docs.filter(d => retained[name].has(String(d._id)));
      assert.equal(normalized(remaining), normalized(expectedDocs), `Preservation check failed in ${name}`);
    }
  }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  for (const [name, docs] of Object.entries(data)) {
    const live = await c.collection(name).find({}).toArray();
    assert.equal(normalized(live), normalized(docs.filter(d => retained[name].has(String(d._id)))), `Post-commit check failed: ${name}`);
  }
  const report = { database: c.name, keep: expected, backup, deleted: Object.values(plan).reduce((n, ids) => n + ids.length, 0), summary, verified: true };
  await fs.writeFile(`backups/operations-cleanup-result-${stamp}.json`, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(report));
} finally {
  await session.endSession();
  await c.close();
}
