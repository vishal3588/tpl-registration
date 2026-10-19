# TPL (Tablers Premier League) Player Registration

A registration portal for tournament players. Players sign in with Google, fill in their details and photo, and see the payment QR. Team owners see their players. Admins see everything, manage teams, and mark payments.

## Features

- **Player form:** email, name, mobile number (10-digit mobile validation), table number (numeric), jersey size (S–XXXL), jersey number (0–99), CricHeroes profile link, self-rating (1–5 stars), player photo, a payment reference (UTR or UPI transaction ID), and a screenshot of the successful payment (JPG/PNG/WEBP, 5 MB max, checked by file signature). Each payment reference can be used only once. Admins see it in the registrations table, so they can check each payment against the bank statement before marking it paid. The payment screenshot is required; a registration is incomplete without it.
- **Admin page:** shows the total, paid and pending registration counts, and a **Download registration details (CSV)** button that exports every registration.
- **Playing profile:** handedness (left- or right-handed, radio) and strengths (one or more of Batsman, Bowler-Fast Pace, Bowler-Medium Pace, Bowler-Spinner, All Rounder, All Rounder-Batsman, All Rounder-Bowler). Both are required.
- **Team assignment:** players don't pick a team. An admin assigns each registration to a team from the admin **All registrations** table. Team owners only see players assigned to their team, and jersey numbers must be unique within a team.
- **Payment:** the bank QR code is displayed on the form page. Admins mark each registration as paid.
- **Storage:** records go to Google Sheets and photos/logos go to Google Drive (`STORAGE=google`). A local JSON file and `uploads/` folder are used for development (`STORAGE=local`, the default).
- **Branding:** placeholders for the tournament logo, sponsor logos, payment QR, and per-team logos and brand colour. Edit `public/assets/branding/branding.json` and replace the SVG placeholders.
- **Players register without signing in.** One registration per email and per mobile number. Changes after submission must be made by an admin.
- **Player login:** after team allotment, players sign in with Google using the same email they registered with. They see their registration, their team, and their teammates (name, jersey, size, handedness, strength and photo). Contact details of teammates are never shown.
- **Registration amount:** Rs 2000, set as `registrationAmount` in `branding.json` and shown in the payment section.
- **Staff sign-in:** team owners and admins sign in with Google from the dashboard. Optionally restricted to your domain with `ALLOWED_EMAIL_DOMAINS`.
- **Roles:**

| Role   | How assigned                              | Can do |
|--------|-------------------------------------------|--------|
| Admin  | Listed in `ADMIN_EMAILS`, or added by an admin in the dashboard's **Admins** section | Sign in and manage teams and owners, sponsors, admins, see all registrations, mark payments |
| Owner  | Email set as a team's owner by an admin   | Sign in and see the players in their team(s) |
| Player | Anyone registers without sign-in; signs in with the registered email after allotment | See their own registration, team and teammates |

## Run locally

```bash
cd cricket-registration
npm install
cp .env.example .env        # then set ADMIN_EMAILS and DEV_LOGIN=true for local testing
npm start                   # http://localhost:3000
```

With `DEV_LOGIN=true`, `POST /auth/dev-login` with `{"email": "..."}` signs you in without Google. Never enable this in production.

Run the tests:

```bash
npm test
```

## Production setup (Google Sheets, Drive, and sign-in)

1. **Google Cloud project.** Enable the *Google Sheets API* and the *Google Drive API*.
2. **OAuth client (sign-in).** APIs & Services → Credentials → Create OAuth client ID → *Web application*. Add `https://<your-domain>/auth/callback` as an authorised redirect URI. Put the client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Configure the consent screen as *Internal* if you only want organisation accounts.
3. **Service account (storage).** Create a service account and download its JSON key to `secrets/service-account.json`. Set `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` to that path.
4. **Spreadsheet.** Create a Google Sheet with four tabs named exactly `Teams`, `Registrations`, `Sponsors` and `Admins`. Share it with the service account's email as *Editor*. Copy its ID from the URL into `GOOGLE_SPREADSHEET_ID`. The app writes the header rows on first start if the tabs are empty.
5. **Drive (your own Google account).** A service account has no Drive storage, so files go to your personal Google Drive:
   - Add `http://localhost:8080/oauth2callback` to the OAuth client's **Authorised redirect URIs**.
   - Make sure the OAuth consent screen is **published** (not Testing). Testing-mode tokens expire after 7 days.
   - Run `npm run setup:drive`, open the link it prints, and sign in with your personal Google account.
   - Copy the printed `GOOGLE_DRIVE_REFRESH_TOKEN` and `GOOGLE_DRIVE_FOLDER_ID` into `.env`, and into Render's environment variables.
6. Set `STORAGE=google`, `NODE_ENV=production`, a long random `SESSION_SECRET`, `BASE_URL=https://<your-domain>`, and `ADMIN_EMAILS`. Then run `npm start` behind HTTPS.

### Sheet columns

- **Teams:** id, name, owner_email, logo_url, primary_color, created_at, owner_name
- **Sponsors:** id, name, logo_url, created_at
- **Admins:** id, email, created_at
- **Registrations:** id, created_at, updated_at, email, name, contact, table_number, team_id, team_name, jersey_size, jersey_number, cricheroes_url, rating, photo_url, payment_status, payment_proof_url, handedness, strength, payment_reference

Do not reorder columns. Add new fields at the end only, and update `SCHEMA` in `src/storage/google.js`.

## Admin management

- `ADMIN_EMAILS` is the permanent base set of admins. These accounts stay admins and can't be removed in the app, so keep at least one here.
- Admins added in the dashboard's **Admins** section can be removed there. An admin can't remove their own access.

## Branding and admin management

- **Host logos** (header of every page): `hostLogos` in `public/assets/branding/branding.json`.
- **Sponsor logos** (footer of every page): add and remove them in the admin **Sponsors** section. They are stored in the `Sponsors` sheet tab, or in `uploads/sponsors/` locally.
- **Teams and owners** (admin **Teams** section): set the team name, owner name, owner email, brand colour and logo. Changing the owner email moves that team's dashboard access to the new owner.
- **Payment QR:** replace `public/assets/branding/payment-qr.svg` with your bank QR code, or change `paymentQr` in `branding.json`.
- **Payment instructions:** `paymentInstructions` in `branding.json`.

## Decisions to confirm

- **Mobile format:** Indian numbers (10 digits, starting 6–9, optional +91 or 0). Change `MOBILE_RE` in `src/validation.js` for other countries.
- **Table number:** treated as a numeric seating or table reference (1–9999). Confirm this is what you meant.
- **Jersey number:** 0–99, unique within a team. Change the limits in `src/validation.js` if needed.
- **CricHeroes domains:** `cricheroes.in` and `cricheroes.com`. Override with `CRICHEROES_HOSTS`.
- **Photo visibility (Google mode):** player photos and payment screenshots stay private in Drive. Team and sponsor logos are made viewable by anyone with the link so they show on the public pages.
- **Payment:** the app shows the QR and records paid/pending status. Admins confirm payment manually; there is no bank reconciliation.
- **Not included:** confirmation emails, payment-gateway integration, and CSV export. The Sheet itself serves as the export.

## Notes

- Google mode reads and writes the whole sheet per request. This is fine for a tournament-sized list, but it is not built for high concurrency.
- Registration itself does not verify the email, so anyone can register with any email address. Duplicate emails and mobile numbers are rejected rather than overwritten. Player login uses Google, so only the owner of a Google account can see that player's team.
- There is no admin screen yet for editing or deleting a registration. Only payment status can be changed.
- Sessions use the in-memory store. Restarting the server signs everyone out. For multiple instances, add a shared session store.
- Google Sheets writes use `RAW` mode, so cell values are stored as text and cannot run as formulas.
