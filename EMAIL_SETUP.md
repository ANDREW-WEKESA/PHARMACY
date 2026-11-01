# Email Setup for Password Reset

The password reset feature supports email notifications. Here's how to set it up:

## Option 1: MailChannels (FREE on Cloudflare Workers)

MailChannels provides free email sending for Cloudflare Workers.

### Setup Steps:

1. **Add Environment Variables to wrangler.toml:**
   ```toml
   [vars]
   SEND_EMAIL = "true"
   FROM_EMAIL = "noreply@yourdomain.com"
   ```

2. **Deploy to Cloudflare:**
   ```bash
   npm run deploy
   ```

3. **Configure DNS (if using custom domain):**
   - Add SPF record: `v=spf1 include:relay.mailchannels.net ~all`
   - Add DKIM record (provided by MailChannels)

### How it works:
- User clicks "Forgot password"
- Enters email
- System generates secure reset token
- Email sent via MailChannels API
- User clicks link in email
- Sets new password

## Option 2: SendGrid, Mailgun, or Postmark

For more features (templates, analytics, etc.):

1. Sign up for an account
2. Get API key
3. Add to `wrangler.toml`:
   ```toml
   [vars]
   EMAIL_PROVIDER = "sendgrid"
   EMAIL_API_KEY = "your-api-key"
   FROM_EMAIL = "noreply@yourdomain.com"
   ```

4. Update the email sending code in `worker/src/routes-core.js`

## Development Mode

Without email configured, reset links are logged to console:

```
Password reset link for user@example.com: /reset-password?token=abc123...
```

You can copy this link and test locally.

## Security Features

✅ Tokens expire after 1 hour
✅ Tokens can only be used once  
✅ Email enumeration prevention (always returns success)
✅ Rate limiting on reset requests
✅ Audit trail of all reset attempts

## Testing

1. Click "Forgot your password?" on login page
2. Enter email address
3. Check console logs (dev) or email inbox (production)
4. Click reset link
5. Enter new password
6. Login with new credentials

## Production Checklist

- [ ] Configure email service (MailChannels, SendGrid, etc.)
- [ ] Set `SEND_EMAIL=true` in production environment
- [ ] Configure `FROM_EMAIL` with your domain
- [ ] Set up SPF/DKIM DNS records
- [ ] Test password reset flow end-to-end
- [ ] Monitor email delivery rates
- [ ] Set up email templates for branding

## Cost

- **MailChannels**: FREE (100,000 emails/month on Cloudflare)
- **SendGrid**: Free tier (100 emails/day), paid plans from $19.95/month
- **Mailgun**: Free tier (5,000 emails/month), paid plans from $35/month
- **Postmark**: Free tier (100 emails/month), paid plans from $15/month

## Support

For email issues:
1. Check console logs for errors
2. Verify environment variables are set
3. Test with MailChannels API directly
4. Check spam folder
5. Review audit logs in the system
