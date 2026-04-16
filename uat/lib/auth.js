'use strict';

const fs   = require('fs/promises');
const path = require('path');

async function getAccessToken(CONFIG, log) {
  let creds;
  try {
    creds = JSON.parse(await fs.readFile(path.join(process.cwd(), 'self_client.json'), 'utf8'));
  } catch { throw new Error('Cannot read self_client.json'); }

  if (creds.access_token && creds.expiry_time && Date.now() < creds.expiry_time - 60000) {
    log.info('Using cached access token.'); return creds.access_token;
  }
  log.info('Requesting new access token...');
  const params = new URLSearchParams({
    client_id: creds.client_id, client_secret: creds.client_secret,
    grant_type: creds.refresh_token ? 'refresh_token' : 'authorization_code',
    ...(creds.refresh_token ? { refresh_token: creds.refresh_token } : { code: creds.code }),
  });
  const data = await (await fetch('https://accounts.zoho.com/oauth/v2/token',
    { method: 'POST', body: params })).json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  const updated = { ...creds, access_token: data.access_token,
    expiry_time: Date.now() + data.expires_in * 1000,
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}) };
  await fs.writeFile(path.join(process.cwd(), 'self_client.json'), JSON.stringify(updated, null, 2));
  log.info('New token saved.'); return data.access_token;
}

module.exports = { getAccessToken };
