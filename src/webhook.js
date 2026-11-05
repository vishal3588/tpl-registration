import crypto from 'node:crypto';
import { config } from './config.js';

// Fires once after a team is assigned to a player. Never throws — a webhook failure
// must not fail the admin's team-assignment request.
export async function notifyTeamAssigned(registration, team) {
  const { url, secret } = config.callingWebhook;
  if (!url || !secret) return;

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
      console.error(`[webhook] calling service returned ${res.status} for registration ${registration.id}`);
    }
  } catch (err) {
    console.error(`[webhook] failed to notify calling service for registration ${registration.id}:`, err.message);
  }
}
