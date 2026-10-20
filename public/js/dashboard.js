import { $, PLACEHOLDER_LOGO, api, esc, loadBranding, loadSponsors, logout } from './common.js';

const teamForm = $('#team-form');
const teamStatus = $('#team-status');
const sponsorForm = $('#sponsor-form');
const sponsorStatus = $('#sponsor-status');
let editingTeamId = null;

init();

async function init() {
  await loadBranding();
  $('#logout').onclick = async () => {
    await logout();
    location.href = 'index.html';
  };

  const me = await api('/me').catch(() => null);
  if (!me) {
    $('#signed-out').hidden = false;
    return;
  }

  $('#logout').hidden = false;
  $('#user-email').textContent = `${me.email} · ${me.roles.join(', ')}`;
  showRoleNotice(me);
  $('#player-section').hidden = false;
  await loadPlayerSection();

  if (me.roles.includes('admin')) {
    $('#admin-section').hidden = false;
    $('#teams-section').hidden = false;
    $('#sponsors-section').hidden = false;
    $('#admins-section').hidden = false;
    $('#all-registrations').onclick = onPaymentClick;
    $('#all-registrations').onchange = onTeamChange;
    $('#sponsors-admin').onclick = onSponsorRemove;
    $('#admins-list').onclick = onAdminRemove;
    await Promise.all([
      refreshRegistrations('#all-registrations', true),
      loadTeams(),
      loadSponsorAdmin(),
      loadAdmins(),
    ]);
  } else if (me.roles.includes('owner')) {
    $('#owner-section').hidden = false;
    await refreshRegistrations('#owner-registrations', false);
  }
}

// The sign-in tab the user chose (?as=owner|admin|player). Warn if the account doesn't have that role.
function showRoleNotice(me) {
  const params = new URLSearchParams(location.search);
  const wanted = params.get('as');
  const messages = {
    owner: 'This account is not linked to a team. Ask an admin to add your email as a team owner, then sign in again.',
    admin: 'This account does not have admin access. Ask an existing admin to add your email in the Admins section.',
    player: 'No registration is linked to this email. Register first using the same email, then sign in again.',
  };
  const satisfied = wanted === 'player' ? Boolean(me.registration) : me.roles.includes(wanted);
  if (!messages[wanted] || satisfied) return;
  const notice = $('#role-notice');
  notice.textContent = messages[wanted];
  notice.hidden = false;
}

// The signed-in player's registration, team (with owner) and teammates. Nothing else is shown.
async function loadPlayerSection() {
  const el = $('#player-body');
  const { registration, team, teammates } = await api('/my-team');
  if (!registration) {
    el.innerHTML = '<p class="muted">No registration is linked to this email yet. <a href="index.html">Register now</a>.</p>';
    return;
  }

  const details = `
    <h3>My registration</h3>
    <div class="table-wrap"><table>
      <tbody>
        <tr><th>Name</th><td>${esc(registration.name)}</td><th>Email</th><td>${esc(registration.email)}</td></tr>
        <tr><th>Mobile</th><td>${esc(registration.contact)}</td><th>Table</th><td>${esc(registration.table_number)}</td></tr>
        <tr><th>Jersey</th><td>#${esc(registration.jersey_number)} (${esc(registration.jersey_size)})</td><th>Rating</th><td>${esc(registration.rating)} ★</td></tr>
        <tr><th>Hand</th><td>${esc(registration.handedness)}</td><th>Strength</th><td>${esc(registration.strength)}</td></tr>
        <tr><th>Photo</th><td><a href="${esc(registration.photo_url)}" target="_blank" rel="noopener">View</a></td>
          <th>CricHeroes</th><td>${registration.cricheroes_url ? `<a href="${esc(registration.cricheroes_url)}" target="_blank" rel="noopener">Profile</a>` : '<span class="muted">—</span>'}</td></tr>
      </tbody>
    </table></div>`;

  const teamBlock = team
    ? `<h3>My team</h3>
       <div class="table-wrap"><table>
         <tbody>
           <tr><th>Team</th><td>${esc(team.name)}</td></tr>
           <tr><th>Team owner</th><td>${esc(team.owner_name || '—')}</td></tr>
           <tr><th>Owner email</th><td>${esc(team.owner_email)}</td></tr>
         </tbody>
       </table></div>`
    : '<h3>My team</h3><p class="notice">Team allotment is pending. Your team will appear here once it is confirmed.</p>';

  const mates = team
    ? `<h3>My teammates</h3>${teammates.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Photo</th><th>Name</th><th>Jersey</th><th>Size</th><th>Hand</th><th>Strength</th></tr></thead>
          <tbody>${teammates.map(m => `<tr>
            <td><img class="thumb" src="${esc(m.photo_url)}" alt=""></td>
            <td>${esc(m.name)}</td>
            <td>#${esc(m.jersey_number)}</td>
            <td>${esc(m.jersey_size)}</td>
            <td>${esc(m.handedness)}</td>
            <td>${esc(m.strength)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`
      : '<p class="muted">No teammates have been allotted to this team yet.</p>'}`
    : '';

  el.innerHTML = details + teamBlock + mates;
}

// Staff sign-in tabs (team owner / admin). Each only changes the instructions; access is decided by the server.
document.querySelectorAll('[role="tab"]').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('[role="tab"]').forEach(t => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
    });
  });
});

async function refreshRegistrations(selector, isAdmin) {
  const el = $(selector);
  const { registrations } = await api('/registrations');
  if (isAdmin) {
    const paid = registrations.filter(r => r.payment_status === 'paid').length;
    $('#registration-counts').textContent = `Total registrations: ${registrations.length} · Paid: ${paid} · Pending: ${registrations.length - paid}`;
  }
  if (!registrations.length) {
    el.innerHTML = '<p class="muted">No registrations yet.</p>';
    return;
  }
  const teams = isAdmin ? (await api('/teams')).teams : [];
  el.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Photo</th><th>Name</th><th>Team</th><th>Jersey</th><th>Size</th>
        <th>Contact</th><th>Table</th><th>Hand</th><th>Strength</th><th>Rating</th><th>CricHeroes</th>${isAdmin ? '<th>Payment</th>' : ''}<th>Payment proof</th><th>Payment ref</th>
      </tr></thead>
      <tbody>${registrations.map(r => rowHtml(r, isAdmin, teams)).join('')}</tbody>
    </table></div>`;
}

function teamCell(r, isAdmin, teams) {
  if (!isAdmin) return esc(r.team_name) || '<span class="muted">Not assigned</span>';
  const options = ['<option value="">Not assigned</option>', ...teams.map(t =>
    `<option value="${esc(t.id)}" ${t.id === r.team_id ? 'selected' : ''}>${esc(t.name)}</option>`)];
  return `<select data-team-for="${esc(r.id)}">${options.join('')}</select>`;
}

function rowHtml(r, isAdmin, teams) {
  const next = r.payment_status === 'paid' ? 'pending' : 'paid';
  const payment = isAdmin
    ? `${paymentPill(r.payment_status)} <button class="link" data-pay="${esc(r.id)}" data-next="${next}">Mark ${next}</button>`
    : paymentPill(r.payment_status);
  const proof = r.payment_proof_url
    ? `<a href="${esc(r.payment_proof_url)}" target="_blank" rel="noopener">View</a>`
    : '<span class="pill pending">Missing</span>';
  return `<tr>
    <td><a href="${esc(r.photo_url)}" target="_blank" rel="noopener"><img class="thumb" src="${esc(r.photo_url)}" alt=""></a></td>
    <td>${esc(r.name)}</td>
    <td>${teamCell(r, isAdmin, teams)}</td>
    <td>#${esc(r.jersey_number)}</td>
    <td>${esc(r.jersey_size)}</td>
    <td>${esc(r.contact)}</td>
    <td>${esc(r.table_number)}</td>
    <td>${esc(r.handedness)}</td>
    <td>${esc(r.strength)}</td>
    <td>${esc(r.rating)} ★</td>
    <td>${r.cricheroes_url ? `<a href="${esc(r.cricheroes_url)}" target="_blank" rel="noopener">Profile</a>` : '<span class="muted">—</span>'}</td>
    ${isAdmin ? `<td>${payment}</td>` : ''}
    <td>${proof}</td>
    <td>${esc(r.payment_reference)}</td>
  </tr>`;
}

function paymentPill(status) {
  return `<span class="pill ${status === 'paid' ? 'paid' : 'pending'}">${status === 'paid' ? 'Paid' : 'Pending'}</span>`;
}

async function onTeamChange(event) {
  const select = event.target.closest('select[data-team-for]');
  if (!select) return;
  select.disabled = true;
  await api(`/registrations/${select.dataset.teamFor}/team`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team_id: select.value }),
  });
  await refreshRegistrations('#all-registrations', true);
}

async function onPaymentClick(event) {
  const button = event.target.closest('button[data-pay]');
  if (!button) return;
  button.disabled = true;
  await api(`/registrations/${button.dataset.pay}/payment`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payment_status: button.dataset.next }),
  });
  await refreshRegistrations('#all-registrations', true);
}

async function loadTeams() {
  const { teams } = await api('/teams');
  const el = $('#teams-list');
  if (!teams.length) {
    el.innerHTML = '<p class="muted">No teams yet. Add one below.</p>';
    return;
  }
  el.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Logo</th><th>Team</th><th>Owner</th><th>Owner email</th><th>Colour</th><th></th></tr></thead>
      <tbody>${teams.map(t => `<tr>
        <td><img class="thumb" src="${esc(t.logo_url || PLACEHOLDER_LOGO)}" alt=""></td>
        <td>${esc(t.name)}</td>
        <td>${esc(t.owner_name)}</td>
        <td>${esc(t.owner_email)}</td>
        <td><span class="swatch" style="background:${esc(t.primary_color || '#ffffff')}"></span></td>
        <td><button class="link" data-edit="${esc(t.id)}">Edit</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  el.onclick = event => {
    const button = event.target.closest('button[data-edit]');
    if (button) startEditTeam(teams.find(t => t.id === button.dataset.edit));
  };
}

function startEditTeam(team) {
  editingTeamId = team.id;
  teamForm.elements.name.value = team.name;
  teamForm.elements.owner_name.value = team.owner_name ?? '';
  teamForm.elements.owner_email.value = team.owner_email;
  teamForm.elements.primary_color.value = team.primary_color || '#1f6feb';
  teamForm.elements.logo.value = '';
  $('#team-form-title').textContent = `Edit ${team.name}`;
  $('#team-cancel').hidden = false;
  teamForm.scrollIntoView({ behavior: 'smooth' });
}

function resetTeamForm() {
  editingTeamId = null;
  teamForm.reset();
  teamForm.elements.primary_color.value = '#1f6feb';
  $('#team-form-title').textContent = 'Add a team';
  $('#team-cancel').hidden = true;
}

$('#team-cancel').addEventListener('click', resetTeamForm);

function showFieldErrors(root, errors) {
  root.querySelectorAll('[data-error-for]').forEach(el => (el.textContent = ''));
  for (const [field, message] of Object.entries(errors ?? {})) {
    const el = root.querySelector(`[data-error-for="${field}"]`);
    if (el) el.textContent = message;
  }
}

teamForm.addEventListener('submit', async event => {
  event.preventDefault();
  showFieldErrors(teamForm, {});
  teamStatus.className = '';
  teamStatus.textContent = 'Saving…';
  try {
    const path = editingTeamId ? `/teams/${editingTeamId}` : '/teams';
    await api(path, { method: editingTeamId ? 'PUT' : 'POST', body: new FormData(teamForm) });
    teamStatus.className = 'ok';
    teamStatus.textContent = 'Team saved.';
    resetTeamForm();
    await loadTeams();
  } catch (err) {
    teamStatus.className = 'fail';
    teamStatus.textContent = err.body?.errors ? 'Please fix the highlighted fields.' : err.message;
    showFieldErrors(teamForm, err.body?.errors);
  }
});

async function loadAdmins() {
  const { admins } = await api('/admins');
  const el = $('#admins-list');
  el.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Email</th><th>Access</th><th></th></tr></thead>
      <tbody>${admins.map(a => `<tr>
        <td>${esc(a.email)}</td>
        <td>${a.source === 'config' ? 'Configured (fixed)' : 'Added here'}</td>
        <td>${a.id ? `<button class="link" data-remove-admin="${esc(a.id)}">Remove</button>` : ''}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

async function onAdminRemove(event) {
  const button = event.target.closest('button[data-remove-admin]');
  if (!button || !confirm('Remove admin access for this person?')) return;
  button.disabled = true;
  try {
    await api(`/admins/${button.dataset.removeAdmin}`, { method: 'DELETE' });
    await loadAdmins();
  } catch (err) {
    alert(err.message);
    button.disabled = false;
  }
}

$('#admin-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $('#admin-status');
  showFieldErrors(form, {});
  status.className = '';
  status.textContent = 'Saving…';
  try {
    await api('/admins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.elements.email.value }),
    });
    status.className = 'ok';
    status.textContent = 'Admin added. They can use the dashboard after signing in with Google.';
    form.reset();
    await loadAdmins();
  } catch (err) {
    status.className = 'fail';
    status.textContent = err.body?.errors ? 'Please fix the highlighted fields.' : err.message;
    showFieldErrors(form, err.body?.errors);
  }
});

async function loadSponsorAdmin() {
  const sponsors = await loadSponsors();
  const el = $('#sponsors-admin');
  if (!sponsors.length) {
    el.innerHTML = '<p class="muted">No sponsors yet. Add one below; logos appear in the footer of every page.</p>';
    return;
  }
  el.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>Logo</th><th>Sponsor</th><th></th></tr></thead>
      <tbody>${sponsors.map(s => `<tr>
        <td><img class="thumb" src="${esc(s.logo_url)}" alt=""></td>
        <td>${esc(s.name)}</td>
        <td><button class="link" data-remove="${esc(s.id)}">Remove</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}

async function onSponsorRemove(event) {
  const button = event.target.closest('button[data-remove]');
  if (!button || !confirm('Remove this sponsor from every page?')) return;
  button.disabled = true;
  await api(`/sponsors/${button.dataset.remove}`, { method: 'DELETE' });
  await loadSponsorAdmin();
}

sponsorForm.addEventListener('submit', async event => {
  event.preventDefault();
  showFieldErrors(sponsorForm, {});
  sponsorStatus.className = '';
  sponsorStatus.textContent = 'Adding…';
  try {
    await api('/sponsors', { method: 'POST', body: new FormData(sponsorForm) });
    sponsorStatus.className = 'ok';
    sponsorStatus.textContent = 'Sponsor added.';
    sponsorForm.reset();
    await loadSponsorAdmin();
  } catch (err) {
    sponsorStatus.className = 'fail';
    sponsorStatus.textContent = err.body?.errors ? 'Please fix the highlighted fields.' : err.message;
    showFieldErrors(sponsorForm, err.body?.errors);
  }
});
