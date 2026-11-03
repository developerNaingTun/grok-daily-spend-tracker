# Together Spend

A two-person household ledger for separate mobile accounts with shared MMK reporting.

## Included

- Expo / React Native / TypeScript Android and iOS app.
- Email/password accounts through Supabase Auth; native session tokens stored in Expo SecureStore.
- Create a household and invite exactly one partner with a private invitation code.
- Record income and expenses, including tax and utilities, with dates and notes.
- Both members see all household entries. Each can edit/delete only their own entries.
- Monthly income, expenses, balance, category bars, and totals per partner.
- Pull to refresh, refresh on foreground, and 30-second polling while open.
- ASP.NET Core 10 API; Supabase Postgres migration with row-level security.

This first version requires connectivity. It does not calculate tax liability, schedule recurring bills, connect banks, convert currencies, or sync offline changes. Tax and utility payments are manually entered expenses. Balance means monthly income minus expenses, not a bank balance.

## 1. Supabase

Create a Supabase project. Run `supabase/migrations/001_household_ledger.sql` once in its SQL editor (or use Supabase CLI migrations on a linked project). The migration expects Supabase's `auth.users`, `auth.uid()`, and standard roles.

Copy the project URL and **publishable key** from Supabase settings. A legacy anon key also works. Do not use the service-role/secret key: requests must retain the signed-in user's permissions.

Enable email/password authentication. Keep email confirmation enabled and configure your email provider for real users. Each partner registers independently, confirms their email, then signs in. No credentials belong in Git. The examples contain placeholders only.

## 2. API

Install .NET SDK 10.0 (tested with 10.0.403). From the repository root:

```bash
cp api/.env.example api/.env
# Edit api/.env locally; it is ignored by Git.
set -a
. api/.env
set +a
dotnet restore api/SpendTracker.Api.csproj
dotnet run --project api/SpendTracker.Api.csproj
```

`Supabase__Url` and `Supabase__PublishableKey` are required; the server fails startup if absent. `/health` checks the API process only, not Supabase connectivity. Configure `AllowedOrigins` as a comma-separated list if adding a browser client; native apps do not require CORS. Host the API behind HTTPS for real devices outside trusted local development. Do not expose the HTTP development endpoint to the Internet.

The API validates bearer sessions against Supabase Auth, then calls PostgREST with that same user token. Database policies enforce access even if requests bypass the API. No database password or service-role key is required.

## 3. Mobile app

Use Node 22+ and npm. From the repository root:

```bash
cp mobile/.env.example mobile/.env
# Set the Supabase URL, publishable key, and API URL reachable from your phone.
npm ci --prefix mobile
cd mobile
npx expo start
```

Open with Expo Go compatible with SDK 54 on Android/iOS, or use an emulator/development build. A physical phone needs your computer's LAN IP for the API, not localhost. Android emulator typically uses `10.0.2.2`. An iOS simulator can use localhost. Supabase must be reachable from both the API and phones. The EXPO_PUBLIC values are bundled into the app: only public project settings belong there.

One partner creates a household and shares the code privately. The other signs in using their own account and joins with that code. The code stops allowing joins when the household has two members. Joining a second household and transferring household ownership are outside this version.

## Validation

```bash
dotnet build api/SpendTracker.Api.csproj
npm run typecheck --prefix mobile
npm test --prefix mobile
cd mobile && npx expo export --platform android --output-dir /tmp/together-spend-android
```

`tests/database.sql` exercises the migration with three fixture users in a disposable PostgreSQL database. `tests/run-database.sh` uses a temporary Docker container; it must never target a live Supabase database. It checks cross-household isolation, ownership restrictions, and two-member capacity.

Before deployment, test on both phones with a real Supabase project: register/confirm both users, create/join the household, add income/tax/utilities from each, verify matching monthly totals after refresh, edit/delete each user's entries, and confirm a third user cannot join or access the household. Live authentication and device behavior require this verification; successful builds alone do not establish them.

## API routes

All `/api/*` routes require a Supabase access token as `Authorization: Bearer <token>`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | Process liveness |
| GET | `/api/household` | Current household or null |
| POST | `/api/household` | Create with `{ "name": "Our home" }` |
| POST | `/api/household/join` | Join with `{ "code": "..." }` |
| GET | `/api/entries?month=2026-11` | Household entries in the selected month |
| POST | `/api/entries` | Add entry |
| PUT | `/api/entries/{id}` | Update own entry |
| DELETE | `/api/entries/{id}` | Delete own entry |

Entry payload: `{ "amount": 25000, "kind": "expense", "category": "Utilities", "date": "2026-11-03", "note": "Electricity" }`. Amounts must be positive, at most two decimal places, and no greater than 999,999,999,999 MMK. Store dates as local calendar dates. Select a different month to view older/future entries.
