import { config } from '../config.js';
import { localStorage } from './local.js';
import { googleStorage } from './google.js';

export const storage = config.storage === 'google' ? googleStorage : localStorage;
