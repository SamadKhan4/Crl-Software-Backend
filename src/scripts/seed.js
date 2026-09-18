import bcrypt from "bcryptjs";
import { connectDatabase, disconnectDatabase } from "../config/db.js";
import {
  Branch,
  Counter,
  Customer,
  DeliveryRunSheet,
  Invoice,
  Manifest,
  MoneyReceipt,
  Quotation,
  Shipment,
  ShipmentDocument,
  ShipmentEvent,
  StationeryTransaction,
  Trip,
  User,
  Vendor,
} from "../models/index.js";
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
  const demoDataOnly = process.env.DEMO_DATA_ONLY === "true";
  let nagpur;
  let mumbai;
  let admin;
  let employee1;

  if (demoDataOnly) {
    nagpur = await Branch.findOne({ status: "ACTIVE" }).sort({ createdAt: 1 });
    if (!nagpur) throw new Error("An active origin branch is required before loading demo data");
    mumbai = await Branch.findOne({ _id: { $ne: nagpur._id }, status: "ACTIVE" }).sort({ createdAt: 1 });
    if (!mumbai) {
      mumbai = await Branch.findOneAndUpdate(
        { branchCode: "BOM-DEMO" },
        {
          $setOnInsert: {
            name: "Mumbai Demo Branch",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400001",
            phone: "9000000002",
            email: "mumbai-demo@example.test",
            status: "ACTIVE",
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
    admin = await User.findOne({ role: ROLES.ADMIN, status: "ACTIVE" }).sort({ createdAt: 1 });
    if (!admin) throw new Error("An active administrator is required before loading demo data");
    employee1 =
      (await User.findOne({ branchId: nagpur._id, status: "ACTIVE" }).sort({ createdAt: 1 })) || admin;
  } else {
    nagpur = await Branch.findOneAndUpdate(
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
    mumbai = await Branch.findOneAndUpdate(
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
    admin = await upsertUser({
      employeeCode: "CRLEMP000001",
      email: "admin@crl-transport.com",
      name: "CRL Administrator",
      role: ROLES.ADMIN,
    });
    employee1 = await upsertUser({
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
  }

  const now = new Date();
  const year = now.getFullYear();
  const day = 24 * 60 * 60 * 1000;
  const dateFromNow = (offset, hour = 10) => {
    const value = new Date(now.getTime() + offset * day);
    value.setHours(hour, 0, 0, 0);
    return value;
  };
  const demoCustomers = await Promise.all([
    Customer.findOneAndUpdate(
      { customerCode: "90001" },
      {
        $set: {
          customerType: "CREDIT",
          name: "Rohit Sharma",
          companyName: "Vidarbha Engineering Pvt Ltd",
          mobile: "9876501001",
          alternateMobile: "9876501011",
          email: "accounts@vidarbha-engineering.example",
          address: "Hingna MIDC, Plot 42",
          city: "Nagpur",
          state: "Maharashtra",
          pincode: "440016",
          gstNumber: "27ABCDE1234F1Z5",
          status: "ACTIVE",
          createdBy: admin._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
    Customer.findOneAndUpdate(
      { customerCode: "90002" },
      {
        $set: {
          customerType: "CREDIT",
          name: "Neha Deshmukh",
          companyName: "Central India Retail Ltd",
          mobile: "9876501002",
          alternateMobile: "9876501012",
          email: "finance@central-retail.example",
          address: "Wardha Road Logistics Park",
          city: "Nagpur",
          state: "Maharashtra",
          pincode: "441108",
          gstNumber: "27AAACR1234A1Z7",
          status: "ACTIVE",
          createdBy: admin._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
  ]);

  const demoVendors = await Promise.all([
    Vendor.findOneAndUpdate(
      { vendorCode: "CRLDEMO001" },
      {
        $set: {
          vendorType: "CO_LOADER",
          name: "Western India Co-Loaders",
          contactPerson: "Amit Patil",
          mobile: "9867002001",
          email: "operations@western-coloaders.example",
          address: "Transport Nagar, Bhandup",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400078",
          gstNumber: "27AABCT4321K1Z2",
          commercial: {
            rateBasis: "PER_KG",
            rate: 8.5,
            fuelSurchargePercent: 10,
            handlingCharge: 450,
            detentionPerDay: 1200,
            creditDays: 30,
            gstRate: 18,
          },
          vehicles: [
            {
              vehicleNumber: "MH40AB1201",
              vehicleType: "17 FT Closed Body",
              capacityKg: 7000,
              driverName: "Sanjay Yadav",
              driverMobile: "9823003001",
              status: "ACTIVE",
            },
          ],
          status: "ACTIVE",
          createdBy: admin._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
    Vendor.findOneAndUpdate(
      { vendorCode: "CRLDEMO002" },
      {
        $set: {
          vendorType: "LAST_MILE",
          name: "Mumbai Metro Last Mile",
          contactPerson: "Imran Shaikh",
          mobile: "9867002002",
          email: "dispatch@mumbai-lastmile.example",
          address: "Sakinaka Cargo Estate",
          city: "Mumbai",
          state: "Maharashtra",
          pincode: "400072",
          gstNumber: "27AACCM9876D1Z8",
          commercial: {
            rateBasis: "PER_TRIP",
            rate: 3200,
            fuelSurchargePercent: 8,
            handlingCharge: 300,
            detentionPerDay: 900,
            creditDays: 15,
            gstRate: 18,
          },
          vehicles: [
            {
              vehicleNumber: "MH02FG4502",
              vehicleType: "Tata Ace",
              capacityKg: 1200,
              driverName: "Rakesh More",
              driverMobile: "9823003002",
              status: "ACTIVE",
            },
          ],
          status: "ACTIVE",
          createdBy: admin._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ),
  ]);

  const demoRows = [
    {
      sequence: 1,
      customer: demoCustomers[0],
      vendor: demoVendors[0],
      lrNumber: `CRL-NGP-${year}-900001`,
      senderName: "Vidarbha Engineering Pvt Ltd",
      receiverName: "Prime Machine Tools",
      receiverMobile: "9819004001",
      receiverAddress: "Andheri East Industrial Area, Mumbai",
      receiverPincode: "400093",
      description: "Industrial pump assemblies",
      packageCount: 8,
      weightKg: 640,
      declaredValue: 285000,
      taxableAmount: 9350,
      gstAmount: 1683,
      totalAmount: 11033,
      vehicleNumber: "MH40AB1201",
      driverName: "Sanjay Yadav",
      driverMobile: "9823003001",
      eWayBillNo: "271234567890",
      invoiceReference: "VEPL/SALE/9001",
      poReference: "PO-VEPL-7781",
      currentStatus: SHIPMENT_STATUS.CLOSED,
      invoiceStatus: "PART_PAID",
      paidAmount: 5000,
    },
    {
      sequence: 2,
      customer: demoCustomers[1],
      vendor: demoVendors[1],
      lrNumber: `CRL-NGP-${year}-900002`,
      senderName: "Central India Retail Ltd",
      receiverName: "Harbour Retail Warehouse",
      receiverMobile: "9819004002",
      receiverAddress: "Turbhe MIDC, Navi Mumbai",
      receiverPincode: "400705",
      description: "Retail display fixtures",
      packageCount: 14,
      weightKg: 920,
      declaredValue: 410000,
      taxableAmount: 12750,
      gstAmount: 2295,
      totalAmount: 15045,
      vehicleNumber: "MH02FG4502",
      driverName: "Rakesh More",
      driverMobile: "9823003002",
      eWayBillNo: "279876543210",
      invoiceReference: "CIRL/SALE/9002",
      poReference: "PO-CIRL-8842",
      currentStatus: SHIPMENT_STATUS.COMPLETED,
      invoiceStatus: "ISSUED",
      paidAmount: 0,
    },
  ];

  for (const row of demoRows) {
    const suffix = String(row.sequence).padStart(3, "0");
    const bookingDate = dateFromNow(-8 - row.sequence);
    const deliveryDate = dateFromNow(-2 - row.sequence, 16);
    const shipment = await Shipment.findOneAndUpdate(
      { lrNumber: row.lrNumber },
      {
        $set: {
          customerId: row.customer._id,
          originBranchId: nagpur._id,
          destinationBranchId: mumbai._id,
          currentStatus: row.currentStatus,
          currentLocation: mumbai.name,
          senderName: row.senderName,
          receiverName: row.receiverName,
          receiverMobile: row.receiverMobile,
          packageCount: row.packageCount,
          weightKg: row.weightKg,
          description: row.description,
          expectedDeliveryDate: dateFromNow(-2 - row.sequence),
          lrDetails: {
            goods: [
              {
                packageNumber: `PKG-${suffix}`,
                description: row.description,
                packageType: "Wooden crates",
                quantity: row.packageCount,
                actualWeight: row.weightKg,
                length: 120,
                breadth: 80,
                height: 75,
                dimensionUnit: "CM",
                declaredValue: row.declaredValue,
                volume: 0.72,
                volumetricWeight: row.weightKg,
                chargedWeight: row.weightKg,
              },
            ],
            volumetricWeight: row.weightKg,
            consignorCode: row.customer.customerCode,
            consignorAddress: row.customer.address,
            consignorPincode: row.customer.pincode,
            consignorGstin: row.customer.gstNumber,
            consigneeAddress: row.receiverAddress,
            consigneePincode: row.receiverPincode,
            bookingDate,
            bookingBranch: nagpur.name,
            from: "Nagpur",
            to: "Mumbai",
            deliveryAddress: row.receiverAddress,
            contactNo: row.receiverMobile,
            invoiceNo: row.invoiceReference,
            invoiceDate: bookingDate,
            eWayBillNo: row.eWayBillNo,
            eWayBillDate: bookingDate,
            poStnNo: row.poReference,
            customerReference: `DEMO-END-TO-END-${suffix}`,
            packageNumber: `PKG-${suffix}`,
            packageType: "Wooden crates",
            actualWeight: row.weightKg,
            chargedWeight: row.weightKg,
            dimensions: "120 x 80 x 75 CM",
            volume: 0.72,
            declaredValue: row.declaredValue,
            remarks: "End-to-end demo consignment",
            receiverNamePrint: row.receiverName,
            receiverMobilePrint: row.receiverMobile,
            receiverDateTime: deliveryDate,
            receiverSignature: "POD verified in demo seed",
            paymentMode: "CREDIT",
            riskType: "OWNER_RISK",
            insuranceType: "INSURED",
            freightBasis: "FIXED",
            freightRate: row.taxableAmount,
            fuelRatePercent: 10,
            rovRatePercent: 0.1,
            freightCharges: row.taxableAmount - 1350,
            fuelCharges: 800,
            handlingCharges: 500,
            docketCharges: 50,
            gstRate: 18,
            gstAmount: row.gstAmount,
            totalAmount: row.totalAmount,
          },
          receivedAt: dateFromNow(-4 - row.sequence, 11),
          receivedBy: employee1._id,
          receivedLocation: mumbai.name,
          receivingBranchId: mumbai._id,
          createdBy: employee1._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const eventRows = [
      [SHIPMENT_STATUS.BOOKED, nagpur.name, "LR booked and pickup scheduled"],
      [SHIPMENT_STATUS.IN_TRANSIT, `${nagpur.city || nagpur.name} Hub`, "First-mile pickup completed and vehicle dispatched"],
      [SHIPMENT_STATUS.RECEIVED, mumbai.name, "Consignment received at destination hub"],
      [SHIPMENT_STATUS.LR_IMAGE_UPLOADED, mumbai.name, "Delivery document uploaded"],
      [SHIPMENT_STATUS.LR_IMAGE_VERIFIED, mumbai.name, "Delivery document verified"],
      [SHIPMENT_STATUS.COMPLETED, row.receiverAddress, "Last-mile delivery completed"],
      ...(row.currentStatus === SHIPMENT_STATUS.CLOSED
        ? [[SHIPMENT_STATUS.CLOSED, row.receiverAddress, "Shipment commercially closed"]]
        : []),
    ];
    for (const [status, location, remarks] of eventRows) {
      await ShipmentEvent.findOneAndUpdate(
        { shipmentId: shipment._id, status, remarks },
        {
          $set: {
            shipmentId: shipment._id,
            status,
            location,
            branchId: status === SHIPMENT_STATUS.BOOKED || status === SHIPMENT_STATUS.IN_TRANSIT ? nagpur._id : mumbai._id,
            remarks,
            updatedBy: employee1._id,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    for (const documentType of ["LR_IMAGE", "POD"]) {
      await ShipmentDocument.findOneAndUpdate(
        { shipmentId: shipment._id, documentType, version: 1 },
        {
          $set: {
            shipmentId: shipment._id,
            documentType,
            version: 1,
            storageKey: `seed/demo/${row.lrNumber}-${documentType.toLowerCase()}.pdf`,
            originalFileName: `${row.lrNumber}-${documentType.toLowerCase()}.pdf`,
            mimeType: "application/pdf",
            fileSize: 0,
            checksum: `demo-${row.sequence}-${documentType.toLowerCase()}`,
            uploadedBy: employee1._id,
            uploadSource: "INTERNAL",
            verificationStatus: "VERIFIED",
            verifiedBy: admin._id,
            verifiedAt: deliveryDate,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    await Manifest.findOneAndUpdate(
      { manifestNumber: `DEMO-MNF-${year}-${suffix}` },
      {
        $set: {
          branchId: nagpur._id,
          shipmentIds: [shipment._id],
          vendorId: row.vendor._id,
          destination: "Mumbai",
          vehicleNumber: row.vehicleNumber,
          deliveryAgent: row.driverName,
          vendorReference: `COL-${year}-${suffix}`,
          coLoaderStatus: "DELIVERED",
          status: "CLOSED",
          remarks: "End-to-end demo manifest delivered at destination hub",
          createdBy: employee1._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await Trip.findOneAndUpdate(
      { tripNumber: `DEMO-TRIP-${year}-${suffix}` },
      {
        $set: {
          branchId: nagpur._id,
          shipmentIds: [shipment._id],
          vendorId: row.vendor._id,
          vehicleNumber: row.vehicleNumber,
          driverName: row.driverName,
          driverMobile: row.driverMobile,
          origin: "Nagpur",
          destination: "Mumbai",
          departureDate: dateFromNow(-7 - row.sequence, 7),
          expectedArrival: dateFromNow(-5 - row.sequence, 18),
          freightAmount: row.sequence === 1 ? 7200 : 8400,
          advanceAmount: row.sequence === 1 ? 2500 : 3000,
          status: "CLOSED",
          remarks: "Demo line-haul trip completed",
          createdBy: employee1._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await DeliveryRunSheet.findOneAndUpdate(
      { drsNumber: `DEMO-DRS-${year}-${suffix}` },
      {
        $set: {
          branchId: mumbai._id,
          shipmentIds: [shipment._id],
          vehicleNumber: row.vehicleNumber,
          driverName: row.driverName,
          driverMobile: row.driverMobile,
          deliveryDate,
          route: row.sequence === 1 ? "Mumbai Hub - Andheri East" : "Mumbai Hub - Turbhe MIDC",
          partB: [{ eWayBillNo: row.eWayBillNo, vehicleNumber: row.vehicleNumber, updatedAt: deliveryDate }],
          podShipmentIds: [shipment._id],
          status: "CLOSED",
          closedAt: deliveryDate,
          closedBy: employee1._id,
          remarks: "POD uploaded and last-mile run closed",
          createdBy: employee1._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const invoice = await Invoice.findOneAndUpdate(
      { invoiceNumber: `DEMO-INV-${year}-${suffix}` },
      {
        $set: {
          branchId: nagpur._id,
          customerId: row.customer._id,
          shipmentIds: [shipment._id],
          billTo: {
            name: row.customer.name,
            companyName: row.customer.companyName,
            address: row.customer.address,
            city: row.customer.city,
            state: row.customer.state,
            pincode: row.customer.pincode,
            gstNumber: row.customer.gstNumber,
            mobile: row.customer.mobile,
            email: row.customer.email,
          },
          lineItems: [
            {
              shipmentId: shipment._id,
              lrNumber: shipment.lrNumber,
              bookingDate,
              origin: "Nagpur",
              destination: "Mumbai",
              packageCount: row.packageCount,
              weightKg: row.weightKg,
              taxableAmount: row.taxableAmount,
            },
          ],
          periodFrom: bookingDate,
          periodTo: deliveryDate,
          subtotal: row.taxableAmount,
          gstRate: 18,
          gstAmount: row.gstAmount,
          totalAmount: row.totalAmount,
          paidAmount: row.paidAmount,
          balanceAmount: row.totalAmount - row.paidAmount,
          issueDate: dateFromNow(-1 - row.sequence),
          dueDate: dateFromNow(14 - row.sequence),
          status: row.invoiceStatus,
          notes: "Demo credit invoice generated from delivered LR",
          createdBy: admin._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await MoneyReceipt.findOneAndUpdate(
      { receiptNumber: `DEMO-RCPT-${year}-${suffix}` },
      {
        $set: {
          branchId: nagpur._id,
          customerId: row.customer._id,
          allocations: row.sequence === 1 ? [{ invoiceId: invoice._id, amount: row.paidAmount }] : [],
          shipmentIds: row.sequence === 1 ? [] : [shipment._id],
          receivedFrom: row.customer.companyName,
          amount: row.sequence === 1 ? row.paidAmount : 2500,
          paymentMode: row.sequence === 1 ? "BANK_TRANSFER" : "UPI",
          transactionReference: row.sequence === 1 ? "UTR-DEMO-900001" : "UPI-DEMO-900002",
          receiptDate: dateFromNow(-row.sequence),
          remarks: row.sequence === 1 ? "Partial payment against demo invoice" : "Unallocated customer advance",
          status: "ACTIVE",
          createdBy: admin._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const estimatedFreight = row.sequence === 1 ? 18000 : 26500;
    await Quotation.findOneAndUpdate(
      { quotationNumber: `DEMO-QUO-${year}-${suffix}` },
      {
        $set: {
          branchId: nagpur._id,
          customerId: row.customer._id,
          leadName: row.customer.name,
          companyName: row.customer.companyName,
          billingAddress: `${row.customer.address}, ${row.customer.city} - ${row.customer.pincode}`,
          paymentTerms: row.sequence === 1 ? "30 Days" : "15 Days",
          serviceType: row.sequence === 1 ? "PTL" : "FTL",
          validityDays: 30,
          mobile: row.customer.mobile,
          email: row.customer.email,
          origin: "Nagpur",
          destination: "Mumbai",
          goodsDescription: row.description,
          packageCount: row.packageCount,
          weightKg: row.weightKg,
          estimatedFreight,
          gstRate: 18,
          totalAmount: Math.round(estimatedFreight * 1.18 * 100) / 100,
          transportationRates: [
            {
              origin: "Nagpur",
              destination: "Mumbai",
              mode: row.sequence === 1 ? "PTL" : "FTL",
              rateBasis: row.sequence === 1 ? "PER_KG" : "PER_TRIP",
              rate: row.sequence === 1 ? 28 : estimatedFreight,
            },
          ],
          accessorialCharges: {
            docketCharges: "Rs. 50 per LR",
            rovOwnerRisk: "0.10% of declared value",
            fod: "Actual, if applicable",
            codHandling: "1% subject to minimum Rs. 100",
            pickupCharges: "Included within Nagpur city limits",
            odaRemoteArea: "As per serviceable pincode",
            hamali: "At actual",
            reattemptDelivery: "Rs. 750 per attempt",
            appointmentDelivery: "Rs. 500",
            detention: "Rs. 1,200 per day",
            storage: "After 48 hours at actual",
            specialHandling: "As mutually agreed",
            insurance: "Consignor responsibility",
            gst: "18% as applicable",
          },
          validUntil: dateFromNow(30),
          status: row.sequence === 1 ? "ACCEPTED" : "QUOTED",
          source: "INTERNAL",
          notes: "End-to-end demo quotation",
          createdBy: admin._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  const stationeryRows = [
    {
      transactionNumber: `DEMO-STN-${year}-001`,
      itemType: "LR_BOOK",
      transactionType: "RECEIVE",
      quantity: 20,
      serialFrom: "LR-DEMO-0001",
      serialTo: "LR-DEMO-2000",
      remarks: "Demo stationery stock received at Nagpur branch",
    },
    {
      transactionNumber: `DEMO-STN-${year}-002`,
      itemType: "LR_BOOK",
      transactionType: "ISSUE",
      quantity: 2,
      serialFrom: "LR-DEMO-0001",
      serialTo: "LR-DEMO-0200",
      issuedToType: "VENDOR",
      vendorId: demoVendors[0]._id,
      issuedToName: demoVendors[0].name,
      remarks: "Demo LR books issued to co-loader",
    },
  ];
  for (const transaction of stationeryRows) {
    await StationeryTransaction.findOneAndUpdate(
      { transactionNumber: transaction.transactionNumber },
      {
        $set: {
          ...transaction,
          branchId: nagpur._id,
          transactionDate: dateFromNow(transaction.transactionType === "RECEIVE" ? -10 : -9),
          createdBy: admin._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  console.log(
    demoDataOnly
      ? "Main database demo seed completed without changing users or passwords."
      : "Development seed completed with 2 linked first-mile to last-mile demo flows.",
  );
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
