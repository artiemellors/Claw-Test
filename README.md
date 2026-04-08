# Slack Block Kit Agent Renderer

Renders agent messages as Slack Block Kit payloads (blocks, buttons, sections, dividers, context) and posts them via the Slack API.

## Setup

bash
npm install
cp .env.example .env
# Add your Slack bot token and channel ID to .env


## Usage

js
const { renderAndSend } = require('./src');

await renderAndSend({
  text: 'Deployment complete',
  sections: [
    { text: 'Service *api-gateway* deployed to production.' },
    { fields: ['Region: us-east-1', 'Version: 2.4.1'] }
  ],
  actions: [
    { text: 'View Logs', url: 'https://logs.example.com' },
    { text: 'Rollback', actionId: 'rollback_deploy', style: 'danger' }
  ],
  context: ['Triggered by CI/CD pipeline', 'Duration: 43s']
});


## Agent Message Format

Agents produce a simple JSON structure:

json
{
  "text": "Fallback text",
  "sections": [
    { "text": "Markdown *text*" },
    { "fields": ["Label: Value", "Label2: Value2"] }
  ],
  "actions": [
    { "text": "Click Me", "actionId": "btn_1" },
    { "text": "Open Link", "url": "https://example.com" }
  ],
  "context": ["Small note", "Another note"],
  "divider": true
}


The renderer converts this into valid Slack Block Kit JSON and posts it.

## Testing

bash
npm test