import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Explicitly preserve users, masters, HR, authentication, and sequence counters.
const EJSON = mongoose.mongo.BSON.EJSON;
const source = 'backups/full-reset-snapshot-2026-11-02T06-56-28-619Z.json';
const snapshot = EJSON.parse(await fs.readFile(source, 'utf8'));
const data = snapshot.collections;
const clear = new Set([
  'shipments', 'pickuprunsheets', 'pickuprequests', 'bookings', 'segregations',
  'loadingtallies', 'manifests', 'trips', 'movementlegs', 'unloadingtallies',
  'deliveryrunsheets', 'packageunits', 'shipmentevents', 'shipmentdocuments',
  'uploadsessions', 'invoices', 'moneyreceipts', 'quotations',
  'stationerytransactions', 'notifications',
]);
const keepModules = new Set(['FLEET', 'DRIVER', 'HR', 'SYSTEM_SETTING']);
const operationalTypes = new Set([
  'Shipment', 'PickupRunSheet', 'PickupRequest', 'Booking', 'Segregation',
  'LoadingTally', 'Manifest', 'Trip', 'MovementLeg', 'UnloadingTally',
  'DeliveryRunSheet', 'PackageUnit', 'ShipmentEvent', 'ShipmentDocument',
  'UploadSession', 'Invoice', 'MoneyReceipt', 'Quotation', 'StationeryTransaction', 'Notification',
]);
const keptRegisterIds = new Set(data.tmsregisters.filter(d => keepModules.has(d.module)).map(d => String(d._id)));
function shouldDelete(name, doc) {
  if (clear.has(name)) return true;
  if (name === 'tmsregisters') return !keepModules.has(doc.module);
  if (name === 'auditlogs') {
    if (operationalTypes.has(doc.entityType)) return true;
    if (doc.entityType === 'TmsRegister') {
      if (keptRegisterIds.has(String(doc.entityId))) return false;
      const module = doc.newValue?.module || doc.oldValue?.module;
      return module ? !keepModules.has(module) : /^(PICKUP|PTL|FTL|HUB|HANDLING|VENDOR_SETTLEMENT|EWAY_GST|ACCOUNTING|CLAIM|NOTIFICATION)_/.test(doc.action);
    }
  }
  return false;
}
const plan = Object.fromEntries(Object.entries(data).map(([name, docs]) => [name, docs.filter(d => shouldDelete(name, d)).map(d => d._id)]));
const preserved = Object.fromEntries(Object.entries(data).map(([name, docs]) => [name, docs.filter(d => !shouldDelete(name, d))]));
const summary = Object.fromEntries(Object.entries(data).map(([name, docs]) => [name, { before: docs.length, delete: plan[name].length, remaining: preserved[name].length }]));
console.log(JSON.stringify(summary, null, 2));
if (!process.argv.includes('--apply')) process.exit(0);
dotenv.config({ path: '.env', override: true });
const c = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }).asPromise();
const session = await c.startSession();
const normalize = docs => EJSON.stringify([...docs].sort((a, b) => String(a._id).localeCompare(String(b._id))), null, 0, { relaxed: false });
try {
  assert.equal(c.name, snapshot.database);
  await session.withTransaction(async () => {
    // Check frozen target records and preserved business/account data before writing.
    for (const [name, docs] of Object.entries(data)) {
      if (name === 'refreshtokens') continue; // TTL expiry is independent of this cleanup.
      const live = await c.collection(name).find({}, { session }).toArray();
      assert.equal(normalize(live), normalize(docs), `${name} changed since backup; aborting`);
    }
    for (const [name, ids] of Object.entries(plan)) {
      if (!ids.length) continue;
      const result = await c.collection(name).deleteMany({ _id: { $in: ids } }, { session });
      assert.equal(result.deletedCount, ids.length);
    }
    for (const [name, docs] of Object.entries(preserved)) {
      if (name === 'refreshtokens') continue;
      assert.equal(normalize(await c.collection(name).find({}, { session }).toArray()), normalize(docs), `Verification failed: ${name}`);
    }
  }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  for (const [name, docs] of Object.entries(preserved)) {
    if (name === 'refreshtokens') continue;
    assert.equal(normalize(await c.collection(name).find({}).toArray()), normalize(docs), `Post-commit verification failed: ${name}`);
  }
  const result = {
    backup: source,
    deleted: Object.values(plan).reduce((sum, ids) => sum + ids.length, 0),
    usersPreserved: preserved.users.length,
    lrCount: await c.collection('shipments').countDocuments(),
    invoiceCount: await c.collection('invoices').countDocuments(),
    receiptCount: await c.collection('moneyreceipts').countDocuments(),
    costAndSettlementCount: await c.collection('tmsregisters').countDocuments({ module: { $in: ['PICKUP', 'PTL', 'FTL', 'HANDLING', 'ACCOUNTING', 'VENDOR_SETTLEMENT'] } }),
    summary,
    verified: true,
  };
  await fs.writeFile('backups/lr-revenue-operations-reset-result-'+new Date().toISOString().replace(/[:.]/g, '-')+'.json', JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(result));
} finally {
  await session.endSession();
  await c.close();
}
