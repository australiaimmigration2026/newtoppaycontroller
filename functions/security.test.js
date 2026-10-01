const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requireAdmin } = require('./security');
const safe = require('./sanitize');
const { getUserDirectoryCandidates, chooseUserDirectory } = require('./index');
class AccessError extends Error { constructor(code, message) { super(message); this.code = code; } }
const request = { auth: { uid: 'admin-id', token: { auth_time: 1800000000 } } };
const user = { disabled: false, emailVerified: true, tokensValidAfterTime: new Date(1700000000000).toUTCString() };
function check(req = request, overrides = {}, profile = { admin: true }) {
  return requireAdmin(req, { getUser: async uid => { assert.equal(uid, 'admin-id'); return { ...user, ...overrides }; } }, { doc: path => { assert.equal(path, 'users/admin-id'); return { get: async () => ({ data: () => profile }) }; } }, AccessError);
}
test('rejects unauthenticated callers', async () => { await assert.rejects(check({}), { code: 'unauthenticated' }); });
test('rejects unverified, disabled, revoked and malformed sessions', async () => {
  for (const overrides of [{ emailVerified: false }, { disabled: true }, { tokensValidAfterTime: new Date(1900000000000).toUTCString() }]) await assert.rejects(check(request, overrides), { code: 'permission-denied' });
  await assert.rejects(check({ auth: { uid: 'admin-id', token: {} } }), { code: 'permission-denied' });
});
test('only boolean true admin flags authorize, rechecked on each call', async () => {
  for (const profile of [{}, { admin: false }, { admin: 'true' }, undefined]) await assert.rejects(check(request, {}, profile === undefined ? null : profile), { code: 'permission-denied' });
  await check();
  await assert.rejects(check(request, {}, { admin: false }), { code: 'permission-denied' });
});
test('masks payment data and excludes nested credentials across response types', () => {
  const sensitive = { cardNumber: '4111 1111 1111 1111', accountNumber: '987654321234', cvv: '987', pin: '7382', pinHash: 'secret-hash', nested: { pin: '7382' } };
  assert.deepEqual(safe.method('card1', { ...sensitive, kind: 'card', brand: 'Visa' }), { id: 'card1', kind: 'card', brand: 'Visa', bankName: null, status: null, last4: '1111' });
  assert.equal(safe.method('bank1', { ...sensitive, kind: 'bank' }).last4, '1234');
  for (const output of [safe.profile(sensitive), safe.wallet(sensitive), safe.personal(sensitive), safe.transaction('t1', sensitive), safe.account('a1', sensitive), safe.bonus('b1', sensitive)]) {
    const serialized = JSON.stringify(output);
    for (const forbidden of ['4111', '987654321234', '7382', 'secret-hash', 'cvv', 'pinHash', 'nested']) assert.equal(serialized.includes(forbidden), false);
  }
});
test('optional fields are null, and PANs in display fields are redacted', () => {
  assert.equal(safe.profile().name, null);
  assert.equal(safe.wallet({ balance: 0 }).balance, 0);
  assert.equal(safe.wallet({ balance: { pin: '1234' } }).balance, null);
  assert.equal(safe.profile({ name: 'Card 4111-1111-1111-1111' }).name, 'Card [redacted]');
  assert.equal(safe.transaction('t1', { createdAt: { toDate: () => new Date('2026-01-01') } }).createdAt, '2026-01-01T00:00:00.000Z');
});

test('prefers the legacy adminUserDirectory for user listings before falling back to users', () => {
  assert.deepEqual(getUserDirectoryCandidates(), ['adminUserDirectory', 'users']);
  assert.equal(chooseUserDirectory({ adminUserDirectory: true, users: true }), 'adminUserDirectory');
  assert.equal(chooseUserDirectory({ adminUserDirectory: false, users: true }), 'users');
  assert.equal(chooseUserDirectory({ adminUserDirectory: false, users: false }), 'users');
});
