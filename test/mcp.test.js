import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToolResult, MCP_TOOLS } from '../server/youcam/mcp.js';

test('MCP tool results are parsed from structuredContent or text JSON', () => {
  const structured = parseToolResult({ structuredContent: { result: { task_status: 'success', task_id: 't1', results: { url: 'u' } } } });
  assert.equal(structured.data.task_status, 'success');
  assert.equal(structured.data.task_id, 't1');
  const text = parseToolResult({ content: [{ type: 'text', text: JSON.stringify({ data: { task_status: 'success', results: { url: 'u2' } } }) }] });
  assert.equal(text.data.results.url, 'u2');
  const err = parseToolResult({ isError: true, content: [{ type: 'text', text: 'boom' }] });
  assert.equal(err.isError, true);
});

test('every YouCam feature the agent uses has an MCP tool mapping', () => {
  for (const f of ['skin-tone-analysis', 'makeup-vto', 'cloth-v4']) assert.ok(MCP_TOOLS[f], f);
  assert.equal(MCP_TOOLS['cloth-v4'][0], 'fashion');
});
