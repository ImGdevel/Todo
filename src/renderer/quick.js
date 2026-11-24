const text = document.getElementById('text');
const routine = document.getElementById('routine');
const hint = document.getElementById('hint');
const HINT = '/10쪽 목표량 · @14:30 일정 · Esc 닫기';

function preview() {
  const p = Model.parseQuick(text.value);
  const bits = [];
  if (p.target) bits.push(`목표 ${p.target}${p.unit}`);
  if (p.scheduledTime) bits.push(`${p.scheduledTime} 일정`);
  if (routine.checked) bits.push('매일 반복');
  hint.textContent = bits.length ? `→ ${p.title || '(제목 없음)'} · ${bits.join(' · ')}` : HINT;
  hint.classList.remove('ok');
}

text.addEventListener('input', preview);
routine.addEventListener('change', () => { preview(); text.focus(); });

document.getElementById('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const p = Model.parseQuick(text.value);
  if (!p.title) return;
  api.dispatch('task/add', { ...p, kind: routine.checked ? 'routine' : 'once' });
  hint.textContent = `추가함: ${p.title}`;
  hint.classList.add('ok');
  text.value = '';
  routine.checked = false;
  setTimeout(() => api.dispatch('ui/closeQuick'), 450);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.dispatch('ui/closeQuick');
});

api.onQuickOpen(() => {
  text.value = '';
  routine.checked = false;
  hint.textContent = HINT;
  hint.classList.remove('ok');
  text.focus();
});
