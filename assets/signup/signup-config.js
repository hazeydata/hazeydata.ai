// HD-SIGNUP-001 single source of truth: source allowlist, allowed origins, limits, status copy.
// Imported by functions/api/subscribe.js, functions/_middleware.js and assets/signup/signup.js.
// No secrets here. BEEHIIV_API_KEY and BEEHIIV_PUB_ID are Pages environment secrets.

// AC4: hazeydata.ai home plus the 8 project slugs.
export const SOURCES = [
  'hazeydata',
  'openmillage',
  'k12comp',
  'agentwebindex',
  'parkpermits',
  'theme-park-crowd-report',
  'cdr',
  'accord',
  'project-8', // opaque slug per Spec R1; public name open with Fred (OQ5)
];

// AC9 (Spec R1): exactly these origins. Others only by spec ruling once a page there embeds the form.
export const ALLOWED_ORIGINS = [
  'https://hazeydata.ai',
  'https://www.hazeydata.ai',
];

// AC7 / AC8 (OQ4 defaults).
export const RATE_LIMIT = { max: 5, windowSeconds: 600 };
export const BEEHIIV_TIMEOUT_MS = 5000;

export const STATUSES = ['subscribed', 'already_subscribed', 'invalid_email', 'rate_limited', 'error'];

// AC14: Lindsay's copy, word for word.
export const MESSAGES = {
  subscribed: "You're in. Watch your inbox.",
  already_subscribed: "You're already on the list. Nice taste.",
  invalid_email: 'That email looks off. Give it another look?',
  rate_limited: 'Whoa, lots of tries. Wait ten minutes and go again.',
  error: "That one's on us, not you. Try again in a minute.",
};
