const { renderBlocks } = require('../src/renderer');
const assert = require('assert');

// Section with text
(() => {
 const blocks = renderBlocks({ sections: [{ text: 'Hello world' }] });
 assert.strictEqual(blocks[0].type, 'section');
 assert.strictEqual(blocks[0].text.text, 'Hello world');
})();

// Section with fields
(() => {
 const blocks = renderBlocks({ sections: [{ fields: ['A: 1', 'B: 2'] }] });
 assert.strictEqual(blocks[0].fields.length, 2);
 assert.strictEqual(blocks[0].fields[0].type, 'mrkdwn');
})();

// Actions with buttons
(() => {
 const blocks = renderBlocks({
   actions: [
     { text: 'Go', url: 'https://x.com' },
     { text: 'Stop', actionId: 'stop', style: 'danger' }
   ]
 });
 const actions = blocks[0];
 assert.strictEqual(actions.type, 'actions');
 assert.strictEqual(actions.elements.length, 2);
 assert.strictEqual(actions.elements[0].url, 'https://x.com');
 assert.strictEqual(actions.elements[1].style, 'danger');
 assert.strictEqual(actions.elements[1].action_id, 'stop');
})();

// Context
(() => {
 const blocks = renderBlocks({ context: ['note1', 'note2'] });
 assert.strictEqual(blocks[0].type, 'context');
 assert.strictEqual(blocks[0].elements.length, 2);
})();

// Divider
(() => {
 const blocks = renderBlocks({ divider: true, sections: [{ text: 'x' }] });
 assert.ok(blocks.some(b => b.type === 'divider'));
})();

// Full message
(() => {
 const blocks = renderBlocks({
   text: 'fallback',
   sections: [{ text: 'Deploy done' }],
   actions: [{ text: 'Logs', url: 'https://logs.io' }],
   context: ['via CI'],
   divider: true
 });
 const types = blocks.map(b => b.type);
 assert.ok(types.includes('section'));
 assert.ok(types.includes('divider'));
 assert.ok(types.includes('actions'));
 assert.ok(types.includes('context'));
})();

// Empty message
(() => {
 const blocks = renderBlocks({});
 assert.strictEqual(blocks.length, 0);
})();

console.log('All tests passed.');