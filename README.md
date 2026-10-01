# Toppay admin workspace

Separate English React admin panel for Firebase project `toppay-2bd66`.

## Current status

The original repository was a Create React App starter: no Firebase configuration, functions, rules, or environment files were present. No authenticated Firebase CLI/project access was available. **Live documents, deployed rules, and callable deployment have not been verified.** The UI deliberately displays a disconnected state instead of fabricated users.

The app uses the new `toppayAdminApi` callable, supplied in `functions/`. It does not call or assume deployment of the original `getAdminUserDetails` function.

## Local setup

1. Obtain the original project's Firebase **web app** configuration. Copy `.env.example` to `.env.local` and fill in the values. The project ID must be `toppay-2bd66`; other project IDs fail closed. Never put service-account credentials in React environment variables.
2. `npm ci`
3. `npm start`

Email/password authentication must be enabled in the existing project and the admin origin must be authorized. A verified admin here means an enabled, email-verified Firebase Auth account with the exact boolean `users/{auth.uid}.admin === true`. Grant this flag only using trusted server-side tooling. Every callable request checks the live user document and Auth account, including token revocation time.

## Verify the real schema before production

Using authorized Application Default Credentials and installed backend dependencies:

```sh
npm ci --prefix functions
node functions/inspect-schema.js
# Optionally inspect a known user:
node functions/inspect-schema.js USER_UID
```

This read-only tool emits field names and types, never stored values or document IDs. It samples all the supplied paths. Compare the result to `functions/sanitize.js`, then update the explicit response schemas and tests for any real field-name differences. Do not add arbitrary document spreads or raw-object fallback rendering. Check multiple users, cards, banks, and transaction types: a small sample cannot establish every optional field.

Current optional response field assumptions:

| Path | Fields used |
| --- | --- |
| `users/{uid}` | displayName, name, email, phoneNumber, status, admin, createdAt |
| `users/{uid}/wallet/summary` | balance, currency, rewardPoints, monthlyLimit, monthlyUsage, status |
| `users/{uid}/personalInformation/profile` | firstName, lastName, dateOfBirth, address, country, verificationStatus |
| `users/{uid}/transactions/{id}` | type, status, currency, amount, fee, createdAt, updatedAt |
| `transactionRequests/{id}` | uid, type, status, currency, amount, fee, createdAt, updatedAt |
| `users/{uid}/paymentMethods/{id}` | kind, brand, bankName, status; last4 derived on the server from last4/cardNumber/accountNumber |
| `account/{id}` | name, bankName, type, currency, status; masked accountNumber |
| `bonus/sendmoney`, `bonus/cashout` | enabled, amount, percentage, currency |

Missing fields are null, displayed as “Not provided” or a dash. Numeric zero is preserved. Timestamps currently expect Firestore Timestamp values. Transaction queries use `createdAt DESC` and document ID `DESC`, with document-snapshot cursors and 20 records per page. **Firestore ordering excludes documents without `createdAt`**: audit/backfill missing timestamps from trustworthy source records before claiming complete history. Never fabricate historical dates. User, request, and account lists use document ID ordering; requests do not assume a timestamp is present. Cards and banks paginate independently.

## Security rules and rollout

The React app imports Firebase Auth and Functions only. It never directly reads Firestore. All collections are accessed through an admin-checked backend; payment numbers are reduced to the last four digits before transport. Response schemas exclude CVV, PINs, PIN hashes, nested credentials, and unknown fields. Stored documents and sensitive request bodies are not logged.

`firestore.rules.candidate` is a strict backend-only deny-all baseline. It enforces no direct client access, including admin clients, while the Admin SDK uses its own IAM access. It is intentionally **not wired into firebase.json**: deploying it over the unknown existing rules would break direct Firestore access in the mobile app. There is no separate ruleset per web app within a shared Firestore database.

Before launch, retrieve the current deployed rules and mobile flows, then produce and test a compatible migration. At minimum:

- No client can create or modify an admin flag, wallet balances, or review results.
- No client, including an admin browser, can directly read documents containing full PANs or PIN-related data. Rules cannot redact fields. Existing mobile reads of such documents need a backend/masked-document migration.
- Raw `users` and transaction documents require the same audit because they may contain sensitive fields. Check broad wildcard grants: a narrower deny does not override another matching allow.
- Other users' private records and admin configuration writes must be inaccessible to ordinary accounts.

The candidate baseline is reviewable, but **the live project is not asserted secure until the migration is verified and deployed**. Firebase guidance: [field-level access](https://firebase.google.com/docs/firestore/security/rules-fields), [callable functions](https://firebase.google.com/docs/functions/callable).

## Backend and separate hosting deployment

Use Node 22 and an authenticated Firebase CLI with access to the existing project. Review project billing, region, existing functions, and rules first.

```sh
npm ci --prefix functions
firebase functions:list --project toppay-2bd66
firebase deploy --only functions:toppay-admin --project toppay-2bd66
firebase functions:list --project toppay-2bd66
```

The codebase is named `toppay-admin` to avoid treating the mobile functions as part of this codebase. Confirm `toppayAdminApi` exists in `us-central1`, then sign in with an authorized account and verify `session`, user details, and transaction pagination. Confirm direct calls from ordinary users fail. If changing the backend region, update both `functions/index.js` and the React environment variable.

Hosting requires an explicit separate site target, so it cannot silently replace the existing mobile app's default site:

```sh
firebase hosting:sites:create YOUR_UNIQUE_ADMIN_SITE --project toppay-2bd66
firebase target:apply hosting admin YOUR_UNIQUE_ADMIN_SITE --project toppay-2bd66
npm run build
firebase deploy --only hosting:admin --project toppay-2bd66
```

Do not deploy the panel as production-ready until the shared rules audit is complete. No deployment was performed during implementation.

## Scope and checks

Users are the home page. Users have separate Profile, Balance, All transactions, Saved cards, and Saved banks sections. Search and role/status filters apply to the current page; exact UID lookup works across the directory. Transactions include a details dialog and older-page navigation. Requests link by both UID and transaction ID to the matching user transaction.

Request approval/rejection, financial mutations, and settings edits are deliberately not implemented: the mobile app's ledger, review statuses, bonus formulas, and idempotency contract have not been supplied or inspected. These pages are explicitly view-only.

```sh
npm run build
npm test -- --watchAll=false --runInBand
node --test functions/security.test.js
```

Backend unit tests cover authorization and response redaction; frontend tests cover denied access and transaction navigation. These are not live Firebase integration or emulator rules tests. The existing CRA dependency tree has npm audit findings; review them before deployment rather than applying an unreviewed breaking `audit fix --force`.
