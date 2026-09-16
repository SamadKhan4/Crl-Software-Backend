import bcrypt from "bcryptjs";
import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { Branch, Counter, Customer, Shipment, ShipmentDocument, ShipmentEvent, User } from "../models/index.js";
import { ROLES, SHIPMENT_STATUS } from "../constants/workflow.js";

const password = process.env.SEED_ADMIN_PASSWORD || "ChangeThisDevelopmentPassword123!";
const statuses = [
  SHIPMENT_STATUS.BOOKED,
  SHIPMENT_STATUS.IN_TRANSIT,
  SHIPMENT_STATUS.RECEIVED,
  SHIPMENT_STATUS.LR_IMAGE_UPLOADED,
  SHIPMENT_STATUS.LR_IMAGE_VERIFIED,
  SHIPMENT_STATUS.LR_IMAGE_VERIFIED,
  SHIPMENT_STATUS.COMPLETED,
  SHIPMENT_STATUS.CLOSED,
  SHIPMENT_STATUS.CANCELLED,
  SHIPMENT_STATUS.BOOKED,
];
const upsertUser = async ({ employeeCode, email, name, role, branchId }) =>
  User.findOneAndUpdate(
    { email },
    { $set: { employeeCode, name, role, branchId, status: "ACTIVE", passwordHash: await bcrypt.hash(password, 12) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

const run = async () => {
  await connectDatabase();
  const nagpur = await Branch.findOneAndUpdate(
    { branchCode: "NGP" },
    {
      $set: {
        name: "Nagpur Branch",
        city: "Nagpur",
        state: "Maharashtra",
        pincode: "440001",
        phone: "9000000001",
        email: "nagpur@example.test",
        status: "ACTIVE",
      },
    },
    { upsert: true, new: true },
  );
  const mumbai = await Branch.findOneAndUpdate(
    { branchCode: "BOM" },
    {
      $set: {
        name: "Mumbai Branch",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        phone: "9000000002",
        email: "mumbai@example.test",
        status: "ACTIVE",
      },
    },
    { upsert: true, new: true },
  );
  const admin = await upsertUser({
    employeeCode: "CRLEMP000001",
    email: "admin@crl-transport.com",
    name: "CRL Administrator",
    role: ROLES.ADMIN,
  });
  const employee1 = await upsertUser({
    employeeCode: "CRLEMP000002",
    email: "employee1@crl-transport.com",
    name: "Nagpur Operations",
    role: ROLES.EMPLOYEE,
    branchId: nagpur._id,
  });
  await upsertUser({
    employeeCode: "CRLEMP000003",
    email: "employee2@crl-transport.com",
    name: "Mumbai Operations",
    role: ROLES.EMPLOYEE,
    branchId: mumbai._id,
  });
  await Counter.findOneAndUpdate({ key: "employee" }, { $max: { value: 3 } }, { upsert: true });
  const customers = await Promise.all(
    Array.from({ length: 5 }, (_, index) => {
      const number = index + 1;
      return Customer.findOneAndUpdate(
        { customerCode: String(number).padStart(5, "0") },
        {
          $set: {
            name: `Sample Contact ${number}`,
            customerType: "TO_PAY_PAID",
            companyName: `Sample Company ${number}`,
            mobile: `90000000${String(number).padStart(2, "0")}`,
            email: `customer${number}@example.test`,
            city: "Nagpur",
            state: "Maharashtra",
            pincode: "440001",
            status: "ACTIVE",
            createdBy: admin._id,
          },
        },
        { upsert: true, new: true },
      );
    }),
  );
  await Counter.findOneAndUpdate({ key: "customer" }, { $max: { value: 5 } }, { upsert: true });
  for (let index = 0; index < statuses.length; index += 1) {
    const number = index + 1;
    const status = statuses[index];
    const lrNumber = `CRL-NGP-${new Date().getUTCFullYear()}-${String(number).padStart(6, "0")}`;
    const shipment = await Shipment.findOneAndUpdate(
      { lrNumber },
      {
        $setOnInsert: {
          lrNumber,
          customerId: customers[index % customers.length]._id,
          originBranchId: nagpur._id,
          destinationBranchId: mumbai._id,
          currentStatus: status,
          currentLocation:
            status === SHIPMENT_STATUS.IN_TRANSIT
              ? "Nashik Hub"
              : status === SHIPMENT_STATUS.BOOKED
                ? nagpur.name
                : mumbai.name,
          senderName: `Sample Sender ${number}`,
          receiverName: `Sample Receiver ${number}`,
          receiverMobile: `91111111${String(number).padStart(2, "0")}`,
          packageCount: number,
          weightKg: number * 2.5,
          createdBy: employee1._id,
          ...(status !== SHIPMENT_STATUS.BOOKED && {
            receivedAt: new Date(),
            receivedBy: employee1._id,
            receivedLocation: mumbai.name,
            receivingBranchId: mumbai._id,
          }),
        },
      },
      { upsert: true, new: true },
    );
    await ShipmentEvent.updateOne(
      { shipmentId: shipment._id, status, remarks: "Seed shipment" },
      {
        $setOnInsert: {
          shipmentId: shipment._id,
          status,
          location: shipment.currentLocation,
          branchId: status === SHIPMENT_STATUS.BOOKED ? nagpur._id : mumbai._id,
          remarks: "Seed shipment",
          updatedBy: employee1._id,
        },
      },
      { upsert: true },
    );
    if (
      [
        SHIPMENT_STATUS.LR_IMAGE_UPLOADED,
        SHIPMENT_STATUS.LR_IMAGE_VERIFIED,
        SHIPMENT_STATUS.COMPLETED,
        SHIPMENT_STATUS.CLOSED,
      ].includes(status)
    ) {
      const verificationStatus = status === SHIPMENT_STATUS.LR_IMAGE_UPLOADED ? "PENDING" : "VERIFIED";
      await ShipmentDocument.updateOne(
        { shipmentId: shipment._id, documentType: "LR_IMAGE", version: 1 },
        {
          $setOnInsert: {
            shipmentId: shipment._id,
            documentType: "LR_IMAGE",
            version: 1,
            storageKey: `seed/${lrNumber}.pdf`,
            originalFileName: `sample-${number}.pdf`,
            mimeType: "application/pdf",
            fileSize: 0,
            checksum: "seed-data-no-file",
            uploadSource: "INTERNAL",
            verificationStatus,
            uploadedBy: employee1._id,
            ...(verificationStatus === "VERIFIED" && { verifiedBy: admin._id, verifiedAt: new Date() }),
          },
        },
        { upsert: true },
      );
    }
  }
  await Counter.findOneAndUpdate(
    { key: `lr:NGP:${new Date().getUTCFullYear()}` },
    { $max: { value: 10 } },
    { upsert: true },
  );
  console.log("Seed completed. Admin email: admin@crl-transport.com");
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
