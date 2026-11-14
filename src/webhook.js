import crypto from 'node:crypto';
import { config } from './config.js';

// Returns { ok: true } on success, { ok: false, error } on failure.
// Never throws — callers that fire-and-forget can ignore the return value.
export async function notifyTeamAssigned(registration, team) {
  const { url, secret } = config.callingWebhook;
  if (!url || !secret) return { ok: false, error: 'Webhook not configured' };

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = JSON.stringify({
    event: 'team.assigned',
    timestamp: new Date().toISOString(),
    registration_id: registration.id,
    player: {
      name: registration.name,
      phone: `+91${registration.contact}`,
      email: registration.email,
    },
    team: {
      id: team.id,
      name: team.name,
      owner_name: team.owner_name,
      brand_name: team.brand_name || '',
      marquee_player: team.marquee_player || '',
    },
    jersey_number: registration.jersey_number,
    table_number: registration.table_number,
  });

  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TPL-Signature': `sha256=${signature}`,
        'X-TPL-Timestamp': timestamp,
      },
      body: payload,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const msg = `Calling service returned ${res.status}`;
      console.error(`[webhook] ${msg} for registration ${registration.id}`);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[webhook] failed to notify calling service for registration ${registration.id}:`, err.message);
    return { ok: false, error: err.message };
  }
}
