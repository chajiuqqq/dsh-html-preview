import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSvgSaver, DIAGRAM_PROMPT } from './svg-host.js';

const clientSource = readFileSync(new URL('./client-source.js', import.meta.url), 'utf8');
const sliceOf = (from, to) => clientSource.slice(clientSource.indexOf(from), clientSource.indexOf(to));
const diagram = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><title>流程图</title><rect width="200" height="100"/></svg>';

// Exercise the real pure decisions without emulating React or the DOM.
const markup = new Function(sliceOf('    function previewKind', '    const CARD_STYLE') + '; return { previewKind, cardTitle };')();

test('a diagram is recognised from its content or from its fence language', () => {
  assert.equal(markup.previewKind(diagram, ''), 'svg');
  assert.equal(markup.previewKind(diagram, 'markdown'), 'svg');
  assert.equal(markup.previewKind('<h1>Page</h1>', 'html'), 'html');
  assert.equal(markup.previewKind('<?xml version="1.0"?>\n' + diagram, 'svg'), 'svg');
});
test('other code keeps its native rendering', () => {
  assert.equal(markup.previewKind('const a = 1;', 'javascript'), null);
  assert.equal(markup.previewKind('```svg\n<svg></svg>\n```', 'markdown'), null);
  assert.equal(markup.previewKind('<svgfoo>', 'svg'), 'svg');
  assert.equal(markup.previewKind('<svgfoo>', 'html'), 'html');
});
test('the card title comes from the diagram itself and never leaks markup', () => {
  assert.equal(markup.cardTitle(diagram, 'svg'), '流程图');
  assert.equal(markup.cardTitle('<h1>  A   <em>B</em>  </h1>', 'html'), 'A B');
  assert.equal(markup.cardTitle('<svg></svg>', 'svg'), 'SVG 图表');
  assert.equal(markup.cardTitle('<p></p>', 'html'), 'HTML 输出');
  assert.equal(markup.cardTitle('<title>' + 'x'.repeat(200) + '</title>', 'svg').length, 80);
});
test('the scanner targets the shipped code block markup', () => {
  assert.match(clientSource, /\.md-code-block/);
  assert.match(clientSource, /\[data-code-block-content\] pre/);
  assert.match(clientSource, /\[data-code-block-banner\]/);
});

const decode = new Function(sliceOf('    function commandResult', '    // A code block becomes a preview') + '; return commandResult;')();

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
