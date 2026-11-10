import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSvgSaver, DIAGRAM_PROMPT } from './svg-host.js';

const clientSource = readFileSync(new URL('./client-source.js', import.meta.url), 'utf8');
const { splitPreviews, inlineParts } = new Function(clientSource.slice(clientSource.indexOf('    function splitPreviews'), clientSource.indexOf('    function documentSource')) + '; return { splitPreviews, inlineParts };')();
const fenced = (kind, text) => '```' + kind + '\n' + text + '\n```';
const diagram = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><title>流程图</title><rect width="200" height="100"/></svg>';

test('multiple diagrams stay between their surrounding paragraphs in order', () => {
  const text = '前文\n\n' + fenced('svg', diagram) + '\n中间文字\n' + fenced('html', '<h1>Page</h1>') + '\n后文';
  const parts = splitPreviews(text);
  assert.deepEqual(parts.map(p => p.kind), ['markdown', 'svg', 'markdown', 'html', 'markdown']);
  assert.equal(parts[0].text, '前文\n\n');
  assert.equal(parts[1].title, '流程图');
  assert.equal(parts[2].text, '中间文字\n');
  assert.equal(parts[4].text, '后文');
});
test('pure SVG in an HTML fence and uppercase language names are detected', () => {
  assert.equal(splitPreviews(fenced('html', diagram))[0].kind, 'svg');
  assert.equal(splitPreviews(fenced('SVG', diagram))[0].kind, 'svg');
});
test('unfinished stream remains native while earlier completed diagram stays stable', () => {
  const initial = fenced('svg', diagram);
  const parts = splitPreviews(initial + '\n```svg\n<svg>');
  assert.deepEqual(parts.map(p => p.kind), ['svg', 'markdown']);
  assert.equal(parts[1].text, '```svg\n<svg>');
  assert.equal(parts[0].offset, splitPreviews(initial)[0].offset);
});
test('ordinary code and outer example fences never become previews', () => {
  for (const text of [fenced('js', 'const a = 1'), '````markdown\n' + fenced('svg', diagram) + '\n````', '    ' + fenced('svg', diagram).replaceAll('\n', '\n    '), '> ' + fenced('svg', diagram).replaceAll('\n', '\n> ')]) {
    assert.deepEqual(splitPreviews(text), [{ kind: 'markdown', text, offset: 0 }]);
  }
});
test('tilde fences, CRLF, longer closers and closing fence at EOF work', () => {
  const text = '~~~svg\r\n' + diagram + '\r\n~~~~';
  assert.equal(splitPreviews(text)[0].html, diagram);
  assert.equal(splitPreviews('````svg\n' + diagram + '\n```')[0].kind, 'markdown');
});
test('reasoning and image blocks retain identity and source data stays unchanged', () => {
  const reasoning = { kind: 'reasoning', text: 'thinking' };
  const image = { kind: 'image', attachment: {} };
  const blocks = Object.freeze([reasoning, Object.freeze({ kind: 'text', text: '前文\n' + fenced('svg', diagram) + '\n后文' }), image]);
  const parts = inlineParts(blocks);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].blocks[0], reasoning);
  assert.equal(parts[1].preview.html, diagram);
  assert.equal(parts[2].blocks[1], image);
  assert.ok(blocks[1].text.includes('```svg'));
});
test('identical repeated diagrams have distinct stable keys across stream updates', () => {
  const text = fenced('svg', diagram) + '\n' + fenced('svg', diagram);
  const parts = inlineParts([{ kind: 'text', text }]);
  assert.notEqual(parts[0].key, parts[1].key);
  const updated = inlineParts([{ kind: 'text', text: text + '\nmore' }]);
  assert.deepEqual(updated.slice(0, 2).map(p => p.key), parts.map(p => p.key));
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
