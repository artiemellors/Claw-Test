require('dotenv').config();
const { WebClient } = require('@slack/web-api');

let client;
function getClient() {
 if (!client) client = new WebClient(process.env.SLACK_BOT_TOKEN);
 return client;
}

async function postMessage({ channel, text, blocks }) {
 return getClient().chat.postMessage({ channel, text, blocks });
}

module.exports = { postMessage };