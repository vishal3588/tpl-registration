export const PLACEHOLDER_LOGO = 'assets/placeholders/team-logo.svg';

export const $ = (selector, root = document) => root.querySelector(selector);

export const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status, body });
  }
  return body;
}

export async function logout() {
  await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
}

// Fills the header and sponsor strip from assets/branding/branding.json, and sets the brand colour.
export async function loadBranding() {
  const branding = await fetch('assets/branding/branding.json').then(r => r.json());
  document.documentElement.style.setProperty('--brand', branding.primaryColor);
  document.title = `${branding.tournamentName} · ${document.title.split(' · ').pop()}`;
  $('#tournament-name').textContent = branding.tournamentName;
  $('#tournament-tagline').textContent = branding.tagline;
  $('#host-logos').innerHTML = branding.hostLogos
    .map(h => `<img class="logo" src="${esc(h.logo)}" alt="${esc(h.name)}" title="${esc(h.name)}">`)
    .join('');

  await Promise.all([loadSponsors(), loadTeamRail()]);
  return branding;
}

// Right rail: sponsor logos, from the API so admin changes show on every page.
export async function loadSponsors() {
  const { sponsors } = await api('/sponsors');
  const el = $('#sponsor-rail');
  if (el) {
    el.innerHTML = '<h3>Sponsors</h3>' + (sponsors.length
      ? sponsors.map(s => railItem(s.logo_url, s.name)).join('')
      : '<p class="muted">Sponsor logos will appear here.</p>');
  }
  return sponsors;
}

// Left rail: team owners' logos.
export async function loadTeamRail() {
  const { teams } = await api('/config');
  const el = $('#team-rail');
  if (el) {
    el.innerHTML = '<h3>Team owners</h3>' + (teams.length
      ? teams.map(t => railItem(t.logo_url || PLACEHOLDER_LOGO, t.name)).join('')
      : '<p class="muted">Teams will appear here.</p>');
  }
  return teams;
}

// If a logo fails to load, show the placeholder instead of a broken image.
const railItem = (src, name) =>
  `<figure class="rail-item"><img src="${esc(src)}" alt="${esc(name)}" title="${esc(name)}" onerror="this.onerror=null;this.src='${PLACEHOLDER_LOGO}'"><figcaption>${esc(name)}</figcaption></figure>`;
