const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requireAdmin } = require('./security');
const safe = require('./sanitize');
const { getUserDirectoryCandidates, chooseUserDirectory, createTransactionReviewer } = require('./index');
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

function makeFirestore(initialDocuments) {
  const documents = new Map(Object.entries(initialDocuments).map(([path, data]) => [path, { ...data }]));
  const database = {
    doc: path => ({ path }),
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        async get(ref) {
          const data = documents.get(ref.path);
          return { exists: Boolean(data), data: () => data && { ...data } };
        },
        update(ref, data) { writes.push({ type: 'update', path: ref.path, data }); },
        set(ref, data, options) { writes.push({ type: 'set', path: ref.path, data, options }); },
      };
      const result = await callback(transaction);
      for (const write of writes) {
        const current = documents.get(write.path) || {};
        documents.set(write.path, write.type === 'set' && write.options?.merge === false ? write.data : { ...current, ...write.data });
      }
      return result;
    },
  };
  return { database, documents };
}

test('approving an add-balance request credits its wallet once and updates its request', async () => {
  const { database, documents } = makeFirestore({
    'users/u1/transactions/tx1': { uid: 'u1', requestId: 'req1', type: 'add_balance', status: 'pending', amount: 40, currency: 'BDT' },
    'users/u1/wallet/summary': { balance: 10, currency: 'BDT' },
    'transactionRequests/req1': { uid: 'u1', status: 'pending' },
  });
  const review = createTransactionReviewer(database, () => 'server-time');
  assert.deepEqual(await review({ uid: 'u1', transactionId: 'tx1', decision: 'approved' }), { status: 'approved', balanceImpact: 40 });
  assert.equal(documents.get('users/u1/wallet/summary').balance, 50);
  assert.equal(documents.get('users/u1/transactions/tx1').balanceApplied, true);
  assert.equal(documents.get('users/u1/transactions/tx1').status, 'approved');
  assert.equal(documents.get('transactionRequests/req1').status, 'approved');
  await assert.rejects(review({ uid: 'u1', transactionId: 'tx1', decision: 'approved' }), { code: 'failed-precondition' });
  assert.equal(documents.get('users/u1/wallet/summary').balance, 50);
});

test('rejecting a request changes status without moving wallet balance', async () => {
  const { database, documents } = makeFirestore({
    'users/u1/transactions/tx2': { uid: 'u1', requestId: 'req2', type: 'cashout', status: 'pending', amount: 25 },
    'users/u1/wallet/summary': { balance: 80, currency: 'BDT' },
    'transactionRequests/req2': { uid: 'u1', status: 'pending' },
  });
  const review = createTransactionReviewer(database, () => 'server-time');
  assert.deepEqual(await review({ uid: 'u1', transactionId: 'tx2', decision: 'rejected' }), { status: 'rejected', balanceImpact: null });
  assert.equal(documents.get('users/u1/wallet/summary').balance, 80);
  assert.equal(documents.get('users/u1/transactions/tx2').status, 'rejected');
  assert.equal(documents.get('transactionRequests/req2').status, 'rejected');
});

test('approving a send-money request subtracts the amount from the wallet balance', async () => {
  const { database, documents } = makeFirestore({
    'users/u1/transactions/tx5': { uid: 'u1', requestId: 'req5', type: 'sendmoney', status: 'pending', amount: 30, currency: 'BDT' },
    'users/u1/wallet/summary': { balance: 100, currency: 'BDT' },
    'transactionRequests/req5': { uid: 'u1', status: 'pending', amount: 30 },
  });
  const review = createTransactionReviewer(database, () => 'server-time');
  assert.deepEqual(await review({ uid: 'u1', transactionId: 'tx5', decision: 'approved' }), { status: 'approved', balanceImpact: -30 });
  assert.equal(documents.get('users/u1/wallet/summary').balance, 70);
  assert.equal(documents.get('users/u1/transactions/tx5').balanceApplied, true);
  assert.equal(documents.get('users/u1/transactions/tx5').status, 'approved');
});

test('approves non-wallet transactions without moving the balance, but still rejects currency mismatches for wallet-credit flows', async () => {
  const unsupported = makeFirestore({
    'users/u1/transactions/tx3': { type: 'verification', status: 'pending', amount: 25, currency: 'BDT' },
    'users/u1/wallet/summary': { balance: 80, currency: 'BDT' },
  });
  assert.deepEqual(await createTransactionReviewer(unsupported.database)({ uid: 'u1', transactionId: 'tx3', decision: 'approved' }), { status: 'approved', balanceImpact: 0 });
  assert.equal(unsupported.documents.get('users/u1/wallet/summary').balance, 80);
  assert.equal(unsupported.documents.get('users/u1/transactions/tx3').status, 'approved');

  const currencyMismatch = makeFirestore({
    'users/u1/transactions/tx4': { type: 'deposit', status: 'pending', amount: 25, currency: 'USD' },
    'users/u1/wallet/summary': { balance: 80, currency: 'BDT' },
  });
  await assert.rejects(createTransactionReviewer(currencyMismatch.database)({ uid: 'u1', transactionId: 'tx4', decision: 'approved' }), { code: 'failed-precondition' });
  assert.equal(currencyMismatch.documents.get('users/u1/wallet/summary').balance, 80);
});
