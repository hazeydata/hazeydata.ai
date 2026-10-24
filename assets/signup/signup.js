// HD-SIGNUP-001 progressive enhancement. Same-origin fetch only; the form works without this file.
import { MESSAGES, STATUSES } from './signup-config.js';

function setStatus(el, status) {
  el.dataset.state = status;
  el.textContent = MESSAGES[status];
}

for (const form of document.querySelectorAll('form.hd-signup')) {
  const statusEl = form.querySelector('[data-signup-status]');
  const button = form.querySelector('button[type="submit"]');
  const params = new URLSearchParams(location.search);
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) {
    const input = form.querySelector(`input[name="${k}"]`);
    if (input && params.get(k)) input.value = params.get(k);
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    let status = 'error';
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        body: new URLSearchParams(new FormData(form)),
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      const json = await res.json();
      if (STATUSES.includes(json.status)) status = json.status;
    } catch { /* network failure -> error */ }
    setStatus(statusEl, status);
    if (status === 'subscribed' || status === 'already_subscribed') form.reset();
    button.disabled = false;
    button.removeAttribute('aria-busy');
  });
}
