// One-time setup: lets the app store photos and uploads in YOUR Google Drive.
// Run with `npm run setup:drive`, sign in with your personal Google account, then copy the two values it prints into .env.
import 'dotenv/config';
import http from 'node:http';
import { google } from 'googleapis';

const PORT = 8080;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first (see README).');
  process.exit(1);
}

const oauth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, REDIRECT_URI);
const authUrl = oauth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // makes Google return a refresh token every time
  scope: ['https://www.googleapis.com/auth/drive.file'],
});

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.writeHead(404).end();
    return;
  }
  try {
    const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('code');
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Run the script again.');

    oauth.setCredentials(tokens);
    const drive = google.drive({ version: 'v3', auth: oauth });
    const folder = await drive.files.create({
      requestBody: { name: 'TPL Registration Uploads', mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });

    console.log('\nAdd these to .env (and to Render as environment variables):\n');
    console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`GOOGLE_DRIVE_FOLDER_ID=${folder.data.id}`);
    res.end('Done. You can close this tab and return to the terminal.');
  } catch (err) {
    console.error('Setup failed:', err.message);
    res.writeHead(500).end('Setup failed. Check the terminal.');
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log('Open this link and sign in with your personal Google account:\n');
  console.log(authUrl);
  console.log(`\nWaiting for Google to send you back to ${REDIRECT_URI} ...`);
});
