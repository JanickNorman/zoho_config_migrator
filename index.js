require('dotenv').config();
const axios = require('axios');
const XLSX = require('xlsx');

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
  async getAllModulesWithFields(profileToRolesMap = {}) {
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
            
            // Unified list of all components with standard keys
            allItems: [
                // Fields
                ...fields.map(field => {
                    let access = "Read/Write";
                    if (field.read_only) {
                        access = "System (Read Only)";
                    } else if (field.profiles) {
                        // Map Profiles to their associated Role names
                        const accessList = field.profiles.map(p => {
                            const pName = p.name;
                            const roles = profileToRolesMap[pName];
                            if (roles && roles.size > 0) {
                                // e.g. "Standard (Sales Rep, Sales Manager)"
                                return `${pName} (${Array.from(roles).join(', ')})`; 
                            }
                            return pName;
                        });
                        access = accessList.join("; ");
                    }

                    return {
                        "Category": "Field",
                        "Field Name": field.field_label,
                        "Type of Fields": field.data_type,
                        "Value": field.default_value || field.api_name,
                        "Accessible by": access,
                        "_picklistValues": (field.data_type === 'picklist' || field.data_type === 'multiselectpicklist') ? field.pick_list_values : null
                    };
                }),
                
                // Layouts
                ...layouts.map(l => ({ 
                  "Category": "Layout",
                  "Field Name": l.name,
                  "Type of Fields": "Layout",
                  "Value": l.id,
                  "Accessible by": l.visible ? "Visible to Profiles" : "Hidden"
                })),
                
                // Blueprints
                ...blueprints.map(b => ({ 
                  "Category": "Blueprint",
                  "Field Name": b.name,
                  "Type of Fields": "Blueprint",
                  "Value": b.process_info ? b.process_info.field_value : b.id,
                  "Accessible by": "Process Owners"
                })),
                
                // Assignment Rules
                ...assignmentRules.map(r => ({ 
                  "Category": "Assignment Rule",
                  "Field Name": r.name,
                  "Type of Fields": "Assignment Rule",
                  "Value": r.id,
                  "Accessible by": "System"
                }))
            ]
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
    
    // Fetch Users first to map Profiles to Roles
    console.log('\nFetching Users to map Roles...');
    let users = [];
    let profileToRolesMap = {};
    
    try {
        users = await zoho.getUsers();
        console.log(`✓ Found ${users.length} active users`);
        
        users.forEach(u => {
            if (u.profile && u.role) {
                const pName = u.profile.name;
                const rName = u.role.name;
                if (!profileToRolesMap[pName]) {
                    profileToRolesMap[pName] = new Set();
                }
                profileToRolesMap[pName].add(rName);
            }
        });
    } catch(err) {
        console.log('⚠ Could not fetch users (Check scope ZohoCRM.users.READ)');
    }

    const modulesWithFields = await zoho.getAllModulesWithFields(profileToRolesMap);

    // Fetch Users summary for file
    console.log('\nProcessing Users summary...');
    let usersSummary = users.map(u => ({ 
        "Field Name": u.full_name, 
        "Type of Fields": "User", 
        "Value": u.email,
        "Accessible by": u.role?.name || "No Role"
    }));

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

    // ----------------------------------------
    // CSV GENERATION
    // ----------------------------------------
    console.log('\nGenerating CSV file...');
    
    // CSV Helper to handle commas and quotes safely
    const toCsv = (val) => {
        if (val === null || val === undefined) return '""';
        return `"${String(val).replace(/"/g, '""')}"`;
    };

    let csvContent = "Module,Category,Name,Type,Value/API Name,Access/Notes\n";

    // 1. Add Users
    usersSummary.forEach(user => {
        csvContent += `${toCsv("System (Users)")},${toCsv("User")},${toCsv(user["Field Name"])},${toCsv("User")},${toCsv(user["Value"])},${toCsv(user["Accessible by"])}\n`;
    });

    // 2. Add Modules and their items
    modulesWithFields.forEach(module => {
        if (module.allItems) {
            module.allItems.forEach(item => {
                csvContent += `${toCsv(module.moduleLabel)},${toCsv(item["Category"])},${toCsv(item["Field Name"])},${toCsv(item["Type of Fields"])},${toCsv(item["Value"])},${toCsv(item["Accessible by"])}\n`;
            });
        }
    });

    const csvFile = 'zoho-metadata.csv';
    fs.writeFileSync(csvFile, csvContent);
    console.log(`✓ CSV saved to: ${csvFile}`);

    // ----------------------------------------
    // EXCEL GENERATION
    // ----------------------------------------
    console.log('\nGenerating Excel file...');
    const workbook = XLSX.utils.book_new();

    // Helper to sanitize sheet names (max 31 chars, no special chars)
    const sanitizeSheetName = (name) => {
      // Replace forbidden characters with underscore and truncate to 31 chars
      return (name || "Sheet").replace(/[\\/?*[\]:]/g, '_').substring(0, 31);
    };

    // 1. Add Users Sheet
    if (usersSummary.length > 0) {
        const usersData = usersSummary.map(u => ({
            "Category": "User",
            "Name": u["Field Name"],
            "Type": "User",
            "Value/API Name": u["Value"],
            "Access/Notes": u["Accessible by"]
        }));
        const usersSheet = XLSX.utils.json_to_sheet(usersData);
        XLSX.utils.book_append_sheet(workbook, usersSheet, "System Users");
    }

    // 2. Add Module Sheets
    modulesWithFields.forEach(module => {
        if (module.allItems && module.allItems.length > 0) {
            const sheetData = [];
            module.allItems.forEach(item => {
                sheetData.push({
                    "Category": item["Category"],
                    "Name": item["Field Name"],
                    "Type": item["Type of Fields"],
                    "Value/API Name": item["Value"],
                    "Access/Notes": item["Accessible by"]
                });

                // Expand picklist options for Excel
                if (item["_picklistValues"] && Array.isArray(item["_picklistValues"])) {
                    item["_picklistValues"].forEach(opt => {
                         sheetData.push({
                            "Category": "",
                            "Name": `    ↳ ${opt.display_value}`,
                            "Type": "Option",
                            "Value/API Name": opt.actual_value,
                            "Access/Notes": ""
                         });
                    });
                }
            });
            
            const rawName = module.moduleLabel || module.moduleName;
            let uniqueSheetName = sanitizeSheetName(rawName);
            
            // Handle duplicate sheet names
            let counter = 1;
            while(workbook.SheetNames.includes(uniqueSheetName)) {
                 // Try to keep as much of the original name as possible while appending counter
                 const suffix = `_${counter}`;
                 const baseLen = 31 - suffix.length;
                 uniqueSheetName = rawName.replace(/[\\/?*[\]:]/g, '_').substring(0, baseLen) + suffix;
                 counter++;
            }
            
            const modSheet = XLSX.utils.json_to_sheet(sheetData);
            XLSX.utils.book_append_sheet(workbook, modSheet, uniqueSheetName);
        }
    });

    const excelFile = 'zoho-metadata.xlsx';
    XLSX.writeFile(workbook, excelFile);
    console.log(`✓ Excel file saved to: ${excelFile}`);

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
