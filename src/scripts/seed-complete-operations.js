import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { env } from "../config/env.js";
import {
  Booking,
  Branch,
  Customer,
  DeliveryRunSheet,
  Invoice,
  Manifest,
  MoneyReceipt,
  Notification,
  PackageUnit,
  Segregation,
  Shipment,
  ShipmentDocument,
  ShipmentEvent,
  TmsRegister,
  Trip,
  User,
  Vendor,
} from "../models/index.js";

const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute);
const svgEscape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
})[character]);

const operations = [
  {
    sequence: "260901",
    bookingDate: at(16, 9, 15),
    deliveryDate: at(20, 16, 20),
    destination: "Pune",
    transitDays: 4,
    customer: {
      customerCode: "CRLCUST000201",
      customerType: "CREDIT",
      name: "Rajesh Agrawal",
      companyName: "Shree Balaji Electricals",
      legalName: "Shree Balaji Electricals Private Limited",
      tradeName: "Balaji Electricals",
      mobile: "9823014587",
      email: "accounts@balajielectricals.in",
      address: "Plot 18, Small Factory Area, Bagadganj",
      city: "Nagpur",
      state: "Maharashtra",
      pincode: "440008",
      gstNumber: "27AAKCS1234F1Z5",
      panNumber: "AAKCS1234F",
      industry: "Electrical equipment",
      creditRateCard: [{ location: "Pune", transitDays: 4, ratePerKg: 24 }],
      creditCharges: { fuelRatePercent: 12, handlingCharges: 450, fodCharges: 0, codCharges: 0, rovRatePercent: 1, docketCharges: 100, gstRate: 18 },
    },
    vendor: {
      vendorCode: "CRLVND000201",
      vendorType: "PTL",
      name: "Vidarbha Freight Carriers",
      legalName: "Vidarbha Freight Carriers",
      ownerName: "Sanjay Tiwari",
      contactPerson: "Amit Tiwari",
      mobile: "9765402183",
      email: "operations@vidarbhafreight.in",
      address: "Transport Nagar, Wadi",
      city: "Nagpur",
      state: "Maharashtra",
      pincode: "440023",
      gstNumber: "27AABFV4821D1Z8",
      panNumber: "AABFV4821D",
      vehicleNumber: "MH40BL7286",
      driverName: "Prakash Borkar",
      driverMobile: "9372146805",
    },
    consignee: "Western Industrial Supplies",
    consigneeMobile: "9890123476",
    consigneeAddress: "Gala 12, Bhosari Industrial Estate, Pune, Maharashtra",
    consigneePincode: "411026",
    consigneeGstin: "27AAAFW3284J1Z6",
    goods: [
      { packageNumber: "01-08", description: "Industrial control panels", packageType: "WOODEN CRATE", quantity: 8, actualWeight: 520, length: 120, breadth: 80, height: 95, dimensionUnit: "CM", chargedWeight: 560 },
      { packageNumber: "09-12", description: "Copper cable drums", packageType: "DRUM", quantity: 4, actualWeight: 160, length: 75, breadth: 75, height: 65, dimensionUnit: "CM", chargedWeight: 180 },
    ],
    packageCount: 12,
    weightKg: 680,
    chargedWeight: 740,
    declaredValue: 185000,
    freightRate: 24,
    freightCharges: 16320,
    fuelCharges: 1958.4,
    handlingCharges: 450,
    rovCharges: 1850,
    docketCharges: 100,
    gstAmount: 3722.11,
    totalAmount: 24400.51,
    invoiceNumber: "SBE/26-27/184",
    eWayBillNumber: "271009876543",
    poNumber: "WIS/PO/260914/47",
    customerReference: "Pune plant replenishment",
    vehicleNumber: "MH40BL7286",
    driverName: "Prakash Borkar",
    driverMobile: "9372146805",
    receiverName: "Nitin Kulkarni",
    receiverMobile: "9822654180",
    paymentReference: "UTR26092018457",
  },
  {
    sequence: "260902",
    bookingDate: at(17, 10, 30),
    deliveryDate: at(20, 18, 5),
    destination: "Nashik",
    transitDays: 3,
    customer: {
      customerCode: "CRLCUST000202",
      customerType: "CREDIT",
      name: "Meenal Deshmukh",
      companyName: "Mahalaxmi Agro Equipment",
      legalName: "Mahalaxmi Agro Equipment LLP",
      tradeName: "Mahalaxmi Agro",
      mobile: "9422107634",
      email: "finance@mahalaxmiagro.in",
      address: "Near Kalamna Market Yard, Chikhali Road",
      city: "Nagpur",
      state: "Maharashtra",
      pincode: "440035",
      gstNumber: "27AAFCM5678K1Z2",
      panNumber: "AAFCM5678K",
      industry: "Agricultural machinery",
      creditRateCard: [{ location: "Nashik", transitDays: 3, ratePerKg: 28 }],
      creditCharges: { fuelRatePercent: 10, handlingCharges: 350, fodCharges: 0, codCharges: 0, rovRatePercent: 0.5, docketCharges: 100, gstRate: 18 },
    },
    vendor: {
      vendorCode: "CRLVND000202",
      vendorType: "PTL",
      name: "Maharashtra Surface Logistics",
      legalName: "Maharashtra Surface Logistics",
      ownerName: "Vikas Mahajan",
      contactPerson: "Rohit Mahajan",
      mobile: "9766335082",
      email: "dispatch@mahasurface.in",
      address: "Amravati Road Logistics Park, Gondkhairi",
      city: "Nagpur",
      state: "Maharashtra",
      pincode: "440023",
      gstNumber: "27AANFM7392R1Z4",
      panNumber: "AANFM7392R",
      vehicleNumber: "MH31FC4912",
      driverName: "Sunil Wankhede",
      driverMobile: "9325174068",
    },
    consignee: "Godavari Farm Solutions",
    consigneeMobile: "9767582140",
    consigneeAddress: "Warehouse 7, Ambad MIDC, Nashik, Maharashtra",
    consigneePincode: "422010",
    consigneeGstin: "27AAEFG6482P1Z9",
    goods: [
      { packageNumber: "01-06", description: "Agricultural pump assemblies", packageType: "WOODEN BOX", quantity: 6, actualWeight: 300, length: 105, breadth: 70, height: 75, dimensionUnit: "CM", chargedWeight: 330 },
      { packageNumber: "07-10", description: "Irrigation control valves", packageType: "CARTON", quantity: 4, actualWeight: 120, length: 65, breadth: 50, height: 45, dimensionUnit: "CM", chargedWeight: 125 },
    ],
    packageCount: 10,
    weightKg: 420,
    chargedWeight: 455,
    declaredValue: 95000,
    freightRate: 28,
    freightCharges: 11760,
    fuelCharges: 1176,
    handlingCharges: 350,
    rovCharges: 475,
    docketCharges: 100,
    gstAmount: 2494.98,
    totalAmount: 16355.98,
    invoiceNumber: "MAE/26-27/096",
    eWayBillNumber: "271004568921",
    poNumber: "GFS/PO/260916/22",
    customerReference: "Nashik warehouse stock transfer",
    vehicleNumber: "MH31FC4912",
    driverName: "Sunil Wankhede",
    driverMobile: "9325174068",
    receiverName: "Akash Patil",
    receiverMobile: "9766421875",
    paymentReference: "UTR26092109634",
  },
];

const upsert = (Model, filter, values, session) => Model.findOneAndUpdate(
  filter,
  { $set: values },
  { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true, session },
);

const run = async () => {
  if (env.nodeEnv === "production") throw new Error("This operational data loader is restricted to development");
  await connectDatabase();
  const branches = await Branch.find({ status: "ACTIVE" }).lean();
  if (branches.length !== 1 || branches[0].city?.toLowerCase() !== "nagpur")
    throw new Error("Exactly one active Nagpur branch is required");
  const branch = branches[0];
  const actor = await User.findOne({ status: "ACTIVE", $or: [{ branchId: branch._id }, { role: "ADMIN" }] }).sort({ branchId: -1, createdAt: 1 });
  if (!actor) throw new Error("An active Nagpur user or administrator is required");

  const session = await mongoose.startSession();
  const result = [];
  try {
    await session.withTransaction(async () => {
      for (const operation of operations) {
        const { customer: customerData, vendor: vendorData } = operation;
        const customer = await upsert(Customer, { customerCode: customerData.customerCode }, {
          ...customerData,
          services: ["DOOR_TO_DOOR", "PTL", "PICKUP", "DELIVERY"],
          billing: { cycle: "FORTNIGHTLY", paymentTerms: "Payment within 15 days", creditLimit: 500000, creditDays: 15, invoiceMode: "SINGLE_LR", gstRate: 18, tdsRate: 0, billingEmail: customerData.email },
          contacts: [{ department: "ACCOUNTS", name: customerData.name, mobile: customerData.mobile, email: customerData.email }],
          status: "ACTIVE",
          createdBy: actor._id,
        }, session);
        const vendor = await upsert(Vendor, { vendorCode: vendorData.vendorCode }, {
          vendorCode: vendorData.vendorCode,
          vendorType: vendorData.vendorType,
          name: vendorData.name,
          legalName: vendorData.legalName,
          ownerName: vendorData.ownerName,
          contactPerson: vendorData.contactPerson,
          mobile: vendorData.mobile,
          email: vendorData.email,
          address: vendorData.address,
          city: vendorData.city,
          state: vendorData.state,
          pincode: vendorData.pincode,
          gstNumber: vendorData.gstNumber,
          panNumber: vendorData.panNumber,
          services: ["FM", "MM", "LM", "PTL", "PICKUP", "DELIVERY", "LINE_HAUL"],
          commercial: { rateBasis: "PER_TRIP", rate: 9500, fuelSurchargePercent: 8, handlingCharge: 300, detentionPerDay: 1200, creditDays: 15, gstRate: 18 },
          vehicles: [{ vehicleNumber: vendorData.vehicleNumber, vehicleType: "17 FT CLOSED BODY", capacityKg: 5000, driverName: vendorData.driverName, driverMobile: vendorData.driverMobile, status: "ACTIVE" }],
          verification: { bankVerified: true, gstVerified: true, panVerified: true, approvedBy: actor._id, approvalDate: operation.bookingDate },
          status: "ACTIVE",
          createdBy: actor._id,
        }, session);

        const bookingNumber = `BKG-NGP-${operation.sequence}`;
        const lrNumber = `CRL-NGP-${operation.sequence}`;
        const expectedDeliveryDate = new Date(operation.bookingDate);
        expectedDeliveryDate.setDate(expectedDeliveryDate.getDate() + operation.transitDays);
        const booking = await upsert(Booking, { bookingNumber }, {
          bookingNumber,
          branchId: branch._id,
          destinationBranchId: branch._id,
          customerId: customer._id,
          bookingDate: operation.bookingDate,
          consignorCode: customer.customerCode,
          consignor: customer.companyName,
          consignorAddress: customer.address,
          consignorPincode: customer.pincode,
          consignorGstin: customer.gstNumber,
          consignee: operation.consignee,
          consigneeMobile: operation.consigneeMobile,
          consigneeAddress: operation.consigneeAddress,
          consigneePincode: operation.consigneePincode,
          consigneeGstin: operation.consigneeGstin,
          origin: "Nagpur",
          destination: operation.destination,
          service: "PTL",
          packageCount: operation.packageCount,
          weightKg: operation.weightKg,
          description: operation.goods.map(({ description }) => description).join("; "),
          invoiceNumber: operation.invoiceNumber,
          eWayBillNumber: operation.eWayBillNumber,
          expectedDeliveryDate,
          status: "LR_GENERATED",
          createdBy: actor._id,
        }, session);
        const shipment = await upsert(Shipment, { lrNumber }, {
          lrNumber,
          customerId: customer._id,
          originBranchId: branch._id,
          destinationBranchId: branch._id,
          currentStatus: "CLOSED",
          currentLocation: operation.destination,
          senderName: customer.companyName,
          receiverName: operation.consignee,
          receiverMobile: operation.consigneeMobile,
          packageCount: operation.packageCount,
          weightKg: operation.weightKg,
          description: operation.goods.map(({ description }) => description).join("; "),
          expectedDeliveryDate,
          receivedAt: operation.deliveryDate,
          receivedBy: actor._id,
          receivedLocation: operation.destination,
          receivingBranchId: branch._id,
          createdBy: actor._id,
          lrDetails: {
            goods: operation.goods,
            consignorCode: customer.customerCode,
            consignorAddress: customer.address,
            consignorPincode: customer.pincode,
            consignorGstin: customer.gstNumber,
            consigneeAddress: operation.consigneeAddress,
            consigneePincode: operation.consigneePincode,
            consigneeGstin: operation.consigneeGstin,
            bookingDate: operation.bookingDate,
            bookingBranch: branch.name,
            from: "Nagpur",
            to: operation.destination,
            deliveryAddress: operation.consigneeAddress,
            contactNo: operation.consigneeMobile,
            invoiceNo: operation.invoiceNumber,
            invoiceDate: operation.bookingDate,
            eWayBillNo: operation.eWayBillNumber,
            eWayBillDate: operation.bookingDate,
            poStnNo: operation.poNumber,
            customerReference: operation.customerReference,
            actualWeight: operation.weightKg,
            chargedWeight: operation.chargedWeight,
            declaredValue: operation.declaredValue,
            paymentMode: "CREDIT",
            riskType: "CARRIER_RISK",
            insuranceType: "INSURED",
            freightBasis: "PER_KG",
            freightRate: operation.freightRate,
            fuelRatePercent: customer.creditCharges.fuelRatePercent,
            rovRatePercent: customer.creditCharges.rovRatePercent,
            freightCharges: operation.freightCharges,
            fuelCharges: operation.fuelCharges,
            handlingCharges: operation.handlingCharges,
            fodCharges: 0,
            codCharges: 0,
            rovCharges: operation.rovCharges,
            docketCharges: operation.docketCharges,
            gstRate: 18,
            gstAmount: operation.gstAmount,
            totalAmount: operation.totalAmount,
            remarks: `Handle with care. Deliver against stamped acknowledgement at ${operation.destination}.`,
            receiverNamePrint: operation.receiverName,
            receiverMobilePrint: operation.receiverMobile,
            receiverDateTime: operation.deliveryDate,
          },
        }, session);
        booking.shipmentId = shipment._id;
        await booking.save({ session });

        const segregation = await upsert(Segregation, { segregationNumber: `SEG-NGP-${operation.sequence}` }, {
          segregationNumber: `SEG-NGP-${operation.sequence}`,
          branchId: branch._id,
          shipmentIds: [shipment._id],
          vendorId: vendor._id,
          destination: operation.destination,
          vehicleNumber: operation.vehicleNumber,
          driverName: operation.driverName,
          driverMobile: operation.driverMobile,
          status: "MANIFESTED",
          remarks: `LR segregated for ${operation.destination} PTL movement`,
          createdBy: actor._id,
        }, session);
        const manifest = await upsert(Manifest, { manifestNumber: `MNF-NGP-${operation.sequence}` }, {
          manifestNumber: `MNF-NGP-${operation.sequence}`,
          branchId: branch._id,
          shipmentIds: [shipment._id],
          segregationId: segregation._id,
          vendorId: vendor._id,
          destination: operation.destination,
          vehicleNumber: operation.vehicleNumber,
          deliveryAgent: operation.driverName,
          vendorReference: `VFC-${operation.sequence}`,
          coLoaderStatus: "DELIVERED",
          status: "CLOSED",
          remarks: `Delivered at ${operation.destination} hub and handed to last-mile team`,
          createdBy: actor._id,
        }, session);
        segregation.manifestId = manifest._id;
        await segregation.save({ session });
        const trip = await upsert(Trip, { tripNumber: `TRIP-NGP-${operation.sequence}` }, {
          tripNumber: `TRIP-NGP-${operation.sequence}`,
          branchId: branch._id,
          shipmentIds: [shipment._id],
          vendorId: vendor._id,
          vehicleNumber: operation.vehicleNumber,
          driverName: operation.driverName,
          driverMobile: operation.driverMobile,
          origin: "Nagpur",
          destination: operation.destination,
          departureDate: new Date(operation.bookingDate.getTime() + 7 * 60 * 60 * 1000),
          expectedArrival: expectedDeliveryDate,
          freightAmount: 9500,
          advanceAmount: 4000,
          startKm: operation.sequence === "260901" ? 48215 : 76320,
          endKm: operation.sequence === "260901" ? 48942 : 76820,
          dieselAmount: operation.sequence === "260901" ? 5600 : 4100,
          tollAmount: operation.sequence === "260901" ? 1280 : 840,
          otherExpense: 350,
          revenueAmount: operation.totalAmount,
          status: "CLOSED",
          remarks: "Trip completed; vehicle and expense sheet reconciled",
          createdBy: actor._id,
        }, session);

        const invoice = await upsert(Invoice, { invoiceNumber: `INV-NGP-${operation.sequence}` }, {
          invoiceNumber: `INV-NGP-${operation.sequence}`,
          branchId: branch._id,
          customerId: customer._id,
          shipmentIds: [shipment._id],
          billTo: { name: customer.name, companyName: customer.companyName, address: customer.address, city: customer.city, state: customer.state, pincode: customer.pincode, gstNumber: customer.gstNumber, mobile: customer.mobile, email: customer.email },
          lineItems: [{ shipmentId: shipment._id, lrNumber, bookingDate: operation.bookingDate, origin: "Nagpur", destination: operation.destination, packageCount: operation.packageCount, weightKg: operation.weightKg, taxableAmount: Number((operation.totalAmount - operation.gstAmount).toFixed(2)) }],
          periodFrom: operation.bookingDate,
          periodTo: operation.deliveryDate,
          subtotal: Number((operation.totalAmount - operation.gstAmount).toFixed(2)),
          gstRate: 18,
          gstAmount: operation.gstAmount,
          totalAmount: operation.totalAmount,
          paidAmount: operation.totalAmount,
          balanceAmount: 0,
          issueDate: operation.deliveryDate,
          dueDate: new Date(operation.deliveryDate.getTime() + 15 * 86400000),
          status: "PAID",
          notes: `Freight invoice against ${lrNumber}`,
          createdBy: actor._id,
        }, session);
        const receipt = await upsert(MoneyReceipt, { receiptNumber: `MR-NGP-${operation.sequence}` }, {
          receiptNumber: `MR-NGP-${operation.sequence}`,
          branchId: branch._id,
          customerId: customer._id,
          allocations: [{ invoiceId: invoice._id, amount: operation.totalAmount }],
          shipmentIds: [shipment._id],
          receivedFrom: customer.companyName,
          amount: operation.totalAmount,
          paymentMode: "BANK_TRANSFER",
          transactionReference: operation.paymentReference,
          receiptDate: new Date(operation.deliveryDate.getTime() + 86400000),
          remarks: `Full payment received against ${invoice.invoiceNumber}`,
          status: "ACTIVE",
          createdBy: actor._id,
        }, session);

        const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect width="100%" height="100%" fill="white"/><rect x="25" y="25" width="950" height="650" fill="none" stroke="#142b36" stroke-width="4"/><text x="55" y="85" font-family="Arial" font-size="34" font-weight="700">CHAPLE ROADLINES PVT. LTD.</text><text x="55" y="145" font-family="Arial" font-size="26">Proof of Delivery</text><text x="55" y="215" font-family="Arial" font-size="22">LR: ${svgEscape(lrNumber)}</text><text x="55" y="260" font-family="Arial" font-size="22">Consignee: ${svgEscape(operation.consignee)}</text><text x="55" y="305" font-family="Arial" font-size="22">Delivered at: ${svgEscape(operation.destination)}</text><text x="55" y="350" font-family="Arial" font-size="22">Received by: ${svgEscape(operation.receiverName)}</text><text x="55" y="395" font-family="Arial" font-size="22">Packages received: ${operation.packageCount}</text><text x="55" y="440" font-family="Arial" font-size="22">Condition: Received in good condition</text><line x1="600" y1="555" x2="915" y2="555" stroke="#142b36" stroke-width="2"/><text x="650" y="590" font-family="Arial" font-size="18">Receiver signature</text></svg>`);
        const storageKey = `shipments/${shipment._id}/pod/${lrNumber.toLowerCase()}-acknowledgement.svg`;
        const absolutePath = path.resolve(env.uploadDir, storageKey);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, svg);
        const pod = await upsert(ShipmentDocument, { shipmentId: shipment._id, documentType: "POD", version: 1 }, {
          shipmentId: shipment._id,
          documentType: "POD",
          version: 1,
          storageKey,
          originalFileName: `${lrNumber}-signed-pod.svg`,
          mimeType: "image/svg+xml",
          fileSize: svg.length,
          checksum: crypto.createHash("sha256").update(svg).digest("hex"),
          uploadedBy: actor._id,
          uploadSource: "INTERNAL",
          verificationStatus: "VERIFIED",
          verifiedBy: actor._id,
          verifiedAt: operation.deliveryDate,
        }, session);
        const drs = await upsert(DeliveryRunSheet, { drsNumber: `DRS-NGP-${operation.sequence}` }, {
          drsNumber: `DRS-NGP-${operation.sequence}`,
          branchId: branch._id,
          shipmentIds: [shipment._id],
          vehicleNumber: operation.vehicleNumber,
          driverName: operation.driverName,
          driverMobile: operation.driverMobile,
          deliveryDate: operation.deliveryDate,
          route: `${operation.destination} Industrial Delivery Route`,
          partB: [{ eWayBillNo: operation.eWayBillNumber, vehicleNumber: operation.vehicleNumber, updatedAt: operation.bookingDate }],
          podShipmentIds: [shipment._id],
          deliveryProofs: [{ shipmentId: shipment._id, receiverName: operation.receiverName, receiverMobile: operation.receiverMobile, signatureName: operation.receiverName, remarks: "Material received in good condition with company stamp", deliveredAt: operation.deliveryDate, recordedBy: actor._id, documentId: pod._id }],
          status: "CLOSED",
          closedAt: new Date(operation.deliveryDate.getTime() + 15 * 60000),
          closedBy: actor._id,
          remarks: "All consignments delivered; POD checked and DRS closed",
          createdBy: actor._id,
        }, session);

        await ShipmentEvent.deleteMany({ shipmentId: shipment._id }, { session });
        const eventRows = [
          ["BOOKED", "Nagpur", "Booking confirmed and LR generated", 0],
          ["SEGREGATED", "Nagpur Hub", `Segregated for ${operation.destination} route`, 2],
          ["MANIFESTED", "Nagpur Hub", `Added to manifest ${manifest.manifestNumber}`, 3],
          ["PICKED_UP", customer.address, "First-mile pickup completed", 5],
          ["MONEY_RECEIPT_CREATED", "Nagpur Branch", `Receipt ${receipt.receiptNumber} recorded`, 6],
          ["TRIP_PLANNED", "Nagpur Hub", `Trip ${trip.tripNumber} planned`, 7],
          ["IN_TRANSIT", "Nagpur", `Vehicle ${operation.vehicleNumber} dispatched`, 8],
          ["AT_HUB", `${operation.destination} Hub`, "Shipment inward completed at destination hub", 52],
          ["RECEIVED", `${operation.destination} Hub`, "Shipment received and sorted for delivery", 54],
          ["OUT_FOR_DELIVERY", operation.destination, `DRS ${drs.drsNumber} dispatched`, 56],
          ["DELIVERED", operation.consigneeAddress, `Delivered to ${operation.receiverName}`, 60],
          ["POD_UPLOADED", operation.consigneeAddress, "Signed POD uploaded and verified", 61],
          ["DRS_CLOSED", `${operation.destination} Hub`, `DRS ${drs.drsNumber} closed`, 62],
          ["CLOSED", `${operation.destination} Hub`, "Shipment lifecycle completed", 63],
        ];
        await ShipmentEvent.insertMany(eventRows.map(([status, location, remarks, hours]) => ({
          shipmentId: shipment._id,
          status,
          location,
          branchId: branch._id,
          remarks,
          updatedBy: actor._id,
          createdAt: new Date(operation.bookingDate.getTime() + hours * 60 * 60 * 1000),
        })), { session });

        await PackageUnit.deleteMany({ shipmentId: shipment._id }, { session });
        const scanSteps = [
          ["GENERATED", "Nagpur Branch", 0], ["PICKUP", customer.address, 5], ["HUB_INWARD", "Nagpur Hub", 6],
          ["SORTED", "Nagpur Hub", 7], ["LOADED", "Nagpur Hub", 8], ["UNLOADED", `${operation.destination} Hub`, 52],
          ["OUT_FOR_DELIVERY", operation.destination, 56], ["DELIVERED", operation.consigneeAddress, 60],
        ];
        await PackageUnit.insertMany(Array.from({ length: operation.packageCount }, (_, index) => ({
          barcode: `${operation.sequence}${String(index + 1).padStart(4, "0")}`,
          shipmentId: shipment._id,
          lrNumber,
          sequence: index + 1,
          totalPackages: operation.packageCount,
          status: "DELIVERED",
          currentLocation: operation.consigneeAddress,
          currentCustodianType: "CUSTOMER",
          currentCustodianId: operation.receiverMobile,
          scans: scanSteps.map(([action, location, hours]) => ({ action, location, branchId: branch._id, routeCode: `NGP-${operation.destination.toUpperCase()}`, vehicleNumber: operation.vehicleNumber, remarks: `${action.replaceAll("_", " ")} scan completed`, scannedBy: actor._id, scannedAt: new Date(operation.bookingDate.getTime() + hours * 60 * 60 * 1000) })),
          createdBy: actor._id,
        })), { session });

        await TmsRegister.deleteMany({ shipmentIds: shipment._id, reference: lrNumber }, { session });
        const registerRows = [
          ["PICKUP", `Pickup run for ${customer.companyName}`, customer.address, "Nagpur Hub", 5],
          ["HUB", `${operation.destination} hub inward and segregation`, "Nagpur Hub", `${operation.destination} Hub`, 52],
          ["HANDLING", `Loading and unloading for ${lrNumber}`, "Nagpur Hub", `${operation.destination} Hub`, 53],
          ["PTL", `PTL movement Nagpur to ${operation.destination}`, "Nagpur", operation.destination, 60],
        ];
        await TmsRegister.insertMany(registerRows.map(([module, title, origin, destination, hours], index) => ({
          recordNumber: `${module}-NGP-${operation.sequence}-${index + 1}`,
          module,
          branchId: branch._id,
          shipmentIds: [shipment._id],
          vendorId: vendor._id,
          customerId: customer._id,
          title,
          reference: lrNumber,
          operationDate: new Date(operation.bookingDate.getTime() + hours * 60 * 60 * 1000),
          origin,
          destination,
          vehicleNumber: operation.vehicleNumber,
          driverName: operation.driverName,
          driverMobile: operation.driverMobile,
          quantity: operation.packageCount,
          amount: module === "PTL" ? 9500 : module === "HANDLING" ? operation.handlingCharges : 0,
          status: "COMPLETED",
          description: `${module} activity completed against ${lrNumber}`,
          remarks: "Operational checklist completed and verified",
          createdBy: actor._id,
          updatedBy: actor._id,
        })), { session });

        await Notification.deleteMany({ shipmentId: shipment._id }, { session });
        await Notification.create([{
          event: "SHIPMENT_DELIVERED",
          shipmentId: shipment._id,
          invoiceId: invoice._id,
          customerId: customer._id,
          branchId: branch._id,
          recipientName: customer.name,
          mobile: customer.mobile,
          email: customer.email,
          channels: ["SMS", "EMAIL"],
          subject: `${lrNumber} delivered successfully`,
          message: `${lrNumber} was delivered to ${operation.receiverName} at ${operation.destination}. POD is available in the shipment record.`,
          status: "SENT",
          attempts: 1,
          sentAt: operation.deliveryDate,
        }], { session });

        result.push({ bookingNumber, lrNumber, segregationNumber: segregation.segregationNumber, manifestNumber: manifest.manifestNumber, tripNumber: trip.tripNumber, receiptNumber: receipt.receiptNumber, drsNumber: drs.drsNumber, destination: operation.destination, status: shipment.currentStatus });
      }
    });
  } finally {
    await session.endSession();
  }
  const lrNumbers = result.map(({ lrNumber }) => lrNumber);
  const shipmentIds = await Shipment.find({ lrNumber: { $in: lrNumbers } }).distinct("_id");
  const verification = {
    bookings: await Booking.countDocuments({ bookingNumber: { $in: result.map(({ bookingNumber }) => bookingNumber) }, shipmentId: { $in: shipmentIds } }),
    shipments: shipmentIds.length,
    segregations: await Segregation.countDocuments({ shipmentIds: { $in: shipmentIds }, status: "MANIFESTED" }),
    manifests: await Manifest.countDocuments({ shipmentIds: { $in: shipmentIds }, status: "CLOSED", coLoaderStatus: "DELIVERED" }),
    trips: await Trip.countDocuments({ shipmentIds: { $in: shipmentIds }, status: "CLOSED" }),
    invoices: await Invoice.countDocuments({ shipmentIds: { $in: shipmentIds }, status: "PAID" }),
    receipts: await MoneyReceipt.countDocuments({ shipmentIds: { $in: shipmentIds }, status: "ACTIVE" }),
    drsClosed: await DeliveryRunSheet.countDocuments({ shipmentIds: { $in: shipmentIds }, status: "CLOSED" }),
    verifiedPods: await ShipmentDocument.countDocuments({ shipmentId: { $in: shipmentIds }, documentType: "POD", verificationStatus: "VERIFIED" }),
    trackingEvents: await ShipmentEvent.countDocuments({ shipmentId: { $in: shipmentIds } }),
    packagesDelivered: await PackageUnit.countDocuments({ shipmentId: { $in: shipmentIds }, status: "DELIVERED" }),
    operationalRegisters: await TmsRegister.countDocuments({ shipmentIds: { $in: shipmentIds }, status: "COMPLETED" }),
  };
  console.log(JSON.stringify({ branch: `${branch.branchCode} - ${branch.name}`, actor: actor.name, operations: result, verification }, null, 2));
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(disconnectDatabase);
