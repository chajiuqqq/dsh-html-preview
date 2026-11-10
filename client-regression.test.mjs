import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSvgSaver, DIAGRAM_PROMPT } from './svg-host.js';

const clientSource = readFileSync(new URL('./client-source.js', import.meta.url), 'utf8');
const extract = new Function(clientSource.slice(clientSource.indexOf('    const fence ='), clientSource.indexOf('    function documentSource')) + '; return extract;')();
const owner = text => ({ turn: { steps: [{ data: new Map([['assistant-step', { blocks: [{ kind: 'text', text }] }]]) }] } });
const fenced = (kind, text) => '```' + kind + '\n' + text + '\n```';
const diagram = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><title>流程图</title><rect width="200" height="100"/></svg>';

test('standalone SVG is identified with its title', () => {
  assert.deepEqual(extract(owner(fenced('svg', diagram))), { html: diagram, kind: 'svg', title: '流程图' });
});
test('HTML previews remain supported and pure SVG in an HTML fence is detected', () => {
  assert.equal(extract(owner(fenced('html', '<h1>Page</h1>'))).kind, 'html');
  assert.equal(extract(owner(fenced('html', diagram))).kind, 'svg');
});
test('last complete supported block wins, unfinished streamed blocks do not replace it', () => {
  const initial = fenced('html', '<p>before</p>');
  assert.equal(extract(owner(initial + '\n' + fenced('SVG', diagram))).kind, 'svg');
  assert.equal(extract(owner(initial + '\n```svg\n<svg>')).html, '<p>before</p>');
  assert.equal(extract(owner('普通回复')), null);
});
test('SVG saver rejects incomplete and oversized documents before filesystem access', async () => {
  const saver = createSvgSaver({});
  await assert.rejects(saver.save({}, { svg: '<svg>' }), /完整的 SVG/);
  await assert.rejects(saver.save({}, { svg: '<svg>' + ' '.repeat(2 * 1024 * 1024) + '</svg>' }), /2 MiB/);
});
test('SVG saver uses current scoped directory and policy without overwriting', async () => {
  let directory = '/first';
  const writes = [];
  const policy = {};
  const services = {
    workingDirectory: { get: () => directory },
    sandboxPolicy: { resolve: () => policy },
    fs: {
      resolve: async (filename, options) => `${options.cwd}/${filename}`,
      processPath: target => target,
      writeText: async (...args) => { writes.push(args); },
    },
  };
  const saver = createSvgSaver({});
  const agent = { ctx: { get: key => services[key] }, session: {} };
  await saver.save(agent, { svg: diagram, title: '../../diagram' });
  directory = '/second';
  const result = await saver.save(agent, { svg: diagram });
  assert.match(writes[0][0], /^\/first\/svg-[^/]+\.svg$/);
  assert.match(result.path, /^\/second\/svg-[^/]+\.svg$/);
  assert.deepEqual(writes[1][2], { kind: 'createIfAbsent' });
  assert.equal(writes[1][4], policy);
  assert.equal(result.bytes, Buffer.byteLength(diagram));
  assert.match(DIAGRAM_PROMPT, /Use Markdown for ordinary answers/);
});


// Exercise the real pure response decoder without emulating React or the DOM.
const source = readFileSync(new URL('./client-source.js', import.meta.url), 'utf8');
const match = source.match(/    function commandResult\(response\) \{[\s\S]*?\n    \}/);
assert.ok(match, 'response decoder exists');
const decode = new Function(`${match[0]}; return commandResult;`)();

test('successful RPC exposes the saved path inside value.result', () => {
  const result = { kind: 'success', text: '/workspace/export.html' };
  assert.equal(decode({ ok: true, value: { commandId: 'test', result } }), result);
});
test('transport rejection preserves the API error', () => {
  assert.throws(() => decode({ ok: false, error: { code: 'DENIED', message: '访问被拒绝' } }), /访问被拒绝/);
});
test('save failure preserves the command error', () => {
  assert.throws(() => decode({ ok: true, value: { result: { kind: 'error', text: '目录不可写' } } }), /目录不可写/);
});
test('unknown commands and missing responses give readable errors', () => {
  assert.throws(() => decode({ ok: true, value: undefined }), /保存命令不可用/);
  assert.throws(() => decode(undefined), /保存请求失败/);
});
