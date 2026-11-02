import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: '.env', override: true });
const EJSON = mongoose.mongo.BSON.EJSON;
const encode = value => EJSON.stringify(value, null, 2, { relaxed: false });
const c = await mongoose.createConnection(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 }).asPromise();
const path = 'backups/dummy-master-cleanup-plan.json';
const normalize = docs => encode([...docs].sort((a,b) => String(a._id).localeCompare(String(b._id))));
function mentions(value, id) {
  if (value == null) return false;
  if (typeof value === 'string' || value._bsontype === 'ObjectId') return String(value) === id;
  if (Array.isArray(value)) return value.some(v => mentions(v, id));
  if (typeof value === 'object' && !(value instanceof Date)) return Object.entries(value).some(([k,v]) => k !== '_id' && mentions(v,id));
  return false;
}
try {
  if (!process.argv.includes('--apply')) {
    const data = {};
    for (const {name,type} of await c.db.listCollections().toArray()) {
      if(type === 'collection' && !name.startsWith('system.')) data[name] = await c.collection(name).find({}).toArray();
    }
    const candidates = [];
    for (const [name, docs] of Object.entries(data)) {
      if (!['customers','vendors','branches','businessmasters','ratecards','tmsregisters'].includes(name)) continue;
      for (const d of docs) {
        const code = d.code || d.recordNumber || d.vendorCode || d.branchCode || '';
        const demo = /DEMO/i.test(code) || /@(.*\.)?example\.(test|com)$|\.example$/i.test(d.email || '');
        const xyz = ['customers','vendors'].includes(name) && /\bXYZ\b/i.test(`${d.name || ''} ${d.companyName || ''}`);
        if(demo || xyz) candidates.push({collection:name,id:String(d._id),label:d.name || d.companyName || code,reason:xyz?'User-confirmed XYZ dummy':'Explicit demo code or example email'});
      }
    }
    const ids = new Set(candidates.map(x=>x.id));
    // Remove attached rate/vehicle records for the explicitly deleted dummy parties.
    const parties = candidates.filter(x=>['customers','vendors'].includes(x.collection)).map(x=>x.id);
    for (const name of ['ratecards','tmsregisters','businessmasters']) for(const d of data[name]) {
      if(!ids.has(String(d._id)) && parties.some(id=>String(d.vendorId)===id || String(d.customerId)===id)) {
        candidates.push({collection:name,id:String(d._id),label:d.name || d.title || d.code,reason:'Attached to dummy party'});
        ids.add(String(d._id));
      }
    }
    // Never damage retained users, HR or real master dependencies.
    const protectedRecords=[];
    let changed;
    do {
      changed=false;
      for (const candidate of candidates.filter(x=>ids.has(x.id))) {
        const refs=[];
        for(const [name,docs] of Object.entries(data)) {
          if(name==='auditlogs') continue;
          for(const d of docs) if(!ids.has(String(d._id)) && mentions(d,candidate.id)) refs.push({collection:name,id:String(d._id)});
        }
        if(refs.length) { ids.delete(candidate.id); protectedRecords.push({...candidate,referencedBy:refs}); changed=true; }
      }
    } while(changed);
    const plan=Object.fromEntries(Object.entries(data).map(([name,docs])=>[name,docs.filter(d=>ids.has(String(d._id)) || (name==='auditlogs' && ids.has(String(d.entityId)))).map(d=>d._id)]));
    const backup='backups/dummy-masters-before-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
    await fs.writeFile(backup,encode({database:c.name,collections:data}),{flag:'wx'});
    await fs.writeFile(path,encode({backup,plan,targets:candidates.filter(x=>ids.has(x.id)),protectedRecords}));
    console.log(JSON.stringify({backup,targets:candidates.filter(x=>ids.has(x.id)),protectedRecords,counts:Object.fromEntries(Object.entries(plan).filter(([,ids])=>ids.length).map(([k,ids])=>[k,ids.length]))}));
  } else {
    const prepared=EJSON.parse(await fs.readFile(path,'utf8'));
    const {collections:data,database}=EJSON.parse(await fs.readFile(prepared.backup,'utf8'));
    assert.equal(c.name,database);
    const expected=Object.fromEntries(Object.entries(data).map(([name,docs])=>[name,docs.filter(d=>!prepared.plan[name].some(id=>String(id)===String(d._id)))]));
    const session=await c.startSession();
    try {
      await session.withTransaction(async()=>{
        for(const [name,docs] of Object.entries(data)) {
          if(name==='refreshtokens') continue;
          assert.equal(normalize(await c.collection(name).find({},{session}).toArray()),normalize(docs),`${name} changed since backup`);
        }
        for(const [name,ids] of Object.entries(prepared.plan)) if(ids.length) {
          assert.equal((await c.collection(name).deleteMany({_id:{$in:ids}},{session})).deletedCount,ids.length);
        }
        for(const [name,docs] of Object.entries(expected)) {
          if(name==='refreshtokens') continue;
          assert.equal(normalize(await c.collection(name).find({},{session}).toArray()),normalize(docs),`Verification failed: ${name}`);
        }
      },{readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
    } finally {await session.endSession();}
    for(const [name,docs] of Object.entries(expected)) {
      if(name==='refreshtokens') continue;
      assert.equal(normalize(await c.collection(name).find({}).toArray()),normalize(docs),`Post-commit verification failed: ${name}`);
    }
    const result={deleted:Object.values(prepared.plan).reduce((n,ids)=>n+ids.length,0),masterRecordsDeleted:prepared.targets.length,usersPreserved:expected.users.length,backup:prepared.backup,protectedRecords:prepared.protectedRecords,verified:true};
    await fs.writeFile('backups/dummy-master-cleanup-result.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  }
} finally {await c.close();}
