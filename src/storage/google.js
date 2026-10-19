import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { config } from '../config.js';

// Production backend: Google Sheets for records, Google Drive for photos and logos.
// Authenticates as a service account; the spreadsheet and Drive folder must be shared with its email.

// Column order == sheet header order. Append new fields at the end only.
const SCHEMA = {
  teams: {
    tab: 'Teams',
    columns: ['id', 'name', 'owner_email', 'logo_url', 'primary_color', 'created_at', 'owner_name'],
    numeric: [],
  },
  sponsors: {
    tab: 'Sponsors',
    columns: ['id', 'name', 'logo_url', 'created_at'],
    numeric: [],
  },
  admins: {
    tab: 'Admins',
    columns: ['id', 'email', 'created_at'],
    numeric: [],
  },
  registrations: {
    tab: 'Registrations',
    columns: [
      'id', 'created_at', 'updated_at', 'email', 'name', 'contact', 'table_number', 'team_id', 'team_name',
      'jersey_size', 'jersey_number', 'cricheroes_url', 'rating', 'photo_url', 'payment_status',
      'payment_proof_url', 'handedness', 'strength', 'payment_reference',
    ],
    numeric: ['table_number', 'jersey_number', 'rating'],
  },
};

let clients;
function api() {
  if (!clients) {
    // Sheets: the service account (it has no Drive quota, but Sheets does not need any).
    const sheetsAuth = new google.auth.GoogleAuth({
      keyFile: config.google.serviceAccountKeyFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    // Drive: your own Google account, using the refresh token from `npm run setup:drive`.
    const driveAuth = new google.auth.OAuth2(config.google.clientId, config.google.clientSecret);
    driveAuth.setCredentials({ refresh_token: config.google.driveRefreshToken });
    clients = {
      sheets: google.sheets({ version: 'v4', auth: sheetsAuth }),
      drive: google.drive({ version: 'v3', auth: driveAuth }),
    };
  }
  return clients;
}

const colLetter = n => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

async function readAll(name) {
  const { tab, columns, numeric } = SCHEMA[name];
  const { data } = await api().sheets.spreadsheets.values.get({
    spreadsheetId: config.google.spreadsheetId,
    range: `${tab}!A2:${colLetter(columns.length)}`,
  });
  return (data.values ?? [])
    .map((row, i) => {
      const obj = { _row: i + 2 };
      columns.forEach((col, j) => {
        const v = row[j] ?? '';
        obj[col] = numeric.includes(col) && v !== '' ? Number(v) : v;
      });
      return obj;
    })
    .filter(obj => obj.id);
}

const stripRow = ({ _row, ...rest }) => rest;

async function upsertRow(name, item) {
  const { tab, columns } = SCHEMA[name];
  const last = colLetter(columns.length);
  const values = [columns.map(col => item[col] ?? '')];
  const existing = (await readAll(name)).find(r => r.id === item.id);
  const { sheets } = api();
  const spreadsheetId = config.google.spreadsheetId;

  // RAW keeps values as text, so a name like "=IMPORTRANGE(...)" cannot run as a formula.
  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab}!A${existing._row}:${last}${existing._row}`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tab}!A:${last}`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }
  return item;
}

// Clears the row rather than deleting it, which keeps the sheet's other row numbers stable.
async function deleteRow(name, id) {
  const row = (await readAll(name)).find(r => r.id === id);
  if (!row) return false;
  const { tab, columns } = SCHEMA[name];
  await api().sheets.spreadsheets.values.clear({
    spreadsheetId: config.google.spreadsheetId,
    range: `${tab}!A${row._row}:${colLetter(columns.length)}${row._row}`,
  });
  return true;
}

export const googleStorage = {
  name: 'Google Sheets + Drive',

  // Checks that each tab exists and writes the header row if the tab is empty.
  async init() {
    const { sheets } = api();
    for (const { tab, columns } of Object.values(SCHEMA)) {
      const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId: config.google.spreadsheetId,
        range: `${tab}!A1:${colLetter(columns.length)}1`,
      });
      if (!data.values?.length) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: config.google.spreadsheetId,
          range: `${tab}!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [columns] },
        });
      }
    }
  },

  async listTeams() {
    return (await readAll('teams')).map(stripRow);
  },

  saveTeam(team) {
    return upsertRow('teams', team);
  },

  async listSponsors() {
    return (await readAll('sponsors')).map(stripRow);
  },

  saveSponsor(sponsor) {
    return upsertRow('sponsors', sponsor);
  },

  deleteSponsor(id) {
    return deleteRow('sponsors', id);
  },

  async listAdmins() {
    return (await readAll('admins')).map(stripRow);
  },

  saveAdmin(admin) {
    return upsertRow('admins', admin);
  },

  deleteAdmin(id) {
    return deleteRow('admins', id);
  },

  async listRegistrations() {
    return (await readAll('registrations')).map(stripRow);
  },

  saveRegistration(registration) {
    return upsertRow('registrations', registration);
  },

  // Streams a file the app uploaded to Drive (used to serve logos through this server).
  async downloadFile(id) {
    const { data, headers } = await api().drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'stream' });
    return { stream: data, mimeType: headers['content-type'] || 'application/octet-stream' };
  },

  // Uploads to the configured Drive folder. Logos and sponsor logos are made public so every visitor can see them;
  // player photos and payment proofs keep the folder's sharing settings.
  async saveFile({ buffer, mimeType, folder, filename }) {
    const { drive } = api();
    const { data } = await drive.files.create({
      requestBody: { name: filename, parents: [config.google.driveFolderId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });
    if (folder === 'logos' || folder === 'sponsors') {
      await drive.permissions.create({ fileId: data.id, requestBody: { role: 'reader', type: 'anyone' }, supportsAllDrives: true });
      return `https://drive.google.com/uc?export=view&id=${data.id}`;
    }
    return data.webViewLink;
  },
};
