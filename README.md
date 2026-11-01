# 💊 Pharmacy Standalone

![Status](https://img.shields.io/badge/status-production--ready-brightgreen) ![Commits](https://img.shields.io/badge/commits-41-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![Responsive](https://img.shields.io/badge/responsive-mobile%20%26%20desktop-blueviolet)

A complete pharmacy management system for a single Kenyan retail pharmacy: drug catalogue, batch and expiry stock, point of sale, sales history, controlled drugs register, suppliers, reports, staff roles and audit log.

Built with React (Vite) for the screens and a Cloudflare Worker with a D1 database for the server. One deployment serves both.

## ✨ Recent Updates (Nov 1, 2026)

- ✅ Professional auth UI with Google Fonts
- ✅ Complete mobile responsive design
- ✅ Password reset via email
- ✅ Color-coded notifications & alerts
- ✅ Enhanced drug catalog with stock details
- ✅ CSV & Excel export
- ✅ Audit log viewer
- ✅ Health monitoring
- ✅ Security enhancements (rate limiting, XSS protection)

## What the pharmacy can do

| Area | What it does |
| --- | --- |
| Sales History / New Sale | Counter screen with search or barcode scan, loose tablets and whole packs, split payments (cash, M-Pesa, card, insurance), credit sales, discounts with reasons, receipts to print or share on WhatsApp, void and refund. |
| Stock Management | Stock by batch with expiry, FEFO selling (oldest expiry first), receiving deliveries, supplier balances, adjustments, stock take, reorder list by supplier. |
| Drug Catalog | Brand and generic names, class (OTC, pharmacy only, prescription, controlled), pack sizes, prices and history, CSV import and export. |
| Dashboard | Today's sales against yesterday, top sellers, expiry alerts (30, 60, 90 days, expired), low and out of stock. |
| Reports | Daily cash-up, profit, stock value, fast and dead stock, controlled drugs register, supplier balances, customer debts. All print or export. |
| Settings | Registered pharmacy details, staff accounts, password change, audit log, backup download. |

Roles: **Owner** (everything), **Pharmacist** (sell, approve prescriptions, stock, catalogue, reports), **Cashier** (sell, own sales, discount limit), **Stock clerk** (receive stock, record damage and expiry).

Rules built in: expired batches cannot be sold, stock can never go negative, prescription drugs need prescriber details and a pharmacist, controlled drugs need patient phone, prescriber facility, a witness for any adjustment, and write to a register that keeps a running balance.

## 1. Run it on your computer

You need Node.js 20 or newer.

```
npm run install:all
```

Create a file named `.dev.vars` (copy `.dev.vars.example`) so it holds your own secret, then:

```
npm run db:migrate:local
npm run build:web
npm run dev:api
```

Open http://localhost:8787. The first screen is the setup page.

For live editing of the screens, also run `npm run dev:web` in a second window and open http://localhost:5173.

## 2. Put it online (Cloudflare)

Do these one at a time.

1. Sign in: `npx wrangler login`
2. Create the database: `npx wrangler d1 create pharmacy-db`
3. Copy the `database_id` it prints into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
4. Create the tables online: `npm run db:migrate:remote`
5. Make a secret. Run `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`, then `npx wrangler secret put JWT_SECRET` and paste it. Do not put this secret in any file.
6. Build and publish: `npm run deploy`

Wrangler prints the live address. Open it.

Use the Workers Paid plan (about USD 5 a month) for a pharmacy that is really trading. The free D1 plan has a daily read limit that a busy counter can hit.

## 3. First sign-in (this sets the client's name)

The first time the address is opened, the app shows **Set up your pharmacy**. Enter the client's registered name, address, KRA PIN, PPB licence number, superintendent pharmacist and the owner's login. The name then shows on the sidebar, receipts and reports. No code change is needed for a new client. Setup can only be run once.

## 4. Handover checklist for the client

- Owner changes the password (Settings, My account).
- Add staff under Settings, Users, each with the right role. Cashiers sign in with email or phone.
- Import the drug list (Drug Catalog, Import CSV, a template can be downloaded there) or add drugs one by one.
- Add suppliers, then record opening stock under Stock Management, Receive stock.
- Make a test sale and print a receipt on the pharmacy's printer.
- Download a backup (Settings, Backup) and keep it somewhere safe. Do this regularly.

## 5. Things to know

- Receipts print from the browser. Choose the thermal printer and 80 mm paper in the print window.
- A barcode scanner works as a keyboard: click the search box and scan.
- The rules for prescription and controlled drugs follow common Kenyan practice. The pharmacy's superintendent pharmacist should confirm them against current Pharmacy and Poisons Board requirements.
- Not included yet: automatic M-Pesa payment confirmation (STK push), SMS and WhatsApp automation, working without internet, KRA eTIMS invoices, several branches. M-Pesa payments are recorded with the transaction code typed in by the cashier.
- VAT: prices include VAT. Drugs marked VAT-able show the VAT part on reports.

## 6. Test the server

On a fresh local database with the server running: `npm run test:api`. It runs 80+ checks across sign-in, roles, stock, selling, voiding, stock take and reports.

## Folder guide

- `worker/src` the server (routes for core, stock, sales and reports)
- `worker/migrations` the database tables
- `web/src` the screens
- `scripts/smoke-test.mjs` the server test
