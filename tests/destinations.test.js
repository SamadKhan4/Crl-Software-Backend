import { jest } from '@jest/globals';
import { searchDestinations } from '../src/services/destination.service.js';

test('returns postal destinations for name or PIN searches', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [{ PostOffice: [
    { Name: 'Nagpur GPO', District: 'Nagpur', Pincode: '440001' },
    { Name: 'Pune HO', District: 'Pune', Pincode: '411001' },
  ] }] });
  await expect(searchDestinations('440001')).resolves.toEqual([
    { id: '440001:Nagpur GPO', name: 'Nagpur GPO', district: 'Nagpur', pincode: '440001' },
    { id: '411001:Pune HO', name: 'Pune HO', district: 'Pune', pincode: '411001' },
  ]);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/pincode/440001'), expect.any(Object));
  await searchDestinations('Nagpur');
  expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('/postoffice/Nagpur'), expect.any(Object));
});

test('returns three defaults and falls back without a server error', async () => {
  expect(await searchDestinations('')).toHaveLength(3);
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(searchDestinations('Amravati')).resolves.toEqual([
    { id: '444601:Amravati HO', name: 'Amravati HO', district: 'Amravati', pincode: '444601' },
  ]);
});
