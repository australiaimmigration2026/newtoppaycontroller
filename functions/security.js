async function requireAdmin(request, auth, db, ErrorType) {
  if (!request.auth) throw new ErrorType('unauthenticated', 'Sign in required.');
  const [user, record] = await Promise.all([auth.getUser(request.auth.uid), db.doc(`users/${request.auth.uid}`).get()]);
  const authenticatedAt = request.auth.token?.auth_time;
  const revokedBefore = Date.parse(user.tokensValidAfterTime);
  if (user.disabled || !user.emailVerified || record.data()?.admin !== true || !Number.isFinite(authenticatedAt) || !Number.isFinite(revokedBefore) || authenticatedAt * 1000 < revokedBefore) {
    throw new ErrorType('permission-denied', 'Verified administrator required.');
  }
}
module.exports = { requireAdmin };
