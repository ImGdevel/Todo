const $ = (sel) => document.querySelector(sel);
const card = $('#card');
const list = $('#list');
let state = null;

$('#reset').innerHTML = ICONS.reset;
$('#gear').innerHTML = ICONS.gear;
$('#lock').innerHTML = ICONS.lock;

$('#play').addEventListener('click', () => api.dispatch('timer/toggle'));
$('#reset').addEventListener('click', () => api.dispatch('timer/reset'));
$('#gear').addEventListener('click', () => api.dispatch('ui/openSettings'));

function renderList() {
  const { todos, settings, timer } = state;
  const open = todos.filter((t) => !t.done).length;
  $('#count').textContent = todos.length ? `남은 일 ${open} / ${todos.length}` : '할 일';

  // Open items first so the cap never hides unfinished work behind finished work.
  const visible = settings.showCompleted
    ? [...todos.filter((t) => !t.done), ...todos.filter((t) => t.done)]
    : todos.filter((t) => !t.done);
  const shown = visible.slice(0, settings.maxItems);

  if (!visible.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = todos.length ? '모두 완료했습니다.' : '설정 창에서 할 일을 추가하세요.';
    list.replaceChildren(empty);
  } else {
    list.replaceChildren(...shown.map((todo) => {
      const li = document.createElement('li');
      li.className = 'row';
      li.classList.toggle('done', todo.done);
      li.classList.toggle('active', timer.todoId === todo.id && timer.mode === 'focus');

      const box = document.createElement('span');
      box.className = 'box';
      box.innerHTML = ICONS.check;
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = todo.text;
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'go';
      go.title = '이 일로 집중 시작';
      go.innerHTML = ICONS.play;
      go.addEventListener('click', (e) => {
        e.stopPropagation();
        api.dispatch('timer/start', { todoId: todo.id });
      });

      li.append(box, label, go);
      li.addEventListener('click', () => api.dispatch('todo/toggle', { id: todo.id }));
      return li;
    }));
  }

  const hidden = visible.length - shown.length;
  $('#more').hidden = hidden <= 0;
  $('#more').textContent = hidden > 0 ? `+ ${hidden}개 더` : '';
}

function renderTimer() {
  const { timer, settings } = state;
  const section = $('#timer');
  section.hidden = !settings.showTimer;
  if (!settings.showTimer) return;

  const view = timerView(state);
  section.className = `timer ${timer.mode} ${timer.status}`;
  $('#mode').textContent = timer.mode === 'focus' ? '집중' : '휴식';
  $('#time').textContent = fmtClock(view.remaining);
  $('#bar').style.setProperty('width', `${Math.min(100, Math.max(0, view.progress * 100))}%`);

  const play = $('#play');
  const icon = timer.status === 'running' ? 'pause' : 'play';
  if (play.dataset.icon !== icon) {
    play.dataset.icon = icon;
    play.innerHTML = ICONS[icon];
  }
  $('#reset').hidden = timer.status === 'idle';

  const now = $('#now');
  if (timer.mode === 'focus' && view.todo) {
    const spent = fmtSpent(view.todo.spentMs + view.liveSpent);
    now.textContent = spent ? `${view.todo.text} · ${spent}` : view.todo.text;
  } else {
    now.textContent = '';
  }
}

function render() {
  if (!state) return;
  const s = state.settings;
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.style.setProperty('--alpha', String(s.opacity));
  root.style.setProperty('--scale', String(s.fontScale));
  document.body.classList.toggle('locked', s.clickThrough);
  $('#lock').hidden = !s.clickThrough;
  renderTimer();
  renderList();
}

// The window is sized to the card, so main must know the card's height.
new ResizeObserver(() => api.reportHeight(card.getBoundingClientRect().height)).observe(card);

function chime() {
  try {
    const ctx = new AudioContext();
    const at = ctx.currentTime;
    [[784, 0], [988, 0.18], [1175, 0.36]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at + delay);
      gain.gain.exponentialRampToValueAtTime(0.22, at + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + delay + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at + delay);
      osc.stop(at + delay + 0.55);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* no audio device */ }
}

api.onTimerFinished(({ sound }) => {
  if (sound) chime();
  card.classList.remove('flash');
  void card.offsetWidth; // restart the animation
  card.classList.add('flash');
});

api.onState((next) => { state = next; render(); });
api.getState().then((first) => { state = first; render(); });

setInterval(() => {
  if (state && state.timer.status === 'running') renderTimer();
}, 250);
