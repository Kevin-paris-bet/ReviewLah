// Every confirmation and error message shown after a form is sent (?ok=… / ?error=… in the address).
export const OK_MESSAGES = {
  link: 'Review link updated. Your plates now open the new page.',
  details: 'Location details saved.',
  label: 'Plate name saved.',
  account: 'Account details saved.',
  email: 'Check your new inbox: click the link we sent to confirm the new login email.',
  support: 'Message sent. We reply by email, usually within one working day.',
  links: 'Links page saved.',
  cancel: 'Renewal cancelled. Pro stays on until the end of the period you paid for.',
  resume: 'Renewal back on. Nothing else to do.',
  paid: 'Thank you. Your payment is being confirmed: Pro switches on within a minute.',
  created: 'Created.',
  saved: 'Saved.',
  pro_on: 'Pro switched on for this location.',
  pro_off: 'Pro switched off for this location. The plate and Basic dashboard keep working.',
  moved: 'Plate moved.',
  deleted: 'Deleted.',
  closed: 'Request closed.',
  sent: 'Sent.',
  connected: 'Google connected. Choose which listing belongs to each location.',
  linked: 'Listing linked. Reviews are being imported.',
  unlinked: 'Listing unlinked and its imported reviews deleted.',
  disconnected: 'Google disconnected. All imported Google data has been deleted.',
  synced: 'Reviews updated.',
  drafted: 'Draft ready. Edit it if needed, then approve it to publish.',
  published: 'Reply published on Google.',
  reply_deleted: 'Reply removed from Google.',
  discarded: 'Draft discarded.',
};

export const ERROR_MESSAGES = {
  failed: 'Something went wrong. Nothing was changed. Try again.',
  not_allowed: 'You do not have access to this.',
  not_authenticated: 'Your session ended. Log in again.',
  pro_required: 'This is a Pro feature for this location.',
  invalid_review_url: 'Use a Google review or Google Maps link starting with https:// (g.page, maps.app.goo.gl, search.google.com/local/writereview, google.com/maps…).',
  invalid_name: 'Enter a name (100 characters at most).',
  invalid_phone: 'Enter a phone number with digits only, for example +60 12-345 6789.',
  invalid_links: 'One of the links is not valid. Links must start with https://',
  invalid_message: 'Write a message of at least a few words.',
  too_many_requests: 'You have sent several messages today. We will reply to them first.',
  invalid_interval: 'Choose monthly or yearly billing.',
  invalid_provider: 'Online payment is not available yet.',
  already_subscribed: 'This location already has Pro.',
  not_active: 'This subscription is no longer active.',
  managed_by_support: 'This Pro access was set up by our team. Contact support to change it.',
  provider_subscription_exists: 'This location has a paid subscription. Cancel it from the payment provider first.',
  not_found: 'Not found.',
  invalid_email: 'Enter a valid email address.',
  email_in_use: 'Another customer already uses this email.',
  plate_has_scans: 'This plate has scans: pause it instead of deleting it.',
  payment_unavailable: 'Online payment is not open yet. Contact us and we will switch Pro on for you.',
  payment_failed: 'The payment page could not be opened. Try again in a moment.',
  payment_cancelled: 'Payment cancelled. Nothing was charged.',
  provider_unreachable: 'We could not reach the payment service. Nothing was changed. Try again in a moment.',
  email_failed: 'We could not send the confirmation email. Check the address and try again.',
  login: 'This login link has expired or was already used. Ask for a new one.',
  google_disabled: 'The Google connection is not available yet.',
  google_denied: 'Google access was not granted. Nothing was connected.',
  google_state: 'The Google sign-in took too long. Start again.',
  google_failed: 'Google did not answer as expected. Try again in a moment.',
  google_no_refresh: 'Google did not grant long-term access. Start again and tick the permission box.',
  ai_unavailable: 'AI drafts are not available yet. You can still write the reply yourself.',
  reply_empty: 'Write a reply before publishing.',
  reply_long: 'A reply is limited to 4,000 characters.',
  config: 'This feature is not configured yet.',
};

export function okMessage(code) {
  return OK_MESSAGES[code] || null;
}

export function errorMessage(code) {
  if (!code) return null;
  return ERROR_MESSAGES[code] || ERROR_MESSAGES.failed;
}
