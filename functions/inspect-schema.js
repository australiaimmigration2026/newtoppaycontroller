// Local, privileged inspection only. Uses ADC; never print document values.
// Run: node functions/inspect-schema.js [sample-user-uid]
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp({ projectId: 'toppay-2bd66', credential: applicationDefault() });
const db = getFirestore();
function shape(value, depth = 0) {
  if (value === null) return 'null';
  if (value?.toDate) return 'timestamp';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return depth > 2 ? 'map' : Object.fromEntries(Object.entries(value).map(([key, v]) => [key, shape(v, depth + 1)]));
  return typeof value;
}
async function report(label, query) {
  const snapshot = await query.get();
  const docs = snapshot.docs || (snapshot.exists ? [snapshot] : []);
  console.log(JSON.stringify({ path: label, samples: docs.map(doc => shape(doc.data())) }, null, 2));
  return docs;
}
(async () => {
  const users = await report('users/{uid}', db.collection('users').limit(3));
  const uid = process.argv[2] || users[0]?.id;
  if (uid && !uid.includes('/')) {
    await report('users/{uid}/wallet/summary', db.doc(`users/${uid}/wallet/summary`));
    await report('users/{uid}/personalInformation/profile', db.doc(`users/${uid}/personalInformation/profile`));
    await report('users/{uid}/transactions/{id}', db.collection(`users/${uid}/transactions`).limit(3));
    await report('users/{uid}/paymentMethods/{id}', db.collection(`users/${uid}/paymentMethods`).limit(3));
  }
  await report('transactionRequests/{id}', db.collection('transactionRequests').limit(3));
  await report('account/{id}', db.collection('account').limit(3));
  await report('bonus/sendmoney', db.doc('bonus/sendmoney'));
  await report('bonus/cashout', db.doc('bonus/cashout'));
})().catch(() => { console.error('Inspection failed. Verify ADC credentials and Firestore access to toppay-2bd66.'); process.exitCode = 1; });
