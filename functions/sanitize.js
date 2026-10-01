// Explicit response schemas. Never spread stored documents into a response.
function text(value) {
  if (typeof value !== 'string') return null;
  // Suppress possible PANs even when accidentally stored in a display field.
  return value.slice(0, 250).replace(/(?:\d[ -]?){12,19}/g, '[redacted]');
}
function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function date(value) { return value && typeof value.toDate === 'function' ? value.toDate().toISOString() : null; }
function fields(data, names) { return Object.fromEntries(names.map(name => [name, text(data?.[name])])); }
function profile(data = {}) {
  return { ...fields(data, ['displayName', 'name', 'email', 'phoneNumber', 'status']), admin: data.admin === true, createdAt: date(data.createdAt) };
}
function wallet(data = {}) {
  return { ...fields(data, ['currency', 'status']), ...Object.fromEntries(['balance', 'rewardPoints', 'monthlyLimit', 'monthlyUsage'].map(key => [key, number(data[key])])) };
}
function personal(data = {}) { return fields(data, ['firstName', 'lastName', 'dateOfBirth', 'address', 'country', 'verificationStatus']); }
function lastFour(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}
function method(id, data = {}) {
  return { id, ...fields(data, ['kind', 'brand', 'bankName', 'status']), last4: lastFour(data.last4) || lastFour(data.kind === 'card' ? data.cardNumber : data.accountNumber) };
}
function transaction(id, data = {}) {
  return { id, ...fields(data, ['uid', 'type', 'status', 'currency']), amount: number(data.amount), fee: number(data.fee), createdAt: date(data.createdAt), updatedAt: date(data.updatedAt) };
}
function account(id, data = {}) { return { id, ...fields(data, ['name', 'bankName', 'type', 'currency', 'status']), last4: lastFour(data.accountNumber) }; }
function bonus(id, data = {}) { return { id, enabled: typeof data.enabled === 'boolean' ? data.enabled : null, amount: number(data.amount), percentage: number(data.percentage), currency: text(data.currency) }; }
module.exports = { profile, wallet, personal, method, transaction, account, bonus };
