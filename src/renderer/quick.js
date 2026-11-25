// Quick add: shows what will be created while typing. Recognized /amount and @time get a
// soft background (a mirror layer behind the input). An unreadable time stays in the title.
const $ = (id) => document.getElementById(id);
const text = $('text');
const routine = $('routine');
const box = $('form');

function mirror(value) {
  const m = $('mirror');
  m.replaceChildren();
  const re = /(^|\s)(\/\d+(?:\.\d+)?[^\s\d@/]*|@\d{1,2}:?\d{2})(?=\s|$)/g;
  let last = 0;
  for (const match of value.matchAll(re)) {
    const start = match.index + match[1].length;
    const tok = match[2];
    if (tok.startsWith('@')) {
      const [, hh, mm] = tok.match(/@(\d{1,2}):?(\d{2})/);
      if (Number(hh) > 23 || Number(mm) > 59) continue; // not recognized → no highlight
    }
    m.append(value.slice(last, start));
    const s = document.createElement('span');
    s.className = 'tok';
    s.textContent = tok;
    m.append(s);
    last = start + tok.length;
  }
  m.append(value.slice(last));
  m.scrollLeft = text.scrollLeft;
}

function fit() {
  requestAnimationFrame(() => api.fitQuick(Math.ceil(box.getBoundingClientRect().height + 32)));
}

function preview() {
  const value = text.value;
  mirror(value);
  const p = Model.parseQuick(value);
  const has = !!value.trim();
  $('preview').hidden = !has;
  $('example').hidden = has;
  $('enter').hidden = !p.title;
  if (has) {
    $('p-title').textContent = p.title || '제목을 입력';
    const meta = [routine.checked ? '매일' : '오늘'];
    if (p.scheduledTime) meta.push(`${p.scheduledTime} 일정`);
    if (p.target) meta.push(`목표량 ${p.target}${p.unit}`);
    if (p.invalidTime) meta.push(`${p.invalidTime}은 시각으로 읽지 못해 제목에 넣음 · 00:00–23:59`);
    $('p-meta').textContent = meta.join(' · ');
    $('p-meta').classList.remove('added');
    $('enter-label').textContent = p.invalidTime ? '그대로 추가' : routine.checked ? '루틴으로 추가' : '오늘에 추가';
  }
  fit();
}

text.addEventListener('input', preview);
text.addEventListener('scroll', () => { $('mirror').scrollLeft = text.scrollLeft; });
routine.addEventListener('change', () => { preview(); text.focus(); });

box.addEventListener('submit', (e) => {
  e.preventDefault();
  const p = Model.parseQuick(text.value);
  if (!p.title) return;
  api.dispatch('task/add', { title: p.title, target: p.target, unit: p.unit, scheduledTime: p.scheduledTime, kind: routine.checked ? 'routine' : 'once' });
  $('p-meta').textContent = `추가함 · ${routine.checked ? '루틴' : '오늘'}`;
  $('p-meta').classList.add('added');
  text.value = '';
  mirror('');
  routine.checked = false;
  setTimeout(() => api.dispatch('ui/closeQuick'), 450);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.dispatch('ui/closeQuick');
});

api.onQuickOpen(() => {
  text.value = '';
  routine.checked = false;
  preview();
  text.focus();
});
preview();
