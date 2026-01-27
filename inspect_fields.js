require('dotenv').config();
const axios = require('axios');

class ZohoCRM {
  constructor() {
    this.clientId = process.env.ZOHO_CLIENT_ID || "1000.67XECUAKDRKA9P5TXPMMNWU30BL76F";
    this.clientSecret = process.env.ZOHO_CLIENT_SECRET || "271fe200e73bcfa460c6ab52c8452cb9ef478a8f77";
    this.refreshToken = process.env.ZOHO_REFRESH_TOKEN || "1000.4a032260d3610c11b7773bc0b686ee06.3457473b957f7cbc0773604e652339dd";
    this.apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
    this.accessToken = null;
  }

  // Get access token using refresh token
  async getAccessToken() {
    try {
      const response = await axios.post(
        'https://accounts.zoho.com/oauth/v2/token',
        null,
        {
          params: {
            refresh_token: this.refreshToken,
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'refresh_token'
          }
        }
      );
      
      this.accessToken = response.data.access_token;
      return this.accessToken;
    } catch (error) {
      console.error('Error getting access token:', error.response?.data || error.message);
      throw error;
    }
  }

  // Get fields for a specific module
  async getModuleFields(moduleName) {
    try {
      if (!this.accessToken) {
        await this.getAccessToken();
      }

      const response = await axios.get(
        `${this.apiDomain}/crm/v6/settings/fields`,
        {
          params: {
            module: moduleName
          },
          headers: {
            'Authorization': `Zoho-oauthtoken ${this.accessToken}`
          }
        }
      );

      return response.data.fields;
    } catch (error) {
      console.error(`Error fetching fields for ${moduleName}:`, error.response?.data || error.message);
      throw error;
    }
  }
}

async function inspect() {
    const zoho = new ZohoCRM();
    const fields = await zoho.getModuleFields('Leads');
    const picklistField = fields.find(f => f.data_type === 'picklist');
    if (picklistField) {
        console.log('Found picklist field:', picklistField.api_name);
        console.log(JSON.stringify(picklistField, null, 2));
    } else {
        console.log('No picklist field found in Leads');
    }
}

inspect();
