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

test('admin can edit and delete a user record', async () => {
  onAuthStateChanged.mockImplementation((auth, callback) => { callback({ uid: 'admin', email: 'admin@example.test' }); return () => {}; });
  adminApi.mockImplementation(async (action, input) => {
    if (action === 'session') return { verified: true };
    if (action === 'users') return { items: [{ uid: 'u1', name: 'Test User', status: 'active', email: 'test@example.com', createdAt: '2024-01-01T00:00:00.000Z' }], nextCursor: null };
    if (action === 'user') return { profile: { name: 'Test User', status: 'active' }, wallet: { balance: 250, currency: 'BDT' }, personal: { city: 'Dhaka' } };
    if (action === 'transactions') return { items: [], nextCursor: null };
    if (action === 'updateUser') return { ok: true };
    if (action === 'deleteUser') return { ok: true };
    throw new Error('Unexpected action');
  });

  render(<App />);
  const userButtons = await screen.findAllByRole('button', { name: /Test User/i });
  fireEvent.click(userButtons[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit all user data' }));

  const textarea = await screen.findByLabelText('User data JSON');
  fireEvent.change(textarea, { target: { value: JSON.stringify({ profile: { name: 'Updated User', status: 'active' }, wallet: { balance: 500, currency: 'BDT' }, personal: { city: 'Chittagong' } }, null, 2) } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  await waitFor(() => expect(adminApi).toHaveBeenCalledWith('updateUser', {
    uid: 'u1',
    data: { profile: { name: 'Updated User', status: 'active' }, wallet: { balance: 500, currency: 'BDT' }, personal: { city: 'Chittagong' } }
  }));

  fireEvent.click(screen.getByRole('button', { name: 'Delete user' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));
  await waitFor(() => expect(adminApi).toHaveBeenCalledWith('deleteUser', { uid: 'u1' }));
});
