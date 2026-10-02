const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldPath, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const safe = require('./sanitize');
const { requireAdmin } = require('./security');
initializeApp();
const db = getFirestore();
function id(value) {
  if (typeof value !== 'string' || !value || value.length > 128 || value.includes('/')) throw new HttpsError('invalid-argument', 'Invalid identifier.');
  return value;
}
const balanceCreditTypes = new Set(['addbalance', 'addbalancerequest', 'balanceadd', 'deposit', 'topup', 'recharge', 'cashin', 'addfunds', 'walletcredit']);
const balanceDebitTypes = new Set(['sendmoney', 'cashout', 'withdrawal', 'withdraw', 'payout', 'transferout', 'debit', 'payment']);
const getBalanceDelta = transaction => {
  const normalizedType = String(transaction.type || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (balanceCreditTypes.has(normalizedType)) return Number(transaction.amount ?? 0) || 0;
  if (balanceDebitTypes.has(normalizedType)) return -(Number(transaction.amount ?? 0) || 0);
  return 0;
};
const isPendingReview = status => ['pending', 'under review', 'under_review'].includes(String(status || '').toLowerCase());
function createTransactionReviewer(database, timestamp = () => FieldValue.serverTimestamp()) {
  return async input => {
    const uid = id(input.uid);
    const transactionId = id(input.transactionId);
    const decision = input.decision;
    if (!['approved', 'rejected'].includes(decision)) throw new HttpsError('invalid-argument', 'Choose approve or reject.');

    const transactionRef = database.doc(`users/${uid}/transactions/${transactionId}`);
    const walletRef = database.doc(`users/${uid}/wallet/summary`);
    return database.runTransaction(async firestoreTransaction => {
    const transactionSnap = await firestoreTransaction.get(transactionRef);
    if (!transactionSnap.exists) throw new HttpsError('not-found', 'Transaction not found.');
    const transactionData = transactionSnap.data() || {};
    if (!isPendingReview(transactionData.status)) throw new HttpsError('failed-precondition', 'This transaction has already been reviewed.');
    if (transactionData.uid && transactionData.uid !== uid) throw new HttpsError('permission-denied', 'This transaction belongs to a different user.');
    if (transactionData.balanceApplied === true) throw new HttpsError('failed-precondition', 'This request has already changed the balance and cannot be reviewed again.');

    const requestId = id(typeof transactionData.requestId === 'string' && transactionData.requestId ? transactionData.requestId : transactionId);
    const requestRef = database.doc(`transactionRequests/${requestId}`);
    const requestSnap = await firestoreTransaction.get(requestRef);
    let walletData = null;
    let amount = null;
    let balanceDelta = 0;
    if (decision === 'approved') {
      amount = Number(transactionData.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new HttpsError('failed-precondition', 'The requested amount must be greater than zero.');
      balanceDelta = getBalanceDelta(transactionData);
      if (balanceDelta !== 0) {
        const walletSnap = await firestoreTransaction.get(walletRef);
        walletData = walletSnap.exists ? walletSnap.data() || {} : {};
        if (!Number.isFinite(Number(walletData.balance ?? 0))) throw new HttpsError('failed-precondition', 'The current wallet balance is invalid.');
        if (walletData.currency && transactionData.currency && walletData.currency !== transactionData.currency) {
          throw new HttpsError('failed-precondition', 'The transaction currency does not match the user wallet.');
        }
      }
    }
    if (requestSnap.exists) {
      const requestData = requestSnap.data() || {};
      if (requestData.uid && requestData.uid !== uid) throw new HttpsError('failed-precondition', 'The linked request belongs to a different user.');
      if (!isPendingReview(requestData.status)) throw new HttpsError('failed-precondition', 'The linked request has already been reviewed.');
      if (decision === 'approved' && requestData.amount != null && Number(requestData.amount) !== amount) {
        throw new HttpsError('failed-precondition', 'The linked request amount does not match the transaction amount.');
      }
    }

    const update = { status: decision, updatedAt: timestamp() };
    if (decision === 'approved') {
      update.balanceApplied = balanceDelta !== 0;
      update.balanceImpact = balanceDelta;
      if (balanceDelta !== 0) {
        firestoreTransaction.set(walletRef, {
          ...walletData,
          balance: Number(walletData.balance || 0) + balanceDelta,
          currency: walletData.currency || transactionData.currency || null,
          updatedAt: timestamp(),
        }, { merge: true });
      }
    }
    firestoreTransaction.update(transactionRef, update);
    if (requestSnap.exists) firestoreTransaction.update(requestRef, { status: decision, updatedAt: timestamp() });
    return { status: decision, balanceImpact: decision === 'approved' ? balanceDelta : null };
    });
  };
}
const reviewTransaction = createTransactionReviewer(db);
exports.createTransactionReviewer = createTransactionReviewer;
exports.reviewTransaction = reviewTransaction;
function getUserDirectoryCandidates() {
  return ['adminUserDirectory', 'users'];
}
function chooseUserDirectory({ adminUserDirectory, users } = { adminUserDirectory: false, users: false }) {
  return adminUserDirectory ? 'adminUserDirectory' : 'users';
}
async function resolveUserDirectoryCollection() {
  for (const name of getUserDirectoryCandidates()) {
    const snapshot = await db.collection(name).limit(1).get();
    if (!snapshot.empty) return name;
  }
  return 'users';
}
async function page(collection, cursor, serialize, byDate = false) {
  let query = byDate ? collection.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc') : collection.orderBy(FieldPath.documentId());
  if (cursor) {
    const document = await collection.doc(id(cursor)).get();
    if (!document.exists) throw new HttpsError('failed-precondition', 'Page cursor no longer exists. Refresh the list.');
    query = query.startAfter(document);
  }
  const result = await query.limit(21).get();
  const documents = result.docs.slice(0, 20);
  return { items: documents.map(doc => serialize(doc.id, doc.data())), nextCursor: result.size > 20 ? documents[19].id : null };
}
exports.getUserDirectoryCandidates = getUserDirectoryCandidates;
exports.chooseUserDirectory = chooseUserDirectory;
exports.resolveUserDirectoryCollection = resolveUserDirectoryCollection;
exports.toppayAdminApi = onCall({ region: 'us-central1', maxInstances: 10 }, async request => {
  // Check live Auth and Firestore records on EVERY call, including pagination.
  await requireAdmin(request, getAuth(), db, HttpsError);
  const input = request.data || {};
  switch (input.action) {
    case 'session': return { uid: request.auth.uid, verified: true };
    case 'users': {
      const collectionName = await resolveUserDirectoryCollection();
      const collectionRef = db.collection(collectionName);
      return page(collectionRef, input.cursor, (uid, data) => ({ uid, ...safe.profile(data) }));
    }
    case 'user': {
      const uid = id(input.uid);
      const base = db.doc(`users/${uid}`);
      const [profile, wallet, personal] = await Promise.all([base.get(), base.collection('wallet').doc('summary').get(), base.collection('personalInformation').doc('profile').get()]);
      if (!profile.exists) {
        const legacyProfile = await db.doc(`adminUserDirectory/${uid}`).get();
        if (!legacyProfile.exists) throw new HttpsError('not-found', 'User not found.');
        const legacyData = legacyProfile.data() || {};
        return {
          uid,
          profile: safe.profile({ ...legacyData, uid, name: legacyData.name || legacyData.displayName }),
          wallet: safe.wallet({}),
          personal: safe.personal({}),
        };
      }
      return { uid, profile: safe.profile(profile.data()), wallet: safe.wallet(wallet.data()), personal: safe.personal(personal.data()) };
    }
    case 'transactions': return page(db.collection(`users/${id(input.uid)}/transactions`), input.cursor, safe.transaction, true);
    case 'transaction': {
      const doc = await db.doc(`users/${id(input.uid)}/transactions/${id(input.transactionId)}`).get();
      if (!doc.exists) throw new HttpsError('not-found', 'Transaction not found.');
      return safe.transaction(doc.id, doc.data());
    }
    case 'reviewTransaction': return reviewTransaction(input);
    case 'methods': {
      if (!['card', 'bank'].includes(input.kind)) throw new HttpsError('invalid-argument', 'Invalid payment kind.');
      return page(db.collection(`users/${id(input.uid)}/paymentMethods`).where('kind', '==', input.kind), input.cursor, safe.method);
    }
    case 'requests': return page(db.collection('transactionRequests'), input.cursor, safe.transaction);
    case 'accounts': {
      const providers = ['bkash', 'nagad', 'rocket'];
      const docs = await Promise.all(providers.map(provider => db.doc(`account/${provider}`).get()));
      return { items: docs.filter(doc => doc.exists).map(doc => safe.account(doc.id, doc.data())), nextCursor: null };
    }
    case 'updateAccount': {
      const provider = id(input.provider).toLowerCase();
      if (!['bkash', 'nagad', 'rocket'].includes(provider)) throw new HttpsError('invalid-argument', 'Choose a valid payment account provider.');
      const data = { ...(input.data || {}) };
      delete data.id;
      delete data.provider;
      await db.doc(`account/${provider}`).set(data, { merge: true });
      return { ok: true };
    }
    case 'bonuses': {
      const docs = await Promise.all(['sendmoney', 'cashout'].map(key => db.doc(`bonus/${key}`).get()));
      return { items: docs.map(doc => safe.bonus(doc.id, doc.data())) };
    }
    default: throw new HttpsError('invalid-argument', 'Unknown admin action.');
  }
});
