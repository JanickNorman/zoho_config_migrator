const axios = require('axios');
const fs = require('fs');

async function generateRefreshToken() {
  try {
    // Read the self_client.json file
    const credentials = JSON.parse(fs.readFileSync('self_client.json', 'utf8'));
    
    console.log('Generating refresh token from self_client.json...\n');
    
    // Generate refresh token
    const response = await axios.post(
      'https://accounts.zoho.com/oauth/v2/token',
      null,
      {
        params: {
          code: credentials.code,
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          grant_type: 'authorization_code',
          redirect_uri: 'http://localhost' // or your configured redirect URI
        }
      }
    );

    console.log('✓ Success! Tokens generated:\n');
    console.log('Access Token:', response.data.access_token);
    console.log('Refresh Token:', response.data.refresh_token);
    console.log('Expires in:', response.data.expires_in, 'seconds');
    console.log('Token Type:', response.data.token_type);
    
    // Create .env file
    const envContent = `# Zoho CRM API Configuration
ZOHO_CLIENT_ID=${credentials.client_id}
ZOHO_CLIENT_SECRET=${credentials.client_secret}
ZOHO_REFRESH_TOKEN=${response.data.refresh_token}
ZOHO_API_DOMAIN=https://www.zohoapis.com
`;

    fs.writeFileSync('.env', envContent);
    console.log('\n✓ .env file created successfully!');
    console.log('\nYou can now run: npm start');
    
    return response.data;
  } catch (error) {
    console.error('Error generating refresh token:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error:', error.response.data);
    } else {
      console.error(error.message);
    }
    
    if (error.response?.data?.error === 'invalid_code') {
      console.error('\n⚠️  The authorization code has expired or been used already.');
      console.error('Please generate a new code from Zoho API Console.');
    }
    
    process.exit(1);
  }
}

generateRefreshToken();
