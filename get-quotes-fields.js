#!/usr/bin/env node
const axios = require('axios');
const fs = require('fs/promises');
const path = require('path');
const xlsx = require('xlsx');

async function getAccessToken(credentials) {
  if (credentials.access_token && credentials.expiry_time && new Date().getTime() < credentials.expiry_time) {
    console.log('Using existing access token.');
    return credentials.access_token;
  }

  console.log('Requesting new access token...');
  const tokenUrl = 'https://accounts.zoho.com/oauth/v2/token';
  const params = new URLSearchParams();
  params.append('client_id', credentials.client_id);
  params.append('client_secret', credentials.client_secret);

  if (credentials.refresh_token) {
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', credentials.refresh_token);
  } else if (credentials.code) {
    params.append('grant_type', 'authorization_code');
    params.append('code', credentials.code);
  } else {
    throw new Error('No refresh_token or code available in self_client.json');
  }

  try {
    const response = await axios.post(tokenUrl, params);
    const { access_token, refresh_token, expires_in } = response.data;

    if (access_token) {
      // Save the new token info
      const newCredentials = { ...credentials, access_token, expiry_time: new Date().getTime() + (expires_in * 1000) };
      if (refresh_token) {
        newCredentials.refresh_token = refresh_token;
      }
      await fs.writeFile(path.join(process.cwd(), 'self_client.json'), JSON.stringify(newCredentials, null, 2));
      console.log('New access token obtained and saved.');
      return access_token;
    } else {
      throw new Error('Failed to obtain access token.');
    }
  } catch (error) {
    console.error('Error getting access token:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function getFields(accessToken, moduleName) {
  try {
    console.log(`Fetching fields for ${moduleName} module...`);
    const response = await axios.get(`https://www.zohoapis.com/crm/v2/settings/fields?module=${moduleName}`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    });

    if (response.data && response.data.fields) {
      console.log(`Successfully fetched fields for ${moduleName} module.`);
      return response.data.fields;
    } else {
      console.log(`Could not find fields in response for ${moduleName}:`, response.data);
      return [];
    }
  } catch (error) {
    console.error(`Error fetching ${moduleName} fields:`, error.response ? error.response.data : error.message);
    if (error.response && error.response.data.code === 'INVALID_TOKEN') {
        console.error('The access token is invalid. Please try running the script again to refresh the token.');
    }
    throw error;
  }
}

async function getQuotesLayout(accessToken) {
  try {
    console.log('Fetching layout for Quotes module...');
    const response = await axios.get('https://www.zohoapis.com/crm/v2/settings/layouts?module=Quotes', {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
    });

    if (response.data && response.data.layouts) {
      console.log('Successfully fetched layout for Quotes module.');
      return response.data.layouts;
    } else {
      console.log('Could not find layouts in response:', response.data);
      return [];
    }
  } catch (error) {
    console.error('Error fetching quotes layout:', error.response ? error.response.data : error.message);
    if (error.response && error.response.data.code === 'INVALID_TOKEN') {
        console.error('The access token is invalid. Please try running the script again to refresh the token.');
    }
    throw error;
  }
}

async function main() {
  try {
    const selfClientPath = path.join(process.cwd(), 'self_client.json');
    const selfClientRaw = await fs.readFile(selfClientPath, 'utf8');
    const credentials = JSON.parse(selfClientRaw);

    const accessToken = await getAccessToken(credentials);
    const fields = await getFields(accessToken, 'Quotes');
    const layouts = await getQuotesLayout(accessToken);

    if (fields.length > 0) {
        await fs.writeFile('quotes-fields.json', JSON.stringify(fields, null, 2));
        console.log('Fields saved to quotes-fields.json');
    }

    if (layouts.length > 0) {
        const fieldMap = new Map(fields.map(f => [f.api_name, f]));
        
        // Fetch subform fields and add them to the map and a separate list
        const subformFields = [];
        for (const field of fields) {
            if (field.data_type === 'subform' && field.subform?.module) {
                console.log(`Found subform: ${field.display_label} (${field.subform.module})`);
                const s_fields = await getFields(accessToken, field.subform.module);
                await fs.writeFile(`subform-${field.subform.module}-fields.json`, JSON.stringify(s_fields, null, 2));
                console.log(`Raw fields for subform ${field.subform.module} saved to subform-${field.subform.module}-fields.json`);
                field.subform.fields = s_fields; // embed subform fields
                subformFields.push({
                    name: field.display_label,
                    api_name: field.api_name,
                    module: field.subform.module,
                    fields: s_fields
                });

                // Specifically handle "Quoted Items"
                if (field.api_name === 'Product_Details') { // This is often the default API name for the first subform
                    subformFields.push({
                        name: 'Quoted Items',
                        api_name: field.api_name,
                        module: field.subform.module,
                        fields: s_fields
                    });
                }
            }
        }

        const structuredLayouts = layouts.map(layout => {
            return {
                ...layout,
                sections: layout.sections.map(section => {
                    const processedFields = section.fields.map(field => {
                        const fieldDetails = fieldMap.get(field.api_name);
                        if (fieldDetails && fieldDetails.formula && fieldDetails.formula.expression) {
                            return { ...fieldDetails, formula_expression: fieldDetails.formula.expression };
                        }
                        return fieldDetails;
                    }).filter(f => f);
                    return {
                        ...section,
                        fields: processedFields
                    };
                })
            };
        });

        await fs.writeFile('quotes-layout.json', JSON.stringify(structuredLayouts, null, 2));
        console.log('Structured layout saved to quotes-layout.json');

        const workbook = xlsx.utils.book_new();
        
        // Add main layout sheets
        structuredLayouts.forEach(layout => {
            layout.sections.forEach(section => {
                if (section.fields.length > 0) {
                    const worksheet = xlsx.utils.json_to_sheet(section.fields);
                    // Truncate sheet name if too long
                    const sheetName = section.display_label.substring(0, 31);
                    xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
                }
            });
        });

        // Add subform sheets
        subformFields.forEach(subform => {
            if (subform.fields.length > 0) {
                const processedFields = subform.fields.map(field => {
                    if (field.formula && field.formula.expression) {
                        return { ...field, formula_expression: field.formula.expression };
                    }
                    return field;
                });
                const worksheet = xlsx.utils.json_to_sheet(processedFields);
                const sheetName = `Subform-${subform.name}`.substring(0, 31);
                xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
            }
        });

        await fs.writeFile('quotes-layout.xlsx', xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
        console.log('Layout saved to quotes-layout.xlsx');
    }

  } catch (error) {
    console.error('An error occurred in main:', error.message);
    process.exit(1);
  }
}


main();
