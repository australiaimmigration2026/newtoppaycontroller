const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const safe = require('./sanitize');
const { requireAdmin } = require('./security');
initializeApp();
const db = getFirestore();
function id(value) {
  if (typeof value !== 'string' || !value || value.length > 128 || value.includes('/')) throw new HttpsError('invalid-argument', 'Invalid identifier.');
  return value;
}
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
    case 'methods': {
      if (!['card', 'bank'].includes(input.kind)) throw new HttpsError('invalid-argument', 'Invalid payment kind.');
      return page(db.collection(`users/${id(input.uid)}/paymentMethods`).where('kind', '==', input.kind), input.cursor, safe.method);
    }
    case 'requests': return page(db.collection('transactionRequests'), input.cursor, safe.transaction);
    case 'accounts': return page(db.collection('account'), input.cursor, safe.account);
    case 'bonuses': {
      const docs = await Promise.all(['sendmoney', 'cashout'].map(key => db.doc(`bonus/${key}`).get()));
      return { items: docs.map(doc => safe.bonus(doc.id, doc.data())) };
    }
    default: throw new HttpsError('invalid-argument', 'Unknown admin action.');
  }
});
