import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { adminApi } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
jest.mock('./firebase', () => ({ auth: {}, configured: true, adminApi: jest.fn(), friendlyError: () => 'Access denied.' }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn(), signInWithEmailAndPassword: jest.fn(), signOut: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
test('does not fetch user data before backend authorizes an admin', async () => {
  onAuthStateChanged.mockImplementation((auth, callback) => { callback({ uid: 'not-admin' }); return () => {}; });
  adminApi.mockRejectedValue(new Error('denied'));
  render(<App/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied.');
  expect(adminApi.mock.calls.map(call => call[0])).toEqual(['session']);
  expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
});
test('opens profile, pages older transactions and shows safe transaction details', async () => {
  onAuthStateChanged.mockImplementation((auth, callback) => { callback({ uid: 'admin', email: 'admin@example.test' }); return () => {}; });
  adminApi.mockImplementation(async (action, input) => {
    if (action === 'session') return { verified: true };
    if (action === 'users') return { items: [{ uid: 'u1', name: 'Test User', status: 'active' }], nextCursor: null };
    if (action === 'user') return { profile: { name: 'Test User' }, wallet: {}, personal: {} };
    if (action === 'transactions') return input.cursor ? { items: [{ id: 'older', amount: 5, currency: 'BDT' }], nextCursor: null } : { items: [{ id: 'newer', amount: 10, currency: 'BDT' }], nextCursor: 'newer' };
    if (action === 'transaction') return { id: input.transactionId, amount: 5, currency: 'BDT' };
    throw new Error('Unexpected action');
  });
  render(<App/>);
  fireEvent.click(await screen.findByRole('button', { name: /Test User No email/ }));
  fireEvent.click(await screen.findByRole('tab', { name: 'All transactions' }));
  expect(await screen.findByText('newer')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next →' }));
  expect(await screen.findByText('older')).toBeInTheDocument();
  expect(adminApi).toHaveBeenCalledWith('transactions', { uid: 'u1', cursor: 'newer' });
  fireEvent.click(screen.getByRole('button', { name: 'Details ↗' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('id'));
  expect(screen.getByRole('dialog')).toHaveTextContent('older');
  expect(screen.getByRole('dialog')).toHaveTextContent('currency');
});

test('loads and displays notifications for the selected user', async () => {
  onAuthStateChanged.mockImplementation((auth, callback) => { callback({ uid: 'admin', email: 'admin@example.test' }); return () => {}; });
  adminApi.mockImplementation(async (action, input) => {
    if (action === 'session') return { verified: true };
    if (action === 'users') return { items: [{ uid: 'u1', name: 'Test User', status: 'active' }], nextCursor: null };
    if (action === 'user') return { profile: { name: 'Test User' }, wallet: {}, personal: {} };
    if (action === 'notifications' && input.uid === 'u1') return { items: [{ id: 'notice-1', title: 'Payment update', message: 'Your payment was received', read: false }], nextCursor: null };
    if (action === 'updateUserRecord') return { ok: true };
    throw new Error('Unexpected action');
  });

  render(<App/>);
  fireEvent.click(await screen.findByRole('button', { name: /Test User No email/ }));
  fireEvent.click(await screen.findByRole('tab', { name: 'Notifications' }));

  expect(await screen.findByRole('heading', { name: 'Payment update' })).toBeInTheDocument();
  expect(screen.getByText('Your payment was received')).toBeInTheDocument();
  expect(screen.getByText('notice-1')).toBeInTheDocument();
  expect(adminApi).toHaveBeenCalledWith('notifications', { uid: 'u1', cursor: null });

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(await screen.findByLabelText('message'), { target: { value: 'Payment completed successfully' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(adminApi).toHaveBeenCalledWith('updateUserRecord', {
    uid: 'u1', section: 'notifications', recordId: 'notice-1',
    data: { id: 'notice-1', title: 'Payment update', message: 'Payment completed successfully', read: false }
  }));
});

test('editing a transaction updates that user transaction document', async () => {
  onAuthStateChanged.mockImplementation((auth, callback) => { callback({ uid: 'admin', email: 'admin@example.test' }); return () => {}; });
  adminApi.mockImplementation(async (action, input) => {
    if (action === 'session') return { verified: true };
    if (action === 'users') return { items: [{ uid: 'u1', name: 'Test User', status: 'active' }], nextCursor: null };
    if (action === 'user') return { profile: { name: 'Test User' }, wallet: {}, personal: {} };
    if (action === 'transactions') return { items: [{ id: 'tx-1', type: 'deposit', amount: 150, status: 'pending', currency: 'BDT' }], nextCursor: null };
    if (action === 'transaction') return { id: 'tx-1', uid: 'u1', type: 'deposit', amount: 150, balanceImpact: 20, status: 'pending', currency: 'BDT' };
    if (action === 'updateUserRecord') return { ok: true };
    throw new Error('Unexpected action');
  });

  render(<App/>);
  fireEvent.click(await screen.findByRole('button', { name: /Test User No email/ }));
  await screen.findByRole('heading', { name: 'Test User' });
  fireEvent.click(screen.getByRole('tab', { name: 'All transactions' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(await screen.findByLabelText('status'), { target: { value: 'completed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await waitFor(() => expect(adminApi).toHaveBeenCalledWith('updateUserRecord', {
    uid: 'u1', section: 'transactions', recordId: 'tx-1',
    data: { id: 'tx-1', uid: 'u1', type: 'deposit', amount: 150, balanceImpact: 20, status: 'completed', currency: 'BDT' }
  }));
});

test.each([
  ['approved', 'add_balance', 'Confirm approval'],
  ['rejected', 'cashout', 'Confirm rejection'],
])('can mark a pending transaction %s', async (decision, type, confirmLabel) => {
  onAuthStateChanged.mockImplementation((auth, callback) => { callback({ uid: 'admin', email: 'admin@example.test' }); return () => {}; });
  adminApi.mockImplementation(async (action, input) => {
    if (action === 'session') return { verified: true };
    if (action === 'users') return { items: [{ uid: 'u1', name: 'Test User', status: 'active' }], nextCursor: null };
    if (action === 'user') return { profile: { name: 'Test User' }, wallet: {}, personal: {} };
    if (action === 'transactions') return { items: [{ id: 'tx-review', type, amount: 400, status: 'pending', currency: 'BDT' }], nextCursor: null };
    if (action === 'transaction') return { id: 'tx-review', uid: 'u1', type, amount: 400, status: 'pending', currency: 'BDT' };
    if (action === 'reviewTransaction') return { status: input.decision, balanceImpact: input.decision === 'approved' ? 400 : null };
    throw new Error('Unexpected action');
  });

  render(<App/>);
  fireEvent.click(await screen.findByRole('button', { name: /Test User No email/ }));
  await screen.findByRole('heading', { name: 'Test User' });
  fireEvent.click(screen.getByRole('tab', { name: 'All transactions' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Details ↗' }));
  fireEvent.click(await screen.findByRole('button', { name: decision === 'approved' ? 'Approve' : 'Reject' }));
  if (decision === 'approved') expect(screen.getByText(/add 400 BDT to this user's wallet/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: confirmLabel }));

  await waitFor(() => expect(adminApi).toHaveBeenCalledWith('reviewTransaction', {
    uid: 'u1', transactionId: 'tx-review', decision
  }));
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(decision));
});

test.each([
  ['Saved cards', 'card', 'card-1'],
  ['Saved banks', 'bank', 'bank-1'],
])('%s edits only its selected payment method', async (tab, kind, recordId) => {
  onAuthStateChanged.mockImplementation((auth, callback) => { callback({ uid: 'admin', email: 'admin@example.test' }); return () => {}; });
  adminApi.mockImplementation(async (action, input) => {
    if (action === 'session') return { verified: true };
    if (action === 'users') return { items: [{ uid: 'u1', name: 'Test User', status: 'active' }], nextCursor: null };
    if (action === 'user') return { profile: { name: 'Test User' }, wallet: {}, personal: {} };
    if (action === 'methods') return { items: [{ id: recordId, kind: input.kind, brand: 'Visa', last4: '4242' }], nextCursor: null };
    if (action === 'updateUserRecord') return { ok: true };
    throw new Error('Unexpected action');
  });

  render(<App/>);
  fireEvent.click(await screen.findByRole('button', { name: /Test User No email/ }));
  await screen.findByRole('heading', { name: 'Test User' });
  fireEvent.click(screen.getByRole('tab', { name: tab }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(await screen.findByLabelText('brand'), { target: { value: 'Updated method' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await waitFor(() => expect(adminApi).toHaveBeenCalledWith('updateUserRecord', {
    uid: 'u1', section: 'methods', recordId,
    data: { id: recordId, kind, brand: 'Updated method', last4: '4242' }
  }));
});

test('opens the exact user transaction detail from the requests list', async () => {
  onAuthStateChanged.mockImplementation((auth, callback) => { callback({ uid: 'admin', email: 'admin@example.test' }); return () => {}; });
  adminApi.mockImplementation(async (action, input) => {
    if (action === 'session') return { verified: true };
    if (action === 'requests') return { items: [{ id: 'req-1', uid: 'u9', amount: 250, currency: 'BDT', status: 'completed', createdAt: '2024-01-01T00:00:00.000Z' }], nextCursor: null };
    if (action === 'user') return { profile: { name: 'Test User', status: 'active' }, wallet: { balance: 250, currency: 'BDT' }, personal: {} };
    if (action === 'transactions') return { items: [{ id: 'req-1', amount: 250, currency: 'BDT', status: 'completed', createdAt: '2024-01-01T00:00:00.000Z' }], nextCursor: null };
    if (action === 'transaction') return { id: 'req-1', uid: 'u9', amount: 250, currency: 'BDT', status: 'completed', type: 'cashout', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:05:00.000Z' };
    throw new Error('Unexpected action');
  });

  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Transaction requests' }));
  fireEvent.click(await screen.findByRole('button', { name: 'View transaction ↗' }));

  await waitFor(() => expect(screen.getByRole('heading', { name: 'Test User' })).toBeInTheDocument());
  expect(screen.getByRole('dialog')).toHaveTextContent('id');
  expect(screen.getByRole('dialog')).toHaveTextContent('req-1');
  expect(screen.getByRole('dialog')).toHaveTextContent('cashout');
});

test('shows all raw transaction fields in the detail dialog', async () => {
  onAuthStateChanged.mockImplementation((auth, callback) => { callback({ uid: 'admin', email: 'admin@example.test' }); return () => {}; });
  adminApi.mockImplementation(async (action, input) => {
    if (action === 'session') return { verified: true };
    if (action === 'user') return { profile: { name: 'Test User', status: 'active' }, wallet: { balance: 250, currency: 'BDT' }, personal: {} };
    if (action === 'transaction') return {
      id: 'req-1',
      uid: 'u9',
      amount: 250,
      balanceImpact: 10000,
      currency: 'BDT',
      status: 'completed',
      type: 'cashout',
      method: 'Visa ••• 8184',
      paymentCardNumber: '417052568258184',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:05:00.000Z'
    };
    if (action === 'transactions') return { items: [{ id: 'req-1', amount: 250, currency: 'BDT', status: 'completed', createdAt: '2024-01-01T00:00:00.000Z' }], nextCursor: null };
    if (action === 'requests') return { items: [{ id: 'req-1', uid: 'u9', amount: 250, currency: 'BDT', status: 'completed', createdAt: '2024-01-01T00:00:00.000Z' }], nextCursor: null };
    throw new Error('Unexpected action');
  });

  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Transaction requests' }));
  fireEvent.click(await screen.findByRole('button', { name: 'View transaction ↗' }));

  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('balanceImpact'));
  expect(screen.getByRole('dialog')).toHaveTextContent('paymentCardNumber');
  expect(screen.getByRole('dialog')).toHaveTextContent('417052568258184');
});

test('admin can edit user values without changing field names and delete the record', async () => {
  onAuthStateChanged.mockImplementation((auth, callback) => { callback({ uid: 'admin', email: 'admin@example.test' }); return () => {}; });
  adminApi.mockImplementation(async (action, input) => {
    if (action === 'session') return { verified: true };
    if (action === 'users') return { items: [{ uid: 'u1', name: 'Test User', status: 'active', email: 'test@example.com', createdAt: '2024-01-01T00:00:00.000Z' }], nextCursor: null };
    if (action === 'user') return { profile: { name: 'Test User', status: 'active' }, wallet: { balance: 250, currency: 'BDT' }, personal: { city: 'Dhaka' } };
    if (action === 'transactions') return { items: [], nextCursor: null };
    if (action === 'updateUserRecord') return { ok: true };
    if (action === 'deleteUser') return { ok: true };
    throw new Error('Unexpected action');
  });

  render(<App />);
  const userButtons = await screen.findAllByRole('button', { name: /Test User/i });
  fireEvent.click(userButtons[0]);
  const profileEditButtons = await screen.findAllByRole('button', { name: 'Edit' });
  fireEvent.click(profileEditButtons[0]);

  const nameField = await screen.findByLabelText('name');
  fireEvent.change(nameField, { target: { value: 'Updated User' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await waitFor(() => expect(adminApi).toHaveBeenCalledWith('updateUserRecord', {
    uid: 'u1',
    section: 'profile',
    recordId: null,
    data: { name: 'Updated User', status: 'active' }
  }));

  fireEvent.click(screen.getByRole('tab', { name: 'Balance' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(await screen.findByLabelText('balance'), { target: { value: '500' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await waitFor(() => expect(adminApi).toHaveBeenCalledWith('updateUserRecord', {
    uid: 'u1',
    section: 'balance',
    recordId: null,
    data: { balance: 500, currency: 'BDT' }
  }));

  fireEvent.click(screen.getByRole('button', { name: 'Delete user' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));
  await waitFor(() => expect(adminApi).toHaveBeenCalledWith('deleteUser', { uid: 'u1' }));
});

test('reads payment accounts from account/{provider}/number and edits the selected account', async () => {
  onAuthStateChanged.mockImplementation((auth, callback) => { callback({ uid: 'admin', email: 'admin@example.test' }); return () => {}; });
  adminApi.mockImplementation(async (action, input) => {
    if (action === 'session') return { verified: true };
    if (action === 'users') return { items: [{ uid: 'u1', name: 'Test User', status: 'active' }], nextCursor: null };
    if (action === 'accounts') return { items: [{ id: 'bkash', provider: 'bkash', name: 'Bkash', number: '01712345678', currency: 'BDT', status: 'active' }], nextCursor: null };
    if (action === 'updateAccount') return { ok: true };
    throw new Error('Unexpected action');
  });

  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Payment accounts' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

  fireEvent.change(await screen.findByLabelText('number'), { target: { value: '01777777777' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await waitFor(() => expect(adminApi).toHaveBeenCalledWith('updateAccount', {
    provider: 'bkash',
    data: { id: 'bkash', provider: 'bkash', name: 'Bkash', number: '01777777777', currency: 'BDT', status: 'active' }
  }));
});
