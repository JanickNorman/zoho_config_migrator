const axios = require('axios');

const DAP_API_URL = 'https://api.dap.id/api/v1';
const DAP_API_KEY = '5y0tOKEUErpnXjdmJF5rd1cXPuIIIY7n7WUe3h35';
const DAP_DOMAIN = 'zohocorp';
const DAP_USERNAME = 'zoho';
const DAP_PASSWORD = 'X7@pL9#qT2';

let cachedToken = null;

async function getDAPAccessToken() {
  if (cachedToken) {
    return cachedToken;
  }

  console.log('Fetching DAP access token...');

  try {
    const response = await axios.post(
      `${DAP_API_URL}/login`,
      { username: DAP_USERNAME, password: DAP_PASSWORD },
      {
        headers: {
          'X-API-KEY': DAP_API_KEY,
          'domain': DAP_DOMAIN,
          'Content-Type': 'application/json',
        },
      }
    );

    const token = response.data?.data?.access_token;
    if (!token) {
      throw new Error('No access_token in DAP login response');
    }

    console.log('DAP access token obtained.');
    cachedToken = token;
    return token;
  } catch (error) {
    console.error('Error fetching DAP access token:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    throw error;
  }
}

function clearDAPTokenCache() {
  cachedToken = null;
}

module.exports = { getDAPAccessToken, clearDAPTokenCache };
