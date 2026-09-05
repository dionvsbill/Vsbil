# VSBIL Shop Expansion

This expansion extends the existing Express + Supabase VSBIL application. It does not replace the existing Business Suite, YouTube, authentication, payment or admin architecture.

## Database migration order

Apply these after the existing VSBIL production/business migrations:

1. `database/shop_expansion_v2.sql`
2. `database/shop_checkout_payments_v1.sql`
3. `database/shop_checkout_finalize_v1.sql`

The migrations add shop branding/settings, categories, Jumia/JForce attribution, customer records, pending shop wallet accounting, escrow holds/settlements, WhatsApp shop flows and server-side checkout sessions.

## New routes

- `/dashboard/shop/create` — authenticated shop creation
- `/dashboard/shop/:id` — authenticated shop control center
- `/shop/:slug` — public storefront
- `/admin/shops` — admin shop management

Existing `/business.html`, `/shop-admin.html`, `/shop-store.html`, YouTube and WhatsApp routes remain available.

## Payment configuration

Existing Paystack server configuration is reused:

- `PAYSTACK_SECRET_KEY`
- `APP_URL`
- `APP_ENCRYPTION_KEY`
- `APP_STATE_SECRET`

Online shop checkout never trusts a browser amount. The server calculates product prices and delivery fees, creates a checkout session, verifies Paystack, then atomically finalizes the order and places the seller's net amount into pending shop balance.

## Shop plans

The additive billing API exposes:

- Free: 20 products, 100 conversations, 5% shop fee.
- Pro: GH₵149/month plus GH₵100 first-time setup, 1000 products, 1000 conversations, 3% shop fee.

The first Pro checkout is GH₵249; renewals are GH₵149.

## Jumia / JForce

The existing robust Jumia importer remains intact. The expansion also provides a user-safe preview/import path. HTTP 403 responses are treated as a blocked automated request; VSBIL does not bypass Jumia protections. Users can complete product fields manually.

JForce identifiers are stored server-side with the shop and affiliate clicks are recorded as hashed attribution events.

## WhatsApp

The existing WhatsApp Business infrastructure remains the connection layer. The shop module adds per-shop flow configuration for product/catalog/order/payment/status actions. A real Meta Cloud API connection and webhook configuration are still required before production messages are sent.

## Security

New financial tables have RLS enabled with no direct client write policy. Server-side Express authorization remains authoritative. Sensitive credentials must stay in server environment variables. Shop ownership is checked on every authenticated shop-management endpoint.

## Deployment

The project remains compatible with the existing Node/Express deployment model and Render startup command. Run `npm run typecheck` and `npm run build` in the deployment environment after applying the database migrations.
