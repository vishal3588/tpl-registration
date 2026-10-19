import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const list = (value = '') => value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const dataDir = process.env.DATA_DIR || path.join(root, 'data');

export const config = {
  root,
  port: Number(process.env.PORT) || 3000,
  baseUrl,
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
  storage: process.env.STORAGE === 'google' ? 'google' : 'local',
  // Emails listed here get the Admin role. Everyone else signed in is a player; team owners are assigned per team.
  adminEmails: list(process.env.ADMIN_EMAILS),
  // Restricts Google sign-in to these email domains (e.g. "smarsh.com"). Empty = any Google account.
  allowedDomains: list(process.env.ALLOWED_EMAIL_DOMAINS),
  // Hosts accepted for the CricHeroes profile link.
  cricheroesHosts: list(process.env.CRICHEROES_HOSTS || 'cricheroes.in,cricheroes.com'),
  // Dev-only email sign-in without Google. Never enable in production.
  devLogin: process.env.DEV_LOGIN === 'true',
  dataFile: path.join(dataDir, 'db.json'),
  uploadsDir: path.join(root, 'uploads'),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: `${baseUrl}/auth/callback`,
    serviceAccountKeyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || '',
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '',
    driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
    // Drive uses your own Google account (a service account has no Drive storage). Created by `npm run setup:drive`.
    driveRefreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '',
  },
};

if (process.env.NODE_ENV === 'production' && config.sessionSecret === 'dev-only-insecure-secret') {
  throw new Error('Set SESSION_SECRET before running in production');
}

if (config.storage === 'google') {
  for (const key of ['serviceAccountKeyFile', 'spreadsheetId', 'driveFolderId', 'driveRefreshToken']) {
    if (!config.google[key]) throw new Error(`STORAGE=google requires ${key} (see .env.example)`);
  }
}
