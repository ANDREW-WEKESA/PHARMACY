# 🚀 Deployment Guide - Pharmacy Management System

Complete guide to deploy your pharmacy system to Cloudflare Workers production.

## Prerequisites

1. **Cloudflare Account**: Sign up at https://dash.cloudflare.com/sign-up
2. **Wrangler CLI**: Already installed in your project
3. **Git**: Your code is already on GitHub

## Step 1: Authenticate Wrangler

Login to your Cloudflare account:

```bash
npx wrangler login
```

This will open your browser for authentication.

## Step 2: Create Production D1 Database

Create a new D1 database for production:

```bash
npx wrangler d1 create pharmacy-db
```

**Important**: Copy the `database_id` from the output. It will look like:
```
✅ Successfully created DB 'pharmacy-db' with ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Update `wrangler.toml` and replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with your actual database ID.

## Step 3: Run Database Migrations

Apply your database schema to production:

```bash
npm run db:migrate:remote
```

This creates all tables in your production database.

## Step 4: Set Production Secrets

### JWT Secret (Required)

Generate a secure random string and set it:

```bash
# PowerShell - Generate 32-byte random string
$bytes = New-Object Byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = [Convert]::ToBase64String($bytes)
Write-Output $secret

# Then set it as secret
npx wrangler secret put JWT_SECRET
# Paste the generated secret when prompted
```

### Email Configuration (Optional - for password reset)

If you want password reset emails to work:

```bash
# For MailChannels (Free on Cloudflare)
npx wrangler secret put SEND_EMAIL
# Enter: true

npx wrangler secret put EMAIL_FROM
# Enter: noreply@yourdomain.com
```

**Note**: MailChannels works automatically on Cloudflare Workers. No API key needed!

For other providers (SendGrid, Mailgun, etc.), see `EMAIL_SETUP.md`.

## Step 5: Build and Deploy

Deploy your application:

```bash
npm run deploy
```

This will:
1. Build the React frontend (`web/dist`)
2. Deploy the Worker with assets
3. Give you a production URL like: `https://pharmacy-standalone.YOUR-SUBDOMAIN.workers.dev`

## Step 6: Create Your Admin Account

Visit your production URL and click "Create Account" or use the API:

```bash
# Replace with your actual production URL
curl -X POST https://pharmacy-standalone.YOUR-SUBDOMAIN.workers.dev/api/setup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pharmacy Admin",
    "email": "admin@yourdomain.com",
    "password": "your-secure-password"
  }'
```

Save the token returned - this is your admin login.

## Step 7: Seed Demo Data (Optional)

If you want demo data in production:

```bash
# First, update scripts/seed-demo-data.js with your production URL
node scripts/seed-demo-data.js
```

**Warning**: Only do this for testing. Delete demo data before real use.

## Custom Domain (Optional)

### Option 1: Workers.dev Subdomain (Free)
Your app is already live at: `pharmacy-standalone.YOUR-SUBDOMAIN.workers.dev`

### Option 2: Custom Domain
1. Add your domain to Cloudflare
2. Go to Workers & Pages → pharmacy-standalone → Settings → Domains
3. Click "Add Custom Domain"
4. Enter your domain (e.g., `pharmacy.yourdomain.com`)
5. Cloudflare automatically creates DNS records

## Production Checklist

Before going live with real data:

- [ ] D1 database created and migrated
- [ ] JWT_SECRET set (strong random string)
- [ ] Email configured (if using password reset)
- [ ] Admin account created
- [ ] Demo data removed (if seeded)
- [ ] Custom domain configured (optional)
- [ ] Test login, catalog, sales, stock management
- [ ] Test on mobile devices
- [ ] Backup strategy planned

## Environment Variables Summary

### Required
- `JWT_SECRET` - Set via `wrangler secret put JWT_SECRET`

### Optional (Email)
- `SEND_EMAIL` - Set to "true" to enable emails
- `EMAIL_FROM` - Your sender email address
- `EMAIL_PROVIDER` - "mailchannels" (default), "sendgrid", "mailgun", etc.
- Provider-specific API keys (see EMAIL_SETUP.md)

### In wrangler.toml
- `database_id` - Your D1 database ID

## Monitoring & Management

### View Logs
```bash
npx wrangler tail
```

### View D1 Database
```bash
# Query your production database
npx wrangler d1 execute pharmacy-db --remote --command "SELECT * FROM users"
```

### Update Deployment
```bash
npm run deploy
```

## Costs

Your pharmacy system on Cloudflare:

| Service | Free Tier | Pricing |
|---------|-----------|---------|
| Workers | 100,000 requests/day | $5/10M requests |
| D1 Database | 5GB storage, 5M reads/day | $0.75/GB, $0.001/1K reads |
| Email (MailChannels) | 100,000 emails/month | Free on Workers |
| Custom Domain | Unlimited | Free |

**Typical small pharmacy**: ~$0-5/month (within free tier)

## Rollback

If you need to rollback:

```bash
# View previous deployments
npx wrangler deployments list

# Rollback to specific version
npx wrangler rollback --version <version-id>
```

## Troubleshooting

### "Database not found"
- Ensure database_id in wrangler.toml matches your D1 database
- Run migrations: `npm run db:migrate:remote`

### "JWT verification failed"
- JWT_SECRET must match between deployments
- Re-set secret: `npx wrangler secret put JWT_SECRET`

### "Email not sending"
- Check SEND_EMAIL is set to "true"
- Verify EMAIL_FROM is a valid email
- Check wrangler tail for error logs

### Assets not loading
- Build failed: run `npm run build:web` manually
- Check web/dist folder exists
- Redeploy: `npm run deploy`

## Support

- **Cloudflare Docs**: https://developers.cloudflare.com/workers/
- **D1 Database**: https://developers.cloudflare.com/d1/
- **GitHub Issues**: https://github.com/ANDREW-WEKESA/PHARMACY/issues

---

**Ready to deploy?** Start with Step 1 above! 🚀
