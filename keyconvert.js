const fs = require('fs');
const key = fs.readFileSync('./garments-tracker-system-sdk.json', 'utf-8');
const base64 = Buffer.from(key).toString('base64');
