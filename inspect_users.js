require('dotenv').config();
const axios = require('axios');
const { ZohoCRM } = require('./index.js');

async function inspectUsers() {
    const zoho = new ZohoCRM();
    try {
        const users = await zoho.getUsers();
        if (users.length > 0) {
            console.log('Found user:', users[0].full_name);
            console.log(JSON.stringify(users[0], null, 2));
        } else {
            console.log('No users found');
        }
    } catch (e) {
        console.error(e);
    }
}

inspectUsers();
