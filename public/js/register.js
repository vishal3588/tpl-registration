import { $, api, esc, loadBranding } from './common.js';

const form = $('#reg-form');
const status = $('#form-status');

init();

// Shown when a Google account tried Team owner login but isn't registered as a team owner.
function showDeniedNotice() {
  if (new URLSearchParams(location.search).get('denied') !== 'owner') return;
  const notice = $('#role-notice');
  notice.textContent = 'This email is not registered as a team owner. Only the team owner emails set by the admin can sign in here. Please contact the admin.';
  notice.hidden = false;
}

async function init() {
  showDeniedNotice();
  const branding = await loadBranding();
  $('#payment-qr').src = branding.paymentQr;
  $('#payment-instructions').textContent = branding.paymentInstructions;
  $('#bank-details').innerHTML = bankRows(branding.bankDetails);
  $('#registration-amount').textContent = branding.registrationAmount;

  const post = branding.postRegistration;
  $('#success-flyer').src = post.flyer;
  $('#success-venue').textContent = post.venue;
  $('#success-message').textContent = post.message;

  const config = await api('/config');
  $('#size-select').innerHTML = config.jerseySizes.map(s => `<option value="${s}">${s}</option>`).join('');
}

// Only rows that have a value are shown, so blank fields never appear on the page.
function bankRows(details = {}) {
  const labels = { accountName: 'Account name', bankName: 'Bank', branch: 'Branch', accountNumber: 'Account number', ifsc: 'IFSC', upiId: 'UPI ID' };
  return Object.entries(labels)
    .filter(([key]) => details[key])
    .map(([key, label]) => `<tr><th>${label}</th><td>${esc(details[key])}</td></tr>`)
    .join('');
}

// Pasted references often carry spaces; clean them as they go in.
form.elements.payment_reference.addEventListener('input', event => {
  event.target.value = event.target.value.replace(/\s+/g, '').toUpperCase();
});

// Replaces the form with the flyer, venue and message once the registration is saved.
function showSuccess() {
  form.closest('section').hidden = true;
  $('#success-panel').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearErrors() {
  document.querySelectorAll('[data-error-for]').forEach(el => (el.textContent = ''));
}

function showErrors(errors) {
  for (const [field, message] of Object.entries(errors)) {
    const el = document.querySelector(`[data-error-for="${field}"]`);
    if (el) el.textContent = message;
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  clearErrors();
  status.className = '';
  status.textContent = 'Submitting…';
  try {
    await api('/registrations', { method: 'POST', body: new FormData(form) });
    showSuccess();
  } catch (err) {
    status.className = 'fail';
    status.textContent = err.body?.errors ? 'Please fix the highlighted fields.' : err.message;
    if (err.body?.errors) showErrors(err.body.errors);
  }
});
