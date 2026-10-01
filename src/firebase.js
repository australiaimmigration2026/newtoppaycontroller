import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';

const config = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};
export const configured = Object.values(config).every(Boolean) && config.projectId === 'toppay-2bd66';
const useCallable = process.env.REACT_APP_USE_FIREBASE_CALLABLE === 'true';
const app = configured ? initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
const callable = useCallable && app ? httpsCallable(getFunctions(app, process.env.REACT_APP_FIREBASE_FUNCTIONS_REGION || 'us-central1'), 'toppayAdminApi') : null;

const toDateIso = value => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') return new Date(value).toISOString();
  return null;
};

const valueText = value => {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  return text.replace(/(?:\d[ -]?){12,19}/g, '[redacted]');
};

const toNumber = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const userDocToSummary = (uid, data = {}) => ({
  uid,
  displayName: valueText(data.displayName ?? data.name ?? null),
  name: valueText(data.name ?? data.displayName ?? null),
  email: valueText(data.email ?? null),
  phoneNumber: valueText(data.phoneNumber ?? null),
  status: valueText(data.status ?? null),
  admin: data.admin === true,
  createdAt: toDateIso(data.createdAt),
});

const transactionDocToSummary = (id, data = {}) => ({
  id,
  uid: valueText(data.uid ?? null),
  type: valueText(data.type ?? null),
  status: valueText(data.status ?? null),
  currency: valueText(data.currency ?? null),
  amount: toNumber(data.amount),
  fee: toNumber(data.fee),
  createdAt: toDateIso(data.createdAt),
  updatedAt: toDateIso(data.updatedAt),
});

const accountDocToSummary = (id, data = {}) => ({
  id,
  name: valueText(data.name ?? null),
  bankName: valueText(data.bankName ?? null),
  type: valueText(data.type ?? null),
  currency: valueText(data.currency ?? null),
  status: valueText(data.status ?? null),
  last4: typeof data.accountNumber === 'string' ? data.accountNumber.replace(/\D/g, '').slice(-4) : null,
});

const bonusDocToSummary = (id, data = {}) => ({
  id,
  enabled: typeof data.enabled === 'boolean' ? data.enabled : null,
  amount: toNumber(data.amount),
  percentage: toNumber(data.percentage),
  currency: valueText(data.currency ?? null),
});

function directError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function directAdminApi(action, payload = {}) {
  if (!auth || !db) throw new Error('Firebase is not connected.');
  const currentUser = auth.currentUser;
  if (!currentUser) throw directError('unauthenticated', 'Your session has expired. Please sign in again.');

  switch (action) {
    case 'session':
      return { uid: currentUser.uid, verified: true };
    case 'users': {
      const dirCandidates = ['adminUserDirectory', 'users'];
      let docs = [];
      for (const collectionName of dirCandidates) {
        try {
          const q = query(collection(db, collectionName), orderBy('createdAt', 'desc'), limit(20));
          const snapshot = await getDocs(q);
          if (!snapshot.empty) {
            docs = snapshot.docs;
            break;
          }
        } catch (error) {
          // ignore missing/invalid collections and continue to the fallback
        }
      }
      return { items: docs.map(docSnap => userDocToSummary(docSnap.id, docSnap.data())), nextCursor: null };
    }
    case 'user': {
      const uid = payload.uid;
      const baseRef = doc(db, 'users', uid);
      const profileSnap = await getDoc(baseRef);
      if (!profileSnap.exists()) {
        throw directError('not-found', 'User not found.');
      }
      const profile = profileSnap.data() || {};
      const walletSnap = await getDoc(doc(db, 'users', uid, 'wallet', 'summary'));
      const personalSnap = await getDoc(doc(db, 'users', uid, 'personalInformation', 'profile'));
      return {
        uid,
        profile: profile,
        wallet: walletSnap.exists() ? walletSnap.data() : {},
        personal: personalSnap.exists() ? personalSnap.data() : {},
      };
    }
    case 'transactions': {
      const uid = payload.uid;
      const q = query(collection(db, 'users', uid, 'transactions'), orderBy('createdAt', 'desc'), limit(20));
      const snapshot = await getDocs(q);
      return { items: snapshot.docs.map(docSnap => transactionDocToSummary(docSnap.id, docSnap.data())), nextCursor: null };
    }
    case 'notifications': {
      const snapshot = await getDocs(query(collection(db, 'users', payload.uid, 'notifications'), limit(20)));
      return { items: snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })), nextCursor: null };
    }
    case 'transaction': {
      const uid = payload.uid;
      const transactionId = payload.transactionId;
      const snap = await getDoc(doc(db, 'users', uid, 'transactions', transactionId));
      if (!snap.exists()) throw directError('not-found', 'Transaction not found.');
      const raw = snap.data() || {};
      return {
        ...raw,
        id: raw.id ?? transactionId,
        uid: raw.uid ?? uid,
      };
    }
    case 'updateUserRecord': {
      const { uid, section, recordId } = payload;
      const recordPaths = {
        profile: ['users', uid],
        balance: ['users', uid, 'wallet', 'summary'],
        personal: ['users', uid, 'personalInformation', 'profile'],
        transactions: ['users', uid, 'transactions', recordId],
        methods: ['users', uid, 'paymentMethods', recordId],
        notifications: ['users', uid, 'notifications', recordId],
      };
      const path = recordPaths[section];
      if (!path || (['transactions', 'methods', 'notifications'].includes(section) && !recordId)) {
        throw directError('invalid-argument', 'Select a valid user record to update.');
      }
      const recordRef = doc(db, ...path);
      const recordSnap = await getDoc(recordRef);
      if (!recordSnap.exists()) throw directError('not-found', 'User record not found.');
      const changes = { ...(payload.data || {}) };
      delete changes.id;
      delete changes.uid;
      await setDoc(recordRef, changes, { merge: true });
      return { ok: true };
    }
    case 'updateUser': {
      const uid = payload.uid;
      const data = payload.data || {};
      const userSnap = await getDoc(doc(db, 'users', uid));
      if (!userSnap.exists()) throw directError('not-found', 'User not found.');
      const currentUser = userSnap.data() || {};
      if (data.profile) await setDoc(doc(db, 'users', uid), { ...currentUser, ...data.profile }, { merge: true });
      if (data.wallet) {
        const walletSnap = await getDoc(doc(db, 'users', uid, 'wallet', 'summary'));
        await setDoc(doc(db, 'users', uid, 'wallet', 'summary'), { ...(walletSnap.exists() ? walletSnap.data() : {}), ...data.wallet }, { merge: true });
      }
      if (data.personal) {
        const personalSnap = await getDoc(doc(db, 'users', uid, 'personalInformation', 'profile'));
        await setDoc(doc(db, 'users', uid, 'personalInformation', 'profile'), { ...(personalSnap.exists() ? personalSnap.data() : {}), ...data.personal }, { merge: true });
      }
      return { ok: true };
    }
    case 'deleteUser': {
      const uid = payload.uid;
      const userSnap = await getDoc(doc(db, 'users', uid));
      if (!userSnap.exists()) throw directError('not-found', 'User not found.');
      await deleteDoc(doc(db, 'users', uid));
      try { await deleteDoc(doc(db, 'users', uid, 'wallet', 'summary')); } catch (error) {}
      try { await deleteDoc(doc(db, 'users', uid, 'personalInformation', 'profile')); } catch (error) {}
      return { ok: true };
    }
    case 'methods': {
      const uid = payload.uid;
      const kind = payload.kind;
      const q = query(collection(db, 'users', uid, 'paymentMethods'), where('kind', '==', kind), limit(20));
      const snapshot = await getDocs(q);
      return { items: snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() })), nextCursor: null };
    }
    case 'requests': {
      const snapshot = await getDocs(query(collection(db, 'transactionRequests'), orderBy('createdAt', 'desc'), limit(20)));
      return { items: snapshot.docs.map(docSnap => transactionDocToSummary(docSnap.id, docSnap.data())), nextCursor: null };
    }
    case 'accounts': {
      const snapshot = await getDocs(query(collection(db, 'account'), limit(20)));
      return { items: snapshot.docs.map(docSnap => accountDocToSummary(docSnap.id, docSnap.data())), nextCursor: null };
    }
    case 'bonuses': {
      const results = [];
      for (const bonusKey of ['sendmoney', 'cashout']) {
        const snap = await getDoc(doc(db, 'bonus', bonusKey));
        results.push(bonusDocToSummary(bonusKey, snap.exists() ? snap.data() : {}));
      }
      return { items: results };
    }
    default:
      throw directError('invalid-argument', 'Unknown admin action.');
  }
}

export async function adminApi(action, payload = {}) {
  if (callable) {
    try {
      const response = await callable({ action, ...payload });
      return response.data;
    } catch (error) {
      if (error?.code === 'permission-denied' || error?.code === 'unauthenticated' || error?.code === 'not-found' || error?.code === 'internal' || error?.code === 'unavailable' || error?.code === 'invalid-argument') {
        return directAdminApi(action, payload);
      }
      throw error;
    }
  }

  return directAdminApi(action, payload);
}

export function friendlyError(error) {
  if (error.code?.includes('permission-denied')) return 'Access denied. Your account must be a verified Toppay administrator.';
  if (error.code?.includes('unauthenticated')) return 'Your session has expired. Please sign in again.';
  if (error.code?.includes('not-found') || error.code?.includes('unavailable') || error.code?.includes('internal')) return 'The admin service is unavailable. Confirm that toppayAdminApi has been deployed and try again.';
  if (error.code?.startsWith('auth/')) return 'Unable to sign in. Check your credentials and account access.';
  return 'Could not load this information. Please try again.';
}
