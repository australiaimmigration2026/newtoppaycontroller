import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { adminApi, auth, configured, friendlyError } from './firebase';
import './App.css';
import './UserEditor.css';

const icons = {
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/></>,
  requests: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
  accounts: <path d="m3 9 9-6 9 6H3ZM3 21h18M6 12v6M12 12v6M18 12v6"/>,
  bonuses: <><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8H8a3 3 0 1 1 3-3l1 3ZM12 8h4a3 3 0 1 0-3-3l-1 3Z"/></>,
  search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-5"/></>,
  arrow: <path d="m9 5 7 7-7 7"/>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/></>,
  logout: <path d="M9 3H4v18h5M9 12h12m-4-4 4 4-4 4"/>,
};
function Icon({ name, size = 20 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name] || icons.accounts}</svg>; }
const value = v => v === null || v === undefined || v === '' ? 'Not provided' : String(v);
const date = v => v ? new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not provided';
const money = (v, currency) => v == null ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;
function Badge({ children }) { const s = String(children || '').toLowerCase(); return <span className={`badge ${['active', 'verified', 'completed', 'approved'].includes(s) ? 'green' : ['pending', 'under review'].includes(s) ? 'amber' : ''}`}><i/>{children || 'Not provided'}</span>; }
function Fields({ data }) { const entries = Object.entries(data || {}).filter(([, val]) => val !== undefined); return <dl className="fields">{entries.map(([key, val]) => <div key={key}><dt>{key}</dt><dd>{value(val)}</dd></div>)}</dl>; }
function setUserValue(data, path, nextValue) {
  const [key, ...remaining] = path;
  const updated = Array.isArray(data) ? [...data] : { ...data };
  updated[key] = remaining.length ? setUserValue(data[key], remaining, nextValue) : nextValue;
  return updated;
}
function UserValueFields({ data, onChange, path = [] }) {
  return Object.entries(data || {}).map(([key, fieldValue]) => {
    const fieldPath = [...path, key];
    const label = fieldPath.join(' / ');
    const immutable = key === 'id' || key === 'uid';
    if (fieldValue && typeof fieldValue === 'object' && !(fieldValue instanceof Date)) {
      return <div className="edit-field-group" key={label}><strong>{label}</strong><UserValueFields data={fieldValue} onChange={onChange} path={fieldPath}/></div>;
    }
    const update = nextValue => onChange(fieldPath, nextValue);
    return <label className="edit-field" key={label}><span>{label}</span>{typeof fieldValue === 'boolean' ? <select aria-label={label} value={String(fieldValue)} disabled={immutable} onChange={event => update(event.target.value === 'true')}><option value="true">Yes</option><option value="false">No</option></select> : typeof fieldValue === 'number' ? <input aria-label={label} type="number" value={fieldValue} disabled={immutable} onChange={event => update(event.target.value === '' ? null : Number(event.target.value))}/> : <input aria-label={label} type="text" value={fieldValue == null ? '' : String(fieldValue)} disabled={immutable} onChange={event => update(event.target.value)}/>}</label>;
  });
}
function Empty({ title, children, icon = 'users' }) { return <div className="empty"><span className="empty-icon"><Icon name={icon} size={27}/></span><h3>{title}</h3><p>{children}</p></div>; }
function usePage(action, params, enabled) {
  const [cursors, setCursors] = useState([null]);
  const [result, setResult] = useState({ items: [], nextCursor: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const paramsKey = JSON.stringify(params);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setBusy(true); setError(''); setResult({ items: [], nextCursor: null });
    adminApi(action, { ...JSON.parse(paramsKey), cursor: cursors[cursors.length - 1] }).then(data => { if (alive) setResult(data); }).catch(err => { if (alive) setError(friendlyError(err)); }).finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [action, paramsKey, cursors, enabled, version]);
  return { ...result, busy, error, page: cursors.length - 1, refresh: () => setVersion(v => v + 1), back: () => setCursors(c => c.slice(0, -1)), forward: () => result.nextCursor && setCursors(c => [...c, result.nextCursor]) };
}
function ListFeedback({ list, noun }) { return list.error ? <div className="error" role="alert">{list.error} <button onClick={list.refresh}>Try again</button></div> : list.busy ? <div className="loading" role="status">Loading {noun}…</div> : null; }
function Pager({ list }) { return <div className="pagination"><span>Page {list.page + 1} <span className="muted">· Up to 20 records per page</span></span><div><button disabled={list.page === 0 || list.busy} onClick={list.back}>← Previous</button><button disabled={!list.nextCursor || list.busy} onClick={list.forward}>Next →</button></div></div>; }
function Stat({ title, value: amount, caption, icon }) { return <div className="stat"><div className="stat-top"><span>{title}</span><span className="stat-icon"><Icon name={icon}/></span></div><strong>{amount}</strong><small>{caption}</small></div>; }
function Users({ enabled, openUser, connect }) {
  const list = usePage('users', {}, enabled);
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all'); const [lookup, setLookup] = useState('');
  const filtered = list.items.filter(u => `${u.name || ''} ${u.displayName || ''} ${u.email || ''} ${u.uid}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'admin' ? u.admin : u.status === 'active')));
  return <>
    <div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE, AT A GLANCE</div><h1>Users</h1><p>Manage your community. Every account, in one place.</p></div><button className="button" onClick={list.refresh} disabled={!enabled || list.busy}><Icon name="refresh" size={16}/> Refresh users</button></div>
    <div className="stats"><Stat title="Users on this page" value={enabled ? list.items.length : '—'} caption="Your Toppay community" icon="users"/><Stat title="Active on this page" value={enabled ? list.items.filter(u => u.status === 'active').length : '—'} caption="Accounts ready to transact" icon="accounts"/><Stat title="Admins on this page" value={enabled ? list.items.filter(u => u.admin).length : '—'} caption="Trusted account access" icon="shield"/></div>
    <section className="panel"><div className="panel-title"><div><h2>User directory <span className="count">{enabled ? list.items.length : '—'}</span></h2><p>View profiles, wallets, and payment activity.</p></div><span className="small-label">{enabled ? 'Live data' : 'Awaiting connection'}</span></div>
      <div className="toolbar"><label className="search"><Icon name="search" size={18}/><input aria-label="Search users on this page" placeholder="Search this page by name, email, or UID…" value={search} onChange={e => setSearch(e.target.value)} disabled={!enabled}/></label><select aria-label="Filter users on this page" value={filter} onChange={e => setFilter(e.target.value)} disabled={!enabled}><option value="all">All users</option><option value="active">Active users</option><option value="admin">Administrators</option></select></div>
      <div className="table-wrap"><table><thead><tr><th>User</th><th>User ID</th><th>Status</th><th>Joined</th><th>Role</th><th/></tr></thead><tbody>{filtered.map(u => <tr key={u.uid}><td><button className="user-link" onClick={() => openUser(u.uid)}><span className="avatar">{(u.displayName || u.name || u.email || '?').slice(0, 2).toUpperCase()}</span><span><strong>{u.displayName || u.name || 'Unnamed user'}</strong><small>{u.email || 'No email provided'}</small></span></button></td><td className="mono">{u.uid}</td><td><Badge>{u.status}</Badge></td><td>{date(u.createdAt)}</td><td>{u.admin ? 'Admin' : 'User'}</td><td><button className="icon-button" onClick={() => openUser(u.uid)} aria-label={`Open ${u.name || u.uid}`}><Icon name="arrow" size={16}/></button></td></tr>)}</tbody></table></div>
      <ListFeedback list={list} noun="users"/>
      {!enabled ? <Empty title="Your user directory starts here">Connect to Toppay and sign in with a verified admin account<br/>to securely view and manage your users.<br/><button className="primary" onClick={connect}>{configured ? 'Sign in to Toppay' : 'View connection setup'} <span>↗</span></button></Empty> : !list.busy && !list.error && !filtered.length ? <Empty title="No users found">{search || filter !== 'all' ? 'Try a different search or filter on this page.' : 'No user records are available on this page.'}</Empty> : null}
      <Pager list={list}/>
    </section>
    {enabled && <form className="uid-lookup" onSubmit={e => { e.preventDefault(); if (lookup.trim()) openUser(lookup.trim()); }}><span>Looking for a specific account?</span><input aria-label="Exact user UID" placeholder="Enter an exact Firebase UID" value={lookup} onChange={e => setLookup(e.target.value)} required/><button className="button">Open user →</button></form>}
    <div className="privacy-note"><Icon name="shield" size={17}/><span>Private by design. Payment details are masked and access is restricted to verified admins.</span></div>
  </>;
}
function TransactionList({ uid, showDetails, onEdit }) {
  const list = usePage('transactions', { uid }, true);
  return <><ListFeedback list={list} noun="transactions"/><div className="table-wrap"><table><thead><tr><th>Transaction</th><th>Type</th><th>Amount</th><th>Status</th><th>Created</th><th/></tr></thead><tbody>{list.items.map(t => <tr key={t.id}><td className="mono">{t.id}</td><td>{value(t.type)}</td><td>{money(t.amount, t.currency)}</td><td><Badge>{t.status}</Badge></td><td>{date(t.createdAt)}</td><td className="row-actions"><button className="text-button" onClick={() => showDetails(uid, t.id, list.refresh)}>Details ↗</button><button className="text-button" onClick={() => onEdit('transactions', t, list.refresh)}>Edit</button></td></tr>)}</tbody></table></div>{!list.busy && !list.error && !list.items.length && <Empty title="No transactions yet" icon="requests">This user has no dated transaction records.</Empty>}<Pager list={list}/></>;
}
function Methods({ uid, kind, onEdit }) {
  const list = usePage('methods', { uid, kind }, true);
  return <><ListFeedback list={list} noun={kind === 'card' ? 'cards' : 'banks'}/><div className="method-grid">{list.items.map(m => <article className="method" key={m.id}><div className="method-heading"><div><Icon name="accounts"/><h3>{m.brand || m.bankName || (kind === 'card' ? 'Saved card' : 'Bank account')}</h3></div><button className="text-button" onClick={() => onEdit('methods', m, list.refresh)}>Edit</button></div><Fields data={m}/><Badge>{m.status}</Badge></article>)}</div>{!list.busy && !list.error && !list.items.length && <Empty title={kind === 'card' ? 'No saved cards' : 'No saved banks'} icon="accounts">No payment methods of this kind were found.</Empty>}<Pager list={list}/></>;
}
function Notifications({ uid, onEdit }) {
  const list = usePage('notifications', { uid }, true);
  return <><ListFeedback list={list} noun="notifications"/><div className="method-grid">{list.items.map(notification => <article className="method" key={notification.id}><div className="method-heading"><h3>{notification.title || notification.subject || 'Notification'}</h3><button className="text-button" onClick={() => onEdit('notifications', notification, list.refresh)}>Edit</button></div><Fields data={notification}/></article>)}</div>{!list.busy && !list.error && !list.items.length && <Empty title="No notifications" icon="requests">No notifications were found for this user.</Empty>}<Pager list={list}/></>;
}
function UserDetail({ uid, back, showDetails }) {
  const [tab, setTab] = useState('Profile'); const [data, setData] = useState(null); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const [editingRecord, setEditingRecord] = useState(null);
  const [draft, setDraft] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; setError(''); adminApi('user', { uid }).then(d => { if (alive) setData(d); }).catch(e => { if (alive) setError(friendlyError(e)); }); return () => { alive = false; }; }, [uid, retry]);
  const startRecordEdit = async (section, record, refresh) => {
    setError('');
    try {
      const selectedRecord = section === 'transactions'
        ? await adminApi('transaction', { uid, transactionId: record.id })
        : record;
      setDraft({ ...selectedRecord });
      setEditingRecord({ section, recordId: selectedRecord.id || null, refresh });
    } catch (editError) {
      setError(friendlyError(editError));
    }
  };
  const saveRecord = async () => {
    setBusy(true); setError('');
    try {
      await adminApi('updateUserRecord', {
        uid,
        section: editingRecord.section,
        recordId: editingRecord.recordId,
        data: draft,
      });
      if (['profile', 'balance', 'personal'].includes(editingRecord.section)) {
        setData(current => ({ ...current, [editingRecord.section]: { ...current[editingRecord.section], ...draft } }));
      } else {
        editingRecord.refresh?.();
      }
      setEditingRecord(null);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const deleteUser = async () => {
    setBusy(true); setError('');
    try {
      await adminApi('deleteUser', { uid });
      setDeleteOpen(false);
      back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return <>
    <button className="text-button back" onClick={back}>← Back to users</button>
    <div className="page-heading">
      <div><div className="eyebrow">USER OVERVIEW</div><h1>{data?.profile?.displayName || data?.profile?.name || 'User details'}</h1><p className="mono">{uid}</p></div>
      {data && <Badge>{data.profile?.status || 'active'}</Badge>}
    </div>
    {error && <div className="error" role="alert">{error} <button onClick={() => setRetry(n => n + 1)}>Try again</button></div>}
    {!data && !error && <div className="loading">Loading profile…</div>}
    {data && <>
      <div className="toolbar user-actions">
        <button className="button danger" onClick={() => setDeleteOpen(true)}>Delete user</button>
      </div>
      <div className="tabs" role="tablist">{['Profile', 'Balance', 'All transactions', 'Saved cards', 'Saved banks', 'Notifications'].map(t => <button role="tab" aria-selected={t === tab} className={t === tab ? 'selected' : ''} key={t} onClick={() => setTab(t)}>{t}</button>)}</div>
      <section className="panel detail-panel">
        <div className="panel-title"><div><h2>{tab}</h2><p>{tab === 'All transactions' ? 'Full history, newest first. Browse older records using the page controls.' : tab.startsWith('Saved') ? 'Showing raw payment detail values from Firestore.' : 'Account information from Toppay.'}</p></div></div>
        {tab === 'Profile' && <div className="detail-content">
          <div className="record-section-heading"><h3>Profile</h3><button className="text-button" onClick={() => startRecordEdit('profile', data.profile || {})}>Edit</button></div>
          <Fields data={data.profile || {}}/>
          <div className="record-section-heading"><h3>Personal information</h3><button className="text-button" disabled={!Object.keys(data.personal || {}).length} onClick={() => startRecordEdit('personal', data.personal || {})}>Edit</button></div>
          <Fields data={data.personal || {}}/>
        </div>}
        {tab === 'Balance' && <div className="detail-content">
          <div className="record-section-heading"><h3>Wallet</h3><button className="text-button" disabled={!Object.keys(data.wallet || {}).length} onClick={() => startRecordEdit('balance', data.wallet || {})}>Edit</button></div>
          <div className="balance-value">{money(data.wallet?.balance, data.wallet?.currency)}</div><Fields data={data.wallet || {}}/>
        </div>}
        {tab === 'All transactions' && <TransactionList uid={uid} showDetails={showDetails} onEdit={startRecordEdit}/>}
        {tab === 'Saved cards' && <Methods key="card" uid={uid} kind="card" onEdit={startRecordEdit}/>}
        {tab === 'Saved banks' && <Methods key="bank" uid={uid} kind="bank" onEdit={startRecordEdit}/>}
        {tab === 'Notifications' && <Notifications uid={uid} onEdit={startRecordEdit}/>}
      </section>
    </>}
    {editingRecord && <Modal className="record-editor-dialog" title={`Edit ${editingRecord.section === 'personal' ? 'personal information' : editingRecord.section}${editingRecord.recordId ? ` · ${editingRecord.recordId}` : ''}`} close={() => setEditingRecord(null)}>
      <div className="record-editor"><div className="edit-fields"><UserValueFields data={draft || {}} onChange={(fieldPath, nextValue) => setDraft(current => setUserValue(current, fieldPath, nextValue))}/></div></div>
      <div className="modal-actions"><button className="button" onClick={() => setEditingRecord(null)}>Cancel</button><button className="primary" onClick={saveRecord} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
    </Modal>}
    {deleteOpen && <Modal title="Delete user" close={() => setDeleteOpen(false)}><div className="modal-copy"><p>Are you sure you want to delete this user and their profile data?</p></div><div className="modal-actions"><button className="button" onClick={() => setDeleteOpen(false)}>Cancel</button><button className="button danger" onClick={deleteUser} disabled={busy}>{busy ? 'Deleting…' : 'Confirm delete'}</button></div></Modal>}
  </>;
}
const sections = { users: ['Users', 'Your community, all in one place.'], requests: ['Transaction requests', 'Inspect submitted requests and open their linked user transaction.'], accounts: ['Payment accounts', 'App payment destinations, with account numbers masked.'], bonuses: ['Bonus settings', 'Current send money and cash out bonus configuration.'] };
function OtherSection({ section, enabled, connect, openUser, showDetails }) {
  const list = usePage(section, {}, enabled);
  return <><div className="page-heading"><div><div className="eyebrow">TOPPAY ADMINISTRATION</div><h1>{sections[section][0]}</h1><p>{sections[section][1]}</p></div><button className="button" disabled={!enabled || list.busy} onClick={list.refresh}><Icon name="refresh" size={16}/> Refresh</button></div><section className="panel"><div className="panel-title"><h2>{sections[section][0]}</h2><span className="small-label">View only</span></div>{!enabled ? <Empty title="Connect to view records" icon={section}>Sign in with your verified admin account.<br/><button className="primary" onClick={connect}>{configured ? 'Sign in' : 'View connection setup'} ↗</button></Empty> : <><ListFeedback list={list} noun={sections[section][0].toLowerCase()}/>{section === 'requests' ? <div className="table-wrap"><table><thead><tr><th>Request ID</th><th>User</th><th>Amount</th><th>Status</th><th>Created</th><th/></tr></thead><tbody>{list.items.map(r => <tr key={r.id}><td className="mono">{r.id}</td><td><button className="text-button" disabled={!r.uid} onClick={() => openUser(r.uid)}>{value(r.uid)}</button></td><td>{money(r.amount, r.currency)}</td><td><Badge>{r.status}</Badge></td><td>{date(r.createdAt)}</td><td><button className="text-button" disabled={!r.uid} onClick={() => showDetails(r.uid, r.id, list.refresh)}>View transaction ↗</button></td></tr>)}</tbody></table></div> : <div className="method-grid">{list.items.map(r => <article className="method" key={r.id}><Icon name={section}/><h3>{section === 'bonuses' ? r.id === 'sendmoney' ? 'Send money' : 'Cash out' : r.name || r.bankName || 'Payment account'}</h3><Fields data={section === 'bonuses' ? { Enabled: r.enabled == null ? null : r.enabled ? 'Yes' : 'No', Amount: money(r.amount, r.currency), Percentage: r.percentage == null ? null : `${r.percentage}%` } : { 'Account number': r.last4 ? `•••• ${r.last4}` : null, Currency: r.currency, Status: r.status }}/></article>)}</div>}{!list.busy && !list.error && !list.items.length && <Empty title="No records found" icon={section}>Records will appear here when available.</Empty>}{section !== 'bonuses' && <Pager list={list}/>}</>}</section></>;
}
function Modal({ title, close, children, className = '' }) {
  const dialog = useRef(null);
  useEffect(() => { const node = dialog.current; node.showModal(); return () => node.close(); }, []);
  return <dialog ref={dialog} className={className} onCancel={close} onClick={e => { if (e.target === dialog.current) close(); }} aria-labelledby="dialog-title"><div className="modal-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog">✕</button></div>{children}</dialog>;
}
function Connection({ close }) { return <Modal title="Connect your workspace" close={close}><p className="modal-copy">This admin panel is prepared for <strong>toppay-2bd66</strong>. No live user data has been loaded.</p><ol className="setup-list"><li>Add the original project's web Firebase configuration to <code>.env.local</code> using <code>.env.example</code>.</li><li>Deploy and confirm the <code>toppayAdminApi</code> backend. Audit the shared project's Firestore rules before going live.</li><li>Restart the panel and sign in with an email-verified account whose user document has <code>admin: true</code>.</li></ol><div className="notice">Connection and backend deployment have not been verified.</div><button className="primary full" onClick={close}>Got it</button></Modal>; }
function Login({ close }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <Modal title="Welcome to Toppay" close={close}><p className="modal-copy">Sign in with your verified administrator account.</p><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await signInWithEmailAndPassword(auth, email, password); close(); } catch (err) { setError(friendlyError(err)); } finally { setBusy(false); } }}><label className="form-label">Email address<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/></label><label className="form-label">Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></label>{error && <div className="error" role="alert">{error}</div>}<button className="primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely →'}</button></form></Modal>;
}
const transactionFieldOrder = [
  'amount', 'balanceApplied', 'balanceImpact', 'bonus', 'createdAt', 'createdAtText', 'currency',
  'direction', 'fee', 'id', 'method', 'paymentCardBillingZip', 'paymentCardExpiryMonth',
  'paymentCardExpiryYear', 'paymentCardNumber', 'paymentCardholderName', 'paymentSourceLabel',
  'paymentSourceMasked', 'paymentSourceType', 'requestId', 'status', 'title', 'totalDebit',
  'type', 'uid', 'updatedAt'
];
const balanceCreditTypes = new Set(['addbalance', 'addbalancerequest', 'balanceadd', 'deposit', 'topup', 'recharge', 'cashin', 'addfunds', 'walletcredit']);
const balanceDebitTypes = new Set(['sendmoney', 'cashout', 'withdrawal', 'withdraw', 'payout', 'transferout', 'debit', 'payment']);
const getBalanceDelta = transaction => {
  const normalizedType = String(transaction?.type || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (balanceCreditTypes.has(normalizedType)) return Number(transaction?.amount ?? 0) || 0;
  if (balanceDebitTypes.has(normalizedType)) return -(Number(transaction?.amount ?? 0) || 0);
  return 0;
};
function TransactionModal({ target, close, onReviewed }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [confirmAction, setConfirmAction] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    adminApi('transaction', { uid: target.uid, transactionId: target.transactionId })
      .then(result => { if (alive) setData(result); })
      .catch(loadError => { if (alive) setError(friendlyError(loadError)); });
    return () => { alive = false; };
  }, [target.uid, target.transactionId]);
  const review = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await adminApi('reviewTransaction', {
        uid: target.uid,
        transactionId: target.transactionId,
        decision: confirmAction,
      });
      setData(current => ({
        ...current,
        status: result.status,
        ...(confirmAction === 'approved' ? { balanceApplied: result.balanceImpact !== 0, balanceImpact: result.balanceImpact } : {}),
      }));
      setConfirmAction('');
      onReviewed?.();
    } catch (reviewError) {
      setError(reviewError?.code?.includes('failed-precondition') || reviewError?.code?.includes('invalid-argument')
        ? reviewError.message
        : friendlyError(reviewError));
    } finally {
      setBusy(false);
    }
  };
  const orderedData = data ? Object.fromEntries([
    ...transactionFieldOrder.filter(key => key in data).map(key => [key, data[key]]),
    ...Object.entries(data).filter(([key]) => !transactionFieldOrder.includes(key))
  ]) : {};
  const pending = ['pending', 'under review', 'under_review'].includes(String(data?.status || '').toLowerCase());
  const walletDelta = getBalanceDelta(data);
  const walletLabel = walletDelta > 0 ? `Approve and add ${money(Math.abs(walletDelta), data.currency)} to this user's wallet?`
    : walletDelta < 0 ? `Approve and deduct ${money(Math.abs(walletDelta), data.currency)} from this user's wallet?`
    : 'Approve this transaction and mark it as reviewed?';
  return <Modal title="Transaction details" close={close}>
    {error && <div className="error" role="alert">{error}</div>}
    {!data ? <p>Loading transaction…</p> : <>
      <div className="transaction-amount">{money(data.amount, data.currency)} <Badge>{data.status}</Badge></div>
      <Fields data={orderedData}/>
      {pending && <section className="transaction-review">
        <h3>Review request</h3>
        <p className="muted">Automatic approval is available for all transactions. Wallet balance updates only apply when the transaction type requires them.</p>
        <div className="review-actions">
          <button className="primary" disabled={busy} onClick={() => setConfirmAction('approved')}>Approve</button>
          <button className="button danger" disabled={busy} onClick={() => setConfirmAction('rejected')}>Reject</button>
        </div>
        {confirmAction && <div className="review-confirmation">
          <p>{confirmAction === 'approved' ? walletLabel : 'Reject this request? The user balance will not change.'}</p>
          <div className="review-actions">
            <button className="button" disabled={busy} onClick={() => setConfirmAction('')}>Cancel</button>
            <button className={confirmAction === 'approved' ? 'primary' : 'button danger'} disabled={busy} onClick={review}>{busy ? 'Saving…' : `Confirm ${confirmAction === 'approved' ? 'approval' : 'rejection'}`}</button>
          </div>
        </div>}
      </section>}
    </>}
  </Modal>;
}
export default function App() {
  const [section, setSection] = useState('users'); const [uid, setUid] = useState(null); const [session, setSession] = useState(null); const [checking, setChecking] = useState(false); const [accessError, setAccessError] = useState(''); const [modal, setModal] = useState(null); const [transaction, setTransaction] = useState(null);
  useEffect(() => {
    if (!auth) return;
    let revision = 0;
    const unsubscribe = onAuthStateChanged(auth, async user => {
      const current = ++revision; setSession(null); setUid(null); setTransaction(null); setAccessError('');
      if (!user) { setChecking(false); return; }
      setChecking(true);
      try { await adminApi('session'); if (current === revision) setSession({ uid: user.uid, email: user.email }); } catch (e) { if (current === revision) setAccessError(friendlyError(e)); } finally { if (current === revision) setChecking(false); }
    });
    return () => { revision++; unsubscribe(); };
  }, []);
  const connect = () => setModal(configured ? 'login' : 'setup');
  const showDetails = useCallback((userUid, transactionId, onReviewed) => {
    if (!userUid) return;
    setUid(userUid);
    setSection('users');
    setTransaction({ uid: userUid, transactionId, onReviewed });
  }, []);
  const navigate = key => { setSection(key); setUid(null); setTransaction(null); };
  return <div className="app-shell"><aside className="sidebar"><a className="brand" href="#users" onClick={() => navigate('users')}><span className="brand-symbol">t<span>↗</span></span>toppay<span className="brand-dot">.</span></a><div className="workspace"><span className="workspace-icon">T</span><div><strong>Toppay workspace</strong><small>Administration</small></div><span className="workspace-chevron">⌄</span></div><div className="nav-label">WORKSPACE</div><nav>{Object.entries(sections).map(([key, [title]]) => <button className={key === section ? 'nav-item active' : 'nav-item'} key={key} onClick={() => navigate(key)}><Icon name={key}/><span>{title}</span>{key === section && <span className="nav-dot"/>}</button>)}</nav><div className="sidebar-bottom"><div className="secure-card"><span className="secure-icon"><Icon name="shield"/></span><strong>A secure workspace</strong><p>Protected access.<br/>People and payments, in safe hands.</p></div><div className="admin-identity"><span className="avatar small">{session ? 'AD' : 'TP'}</span><div><strong>{session ? 'Administrator' : 'Admin workspace'}</strong><small>{session?.email || 'Toppay management'}</small></div>{session && <button className="icon-button" aria-label="Sign out" onClick={() => signOut(auth)}><Icon name="logout" size={17}/></button>}</div></div></aside><div className="main-shell"><header className="topbar"><div className="breadcrumb">Workspace <Icon name="arrow" size={13}/><strong>{sections[section][0]}</strong>{uid && <><Icon name="arrow" size={13}/><span>User details</span></>}</div><div className="topbar-right"><span className={`connection ${session ? 'online' : ''}`}><i/>{checking ? 'Verifying access' : session ? 'Connected' : 'Not connected'}</span><span className="topbar-divider"/><button className="top-avatar" aria-label={session ? 'Administrator account' : 'Sign in'} onClick={session ? undefined : connect}>{session ? 'AD' : 'TP'}</button></div></header><main>{!session && <div className="connection-banner"><span className="banner-icon"><Icon name="shield" size={19}/></span><div><strong>{checking ? 'Verifying your administrator access' : 'Your secure admin workspace is ready'}</strong><span>{configured ? 'Sign in to access your Toppay users and payment activity.' : 'Connect Firebase to start managing your Toppay community.'}</span></div><button onClick={connect} disabled={checking}>{configured ? 'Sign in' : 'Connect project'} <span>↗</span></button></div>}{accessError && <div className="error" role="alert">{accessError} <button onClick={() => signOut(auth)}>Sign out</button></div>}{uid && session ? <UserDetail key={uid} uid={uid} back={() => setUid(null)} showDetails={showDetails}/> : section === 'users' ? <Users key={session?.uid || 'offline'} enabled={!!session} openUser={setUid} connect={connect}/> : <OtherSection key={`${section}-${session?.uid || 'offline'}`} section={section} enabled={!!session} connect={connect} openUser={setUid} showDetails={showDetails}/>}<footer><span>© {new Date().getFullYear()} Toppay. All rights reserved.</span><span><i/> Toppay admin console</span></footer></main></div>{modal === 'setup' && <Connection close={() => setModal(null)}/ >}{modal === 'login' && <Login close={() => setModal(null)}/ >}{transaction && session && <TransactionModal target={transaction} onReviewed={transaction.onReviewed} close={() => setTransaction(null)}/ >}</div>;
}
