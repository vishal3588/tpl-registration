import crypto from 'node:crypto';
import { Router } from 'express';
import { google } from 'googleapis';
import { config } from './config.js';
import { storage } from './storage/index.js';

// Roles: admin (ADMIN_EMAILS), owner (owner_email on a team), player (any signed-in user).
const oauthClient = () =>
  new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);

export function isAllowedEmail(email) {
  return config.allowedDomains.length === 0 || config.allowedDomains.includes(email.split('@')[1] ?? '');
}

function signIn(req, user) {
  // A fresh session ID on login prevents session fixation.
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => {
      if (err) return reject(err);
      req.session.user = user;
      resolve();
    });
  });
}

export const authRouter = Router();

authRouter.get('/login', (req, res) => {
  if (!config.google.clientId) {
    return res.status(503).send('Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  }
  req.session.oauthState = crypto.randomUUID();
  // Which sign-in tab was used. Only a hint for the redirect; access is still decided by the email.
  req.session.intent = ['owner', 'admin', 'player'].includes(req.query.as) ? req.query.as : 'player';
  const url = oauthClient().generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    state: req.session.oauthState,
    prompt: 'select_account',
    // Only a hint for the account picker; the server re-checks the domain below.
    hd: config.allowedDomains.length === 1 ? config.allowedDomains[0] : undefined,
  });
  res.redirect(url);
});

authRouter.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/?auth=cancelled');
  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).send('Sign-in session expired. Please try again.');
  }

  const client = oauthClient();
  const { tokens } = await client.getToken(String(code));
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
  const { email, email_verified, name } = ticket.getPayload();

  if (!email_verified || !isAllowedEmail(email)) {
    return res.status(403).send('This Google account is not allowed. Sign in with your organisation account.');
  }
  const intent = req.session.intent ?? 'player';
  await signIn(req, { email: email.toLowerCase(), name: name || email });
  res.redirect(`/dashboard.html?as=${intent}`);
});

if (config.devLogin) {
  // Dev only: sign in with any email without Google. Enabled only when DEV_LOGIN=true.
  authRouter.post('/dev-login', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
    await signIn(req, { email, name: req.body.name || email });
    res.json({ ok: true });
  });
}

authRouter.post('/logout', (req, res, next) => {
  req.session.destroy(err => (err ? next(err) : res.json({ ok: true })));
});

export function requireUser(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Please sign in first' });
  req.user = req.session.user;
  next();
}

// Admins = ADMIN_EMAILS (fixed base, can't be removed in the app) + admins added from the dashboard.
export async function isAdmin(email) {
  if (config.adminEmails.includes(email)) return true;
  return (await storage.listAdmins()).some(a => a.email === email);
}

export async function getRoles(email) {
  const teams = await storage.listTeams();
  const ownedTeamIds = teams.filter(t => t.owner_email === email).map(t => t.id);
  const roles = ['player'];
  if (ownedTeamIds.length) roles.push('owner');
  if (await isAdmin(email)) roles.unshift('admin');
  return { roles, ownedTeamIds };
}

export function requireRole(role) {
  return async (req, res, next) => {
    const { roles } = await getRoles(req.user.email);
    if (!roles.includes(role)) return res.status(403).json({ error: 'You do not have access to this' });
    next();
  };
}
