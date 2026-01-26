# Zoho CRM - Get All Modules and Fields

This Node.js script fetches all modules and their fields from Zoho CRM using the Zoho CRM API v6.

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Edit `.env` and add your Zoho CRM credentials:

```env
ZOHO_CLIENT_ID=your_client_id_here
ZOHO_CLIENT_SECRET=your_client_secret_here
ZOHO_REFRESH_TOKEN=your_refresh_token_here
ZOHO_API_DOMAIN=https://www.zohoapis.com
```

### 3. Getting Zoho CRM Credentials

#### Step 1: Register Your Application
1. Go to [Zoho API Console](https://api-console.zoho.com/)
2. Click "Add Client"
3. Choose "Server-based Applications"
4. Enter:
   - Client Name: Your app name
   - Homepage URL: Your website or `http://localhost`
   - Authorized Redirect URIs: `http://localhost:3000/callback` (or your callback URL)
5. Click "Create"
6. Note down your **Client ID** and **Client Secret**

#### Step 2: Generate Grant Token
1. In the API Console, select your client
2. Click on "Generate Code" tab
3. Scope: Enter `ZohoCRM.modules.ALL,ZohoCRM.settings.ALL`
4. Time Duration: 5 minutes (or desired duration)
5. Scope Description: "Access CRM modules and fields"
6. Click "Create"
7. Copy the generated code (valid for the time duration you specified)

#### Step 3: Generate Refresh Token
Use this curl command (replace values):

```bash
curl -X POST https://accounts.zoho.com/oauth/v2/token \
  -d "code=YOUR_GRANT_TOKEN" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "redirect_uri=http://localhost:3000/callback" \
  -d "grant_type=authorization_code"
```

From the response, save the `refresh_token` value.

#### Step 4: Select Correct API Domain
Choose based on your Zoho CRM data center:
- **US**: `https://www.zohoapis.com`
- **EU**: `https://www.zohoapis.eu`
- **India**: `https://www.zohoapis.in`
- **Australia**: `https://www.zohoapis.com.au`
- **Japan**: `https://www.zohoapis.jp`
- **China**: `https://www.zohoapis.com.cn`

## Usage

### Run the Script

```bash
npm start
```

or

```bash
node index.js
```

### Output

The script will:
1. Authenticate with Zoho CRM
2. Fetch all available modules
3. For each module, fetch all fields
4. Display a summary in the console
5. Save complete data to `zoho-modules-fields.json`

### Example Output

```
============================================================
Zoho CRM - Fetching All Modules and Fields
============================================================

✓ Access token obtained successfully
✓ Found 42 modules

Fetching fields for each module...

Processing: Leads...
  ✓ Found 47 fields
Processing: Contacts...
  ✓ Found 38 fields
...

============================================================
RESULTS SUMMARY
============================================================
Total modules: 42

📦 Leads (Leads)
   Fields: 47
   API Supported: true
   Creatable: true, Editable: true

📦 Contacts (Contacts)
   Fields: 38
   API Supported: true
   Creatable: true, Editable: true
...

✓ Full data saved to: zoho-modules-fields.json
```

## Data Structure

The output JSON file contains:

```json
[
  {
    "moduleName": "Leads",
    "moduleLabel": "Leads",
    "pluralLabel": "Leads",
    "apiSupported": true,
    "editable": true,
    "deletable": true,
    "creatable": true,
    "fields": [
      {
        "apiName": "Email",
        "fieldLabel": "Email",
        "dataType": "email",
        "mandatory": false,
        "readOnly": false,
        "customField": false,
        "visible": true,
        "length": 100,
        "picklistValues": null
      }
    ]
  }
]
```

## Usage as a Module

You can also import and use the `ZohoCRM` class in your own code:

```javascript
const { ZohoCRM } = require('./index');

async function example() {
  const zoho = new ZohoCRM();
  
  // Get all modules
  const modules = await zoho.getAllModules();
  
  // Get fields for a specific module
  const leadFields = await zoho.getModuleFields('Leads');
  
  // Get all modules with fields
  const allData = await zoho.getAllModulesWithFields();
}
```

## API Rate Limits

Zoho CRM API has rate limits:
- Free: 5,000 API calls per day
- Paid plans: Higher limits

The script processes modules sequentially to avoid hitting rate limits.

## Troubleshooting

### Authentication Errors
- Verify your credentials in `.env`
- Check if refresh token is still valid
- Ensure correct API domain for your region

### Module Access Errors
- Some modules may require specific permissions
- Check your Zoho CRM user role has access to all modules

### API Errors
- Review error messages in console
- Check Zoho CRM API documentation for specific error codes

## References

- [Zoho CRM API Documentation](https://www.zoho.com/crm/developer/docs/api/v6/)
- [Zoho OAuth 2.0](https://www.zoho.com/crm/developer/docs/api/v6/oauth-overview.html)
- [Modules API](https://www.zoho.com/crm/developer/docs/api/v6/modules-api.html)
- [Fields API](https://www.zoho.com/crm/developer/docs/api/v6/field-meta.html)
