// Only participant state crosses origins. Admin keys/cookies are never exported.
const CODE = /^\d{7}$/;
export function stateKey(key, code) {
  return key === `qr-poll:mine:${code}` || key === `qr-poll:chat-read:${code}` ||
    key.startsWith(`qr-poll:reacted:${code}:`) || key.startsWith(`voted:${code}:`);
}
export function deviceToken(store, code, kind) {
  const globalKey = `qr-poll:${kind}-device`;
  const scopedKey = `${globalKey}:${code}`;
  let token = store.getItem(scopedKey) || store.getItem(globalKey);
  if (!token) { token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; store.setItem(globalKey, token); }
  return token;
}
export function markUsed(store, code) { store.setItem(`qr-poll:used:${code}`, '1'); }
export function exportIdentity(store, code) {
  if (!CODE.test(code)) throw new Error('Invalid event code.');
  const state = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (stateKey(key, code)) state[key] = store.getItem(key);
  }
  const tokens = {};
  for (const kind of ['reaction', 'vote']) {
    tokens[kind] = store.getItem(`qr-poll:${kind}-device:${code}`) || store.getItem(`qr-poll:${kind}-device`) || '';
  }
  return { version: 1, code, tokens, state };
}
export function importIdentity(store, code, data) {
  if (!CODE.test(code) || data?.version !== 1 || data.code !== code ||
      !data.state || typeof data.state !== 'object' || Array.isArray(data.state) ||
      !data.tokens || typeof data.tokens !== 'object' || JSON.stringify(data).length > 100000) {
    throw new Error('참가 기록 형식을 확인할 수 없습니다.');
  }
  const entries = Object.entries(data.state);
  if (entries.some(([k, v]) => !stateKey(k, code) || typeof v !== 'string' || v.length > 20000)) {
    throw new Error('참가 기록 이외의 값은 가져올 수 없습니다.');
  }
  for (const kind of ['reaction', 'vote']) {
    if (typeof data.tokens[kind] !== 'string' || data.tokens[kind].length > 128) throw new Error('식별값 형식이 잘못되었습니다.');
  }
  if (!data.tokens.reaction && !data.tokens.vote) throw new Error('이 주소에는 기존 참가 기록이 없습니다. 다른 기존 주소를 선택해 보세요.');
  const current = exportIdentity(store, code);
  const used = store.getItem(`qr-poll:used:${code}`) || Object.keys(current.state).some(k => k !== `qr-poll:chat-read:${code}`);
  for (const kind of ['reaction', 'vote']) {
    const scoped = store.getItem(`qr-poll:${kind}-device:${code}`);
    const existing = scoped || (used ? current.tokens[kind] : '');
    if (existing && data.tokens[kind] && existing !== data.tokens[kind]) {
      throw new Error('새 주소에서 이미 다른 참가자로 이용한 행사입니다. 두 기록을 덮어쓰지 않았습니다. 기존 주소에서 계속 참여해 주세요.');
    }
  }
  const changes = new Map(entries);
  for (const kind of ['reaction', 'vote']) {
    if (data.tokens[kind]) changes.set(`qr-poll:${kind}-device:${code}`, data.tokens[kind]);
  }
  changes.set(`qr-poll:used:${code}`, '1');
  const before = new Map([...changes.keys()].map(k => [k, store.getItem(k)]));
  try { for (const [k, v] of changes) store.setItem(k, v); }
  catch (error) {
    for (const [k, v] of before) { if (v === null) store.removeItem(k); else store.setItem(k, v); }
    throw error;
  }
}
