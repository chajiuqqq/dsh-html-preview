import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

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
