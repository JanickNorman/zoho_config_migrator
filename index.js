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
      console.log('✓ Access token obtained successfully');
      return this.accessToken;
    } catch (error) {
      console.error('Error getting access token:', error.response?.data || error.message);
      throw error;
    }
  }

  // Get all modules
  async getAllModules() {
    try {
      if (!this.accessToken) {
        await this.getAccessToken();
      }

      const response = await axios.get(
        `${this.apiDomain}/crm/v6/settings/modules`,
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${this.accessToken}`
          }
        }
      );

      console.log(`✓ Found ${response.data.modules.length} modules`);
      return response.data.modules;
    } catch (error) {
      console.error('Error fetching modules:', error.response?.data || error.message);
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

  // Get assignment rules
  async getAssignmentRules(moduleName) {
    try {
      if (!this.accessToken) await this.getAccessToken();
      const response = await axios.get(`${this.apiDomain}/crm/v6/settings/automation/assignment_rules`, {
        params: { module: moduleName },
        headers: { 'Authorization': `Zoho-oauthtoken ${this.accessToken}` }
      });
      return response.data.assignment_rules || [];
    } catch (error) {
       // Many modules don't have assignment rules, return empty so we don't crash
      if (error.response && error.response.status === 204) return []; 
      console.log(`Note: No assignment rules for ${moduleName} or not supported.`);
      return [];
    }
  }

  // Get Blueprints for a module
  async getBlueprints(moduleName) {
    try {
      if (!this.accessToken) await this.getAccessToken();
      const response = await axios.get(`${this.apiDomain}/crm/v6/settings/blueprints`, {
        params: { module: moduleName },
        headers: { 'Authorization': `Zoho-oauthtoken ${this.accessToken}` }
      });
      return response.data.blueprints || [];
    } catch (error) {
       // 204 means no content (no blueprints)
      if (error.response && error.response.status === 204) return [];
      console.log(`Note: No blueprints for ${moduleName} or not supported.`);
      return [];
    }
  }

  // Get Layouts (often contains rules/structure)
  async getLayouts(moduleName) {
    try {
      if (!this.accessToken) await this.getAccessToken();
      const response = await axios.get(`${this.apiDomain}/crm/v6/settings/layouts`, {
        params: { module: moduleName },
        headers: { 'Authorization': `Zoho-oauthtoken ${this.accessToken}` }
      });
      return response.data.layouts || [];
    } catch (error) {
      console.error(`Error fetching layouts for ${moduleName}:`, error.message);
      return [];
    }
  }

  // Get Users
  async getUsers(type = 'AllUsers') {
    try {
      if (!this.accessToken) await this.getAccessToken();
      const response = await axios.get(`${this.apiDomain}/crm/v6/users`, {
        params: { type },
        headers: { 'Authorization': `Zoho-oauthtoken ${this.accessToken}` }
      });
      return response.data.users || [];
    } catch (error) {
      console.error('Error fetching users:', error.message);
      throw error;
    }
  }

  // Get all modules with their fields
  async getAllModulesWithFields() {
    try {
      const modules = await this.getAllModules();
      const modulesWithFields = [];

      console.log('\nFetching fields for each module...\n');

      for (const module of modules) {
        try {
          console.log(`Processing: ${module.api_name}...`);
          
          const [fields, layouts, blueprints, assignmentRules] = await Promise.all([
            this.getModuleFields(module.api_name).catch(() => []),
            this.getLayouts(module.api_name).catch(() => []),
            this.getBlueprints(module.api_name).catch(() => []),
            this.getAssignmentRules(module.api_name).catch(() => [])
          ]);
          
          modulesWithFields.push({
            moduleName: module.api_name,
            moduleLabel: module.module_name,
            pluralLabel: module.plural_label,
            apiSupported: module.api_supported,
            
            stats: {
                fieldsCount: fields.length,
                layoutsCount: layouts.length,
                blueprintsCount: blueprints.length,
                assignmentRulesCount: assignmentRules.length
            },

            fields: fields.map(field => ({
              apiName: field.api_name,
              fieldLabel: field.field_label,
              dataType: field.data_type,
              mandatory: field.required || false,
              readOnly: field.read_only || false,
              customField: field.custom_field || false,
              visible: field.visible || false,
              length: field.length,
              picklistValues: field.pick_list_values || null
            })),
            layouts: layouts.map(l => ({ name: l.name, id: l.id, status: l.status })),
            blueprints: blueprints.map(b => ({ name: b.name, id: b.id, processInfo: b.process_info })),
            assignmentRules: assignmentRules.map(r => ({ name: r.name, id: r.id }))
          });

          console.log(`  ✓ Fields: ${fields.length}, Layouts: ${layouts.length}, Blueprints: ${blueprints.length}`);
        } catch (error) {
          console.log(`  ✗ Skipped (error fetching details): ${error.message}`);
        }
      }

      return modulesWithFields;
    } catch (error) {
      console.error('Error in getAllModulesWithFields:', error.message);
      throw error;
    }
  }
}

// Main execution
async function main() {
  try {
    console.log('='.repeat(60));
    console.log('Zoho CRM - Fetching All Modules and Fields');
    console.log('='.repeat(60));
    console.log();

    const zoho = new ZohoCRM();
    const modulesWithFields = await zoho.getAllModulesWithFields();

    // Fetch Users
    console.log('\nFetching Users...');
    let usersSummary = [];
    try {
        const users = await zoho.getUsers();
        console.log(`✓ Found ${users.length} active users`);
        usersSummary = users.map(u => ({ 
            fullName: u.full_name, 
            email: u.email, 
            id: u.id, 
            role: u.role?.name, 
            profile: u.profile?.name 
        }));
    } catch(err) {
        console.log('⚠ Could not fetch users (Check scope ZohoCRM.users.READ)');
    }

    // Save full data
    const fullData = {
        generatedAt: new Date().toISOString(),
        users: usersSummary,
        modules: modulesWithFields
    };

    const fs = require('fs');
    const outputFile = 'zoho-metadata-full.json';
    fs.writeFileSync(outputFile, JSON.stringify(fullData, null, 2));
    console.log(`\n✓ Full data saved to: ${outputFile}`);

    console.log('\n' + '='.repeat(60));
    console.log('RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total modules: ${modulesWithFields.length}\n`);

    modulesWithFields.forEach(module => {
      console.log(`\n📦 ${module.moduleName}`);
      console.log(`   Fields: ${module.stats.fieldsCount} | Layouts: ${module.stats.layoutsCount} | Blueprints: ${module.stats.blueprintsCount}`);
    });

  } catch (error) {
    console.error('\n✗ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { ZohoCRM };
