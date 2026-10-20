import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { config } from './config.js';
import { storage } from './storage/index.js';
import { getRoles, isAdmin, requireRole, requireUser } from './auth.js';
import {
  EMAIL_RE, IMAGE_MAX_BYTES, JERSEY_SIZES, detectImage, imageError, validateRegistration, validateSponsor, validateTeam,
} from './validation.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMAGE_MAX_BYTES, files: 2 } });
const nowIso = () => new Date().toISOString();

// Names look like "asha-rao-9876543210-photo.jpg", so files are easy to find in the Sheet and in Drive.
const fileSlug = text => text.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');

async function saveImage(file, folder, baseName = crypto.randomUUID()) {
  const { mimeType, ext } = detectImage(file.buffer);
  return storage.saveFile({ buffer: file.buffer, mimeType, folder, filename: `${baseName}.${ext}` });
}

export const apiRouter = Router();

// Drive links (old and new) are shown through this server's /api/logo route, so browsers never call Drive directly.
const DRIVE_FILE_ID = /(?:[?&]id=|\/d\/|\/folders\/)([\w-]{20,})/;
function driveId(url) {
  const match = DRIVE_FILE_ID.exec(url ?? '');
  return match && url.includes('drive.google.com') ? match[1] : null;
}
// Team and sponsor logos are public.
function logoUrl(url) {
  const id = driveId(url);
  return id ? `/api/logo/${id}` : url;
}
// Player photos and payment screenshots need sign-in and are checked per request.
function fileUrl(url) {
  const id = driveId(url);
  return id ? `/api/files/${id}` : url;
}

// Public: data needed to render the registration form.
apiRouter.get('/config', async (req, res) => {
  const teams = await storage.listTeams();
  res.json({
    jerseySizes: JERSEY_SIZES,
    teams: teams.map(({ id, name, logo_url, primary_color }) => ({ id, name, logo_url: logoUrl(logo_url), primary_color })),
  });
});

// Streams a player photo or payment screenshot stored in Drive, only to people allowed to see it:
// admins, the team's owner (photos only), the teammates on that team (photos only), and the player themselves.
apiRouter.get('/files/:id', requireUser, async (req, res) => {
  const id = req.params.id;
  const registrations = await storage.listRegistrations();
  const reg = registrations.find(r => r.photo_url?.includes(id) || r.payment_proof_url?.includes(id));
  if (!reg || !storage.downloadFile) return res.status(404).json({ error: 'File not found' });

  const { roles, ownedTeamIds } = await getRoles(req.user.email);
  const mine = registrations.find(r => r.email === req.user.email);
  const isPhoto = reg.photo_url?.includes(id);
  const allowed = roles.includes('admin')
    || reg.email === req.user.email
    || (reg.team_id && ownedTeamIds.includes(reg.team_id))
    || (isPhoto && reg.team_id && mine?.team_id === reg.team_id);
  if (!allowed) return res.status(403).json({ error: 'You do not have access to this file' });

  try {
    const { stream, mimeType } = await storage.downloadFile(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (err) {
    res.status(502).json({ error: 'File could not be loaded' });
  }
});

// Streams a team or sponsor logo stored in Drive. Only files listed as a logo are served.
apiRouter.get('/logo/:id', async (req, res) => {
  const id = req.params.id;
  const [teams, sponsors] = await Promise.all([storage.listTeams(), storage.listSponsors()]);
  const isLogo = [...teams, ...sponsors].some(item => item.logo_url?.includes(id));
  if (!isLogo || !storage.downloadFile) return res.status(404).json({ error: 'Logo not found' });
  try {
    const { stream, mimeType } = await storage.downloadFile(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (err) {
    res.status(502).json({ error: 'Logo could not be loaded' });
  }
});

// Public: sponsor logos shown in the footer of every page.
apiRouter.get('/sponsors', async (req, res) => {
  const sponsors = await storage.listSponsors();
  res.json({ sponsors: sponsors.map(s => ({ ...s, logo_url: logoUrl(s.logo_url) })) });
});

apiRouter.post('/sponsors', requireUser, requireRole('admin'), upload.single('logo'), async (req, res) => {
  const { errors, value } = validateSponsor(req.body);
  if (!req.file) errors.logo = 'Upload the sponsor logo (JPG, PNG or WEBP).';
  const logoError = imageError(req.file);
  if (logoError) errors.logo = logoError;
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const sponsor = {
    ...value,
    id: crypto.randomUUID(),
    logo_url: await saveImage(req.file, 'sponsors'),
    created_at: nowIso(),
  };
  await storage.saveSponsor(sponsor);
  res.status(201).json(sponsor);
});

apiRouter.delete('/sponsors/:id', requireUser, requireRole('admin'), async (req, res) => {
  const removed = await storage.deleteSponsor(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Sponsor not found' });
  res.status(204).end();
});

// Admin management. Configured admins (ADMIN_EMAILS) are listed but cannot be removed here.
apiRouter.get('/admins', requireUser, requireRole('admin'), async (req, res) => {
  const configured = config.adminEmails.map(email => ({ id: null, email, source: 'config' }));
  const added = (await storage.listAdmins()).map(a => ({ id: a.id, email: a.email, source: 'added' }));
  res.json({ admins: [...configured, ...added] });
});

apiRouter.post('/admins', requireUser, requireRole('admin'), async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ errors: { email: 'Enter a valid email address.' } });
  if (await isAdmin(email)) return res.status(409).json({ error: 'This person is already an admin.' });

  const admin = { id: crypto.randomUUID(), email, created_at: nowIso() };
  await storage.saveAdmin(admin);
  res.status(201).json(admin);
});

apiRouter.delete('/admins/:id', requireUser, requireRole('admin'), async (req, res) => {
  const admin = (await storage.listAdmins()).find(a => a.id === req.params.id);
  if (!admin) return res.status(404).json({ error: 'Admin not found, or it is a configured admin' });
  if (admin.email === req.user.email) return res.status(400).json({ error: 'You cannot remove your own admin access' });
  await storage.deleteAdmin(admin.id);
  res.status(204).end();
});

apiRouter.get('/me', requireUser, async (req, res) => {
  const { roles, ownedTeamIds } = await getRoles(req.user.email);
  const registration = (await storage.listRegistrations()).find(r => r.email === req.user.email) ?? null;
  res.json({ ...req.user, roles, ownedTeamIds, registration });
});

// The signed-in player's team and teammates. Teammates show only what is needed on the team sheet, never contact details.
apiRouter.get('/my-team', requireUser, async (req, res) => {
  const registrations = await storage.listRegistrations();
  const mine = registrations.find(r => r.email === req.user.email);
  if (!mine) return res.json({ registration: null, team: null, teammates: [] });

  // Only what the player entered. Payment details are not shown on the player's page.
  const registration = {
    name: mine.name,
    email: mine.email,
    contact: mine.contact,
    table_number: mine.table_number,
    jersey_size: mine.jersey_size,
    jersey_number: mine.jersey_number,
    cricheroes_url: mine.cricheroes_url,
    rating: mine.rating,
    handedness: mine.handedness,
    strength: mine.strength,
    photo_url: fileUrl(mine.photo_url),
  };
  if (!mine.team_id) return res.json({ registration, team: null, teammates: [] });

  const team = (await storage.listTeams()).find(t => t.id === mine.team_id) ?? null;
  const teammates = registrations
    .filter(r => r.team_id === mine.team_id && r.id !== mine.id)
    .sort((a, b) => a.jersey_number - b.jersey_number)
    .map(({ name, jersey_number, jersey_size, handedness, strength, photo_url }) => ({
      name, jersey_number, jersey_size, handedness, strength, photo_url: fileUrl(photo_url),
    }));
  res.json({
    registration,
    team: team && { name: team.name, owner_name: team.owner_name, owner_email: team.owner_email },
    teammates,
  });
});

// Public registration: no sign-in. One registration per email and per mobile number; changes go through an admin.
apiRouter.post('/registrations', upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'payment_proof', maxCount: 1 }]), async (req, res) => {
  const teams = await storage.listTeams();
  const registrations = await storage.listRegistrations();

  const { errors, value } = validateRegistration(req.body, teams);
  const photo = req.files?.photo?.[0];
  const paymentProof = req.files?.payment_proof?.[0];
  if (!photo) errors.photo = 'Upload a photo (JPG, PNG or WEBP, max 5 MB).';
  else if (imageError(photo)) errors.photo = imageError(photo);
  if (!paymentProof) errors.payment_proof = 'Upload a screenshot of your successful payment (JPG, PNG or WEBP, max 5 MB).';
  else if (imageError(paymentProof)) errors.payment_proof = imageError(paymentProof);

  // A transaction reference can only be used once, so one payment can't back two registrations.
  if (!errors.payment_reference && registrations.some(r => r.payment_reference === value.payment_reference)) {
    errors.payment_reference = 'This transaction reference has already been used for another registration.';
  }

  if (!errors.email && registrations.some(r => r.email === value.email)) {
    errors.email = 'This email is already registered. Contact the tournament admin to change your details.';
  }
  // Contacts are stored as 10-digit numbers, so this compares like with like.
  if (!errors.contact && registrations.some(r => r.contact === value.contact)) {
    errors.contact = 'This mobile number is already registered. Contact the tournament admin to change your details.';
  }
  // Jersey numbers only clash within a team, so the check applies once a team is assigned.
  const jerseyTaken = !errors.jersey_number && value.team_id && registrations.some(
    r => r.team_id === value.team_id && r.jersey_number === value.jersey_number,
  );
  if (jerseyTaken) errors.jersey_number = 'That jersey number is already taken in this team.';

  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const registration = {
    ...value,
    id: crypto.randomUUID(),
    created_at: nowIso(),
    updated_at: nowIso(),
    photo_url: await saveImage(photo, 'photos', `${fileSlug(value.name)}-${value.contact}-photo`),
    payment_proof_url: await saveImage(paymentProof, 'payments', `${fileSlug(value.name)}-${value.contact}-payment`),
    payment_status: 'pending',
  };
  await storage.saveRegistration(registration);
  res.status(201).json(registration);
});

// Admin assigns (or changes) the team for a registration. An empty team_id unassigns it.
apiRouter.patch('/registrations/:id/team', requireUser, requireRole('admin'), async (req, res) => {
  const existing = (await storage.listRegistrations()).find(r => r.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Registration not found' });

  const teamId = String(req.body?.team_id ?? '');
  const team = teamId ? (await storage.listTeams()).find(t => t.id === teamId) : null;
  if (teamId && !team) return res.status(400).json({ error: 'Team not found' });

  const updated = { ...existing, team_id: team?.id ?? '', team_name: team?.name ?? '', updated_at: nowIso() };
  await storage.saveRegistration(updated);
  res.json(updated);
});

// Admins see everyone; team owners see only players in their team(s); players get 403.
apiRouter.get('/registrations', requireUser, async (req, res) => {
  const { roles, ownedTeamIds } = await getRoles(req.user.email);
  if (!roles.includes('admin') && !roles.includes('owner')) {
    return res.status(403).json({ error: 'Only team owners and admins can view registrations' });
  }
  const all = await storage.listRegistrations();
  const visible = roles.includes('admin') ? all : all.filter(r => ownedTeamIds.includes(r.team_id));
  visible.sort((a, b) => a.team_name.localeCompare(b.team_name) || a.jersey_number - b.jersey_number);
  res.json({
    registrations: visible.map(r => ({ ...r, photo_url: fileUrl(r.photo_url), payment_proof_url: fileUrl(r.payment_proof_url) })),
  });
});

// Admin download of every registration as CSV (opens in Excel or Google Sheets).
const CSV_COLUMNS = [
  'created_at', 'name', 'email', 'contact', 'table_number', 'team_name', 'jersey_size', 'jersey_number',
  'handedness', 'strength', 'rating', 'cricheroes_url', 'payment_status', 'payment_reference',
  'photo_url', 'payment_proof_url',
];

// Cells starting with = + - @ are prefixed so a spreadsheet can't run them as formulas.
function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

apiRouter.get('/registrations.csv', requireUser, requireRole('admin'), async (req, res) => {
  const registrations = await storage.listRegistrations();
  const lines = [
    CSV_COLUMNS.join(','),
    ...registrations.map(r => CSV_COLUMNS.map(column => csvCell(r[column])).join(',')),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="registrations.csv"');
  res.send('\ufeff' + lines.join('\r\n'));
});

apiRouter.patch('/registrations/:id/payment', requireUser, requireRole('admin'), async (req, res) => {
  const status = req.body?.payment_status;
  if (!['pending', 'paid'].includes(status)) return res.status(400).json({ error: 'payment_status must be pending or paid' });
  const existing = (await storage.listRegistrations()).find(r => r.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Registration not found' });
  const updated = { ...existing, payment_status: status, updated_at: nowIso() };
  await storage.saveRegistration(updated);
  res.json(updated);
});

apiRouter.get('/teams', requireUser, requireRole('admin'), async (req, res) => {
  const teams = await storage.listTeams();
  res.json({ teams: teams.map(t => ({ ...t, logo_url: logoUrl(t.logo_url) })) });
});

apiRouter.post('/teams', requireUser, requireRole('admin'), upload.single('logo'), async (req, res) => {
  const { errors, value } = validateTeam(req.body);
  const logoError = imageError(req.file);
  if (logoError) errors.logo = logoError;
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const team = {
    ...value,
    id: crypto.randomUUID(),
    logo_url: req.file ? await saveImage(req.file, 'logos') : '',
    created_at: nowIso(),
  };
  await storage.saveTeam(team);
  res.status(201).json(team);
});

apiRouter.put('/teams/:id', requireUser, requireRole('admin'), upload.single('logo'), async (req, res) => {
  const existing = (await storage.listTeams()).find(t => t.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Team not found' });

  const { errors, value } = validateTeam(req.body);
  const logoError = imageError(req.file);
  if (logoError) errors.logo = logoError;
  if (Object.keys(errors).length) return res.status(400).json({ errors });

  const team = {
    ...existing,
    ...value,
    logo_url: req.file ? await saveImage(req.file, 'logos') : existing.logo_url,
  };
  await storage.saveTeam(team);
  res.json(team);
});
