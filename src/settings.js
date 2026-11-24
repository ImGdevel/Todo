const $ = (sel) => document.querySelector(sel);
const list = $('#list');
let state = null;
let dragId = null;

const el = (tag, className, html) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html) node.innerHTML = html; // only ever static icon markup
  return node;
};

// ---------- todos ----------

function renderTodos() {
  const { todos, timer } = state;
  const open = todos.filter((t) => !t.done).length;
  $('#summary').textContent = todos.length ? `남은 일 ${open} / 전체 ${todos.length}` : '';
  $('#empty').hidden = todos.length > 0;
  list.hidden = todos.length === 0;
  $('#clear-done').disabled = !todos.some((t) => t.done);

  // Do not rebuild rows under the cursor while the user is typing in one.
  if (list.contains(document.activeElement) && document.activeElement.classList.contains('text')) {
    updateRowStates();
    return;
  }

  list.replaceChildren(...todos.map((todo) => {
    const li = el('li', 'item');
    li.dataset.id = todo.id;

    const grip = el('span', 'grip', ICONS.grip);
    grip.title = '끌어서 순서 변경';
    grip.addEventListener('mousedown', () => { li.draggable = true; });

    const check = el('button', 'check', ICONS.check);
    check.type = 'button';
    check.addEventListener('click', () => api.dispatch('todo/toggle', { id: todo.id }));

    const text = el('input', 'text');
    text.type = 'text';
    text.value = todo.text;
    text.maxLength = 300;
    const commitEdit = () => {
      const value = text.value.trim();
      if (!value) text.value = todo.text;
      else if (value !== todo.text) api.dispatch('todo/edit', { id: todo.id, text: value });
    };
    text.addEventListener('blur', () => { commitEdit(); render(); });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') text.blur();
      if (e.key === 'Escape') { text.value = todo.text; text.blur(); }
    });

    const spent = el('span', 'spent');

    const go = el('button', 'icon-btn go');
    go.type = 'button';
    go.addEventListener('click', () => {
      const t = state.timer;
      if (t.todoId === todo.id && t.status === 'running' && t.mode === 'focus') api.dispatch('timer/pause');
      else api.dispatch('timer/start', { todoId: todo.id });
    });

    const del = el('button', 'icon-btn del', ICONS.trash);
    del.type = 'button';
    del.title = '삭제';
    del.addEventListener('click', () => api.dispatch('todo/remove', { id: todo.id }));

    li.append(grip, check, text, spent, go, del);

    li.addEventListener('dragstart', (e) => {
      dragId = todo.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    li.addEventListener('dragend', () => {
      dragId = null;
      li.draggable = false;
      list.querySelectorAll('.drop, .dragging').forEach((n) => n.classList.remove('drop', 'dragging'));
    });
    li.addEventListener('dragover', (e) => {
      if (!dragId || dragId === todo.id) return;
      e.preventDefault();
      li.classList.add('drop');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragId && dragId !== todo.id) api.dispatch('todo/move', { id: dragId, toId: todo.id });
    });
    return li;
  }));
  updateRowStates();
}

// Cheap per-tick update: done/active classes, spent time, play/pause icon.
function updateRowStates() {
  const { timer } = state;
  const view = timerView(state);
  for (const li of list.children) {
    const todo = state.todos.find((t) => t.id === li.dataset.id);
    if (!todo) continue;
    const active = timer.todoId === todo.id && timer.mode === 'focus';
    const running = active && timer.status === 'running';
    li.classList.toggle('done', todo.done);
    li.classList.toggle('active', active);
    li.querySelector('.spent').textContent = fmtSpent(todo.spentMs + (active ? view.liveSpent : 0));
    const go = li.querySelector('.go');
    const icon = running ? 'pause' : 'play';
    if (go.dataset.icon !== icon) {
      go.dataset.icon = icon;
      go.innerHTML = ICONS[icon];
      go.title = running ? '일시정지' : '이 일로 집중 시작';
    }
    // Keep the column so the delete buttons stay aligned.
    go.style.setProperty('visibility', todo.done ? 'hidden' : 'visible');
  }
}

$('#add').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#new');
  if (input.value.trim()) api.dispatch('todo/add', { text: input.value });
  input.value = '';
});
$('#clear-done').addEventListener('click', () => api.dispatch('todo/clearDone'));

// ---------- timer ----------

function renderTimer() {
  const { timer } = state;
  const view = timerView(state);
  $('.panel.timer').classList.toggle('break', timer.mode === 'break');
  $('#clock').textContent = fmtClock(view.remaining);
  $('#bar').style.setProperty('width', `${Math.min(100, Math.max(0, view.progress * 100))}%`);
  for (const b of $('#mode-seg').children) b.classList.toggle('on', b.dataset.mode === timer.mode);

  const play = $('#play');
  const label = timer.status === 'running' ? 'pause' : timer.status === 'paused' ? 'resume' : 'start';
  if (play.dataset.label !== label) {
    play.dataset.label = label;
    play.innerHTML = label === 'pause' ? `${ICONS.pause}일시정지` : `${ICONS.play}${label === 'resume' ? '계속' : '시작'}`;
  }
  $('#reset').disabled = timer.status === 'idle';

  const linked = $('#linked');
  if (timer.mode === 'break') linked.textContent = '휴식 중에는 할 일에 시간이 쌓이지 않습니다.';
  else if (view.todo) linked.replaceChildren('집중 대상 · ', Object.assign(document.createElement('b'), { textContent: view.todo.text }));
  else linked.textContent = '할 일 옆의 재생 버튼을 누르면 그 일에 집중 시간이 기록됩니다.';
}

$('#reset').innerHTML = ICONS.reset;
$('#play').addEventListener('click', () => api.dispatch('timer/toggle'));
$('#reset').addEventListener('click', () => api.dispatch('timer/reset'));
$('#mode-seg').addEventListener('click', (e) => {
  const mode = e.target.dataset.mode;
  if (mode && mode !== state.timer.mode) api.dispatch('timer/mode', { mode });
});

// ---------- settings ----------

const controls = [...document.querySelectorAll('[data-setting]')];

function readControl(input) {
  if (input.type === 'checkbox') return input.checked;
  if (input.dataset.setting === 'displayId') return input.value === '' ? null : Number(input.value);
  if (input.type === 'range' || input.type === 'number') return Number(input.value);
  return input.value;
}

function showOutput(input) {
  const out = input.parentElement.querySelector('output');
  if (!out) return;
  out.textContent = input.dataset.unit === '%' ? `${Math.round(Number(input.value) * 100)}%` : `${input.value}px`;
}

for (const input of controls) {
  const key = input.dataset.setting;
  // Number fields commit on change (blur/Enter) so half-typed values are not clamped mid-edit.
  const event = input.type === 'range' ? 'input' : 'change';
  input.addEventListener(event, () => {
    if (input.type === 'number' && input.value === '') return render();
    api.dispatch('settings/set', { [key]: readControl(input) });
    showOutput(input);
  });
}

$('#corners').addEventListener('click', (e) => {
  const corner = e.target.dataset.corner;
  if (corner) api.dispatch('settings/set', { corner });
});

function renderSettings() {
  const s = state.settings;

  const display = $('#display');
  const options = [['', '주 모니터 (자동)'], ...state.displays.map((d) => [String(d.id), d.label])];
  if (display.dataset.sig !== JSON.stringify(options)) {
    display.dataset.sig = JSON.stringify(options);
    display.replaceChildren(...options.map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })));
  }

  for (const input of controls) {
    if (input === document.activeElement && input.type !== 'checkbox') continue;
    const value = s[input.dataset.setting];
    if (input.type === 'checkbox') input.checked = !!value;
    else input.value = value === null ? '' : String(value);
    showOutput(input);
  }
  for (const b of $('#corners').children) b.classList.toggle('on', b.dataset.corner === s.corner);
}

function renderStatic() {
  const mac = state.platform === 'darwin';
  const pretty = (accel) => accel
    .replace('CommandOrControl', mac ? '⌘' : 'Ctrl')
    .replace('Shift', mac ? '⇧' : 'Shift')
    .split('+').join(mac ? ' ' : ' + ');
  const rows = [
    ['오버레이 표시 / 숨김', state.shortcuts.toggleOverlay],
    ['클릭 통과 켜기 / 끄기', state.shortcuts.toggleClickThrough],
    ['타이머 시작 / 일시정지', state.shortcuts.toggleTimer],
  ];
  $('#keys').replaceChildren(...rows.flatMap(([label, accel]) => {
    const dt = Object.assign(document.createElement('dt'), { textContent: label });
    const dd = document.createElement('dd');
    dd.append(Object.assign(document.createElement('kbd'), { textContent: pretty(accel) }));
    return [dt, dd];
  }));
  $('#login-note').textContent = '설치된 앱에서만 적용됩니다.';
}

// ---------- boot ----------

function render() {
  if (!state) return;
  renderTodos();
  renderTimer();
  renderSettings();
}

api.onState((next) => { state = next; render(); });
api.getState().then((first) => {
  state = first;
  renderStatic();
  render();
  $('#new').focus();
});

setInterval(() => {
  if (!state || state.timer.status !== 'running') return;
  renderTimer();
  updateRowStates();
}, 250);
