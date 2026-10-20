import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Environment must be set before the app modules load (config reads it at import time).
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cricreg-test-'));
Object.assign(process.env, {
  STORAGE: 'local',
  DATA_DIR: dataDir,
  DEV_LOGIN: 'true',
  ADMIN_EMAILS: 'admin@example.com',
  ALLOWED_EMAIL_DOMAINS: '',
});
const { createApp } = await import('../src/app.js');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);
let server;
let base;

const sessions = {};
async function login(email) {
  const res = await fetch(`${base}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  sessions[email] = res.headers.getSetCookie()[0].split(';')[0];
}

const call = async (email, method, url, body, { form } = {}) => {
  const headers = {};
  if (email) headers.Cookie = sessions[email];
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${url}`, { method, headers, body: payload });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

let referenceCounter = 0;

function registrationForm(overrides = {}) {
  const fd = new FormData();
  const fields = {
    email: 'player1@example.com',
    name: 'Asha Rao',
    contact: '9876543210',
    table_number: '4',
    team_id: teamId,
    jersey_size: 'M',
    jersey_number: '10',
    cricheroes_url: 'https://cricheroes.in/player-profile/1',
    rating: '3',
    handedness: 'Right-handed',
    payment_reference: `UTR${String(++referenceCounter).padStart(12, '0')}`,
    strength: ['All Rounder-Batsman'],
    ...overrides,
  };
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (!overrides.skipPaymentProof) fd.append('payment_proof', new Blob([PNG], { type: 'image/png' }), 'payment.png');
  fd.append('photo', new Blob([PNG], { type: 'image/png' }), 'photo.png');
  return fd;
}

let teamId;

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const email of ['admin@example.com', 'owner@example.com', 'player1@example.com', 'player2@example.com']) {
    await login(email);
  }
});

after(async () => {
  server.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('signed-out users are rejected from protected endpoints', async () => {
  const res = await call(null, 'GET', '/api/me');
  assert.equal(res.status, 401);
});

test('admin creates a team with an owner', async () => {
  const fd = new FormData();
  fd.append('name', 'Blue Strikers');
  fd.append('owner_email', 'owner@example.com');
  fd.append('primary_color', '#0044aa');
  const res = await call('admin@example.com', 'POST', '/api/teams', null, { form: fd });
  assert.equal(res.status, 201);
  teamId = res.body.id;
});

test('non-admin cannot create teams', async () => {
  const fd = new FormData();
  fd.append('name', 'Sneaky FC');
  fd.append('owner_email', 'player1@example.com');
  const res = await call('player1@example.com', 'POST', '/api/teams', null, { form: fd });
  assert.equal(res.status, 403);
});

test('public config lists teams without owner emails', async () => {
  const res = await call(null, 'GET', '/api/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.teams[0].name, 'Blue Strikers');
  assert.equal(res.body.teams[0].owner_email, undefined);
});

test('registration works without signing in; invalid fields are reported per field', async () => {
  const bad = await call(null, 'POST', '/api/registrations', null, {
    form: registrationForm({ contact: '123', rating: '9', email: 'not-an-email' }),
  });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors.contact);
  assert.ok(bad.body.errors.rating);
  assert.ok(bad.body.errors.email);

  const ok = await call(null, 'POST', '/api/registrations', null, { form: registrationForm() });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.payment_status, 'pending');
  assert.equal(ok.body.email, 'player1@example.com');
  assert.equal(ok.body.handedness, 'Right-handed');
  assert.match(ok.body.payment_reference, /^UTR\d{12}$/);
  assert.equal(ok.body.strength, 'All Rounder-Batsman');
  assert.equal(ok.body.photo_url, '/uploads/photos/Asha-Rao-9876543210-photo.png');
  assert.equal(ok.body.payment_proof_url, '/uploads/payments/Asha-Rao-9876543210-payment.png');
});

test('payment reference is required and cannot be reused', async () => {
  const missing = await call(null, 'POST', '/api/registrations', null, {
    form: registrationForm({ payment_reference: '' }),
  });
  assert.equal(missing.status, 400);
  assert.ok(missing.body.errors.payment_reference);

  const { body: list } = await call('owner@example.com', 'GET', '/api/registrations');
  const taken = list.registrations[0].payment_reference;
  const reused = await call(null, 'POST', '/api/registrations', null, {
    form: registrationForm({ email: 'reuse@example.com', contact: '9000000009', payment_reference: taken }),
  });
  assert.equal(reused.status, 400);
  assert.match(reused.body.errors.payment_reference, /already been used/);
});

test('registration is incomplete without a payment screenshot', async () => {
  const res = await call(null, 'POST', '/api/registrations', null, {
    form: registrationForm({ skipPaymentProof: true }),
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.payment_proof);
});

test('admin assigns a team to a registration; unknown team is rejected', async () => {
  const { body } = await call('admin@example.com', 'GET', '/api/registrations');
  const reg = body.registrations[0];
  const res = await call('admin@example.com', 'PATCH', `/api/registrations/${reg.id}/team`, { team_id: teamId });
  assert.equal(res.status, 200);
  assert.equal(res.body.team_name, 'Blue Strikers');

  const bad = await call('admin@example.com', 'PATCH', `/api/registrations/${reg.id}/team`, { team_id: 'nope' });
  assert.equal(bad.status, 400);

  const denied = await call('owner@example.com', 'PATCH', `/api/registrations/${reg.id}/team`, { team_id: '' });
  assert.equal(denied.status, 403);
});

test('a second registration with the same email is rejected', async () => {
  const res = await call(null, 'POST', '/api/registrations', null, {
    form: registrationForm({ contact: '9000000001', jersey_number: '13' }),
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.email);
});

test('a second registration with the same mobile number is rejected, even with a different email', async () => {
  const res = await call(null, 'POST', '/api/registrations', null, {
    form: registrationForm({ email: 'other@example.com', contact: '+91 98765 43210', jersey_number: '12' }),
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.errors.contact, 'This mobile number is already registered. Contact the tournament admin to change your details.');
});

test('duplicate jersey number in the same team is rejected', async () => {
  const res = await call(null, 'POST', '/api/registrations', null, {
    form: registrationForm({ email: 'player2@example.com', contact: '9123456780' }),
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.jersey_number);
});

test('owner sees their team players; signed-out and player users cannot list registrations', async () => {
  const owner = await call('owner@example.com', 'GET', '/api/registrations');
  assert.equal(owner.status, 200);
  assert.equal(owner.body.registrations.length, 1);

  const anonymous = await call(null, 'GET', '/api/registrations');
  assert.equal(anonymous.status, 401);

  const player = await call('player1@example.com', 'GET', '/api/registrations');
  assert.equal(player.status, 403);
});

test('only admin can mark payments; owner cannot', async () => {
  const { body } = await call('owner@example.com', 'GET', '/api/registrations');
  const id = body.registrations[0].id;

  const denied = await call('owner@example.com', 'PATCH', `/api/registrations/${id}/payment`, { payment_status: 'paid' });
  assert.equal(denied.status, 403);

  const ok = await call('admin@example.com', 'PATCH', `/api/registrations/${id}/payment`, { payment_status: 'paid' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.payment_status, 'paid');
});

test('me endpoint returns roles and own registration', async () => {
  const owner = await call('owner@example.com', 'GET', '/api/me');
  assert.deepEqual(owner.body.roles, ['player', 'owner']);

  const admin = await call('admin@example.com', 'GET', '/api/me');
  assert.equal(admin.body.roles[0], 'admin');

  assert.equal(owner.body.registration, null);
});

test('admin can update a team owner name and email', async () => {
  const { body } = await call('admin@example.com', 'GET', '/api/teams');
  const team = body.teams.find(t => t.name === 'Blue Strikers');
  const fd = new FormData();
  fd.append('name', 'Blue Strikers');
  fd.append('owner_name', 'Vishal Test');
  fd.append('owner_email', 'owner@example.com');
  fd.append('primary_color', '#0044aa');
  const res = await fetch(`${base}/api/teams/${team.id}`, { method: 'PUT', headers: { Cookie: sessions['admin@example.com'] }, body: fd });
  const updated = await res.json();
  assert.equal(res.status, 200);
  assert.equal(updated.owner_name, 'Vishal Test');
});

test('admin adds and removes a sponsor; public list reflects it', async () => {
  const png = new Blob([PNG], { type: 'image/png' });
  const fd = new FormData();
  fd.append('name', 'Acme Sports');
  fd.append('logo', png, 'acme.png');
  const created = await call('admin@example.com', 'POST', '/api/sponsors', null, { form: fd });
  assert.equal(created.status, 201);

  const listed = await call(null, 'GET', '/api/sponsors');
  assert.equal(listed.body.sponsors.length, 1);
  assert.match(listed.body.sponsors[0].logo_url, /^\/uploads\/sponsors\/.+\.png$/);
  // Logos must load for visitors who are not signed in.
  const anonymous = await fetch(`${base}${listed.body.sponsors[0].logo_url}`);
  assert.equal(anonymous.status, 200);

  const denied = await call('player1@example.com', 'POST', '/api/sponsors', null, { form: fd });
  assert.equal(denied.status, 403);

  const removed = await fetch(`${base}/api/sponsors/${created.body.id}`, { method: 'DELETE', headers: { Cookie: sessions['admin@example.com'] } });
  assert.equal(removed.status, 204);
  assert.equal((await call(null, 'GET', '/api/sponsors')).body.sponsors.length, 0);
});

test('sponsor logo must be a real image', async () => {
  const fd = new FormData();
  fd.append('name', 'Fake Logo Co');
  fd.append('logo', new Blob(['<svg></svg>'], { type: 'image/svg+xml' }), 'logo.svg');
  const res = await call('admin@example.com', 'POST', '/api/sponsors', null, { form: fd });
  assert.equal(res.status, 400);
  assert.ok(res.body.errors.logo);
});

test('players cannot manage admins', async () => {
  const res = await call('player2@example.com', 'GET', '/api/admins');
  assert.equal(res.status, 403);
});

test('admin promotes a player; promoted player gets admin access', async () => {
  const added = await call('admin@example.com', 'POST', '/api/admins', { email: 'Player2@Example.com' });
  assert.equal(added.status, 201);
  assert.equal(added.body.email, 'player2@example.com');

  const me = await call('player2@example.com', 'GET', '/api/me');
  assert.equal(me.body.roles[0], 'admin');
  const teams = await call('player2@example.com', 'GET', '/api/teams');
  assert.equal(teams.status, 200);
});

test('adding an existing admin is rejected', async () => {
  const res = await call('admin@example.com', 'POST', '/api/admins', { email: 'admin@example.com' });
  assert.equal(res.status, 409);
});

test('configured admins are listed but cannot be removed', async () => {
  const { body } = await call('admin@example.com', 'GET', '/api/admins');
  const configured = body.admins.find(a => a.email === 'admin@example.com');
  assert.equal(configured.source, 'config');
  assert.equal(configured.id, null);
  const res = await fetch(`${base}/api/admins/does-not-exist`, { method: 'DELETE', headers: { Cookie: sessions['admin@example.com'] } });
  assert.equal(res.status, 404);
});

test('admin revokes a promoted admin; access is removed immediately', async () => {
  const { body } = await call('admin@example.com', 'GET', '/api/admins');
  const added = body.admins.find(a => a.email === 'player2@example.com');
  const res = await fetch(`${base}/api/admins/${added.id}`, { method: 'DELETE', headers: { Cookie: sessions['admin@example.com'] } });
  assert.equal(res.status, 204);

  const teams = await call('player2@example.com', 'GET', '/api/teams');
  assert.equal(teams.status, 403);
});

test('an admin cannot remove their own access', async () => {
  await call('admin@example.com', 'POST', '/api/admins', { email: 'player1@example.com' });
  const { body } = await call('admin@example.com', 'GET', '/api/admins');
  const player1 = body.admins.find(a => a.email === 'player1@example.com');
  // player1 is now an admin, so they can reach the endpoint but may not remove their own access.
  const res = await fetch(`${base}/api/admins/${player1.id}`, { method: 'DELETE', headers: { Cookie: sessions['player1@example.com'] } });
  assert.equal(res.status, 400);
});

test('player photos stay private to signed-in users', async () => {
  const { body } = await call('admin@example.com', 'GET', '/api/registrations');
  const photo = body.registrations[0].photo_url;
  const anonymous = await fetch(`${base}${photo}`);
  assert.equal(anonymous.status, 401);
});

test('player sees their team and teammates without contact details', async () => {
  // A teammate who is not already on a team: register them, then the admin assigns the team below.
  const mate = await call(null, 'POST', '/api/registrations', null, {
    form: registrationForm({ email: 'mate@example.com', contact: '9000000003', jersey_number: '21', team_id: '' }),
  });
  assert.equal(mate.status, 201);

  // Assign every registration to the same team, as an admin would after allotment.
  const { body } = await call('admin@example.com', 'GET', '/api/registrations');
  for (const reg of body.registrations) {
    await call('admin@example.com', 'PATCH', `/api/registrations/${reg.id}/team`, { team_id: teamId });
  }
  const mine = await call('player1@example.com', 'GET', '/api/my-team');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.registration.email, 'player1@example.com');
  assert.equal(mine.body.team.name, 'Blue Strikers');
  assert.equal(mine.body.team.owner_email, 'owner@example.com');
  assert.equal(mine.body.registration.payment_status, undefined);
  assert.equal(mine.body.registration.payment_proof_url, undefined);
  assert.ok(mine.body.teammates.length >= 1);
  for (const mate of mine.body.teammates) {
    assert.equal(mate.contact, undefined);
    assert.equal(mate.email, undefined);
  }
});

test('admin downloads registration details as CSV; others cannot', async () => {
  const csv = await fetch(`${base}/api/registrations.csv`, { headers: { Cookie: sessions['admin@example.com'] } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment/);
  const text = await csv.text();
  assert.ok(text.replace(/^\ufeff/, '').startsWith('created_at,name,email,contact'));
  assert.ok(text.includes('"Asha Rao"'));

  const player = await fetch(`${base}/api/registrations.csv`, { headers: { Cookie: sessions['player2@example.com'] } });
  assert.equal(player.status, 403);
  const anonymous = await fetch(`${base}/api/registrations.csv`);
  assert.equal(anonymous.status, 401);
});

test('player files need sign-in and unknown files are not found', async () => {
  const anonymous = await fetch(`${base}/api/files/someid`);
  assert.equal(anonymous.status, 401);
  const unknown = await fetch(`${base}/api/files/someid`, { headers: { Cookie: sessions['admin@example.com'] } });
  assert.equal(unknown.status, 404);
});
