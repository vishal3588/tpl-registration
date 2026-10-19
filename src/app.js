import path from 'node:path';
import express from 'express';
import session from 'express-session';
import multer from 'multer';
import { config } from './config.js';
import { authRouter, requireUser } from './auth.js';
import { apiRouter } from './routes.js';

export function createApp() {
  const app = express();
  // Render (and most hosts) sit behind a proxy that terminates HTTPS. Trust it so secure cookies work.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '50kb' }));
  app.use(session({
    name: 'cricreg.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.baseUrl.startsWith('https://'),
      maxAge: 8 * 60 * 60 * 1000,
    },
  }));

  app.use('/auth', authRouter);
  app.use('/api', apiRouter);
  // Logos are public (shown to every visitor). Player photos and payment proofs are only served to signed-in users.
  app.use('/uploads/logos', express.static(path.join(config.uploadsDir, 'logos')));
  app.use('/uploads/sponsors', express.static(path.join(config.uploadsDir, 'sponsors')));
  app.use('/uploads', requireUser, express.static(config.uploadsDir));
  app.use(express.static(path.join(config.root, 'public')));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message });
  });

  return app;
}
