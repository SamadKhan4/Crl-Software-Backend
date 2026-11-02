import { createShipment } from '../src/services/shipment.service.js';

test.each(['ADMIN', 'MANAGER', 'EMPLOYEE'])('locks LR signature and remarks fields for %s', async role => {
  for (const field of ['shipperSignature', 'receiverNamePrint', 'receiverMobilePrint', 'receiverDateTime', 'receiverSignature', 'remarks']) {
    await expect(createShipment({ lrDetails: { [field]: 'changed' } }, { user: { role } }))
      .rejects.toThrow('Signatures and remarks are locked for all roles');
  }
});
