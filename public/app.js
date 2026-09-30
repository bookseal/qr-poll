// 공용 헬퍼: SSE 구독 + 메시지 전송 + 👍 리액션. XSS 안전(textContent만 사용).
export const esc = encodeURIComponent;

// code의 메타+기존 메시지 로드, 이후 SSE로 신규/리액션 수신.
// onMsg(m): 메시지(초기 로드분 + 신규), onReact({id,reactions}): 리액션 갱신
export async function connect(code, { onMeta, onMsg, onReact, onVote, onDel, onRestore, onPin, onEdit, onStage, onPolls } = {}) {
  const r = await fetch(`/api/${esc(code)}`);
  if (!r.ok) {
    document.body.innerHTML = `<div class="center"><div class="card"><h1>Event not found</h1><p>We could not find event code <b>${code}</b>.</p><a href="/">← Back home</a></div></div>`;
    return;
  }
  const data = await r.json();
  onMeta?.(data);
  for (const m of data.messages) onMsg?.(m);

  // 캡처(스냅샷) 모드: 초기 렌더만 하고 SSE는 열지 않는다 (?snap 이면 페이지가 "로딩 완료"로 정착)
  if (new URLSearchParams(location.search).has("snap")) return null;

  const es = new EventSource(`/stream/${esc(code)}`);
  es.onmessage = (e) => {
    const o = JSON.parse(e.data);
    if (o.kind === "react") onReact?.(o);
    else if (o.kind === "vote") onVote?.(o);
    else if (o.kind === "del") onDel?.(o);
    else if (o.kind === "restore") onRestore?.(o);
    else if (o.kind === "pin") onPin?.(o);
    else if (o.kind === "edit") onEdit?.(o);
    else if (o.kind === "stage") onStage?.(o);
    else if (o.kind === "polls") onPolls?.(o.polls);
    else onMsg?.(o);
  };
  return es;
}

// 고정 먼저, 그다음 정렬(recent: 최신, top: 좋아요순)
export function sortMessages(list, sort) {
  const rank =
    sort === "top"
      ? (a, b) => b.reactions - a.reactions || b.ts - a.ts
      : (a, b) => b.ts - a.ts;
  return [...list].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || rank(a, b));
}

// 관리자 액션 (key는 body로 전달, 서버가 검증)
export async function adminAction(code, key, pathPart, body = {}) {
  const r = await fetch(`/admin/${esc(code)}/${pathPart}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, ...body }),
  });
  return r.ok ? r.json() : null;
}

// 보낸 메시지 id를 이 기기가 작성했다고 기억 (내 글에만 편집 버튼을 보여주기 위함)
function rememberMine(code, id) {
  const key = `qr-poll:mine:${code}`;
  const mine = new Set((localStorage.getItem(key) || "").split(",").filter(Boolean));
  mine.add(String(id));
  localStorage.setItem(key, [...mine].join(","));
}

function isMine(code, id) {
  return (localStorage.getItem(`qr-poll:mine:${code}`) || "").split(",").includes(String(id));
}

// 성공 시 저장된 메시지(id 포함)를 반환, 실패 시 null.
export async function send(code, text, pollId = "qa") {
  const r = await fetch(`/msg/${esc(code)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, pollId, token: reactionToken() }),
  });
  if (!r.ok) return null;
  const msg = await r.json();
  rememberMine(code, msg.id);
  return msg;
}

// 본인 글 수정 (작성 기기 토큰이 서버 기록과 일치해야 성공)
export async function editMessage(code, id, text) {
  const r = await fetch(`/msg/${esc(code)}/${id}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, token: reactionToken() }),
  });
  return r.ok;
}

function reactionToken() {
  const key = "qr-poll:reaction-device";
  let token = localStorage.getItem(key);
  if (!token) {
    token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, token);
  }
  return token;
}

export async function react(code, id) {
  const key = `qr-poll:reacted:${code}:${id}`;
  if (localStorage.getItem(key)) return;
  const r = await fetch(`/react/${esc(code)}/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: reactionToken() }),
  });
  if (r.ok) localStorage.setItem(key, "1");
}

// 메시지 li 생성 (텍스트 + ✏️ 편집(본인 글만) + 👍 버튼). textContent = XSS 안전.
export function buildLi(code, m) {
  const li = document.createElement("li");
  li.dataset.id = m.id;
  if (m.pinned) li.classList.add("pinned");
  const txt = document.createElement("span");
  txt.className = "txt";
  txt.textContent = m.text;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "react";
  const alreadyReacted = localStorage.getItem(`qr-poll:reacted:${code}:${m.id}`);
  if (alreadyReacted) { btn.classList.add("reacted"); btn.disabled = true; }
  btn.innerHTML = `👍 <b>${m.reactions || 0}</b>`;
  btn.onclick = async () => { await react(code, m.id); btn.classList.add("reacted"); btn.disabled = true; };
  li.append(txt);
  if (isMine(code, m.id)) li.append(editButton(li, code, m, txt));
  li.append(btn);
  return li;
}

function editButton(li, code, m, txt) {
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "edit";
  edit.textContent = "✏️";
  edit.onclick = () => startEdit(li, code, m, txt, edit);
  return edit;
}

// send()가 서버 응답(id)을 받기 전에 SSE로 내 메시지가 먼저 그려지는 경우가 있어
// (같은 요청의 broadcast가 fetch 응답보다 먼저 도착), rememberMine 직후 이미 그려진
// li에 편집 버튼을 뒤늦게 붙여준다. li가 아직 없거나 버튼이 이미 있으면 아무 일도 안 한다.
export function upgradeAuthorship(container, code, m) {
  const li = container.querySelector(`li[data-id="${m.id}"]`);
  const txt = li?.querySelector(".txt");
  if (!txt || li.querySelector(".edit")) return;
  txt.after(editButton(li, code, m, txt));
}

// 텍스트를 인라인 textarea로 바꿔 본인 글을 수정. 저장/취소 시 원래 span으로 복원.
function startEdit(li, code, m, txt, editBtn) {
  const form = document.createElement("form");
  form.className = "editform";
  const area = document.createElement("textarea");
  area.value = m.text;
  area.maxLength = 500;
  area.required = true;
  const save = document.createElement("button"); save.type = "submit"; save.textContent = "Save";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel";
  form.append(area, save, cancel);
  txt.replaceWith(form);
  editBtn.hidden = true;
  cancel.onclick = () => { form.replaceWith(txt); editBtn.hidden = false; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = area.value.trim();
    if (!text) return;
    save.disabled = true;
    const ok = await editMessage(code, m.id, text);
    save.disabled = false;
    if (!ok) return;
    m.text = text;
    txt.textContent = text;
    form.replaceWith(txt);
    editBtn.hidden = false;
  };
  area.focus();
}

// data-id 로 특정 메시지의 리액션 카운트만 갱신
export function setCount(root, id, n) {
  const b = root.querySelector(`li[data-id="${id}"] .react b`);
  if (b) b.textContent = n;
}

export async function vote(code, pollId, opt, undo = false) {
  const tokenKey = "qr-poll:vote-device";
  let token = localStorage.getItem(tokenKey);
  if (!token) {
    token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(tokenKey, token);
  }
  await fetch(`/vote/${esc(code)}/${esc(pollId)}/${opt}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, undo }),
  });
}

// poll 카드 생성. interactive=true면 옵션 클릭으로 투표(1기기 1표는 localStorage).
export function renderPoll(code, poll, interactive) {
  const wrap = document.createElement("div");
  wrap.className = "poll";
  wrap.dataset.poll = poll.id;
  const q = document.createElement("h3");
  q.textContent = poll.q; // XSS 안전
  wrap.append(q);

  if (poll.type === "text") {
    const hint = document.createElement("p");
    hint.className = "poll-hint";
    hint.textContent = interactive ? "Anonymous messages appear here." : `${poll.responseCount || 0} messages`;
    wrap.append(hint);
    return wrap;
  }

  if (poll.multi) {
    const hint = document.createElement("p");
    hint.className = "poll-hint";
    hint.textContent = "Select all that apply.";
    wrap.append(hint);
  }
  // 이 기기가 고른 옵션들 ("0,2" 형태로 저장; 옛 단일 값 "2"도 그대로 읽힘)
  const votedKey = `voted:${code}:${poll.id}`;
  const mine = new Set((localStorage.getItem(votedKey) || "").split(",").filter(Boolean));
  const paint = () => wrap.querySelectorAll(".opt").forEach((o) => {
    o.classList.toggle("mine", mine.has(o.dataset.i));
    o.classList.toggle("voted", !poll.multi && mine.size > 0);
  });

  poll.options.forEach((label, i) => {
    const row = document.createElement("div");
    row.className = "opt";
    row.dataset.i = i;
    const bar = document.createElement("div"); bar.className = "bar";
    const lab = document.createElement("span"); lab.className = "lab"; lab.textContent = label;
    const cnt = document.createElement("span"); cnt.className = "cnt"; cnt.textContent = "0";
    row.append(bar, lab, cnt);
    if (interactive) {
      row.classList.add("clickable");
      row.onclick = () => {
        const undo = mine.has(row.dataset.i);
        if (undo) mine.delete(row.dataset.i);
        else { if (!poll.multi) mine.clear(); mine.add(row.dataset.i); }
        if (mine.size) localStorage.setItem(votedKey, [...mine].join(","));
        else localStorage.removeItem(votedKey);
        paint();
        vote(code, poll.id, i, undo);
      };
    }
    wrap.append(row);
  });
  if (interactive) paint();
  updatePoll(wrap, poll.counts || []);
  return wrap;
}

export function updatePoll(wrap, counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  wrap.querySelectorAll(".opt").forEach((row) => {
    const c = counts[+row.dataset.i] || 0;
    const pct = total ? Math.round((c / total) * 100) : 0;
    row.querySelector(".bar").style.width = pct + "%";
    row.querySelector(".cnt").textContent = total ? `${c} · ${pct}%` : "0";
  });
}
