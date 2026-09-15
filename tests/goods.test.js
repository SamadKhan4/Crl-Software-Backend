import { calculateGoods } from '../src/utils/goods.js';
import { goodsSchema, shipmentSchema, publicTrackSchema } from '../src/validators/schemas.js';
import { Shipment } from '../src/models/shipment.model.js';

const row = { description: 'Cartons', quantity: 2, actualWeight: 5, length: 30, breadth: 30, height: 30, dimensionUnit: 'CM' };
test.each([['CM', 30], ['IN', 12], ['FT', 1]])('calculates quantity and seven kg per CFT in %s', (dimensionUnit, size) => {
  expect(calculateGoods([{ ...row, dimensionUnit, length: size, breadth: size, height: size }])).toMatchObject({ volume: 2, volumetricWeight: 14, chargedWeight: 14 });
});
test('compares totals, ignores forged calculated fields, and handles stored Mongoose rows', () => {
  const goods = [{ ...row, chargedWeight: 1, volume: 999 }, { ...row, quantity: 1, actualWeight: 30 }];
  const shipment = new Shipment({ lrDetails: { goods } });
  const expected = calculateGoods(goods);
  expect(expected).toMatchObject({ packageCount: 3, actualWeight: 35, volumetricWeight: 21, chargedWeight: 35 });
  expect(calculateGoods(shipment.lrDetails.goods)).toEqual(expected);
});
test('validates manual LR numbers and complete dimensions', () => {
  const base = { lrNumber: '  ab/123  ', customerId: '1'.repeat(24), originBranchId: '2'.repeat(24), destinationBranchId: '3'.repeat(24), senderName: 'Sender', receiverName: 'Receiver', packageCount: 2, weightKg: 5 };
  expect(shipmentSchema.parse(base).lrNumber).toBe('AB/123');
  expect(publicTrackSchema.parse({ lrNumber: '1' }).lrNumber).toBe('1');
  for (const lrNumber of [undefined, '', 'bad number', 'x'.repeat(51)]) expect(shipmentSchema.safeParse({ ...base, lrNumber }).success).toBe(false);
  for (const patch of [{ height: undefined }, { length: -1 }, { quantity: 0 }, { dimensionUnit: 'M' }]) expect(goodsSchema.safeParse({ ...row, ...patch }).success).toBe(false);
  expect(shipmentSchema.safeParse({ ...base, lrDetails: { goods: [], fodCharges: 0, codCharges: 75 } }).success).toBe(false);
  expect(shipmentSchema.safeParse({ ...base, lrDetails: { goods: [row], fodCharges: 0, codCharges: 75 } }).success).toBe(true);
});
