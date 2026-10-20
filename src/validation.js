import { config } from './config.js';

export const JERSEY_SIZES = ['S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const HANDEDNESS = ['Left-handed', 'Right-handed'];
export const STRENGTHS = [
  'Batsman', 'Bowler-Fast Pace', 'Bowler-Medium Pace', 'Bowler-Spinner',
  'All Rounder', 'All Rounder-Batsman', 'All Rounder-Bowler', 'Wicket Keeper',
];

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
// Indian mobile numbers: 10 digits starting 6-9, optional +91 / 91 / 0 prefix. Change for other countries.
const MOBILE_RE = /^(?:\+?91|0)?([6-9]\d{9})$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

export function parseCricheroesUrl(raw) {
  try {
    const url = new URL(String(raw ?? '').trim());
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const allowed = config.cricheroesHosts.some(h => host === h || host.endsWith(`.${h}`));
    return allowed ? url : null;
  } catch {
    return null;
  }
}

export function validateRegistration(body, teams) {
  const errors = {};

  const email = String(body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address. You will use it to sign in after team allotment.';

  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60 || !NAME_RE.test(name)) {
    errors.name = "Enter 2–60 characters: letters, spaces, '.' or '-'.";
  }

  const mobile = MOBILE_RE.exec(String(body.contact ?? '').replace(/[\s()-]/g, ''));
  if (!mobile) errors.contact = 'Enter a valid 10-digit mobile number, e.g. 9876543210 or +91 98765 43210.';

  const table = String(body.table_number ?? '').trim();
  if (!/^\d{1,4}$/.test(table) || Number(table) < 1) {
    errors.table_number = 'Table number must be a whole number from 1 to 9999.';
  }

  // Players don't pick a team; an admin assigns it later. If a team id is sent, it must match a real team.
  const team = teams.find(t => t.id === String(body.team_id ?? ''));
  if (body.team_id && !team) errors.team_id = 'Select a valid team.';

  const jerseySize = String(body.jersey_size ?? '').toUpperCase();
  if (!JERSEY_SIZES.includes(jerseySize)) errors.jersey_size = `Select one of: ${JERSEY_SIZES.join(', ')}.`;

  const jerseyNumber = String(body.jersey_number ?? '').trim();
  if (!/^\d{1,2}$/.test(jerseyNumber) || Number(jerseyNumber) > 99) {
    errors.jersey_number = 'Jersey number must be a whole number from 0 to 99.';
  }

  // The CricHeroes link is the only optional field.
  const cricheroesRaw = String(body.cricheroes_url ?? '').trim();
  const cricheroes = cricheroesRaw ? parseCricheroesUrl(cricheroesRaw) : null;
  if (cricheroesRaw && !cricheroes) {
    errors.cricheroes_url = `Enter an https link to your CricHeroes profile (${config.cricheroesHosts.join(' or ')}), or leave it empty.`;
  }

  const handedness = String(body.handedness ?? '');
  if (!HANDEDNESS.includes(handedness)) errors.handedness = 'Select left-handed or right-handed.';

  // Checkboxes arrive as one value or a list, depending on how many are ticked.
  const strengths = [...new Set([].concat(body.strength ?? []).map(String))].filter(s => STRENGTHS.includes(s));
  if (!strengths.length) errors.strength = 'Select at least one strength.';

  // UTR / UPI transaction IDs: letters and digits (usually 12 digits). Stored in upper case.
  const paymentReference = String(body.payment_reference ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,30}$/.test(paymentReference)) {
    errors.payment_reference = 'Enter the transaction reference (UTR or UPI ID) from your payment app.';
  }

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = 'Rate your own game from 1 to 5 stars.';

  return {
    errors,
    value: {
      email,
      name,
      contact: mobile?.[1] ?? '',
      table_number: Number(table) || 0,
      team_id: team?.id ?? '',
      team_name: team?.name ?? '',
      payment_proof_url: '',
      jersey_size: jerseySize,
      jersey_number: Number(jerseyNumber) || 0,
      cricheroes_url: cricheroes?.href ?? '',
      rating: rating || 0,
      handedness,
      strength: strengths.join(', '),
      payment_reference: paymentReference,
    },
  };
}

export function validateTeam(body) {
  const errors = {};
  const name = String(body.name ?? '').trim();
  if (name.length < 2 || name.length > 80) errors.name = 'Team name must be 2–80 characters.';

  const owner_email = String(body.owner_email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(owner_email)) errors.owner_email = "Enter the team owner's email address.";

  const primary_color = String(body.primary_color ?? '').trim();
  if (primary_color && !HEX_RE.test(primary_color)) errors.primary_color = 'Use a hex colour such as #1f6feb.';

  const owner_name = String(body.owner_name ?? '').trim();
  if (owner_name.length > 80) errors.owner_name = 'Owner name must be 80 characters or fewer.';

  return { errors, value: { name, owner_name, owner_email, primary_color } };
}

export function validateSponsor(body) {
  const errors = {};
  const name = String(body.name ?? '').trim();
  if (name.length < 2 || name.length > 80) errors.name = 'Sponsor name must be 2–80 characters.';
  return { errors, value: { name } };
}

// Checks the real file signature, not just the browser-supplied MIME type.
export function detectImage(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mimeType: 'image/jpeg', ext: 'jpg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', ext: 'png' };
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp', ext: 'webp' };
  }
  return null;
}

export function imageError(file) {
  if (!file) return null;
  if (file.size > IMAGE_MAX_BYTES) return 'Image must be 5 MB or smaller.';
  if (!detectImage(file.buffer)) return 'Upload a JPG, PNG or WEBP image.';
  return null;
}
