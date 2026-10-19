import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';

// Development backend: JSON file for records, local folder for uploads.
let queue = Promise.resolve();

async function load() {
  try {
    return JSON.parse(await fs.readFile(config.dataFile, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { teams: [], registrations: [], sponsors: [], admins: [] };
    throw err;
  }
}

// Serialises writes so concurrent requests cannot overwrite each other.
function mutate(fn) {
  const run = queue.then(async () => {
    const db = await load();
    const result = fn(db);
    await fs.mkdir(path.dirname(config.dataFile), { recursive: true });
    const tmp = `${config.dataFile}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2));
    await fs.rename(tmp, config.dataFile);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function upsert(list, item) {
  const i = list.findIndex(x => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
  return item;
}

export const localStorage = {
  name: 'local JSON',

  async init() {},

  async listTeams() {
    return (await load()).teams;
  },

  saveTeam(team) {
    return mutate(db => upsert(db.teams, team));
  },

  async listRegistrations() {
    return (await load()).registrations;
  },

  saveRegistration(registration) {
    return mutate(db => upsert(db.registrations, registration));
  },

  async listSponsors() {
    return (await load()).sponsors ?? [];
  },

  saveSponsor(sponsor) {
    return mutate(db => upsert((db.sponsors ??= []), sponsor));
  },

  deleteSponsor(id) {
    return mutate(db => {
      const i = (db.sponsors ??= []).findIndex(s => s.id === id);
      if (i < 0) return false;
      db.sponsors.splice(i, 1);
      return true;
    });
  },

  async listAdmins() {
    return (await load()).admins ?? [];
  },

  saveAdmin(admin) {
    return mutate(db => upsert((db.admins ??= []), admin));
  },

  deleteAdmin(id) {
    return mutate(db => {
      const i = (db.admins ??= []).findIndex(a => a.id === id);
      if (i < 0) return false;
      db.admins.splice(i, 1);
      return true;
    });
  },

  async saveFile({ buffer, folder, filename }) {
    const dir = path.join(config.uploadsDir, folder);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), buffer);
    return `/uploads/${folder}/${filename}`;
  },
};
