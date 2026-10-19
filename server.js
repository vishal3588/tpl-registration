import { createApp } from './src/app.js';
import { config } from './src/config.js';
import { storage } from './src/storage/index.js';

await storage.init();

createApp().listen(config.port, () => {
  console.log(`Cricket registration running on port ${config.port} (storage: ${storage.name})`);
});
