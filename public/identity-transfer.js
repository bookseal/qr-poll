import { exportIdentity, importIdentity } from '/participant-identity.js';
const destination = 'https://qr-poll.futurereadycampus.com';
const sources = ['https://qr-poll.physical-spark.com', 'https://qr-chat.physical-spark.com'];
const query = new URLSearchParams(location.search);
const code = query.get('code') || '';
const status = document.getElementById('status');
const choices = document.getElementById('choices');
const back = document.getElementById('continue');
back.href = `/r/${encodeURIComponent(code)}`;
if (!/^\d{7}$/.test(code)) {
  status.textContent = '올바른 행사 주소에서 다시 시작해 주세요.';
} else if (location.pathname === '/identity/export' && sources.includes(location.origin)) {
  document.getElementById('info').textContent = '이 브라우저의 기존 참가 기록을 새 주소로 연결합니다. 관리자 정보와 로그인 쿠키는 옮기지 않습니다.';
  const openerWindow = window.opener;
  const nonce = query.get('nonce');
  if (!openerWindow || !/^[a-f0-9-]{36}$/.test(nonce || '')) {
    status.textContent = '새 주소의 “기록 가져오기” 버튼에서 다시 열어 주세요.';
  } else {
    window.addEventListener('message', event => {
      if (event.origin !== destination || event.source !== openerWindow || event.data?.type !== 'qr-identity-request' || event.data.nonce !== nonce) return;
      try {
        openerWindow.postMessage({ type: 'qr-identity-data', nonce, identity: exportIdentity(localStorage, code) }, destination);
        status.textContent = '기록을 전달했습니다. 새 주소 창으로 돌아가 주세요.';
      } catch { openerWindow.postMessage({ type: 'qr-identity-error', nonce }, destination); }
    });
    openerWindow.postMessage({ type: 'qr-identity-ready', nonce }, destination);
  }
} else if (location.pathname === '/identity/import' && location.origin === destination) {
  let popup = null, sourceOrigin = '', nonce = '', timeout;
  for (const origin of sources) {
    const button = document.createElement('button');
    button.textContent = `${new URL(origin).hostname} 기록 가져오기`;
    button.style.marginBottom = '12px';
    button.addEventListener('click', () => {
      if (popup && !popup.closed) popup.close();
      clearTimeout(timeout);
      sourceOrigin = origin;
      nonce = crypto.randomUUID();
      popup = window.open(`${origin}/identity/export?code=${encodeURIComponent(code)}&nonce=${nonce}`, '_blank', 'popup,width=560,height=520');
      status.textContent = popup ? '기존 주소에서 기록을 확인하고 있습니다…' : '팝업을 허용한 뒤 다시 눌러 주세요.';
      timeout = setTimeout(() => { status.textContent = '연결이 끝나지 않았습니다. 팝업 차단 여부를 확인하고 다시 시도해 주세요.'; }, 15000);
    });
    choices.append(button);
  }
  window.addEventListener('message', event => {
    if (!popup || event.source !== popup || event.origin !== sourceOrigin || event.data?.nonce !== nonce) return;
    if (event.data.type === 'qr-identity-ready') {
      popup.postMessage({ type: 'qr-identity-request', nonce }, sourceOrigin);
    } else if (event.data.type === 'qr-identity-data') {
      clearTimeout(timeout);
      try {
        importIdentity(localStorage, code, event.data.identity);
        status.textContent = '기록을 연결했습니다. 행사로 돌아가면 기존 본인 글과 투표를 이어서 수정할 수 있습니다.';
        choices.hidden = true;
      } catch (error) { status.textContent = error.message; }
      popup.close(); popup = null;
    } else if (event.data.type === 'qr-identity-error') {
      clearTimeout(timeout); status.textContent = '기존 주소의 브라우저 저장소를 읽을 수 없습니다. 일반 브라우저 창에서 다시 시도해 주세요.';
      popup.close(); popup = null;
    }
  });
} else {
  status.textContent = '새 주소에서 참가 기록 연결을 시작해 주세요.';
  back.href = `${destination}/identity/import?code=${encodeURIComponent(code)}`;
  back.textContent = '새 주소에서 기록 연결';
}
