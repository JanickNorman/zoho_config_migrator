require('dotenv').config();
const axios = require('axios');
const { ZohoCRM } = require('./index.js');

async function inspectLayout() {
    const zoho = new ZohoCRM();
    const layouts = await zoho.getLayouts('Leads');
    if (layouts.length > 0) {
        console.log('Found layout:', layouts[0].name);
        console.log(JSON.stringify(layouts[0], null, 2));
    } else {
        console.log('No layouts found');
    }
}

inspectLayout();
