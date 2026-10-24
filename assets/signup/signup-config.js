// HD-SIGNUP-001 single source of truth: source allowlist, allowed origins, limits, status copy.
// Imported by functions/api/subscribe.js, functions/_middleware.js and assets/signup/signup.js.
// No secrets here. BEEHIIV_API_KEY and BEEHIIV_PUB_ID are Pages environment secrets.

// AC4: hazeydata.ai home plus project slugs. The 8th project slug is an open question for Spec.
export const SOURCES = [
  'hazeydata',
  'openmillage',
  'k12comp',
  'agentwebindex',
  'parkpermits',
  'theme-park-crowd-report',
  'cdr',
  'accord',
];

// AC9: origins allowed to POST /api/subscribe. Add project origins here once they embed the partial.
export const ALLOWED_ORIGINS = [
  'https://hazeydata.ai',
  'https://www.hazeydata.ai',
  'https://hazeydata.pages.dev',
];

// AC7 / AC8 (OQ4 defaults).
export const RATE_LIMIT = { max: 5, windowSeconds: 600 };
export const BEEHIIV_TIMEOUT_MS = 5000;

export const STATUSES = ['subscribed', 'already_subscribed', 'invalid_email', 'rate_limited', 'error'];

// AC14: DRAFT copy in Fred's voice, pending Lindsay's final lines.
export const MESSAGES = {
  subscribed: "You're in. Check your inbox for the first data drop.",
  already_subscribed: "You're already on the list. Nothing more to do.",
  invalid_email: "That email doesn't look right. Check it and try again.",
  rate_limited: 'Too many tries from here. Give it ten minutes and try again.',
  error: "Our end broke, not yours. Try again in a minute.",
};
