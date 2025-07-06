// fedapay.config.js
const { FedaPay } = require('fedapay');
require('dotenv').config();

FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY);
//FedaPay.setEnvironment(process.env.FEDAPAY_ENV || 'sandbox');
FedaPay.setEnvironment(process.env.FEDAPAY_ENV || 'live');
