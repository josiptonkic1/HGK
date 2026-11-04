import { $, api, logoHtml, sprinkleDust, inMobileApp } from './common.js';

if (inMobileApp) $('#app-server').hidden = false;

$('#logo').innerHTML = logoHtml();
sprinkleDust();

api('/api/auth/me').then(() => location.replace('/staff')).catch(() => {});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  const btn = e.submitter || $('#login-form button');
  btn.disabled = true;
  try {
    await api('/api/auth/login', { method: 'POST', body: { username: $('#username').value, password: $('#password').value } });
    location.replace('/staff');
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    btn.disabled = false;
  }
});
