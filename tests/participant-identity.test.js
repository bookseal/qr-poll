import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceToken, exportIdentity, importIdentity, markUsed } from '../public/participant-identity.js';
function storage(values = {}) {
  const map = new Map(Object.entries(values));
  return { get length() { return map.size; }, key: i => [...map.keys()][i], getItem: k => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}
const code = '8765432';
const source = () => storage({ 'qr-poll:reaction-device': 'old-author', 'qr-poll:vote-device': 'old-voter',
  [`qr-poll:mine:${code}`]: '1,2', [`voted:${code}:p1`]: '0', 'secret-admin-key': 'never-export',
  'qr-poll:mine:1234567': '9' });
test('restores event identity, authorship and selection without exporting admin or other event data', () => {
  const data = exportIdentity(source(), code);
  assert.deepEqual(Object.keys(data.state).sort(), [`qr-poll:mine:${code}`, `voted:${code}:p1`]);
  const destination = storage({ 'qr-poll:reaction-device': 'new-other-event-author', 'qr-poll:vote-device': 'new-other-event-voter' });
  importIdentity(destination, code, data);
  assert.equal(deviceToken(destination, code, 'reaction'), 'old-author');
  assert.equal(deviceToken(destination, code, 'vote'), 'old-voter');
  assert.equal(deviceToken(destination, '1234567', 'reaction'), 'new-other-event-author');
  assert.equal(destination.getItem(`qr-poll:mine:${code}`), '1,2');
  assert.equal(destination.getItem(`voted:${code}:p1`), '0');
});
test('refuses wrong event, unexpected keys, malformed tokens and oversize data before writing', () => {
  for (const modify of [d => d.code='1234567', d => d.state['admin-key']='secret', d => d.tokens.vote={}, d => d.state[`voted:${code}:p1`]='x'.repeat(100001)]) {
    const data=exportIdentity(source(),code); modify(data); const dest=storage();
    assert.throws(() => importIdentity(dest,code,data)); assert.equal(dest.length,0);
  }
});
test('refuses to overwrite a different identity already used in the destination event', () => {
  const dest=storage({'qr-poll:reaction-device':'new-author'}); markUsed(dest,code);
  assert.throws(() => importIdentity(dest,code,exportIdentity(source(),code)),/덮어쓰지/);
  assert.equal(dest.getItem(`qr-poll:mine:${code}`),null);
  assert.equal(dest.getItem('qr-poll:reaction-device'),'new-author');
});
test('keeps pre-migration legacy identity unchanged and imports each event independently', () => {
  const old=source(); assert.equal(deviceToken(old,code,'reaction'),'old-author');
  const dest=storage(); importIdentity(dest,code,exportIdentity(old,code));
  const other=storage({'qr-poll:reaction-device':'qr-chat-author','qr-poll:vote-device':'qr-chat-voter'});
  importIdentity(dest,'1234567',exportIdentity(other,'1234567'));
  assert.equal(deviceToken(dest,code,'reaction'),'old-author');
  assert.equal(deviceToken(dest,'1234567','reaction'),'qr-chat-author');
});
