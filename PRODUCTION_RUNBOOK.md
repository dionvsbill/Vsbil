# VSBIL production runbook

## 1. Database

Apply the database migrations in this order in Supabase SQL Editor:

1. `database/production_phase2.sql`
2. `database/production_phase3.sql`

Do not skip Phase 3: the application now calls its atomic campaign/activity functions.

## 2. Environment

Copy `.env.example` to the deployment environment and provide real values for every required production variable. Never commit `.env` or any service-role/private key.

Required core secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `APP_URL`
- `APP_ENCRYPTION_KEY`
- `APP_STATE_SECRET`
- `PAYSTACK_SECRET_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `YOUTUBE_REDIRECT_URI`
- `RESEND_API_KEY`
- `EMAIL_FROM`

## 3. Payment activation

VSBIL activation is GHS 50 during the launch offer. The server creates the Paystack transaction, verifies amount/currency/reference/metadata, validates the webhook signature, records webhook events idempotently, and calls the database activation function.

Configure the Paystack webhook to:

`https://YOUR_DOMAIN/api/payment/webhook`

The browser callback is only a convenience. Account activation must depend on server-side verification/webhook processing.

## 4. Authentication

Production authentication uses email OTP verification, Supabase Auth sessions, access/refresh tokens and account-status enforcement. Pending users can sign in after email verification only to reach the activation screen.

## 5. Campaigns

Campaign creation reserves the entire campaign budget atomically from the creator wallet and places the campaign in `pending` review. Admin approval changes it to `active`; rejection/closure releases unused reserved funds. Rewarded like/subscribe campaigns are intentionally disabled because VSBIL must not be used to manufacture artificial third-party engagement.

## 6. Activities

Participants receive an activity attempt from the server. Completion requires the server-side attempt window to have elapsed. Submissions remain `pending` until an administrator verifies them. The reward is credited exactly once through an atomic database function.

The viewing timer is a fraud-control measure, not proof that a human watched every frame. Do not advertise it as a guarantee of YouTube watch analytics.

## 7. Withdrawals

Withdrawal requests are authenticated, validated, limited, idempotency-protected and passed to the atomic `request_withdrawal` database function. Admins review payout requests. Real money payout automation should be enabled only after the selected payout provider's API, webhook reconciliation and compliance requirements have been tested in a staging environment.

## 8. YouTube OAuth

Create Google OAuth credentials with the exact production redirect URI. Keep Google client secrets server-side. Access and refresh tokens are encrypted by the application vault and are never returned to the browser.

## 9. Production verification checklist

- `npm ci`
- `npm run typecheck`
- `npm run build`
- Start with `NODE_ENV=production`
- Check `/api/health`
- Test registration + email verification
- Test pending login → activation
- Test a real Paystack test-mode activation before live mode
- Confirm webhook signature handling
- Confirm activation is idempotent
- Confirm campaign creation deducts/reserves the correct amount
- Confirm admin campaign approval/rejection
- Confirm activity attempt cannot be completed early
- Confirm duplicate submission is rejected
- Confirm admin approval credits one reward only
- Confirm withdrawal balance is reserved exactly once
- Confirm suspended/banned users cannot access protected APIs
- Confirm PWA installation and service-worker update behavior
- Run a mobile browser smoke test on iOS and Android

## Important

This repository contains production application code, but production readiness also depends on external provider configuration, database migration execution, domain/HTTPS configuration, payment-provider approval, Google OAuth configuration, email delivery, monitoring and legal/compliance review. Those external controls cannot be completed by a Git commit alone.
