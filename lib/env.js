// Server-side configuration, read from environment variables (set in Vercel, never in the repository).
// Nothing here is required for the plate redirect and the Basic dashboard to work.

function value(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : '';
}

export function siteUrl() {
  return (value('NEXT_PUBLIC_SITE_URL') || 'https://www.reviewlah.my').replace(/\/+$/, '');
}

export function goUrl(code, source) {
  const base = (value('NEXT_PUBLIC_GO_URL') || 'https://go.reviewlah.my').replace(/\/+$/, '');
  return `${base}/${code}${source ? `?${source}` : ''}`;
}

export function supportEmail() {
  return value('SUPPORT_EMAIL');
}

export function supportWhatsapp() {
  return value('SUPPORT_WHATSAPP').replace(/[^0-9]/g, '');
}

export function legalEntity() {
  return {
    name: value('LEGAL_ENTITY_NAME'),
    address: value('LEGAL_ENTITY_ADDRESS'),
    email: value('PRIVACY_EMAIL') || supportEmail(),
  };
}

export function serviceKey() {
  return value('SUPABASE_SECRET_KEY') || value('SUPABASE_SERVICE_ROLE_KEY');
}

export function scanHashSecret() {
  return value('SCAN_HASH_SECRET');
}

export function cronSecret() {
  return value('CRON_SECRET');
}

export function resendConfig() {
  return { apiKey: value('RESEND_API_KEY'), from: value('EMAIL_FROM') || 'ReviewLah <hello@reviewlah.my>', replyTo: supportEmail() };
}

export function paymentProviderName() {
  return value('PAYMENT_PROVIDER').toLowerCase();
}

export function airwallexConfig() {
  const sandbox = value('AIRWALLEX_ENV').toLowerCase() === 'sandbox';
  return {
    clientId: value('AIRWALLEX_CLIENT_ID'),
    apiKey: value('AIRWALLEX_API_KEY'),
    webhookSecret: value('AIRWALLEX_WEBHOOK_SECRET'),
    priceMonthly: value('AIRWALLEX_PRICE_MONTHLY'),
    priceYearly: value('AIRWALLEX_PRICE_YEARLY'),
    baseUrl: (value('AIRWALLEX_API_URL') || (sandbox ? 'https://api.sandbox.airwallex.com' : 'https://api.airwallex.com')).replace(/\/+$/, ''),
    apiVersion: value('AIRWALLEX_API_VERSION'),
    legalEntityId: value('AIRWALLEX_LEGAL_ENTITY_ID'),
    linkedPaymentAccountId: value('AIRWALLEX_LINKED_PAYMENT_ACCOUNT_ID'),
    sandbox,
  };
}

export function gbpEnabled() {
  return value('GBP_ENABLED').toLowerCase() === 'true';
}

export function googleConfig() {
  return {
    clientId: value('GOOGLE_CLIENT_ID'),
    clientSecret: value('GOOGLE_CLIENT_SECRET'),
    redirectUri: `${siteUrl()}/api/google/callback`,
    pubsubTopic: value('GOOGLE_PUBSUB_TOPIC'),
    pubsubAudience: value('GOOGLE_PUBSUB_AUDIENCE') || `${siteUrl()}/api/google/notifications`,
    pubsubServiceAccount: value('GOOGLE_PUBSUB_SERVICE_ACCOUNT'),
    tokenKey: value('TOKEN_ENCRYPTION_KEY'),
  };
}

export function anthropicConfig() {
  return { apiKey: value('ANTHROPIC_API_KEY'), model: value('ANTHROPIC_MODEL') || 'claude-haiku-5-5' };
}

/** Which optional services are configured (booleans only, shown on the admin system page). */
export function configStatus() {
  const google = googleConfig();
  return {
    SUPABASE_SECRET_KEY: Boolean(serviceKey()),
    SCAN_HASH_SECRET: Boolean(scanHashSecret()),
    CRON_SECRET: Boolean(cronSecret()),
    RESEND_API_KEY: Boolean(value('RESEND_API_KEY')),
    EMAIL_FROM: Boolean(value('EMAIL_FROM')),
    SUPPORT_EMAIL: Boolean(supportEmail()),
    SUPPORT_WHATSAPP: Boolean(supportWhatsapp()),
    LEGAL_ENTITY_NAME: Boolean(value('LEGAL_ENTITY_NAME')),
    PAYMENT_PROVIDER: paymentProviderName() || false,
    AIRWALLEX_CLIENT_ID: Boolean(value('AIRWALLEX_CLIENT_ID')),
    AIRWALLEX_API_KEY: Boolean(value('AIRWALLEX_API_KEY')),
    AIRWALLEX_WEBHOOK_SECRET: Boolean(value('AIRWALLEX_WEBHOOK_SECRET')),
    AIRWALLEX_PRICE_MONTHLY: Boolean(value('AIRWALLEX_PRICE_MONTHLY')),
    AIRWALLEX_PRICE_YEARLY: Boolean(value('AIRWALLEX_PRICE_YEARLY')),
    GBP_ENABLED: gbpEnabled(),
    GOOGLE_CLIENT_ID: Boolean(google.clientId),
    GOOGLE_CLIENT_SECRET: Boolean(google.clientSecret),
    TOKEN_ENCRYPTION_KEY: Boolean(google.tokenKey),
    GOOGLE_PUBSUB_TOPIC: Boolean(google.pubsubTopic),
    GOOGLE_PUBSUB_SERVICE_ACCOUNT: Boolean(google.pubsubServiceAccount),
    ANTHROPIC_API_KEY: Boolean(value('ANTHROPIC_API_KEY')),
  };
}
