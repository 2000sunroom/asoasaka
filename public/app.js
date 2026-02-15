/* ========================================
   万歩計 - メインアプリケーション
   Turso API連携版
   ======================================== */

(function () {
  'use strict';

  // ========== デバイスID管理 ==========
  function getDeviceId() {
    let id = localStorage.getItem('pedometer_device_id');
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : generateUUID();
      localStorage.setItem('pedometer_device_id', id);
    }
    return id;
  }

  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  const DEVICE_ID = getDeviceId();

  // ========== API通信 ==========
  const API = {
    async get(path, params = {}) {
      const qs = new URLSearchParams({ deviceId: DEVICE_ID, ...params }).toString();
      try {
        const res = await fetch(`/api/${path}?${qs}`);
        return await res.json();
      } catch (e) {
        console.warn('API GET failed:', path, e);
        return null;
      }
    },
    async post(path, body = {}) {
      try {
        const res = await fetch(`/api/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: DEVICE_ID, ...body }),
        });
        return await res.json();
      } catch (e) {
        console.warn('API POST failed:', path, e);
        return null;
      }
    },
  };

  // ========== 状態 ==========
  const state = {
    steps: 0,
    goal: 8000,
    stride: 70,
    weight: 60,
    sensitivity: 12,
    isCounting: false,
    startTime: null,
    currentPeriod: 'week',
  };

  // ローカルキャッシュ（オフライン時のフォールバック）
  const LOCAL_KEYS = {
    STEPS: 'ped_steps',
    GOAL: 'ped_goal',
    STRIDE: 'ped_stride',
    WEIGHT: 'ped_weight',
    SENSITIVITY: 'ped_sensitivity',
    IS_COUNTING: 'ped_counting',
    START_TIME: 'ped_start_time',
  };

  // 加速度計のステップ検出用
  let lastAcceleration = 0;
  let lastStepTime = 0;
  const MIN_STEP_INTERVAL = 250;
  let syncTimer = null;
  let dirty = false;

  // ========== DOM要素 ==========
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const DOM = {
    stepCount: $('#step-count'),
    calories: $('#calories'),
    distance: $('#distance'),
    walkTime: $('#walk-time'),
    goalBar: $('#goal-bar'),
    goalText: $('#goal-text'),
    progressFill: $('.progress-ring-fill'),
    btnStart: $('#btn-start'),
    btnStop: $('#btn-stop'),
    pages: $$('.page'),
    navItems: $$('.nav-item'),
    tabs: $$('.tab'),
    summaryTotal: $('#summary-total'),
    summaryAvg: $('#summary-avg'),
    summaryAchieved: $('#summary-achieved'),
    historyList: $('#history-list'),
    historyChart: $('#history-chart'),
    goalInput: $('#goal-input'),
    strideInput: $('#stride-input'),
    weightInput: $('#weight-input'),
    sensitivityInput: $('#sensitivity-input'),
    sensitivityValue: $('#sensitivity-value'),
    btnSaveGoal: $('#btn-save-goal'),
    btnSavePersonal: $('#btn-save-personal'),
    btnReset: $('#btn-reset'),
    modalOverlay: $('#modal-overlay'),
    modalMessage: $('#modal-message'),
    modalConfirm: $('#modal-confirm'),
    modalCancel: $('#modal-cancel'),
    toast: $('#toast'),
  };

  // ========== 初期化 ==========
  async function init() {
    loadLocalState();
    bindEvents();
    updateUI();

    // サーバーから設定を読み込み
    await loadSettingsFromServer();
    // 今日の歩数を読み込み
    await loadTodayFromServer();

    if (state.isCounting) {
      startCounting(true);
    }

    // 定期同期（30秒ごと）
    syncTimer = setInterval(syncToServer, 30000);
  }

  // ========== ローカルステート ==========
  function loadLocalState() {
    state.steps = parseInt(localStorage.getItem(LOCAL_KEYS.STEPS)) || 0;
    state.goal = parseInt(localStorage.getItem(LOCAL_KEYS.GOAL)) || 8000;
    state.stride = parseInt(localStorage.getItem(LOCAL_KEYS.STRIDE)) || 70;
    state.weight = parseInt(localStorage.getItem(LOCAL_KEYS.WEIGHT)) || 60;
    state.sensitivity = parseInt(localStorage.getItem(LOCAL_KEYS.SENSITIVITY)) || 12;
    state.isCounting = localStorage.getItem(LOCAL_KEYS.IS_COUNTING) === 'true';
    state.startTime = localStorage.getItem(LOCAL_KEYS.START_TIME)
      ? parseInt(localStorage.getItem(LOCAL_KEYS.START_TIME))
      : null;

    DOM.goalInput.value = state.goal;
    DOM.strideInput.value = state.stride;
    DOM.weightInput.value = state.weight;
    DOM.sensitivityInput.value = state.sensitivity;
    DOM.sensitivityValue.textContent = state.sensitivity;
  }

  function saveLocalState() {
    localStorage.setItem(LOCAL_KEYS.STEPS, state.steps);
    localStorage.setItem(LOCAL_KEYS.GOAL, state.goal);
    localStorage.setItem(LOCAL_KEYS.STRIDE, state.stride);
    localStorage.setItem(LOCAL_KEYS.WEIGHT, state.weight);
    localStorage.setItem(LOCAL_KEYS.SENSITIVITY, state.sensitivity);
    localStorage.setItem(LOCAL_KEYS.IS_COUNTING, state.isCounting);
    if (state.startTime) {
      localStorage.setItem(LOCAL_KEYS.START_TIME, state.startTime);
    }
  }

  // ========== サーバー連携 ==========
  async function loadSettingsFromServer() {
    const data = await API.get('settings');
    if (data && !data.error) {
      state.goal = data.goal || 8000;
      state.stride = data.stride || 70;
      state.weight = data.weight || 60;
      state.sensitivity = data.sensitivity || 12;

      DOM.goalInput.value = state.goal;
      DOM.strideInput.value = state.stride;
      DOM.weightInput.value = state.weight;
      DOM.sensitivityInput.value = state.sensitivity;
      DOM.sensitivityValue.textContent = state.sensitivity;

      saveLocalState();
      updateUI();
    }
  }

  async function loadTodayFromServer() {
    const data = await API.get('steps', { date: getTodayStr() });
    if (data && !data.error) {
      // サーバーの値がローカルより大きい場合はサーバーを採用
      if ((data.steps || 0) > state.steps) {
        state.steps = data.steps;
        saveLocalState();
        updateUI();
      }
    }
  }

  async function syncToServer() {
    if (!dirty && state.steps === 0) return;

    await API.post('steps', {
      date: getTodayStr(),
      steps: state.steps,
      goal: state.goal,
    });
    dirty = false;
  }

  // ========== 日付ヘルパー ==========
  function getTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ========== イベントバインド ==========
  function bindEvents() {
    // ナビゲーション
    DOM.navItems.forEach(item => {
      item.addEventListener('click', () => switchPage(item.dataset.page));
    });

    // タブ切り替え
    DOM.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        DOM.tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.currentPeriod = tab.dataset.period;
        updateHistoryPage();
      });
    });

    // 計測ボタン
    DOM.btnStart.addEventListener('click', () => startCounting(false));
    DOM.btnStop.addEventListener('click', stopCounting);

    // 設定保存
    DOM.btnSaveGoal.addEventListener('click', saveGoalSetting);
    DOM.btnSavePersonal.addEventListener('click', savePersonalSetting);

    // 感度スライダー
    DOM.sensitivityInput.addEventListener('input', () => {
      DOM.sensitivityValue.textContent = DOM.sensitivityInput.value;
      state.sensitivity = parseInt(DOM.sensitivityInput.value);
      saveLocalState();
    });

    // データリセット
    DOM.btnReset.addEventListener('click', () => {
      showModal('すべてのデータをリセットしますか？\nこの操作は取り消せません。', () => {
        resetAllData();
        showToast('データをリセットしました');
      });
    });

    DOM.modalCancel.addEventListener('click', hideModal);

    // ページ離脱時に同期
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        syncToServer();
      }
    });

    window.addEventListener('beforeunload', () => {
      syncToServer();
    });
  }

  // ========== ページ切り替え ==========
  function switchPage(pageName) {
    DOM.pages.forEach(p => p.classList.remove('active'));
    DOM.navItems.forEach(n => n.classList.remove('active'));
    $(`#page-${pageName}`).classList.add('active');
    $(`.nav-item[data-page="${pageName}"]`).classList.add('active');

    if (pageName === 'history') {
      updateHistoryPage();
    }
  }

  // ========== 歩数計測 ==========
  let isResumeCall = false;

  function startCounting(isResume) {
    isResumeCall = isResume;
    if (!isResume && typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission()
        .then(permission => {
          if (permission === 'granted') {
            beginCounting();
          } else {
            showToast('加速度センサーの許可が必要です');
          }
        })
        .catch(() => showToast('センサーへのアクセスに失敗しました'));
    } else {
      beginCounting();
    }
  }

  function beginCounting() {
    state.isCounting = true;
    if (!state.startTime) {
      state.startTime = Date.now();
    }
    saveLocalState();

    window.addEventListener('devicemotion', handleMotion);

    DOM.btnStart.style.display = 'none';
    DOM.btnStop.style.display = 'inline-flex';

    if (!state._timerInterval) {
      state._timerInterval = setInterval(updateWalkTime, 10000);
    }

    if (!isResumeCall) {
      showToast('計測を開始しました');
    }
  }

  function stopCounting() {
    state.isCounting = false;
    state.startTime = null;
    saveLocalState();

    window.removeEventListener('devicemotion', handleMotion);

    DOM.btnStart.style.display = 'inline-flex';
    DOM.btnStop.style.display = 'none';

    if (state._timerInterval) {
      clearInterval(state._timerInterval);
      state._timerInterval = null;
    }

    syncToServer();
    showToast('計測を停止しました');
  }

  function handleMotion(event) {
    const acc = event.accelerationIncludingGravity;
    if (!acc) return;

    const x = acc.x || 0;
    const y = acc.y || 0;
    const z = acc.z || 0;
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    const now = Date.now();

    if (Math.abs(magnitude - lastAcceleration) > state.sensitivity && now - lastStepTime > MIN_STEP_INTERVAL) {
      state.steps++;
      lastStepTime = now;
      dirty = true;
      saveLocalState();
      updateUI();
    }

    lastAcceleration = magnitude;
  }

  // ========== UI更新 ==========
  function updateUI() {
    DOM.stepCount.textContent = state.steps.toLocaleString();

    // プログレスリング
    const progress = Math.min(state.steps / state.goal, 1);
    const circumference = 2 * Math.PI * 88;
    DOM.progressFill.style.strokeDasharray = circumference;
    DOM.progressFill.style.strokeDashoffset = circumference * (1 - progress);

    // 目標バー
    const barPercent = Math.min((state.steps / state.goal) * 100, 100);
    DOM.goalBar.style.width = barPercent + '%';
    DOM.goalBar.classList.toggle('achieved', state.steps >= state.goal);
    DOM.goalText.textContent = `目標: ${state.steps.toLocaleString()} / ${state.goal.toLocaleString()} 歩`;

    // カロリー
    DOM.calories.textContent = Math.round(state.steps * 0.03 * state.weight / 60).toLocaleString();

    // 距離
    DOM.distance.textContent = (state.steps * state.stride / 100000).toFixed(1);

    updateWalkTime();
  }

  function updateWalkTime() {
    if (state.startTime && state.isCounting) {
      DOM.walkTime.textContent = Math.round((Date.now() - state.startTime) / 60000);
    }
  }

  // ========== 履歴ページ ==========
  async function updateHistoryPage() {
    const days = state.currentPeriod === 'week' ? 7 : 30;

    // サーバーから履歴取得
    const result = await API.get('history', { days });
    const serverHistory = result && result.history ? result.history : [];

    // 日付ごとのマップを作成
    const dataMap = {};
    serverHistory.forEach(h => {
      dataMap[h.date] = { steps: h.steps, goal: h.goal };
    });

    // 今日のデータを含むdays分のデータを生成
    const data = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = formatDateStr(d);

      if (i === 0) {
        data.push({ date: dateStr, steps: state.steps, goal: state.goal });
      } else if (dataMap[dateStr]) {
        data.push({ date: dateStr, steps: dataMap[dateStr].steps, goal: dataMap[dateStr].goal });
      } else {
        data.push({ date: dateStr, steps: 0, goal: state.goal });
      }
    }

    // 集計
    const total = data.reduce((sum, d) => sum + d.steps, 0);
    const daysWithData = data.filter(d => d.steps > 0).length;
    const avg = daysWithData > 0 ? Math.round(total / daysWithData) : 0;
    const achieved = data.filter(d => d.steps >= d.goal).length;

    DOM.summaryTotal.textContent = total.toLocaleString();
    DOM.summaryAvg.textContent = avg.toLocaleString();
    DOM.summaryAchieved.textContent = achieved;

    renderHistoryList(data);
    renderChart(data);
  }

  function formatDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function renderHistoryList(data) {
    DOM.historyList.innerHTML = '';

    if (data.length === 0) {
      DOM.historyList.innerHTML = '<div class="empty-state">データがありません</div>';
      return;
    }

    data.forEach(item => {
      const d = new Date(item.date + 'T00:00:00');
      const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
      const dateLabel = `${d.getMonth() + 1}/${d.getDate()} (${dayNames[d.getDay()]})`;
      const isAchieved = item.steps >= item.goal;

      const el = document.createElement('div');
      el.className = 'history-item';
      el.innerHTML = `
        <span class="history-date">${dateLabel}</span>
        <span class="history-steps">${item.steps.toLocaleString()}<span class="unit">歩</span></span>
        <span class="history-badge ${isAchieved ? 'achieved' : 'not-achieved'}">
          <svg class="history-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            ${isAchieved
              ? '<polyline points="20 6 9 17 4 12"/>'
              : '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'}
          </svg>
          ${isAchieved ? '達成' : '未達成'}
        </span>
      `;
      DOM.historyList.appendChild(el);
    });
  }

  // ========== チャート描画 ==========
  function renderChart(data) {
    const canvas = DOM.historyChart;
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    if (data.length === 0) return;

    const reversed = [...data].reverse();
    const maxSteps = Math.max(...reversed.map(d => d.steps), state.goal) * 1.15;

    const padLeft = 44;
    const padRight = 12;
    const padTop = 16;
    const padBottom = 32;
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBottom;

    // Y軸目盛り
    ctx.font = '10px -apple-system, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'right';

    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const val = Math.round((maxSteps / yTicks) * i);
      const y = padTop + chartH - (chartH * i / yTicks);
      ctx.fillText(val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val, padLeft - 6, y + 3);
      ctx.beginPath();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 0.5;
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();
    }

    // 目標ライン
    const goalY = padTop + chartH - (chartH * state.goal / maxSteps);
    ctx.beginPath();
    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.moveTo(padLeft, goalY);
    ctx.lineTo(w - padRight, goalY);
    ctx.stroke();
    ctx.setLineDash([]);

    // バー
    const barCount = reversed.length;
    const gap = Math.max(2, chartW / barCount * 0.25);
    const barW = Math.max(4, (chartW - gap * (barCount + 1)) / barCount);

    reversed.forEach((item, i) => {
      const x = padLeft + gap + i * (barW + gap);
      const barH = (item.steps / maxSteps) * chartH;
      const y = padTop + chartH - barH;

      const gradient = ctx.createLinearGradient(x, y, x, padTop + chartH);
      if (item.steps >= item.goal) {
        gradient.addColorStop(0, '#22c55e');
        gradient.addColorStop(1, '#86efac');
      } else {
        gradient.addColorStop(0, '#4fc3f7');
        gradient.addColorStop(1, '#b3e5fc');
      }
      ctx.fillStyle = gradient;

      const radius = Math.min(barW / 2, 4);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + barW - radius, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + radius);
      ctx.lineTo(x + barW, padTop + chartH);
      ctx.lineTo(x, padTop + chartH);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.fill();

      // X軸ラベル
      const d = new Date(item.date + 'T00:00:00');
      let label;
      if (barCount <= 7) {
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
        label = dayNames[d.getDay()];
      } else {
        label = `${d.getMonth() + 1}/${d.getDate()}`;
      }
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      if (barCount <= 7 || i % Math.ceil(barCount / 8) === 0) {
        ctx.fillText(label, x + barW / 2, h - 8);
      }
    });
  }

  // ========== 設定保存 ==========
  async function saveGoalSetting() {
    const val = parseInt(DOM.goalInput.value);
    if (val && val >= 100 && val <= 100000) {
      state.goal = val;
      saveLocalState();
      updateUI();

      await API.post('settings', {
        goal: state.goal,
        stride: state.stride,
        weight: state.weight,
        sensitivity: state.sensitivity,
      });

      showToast('目標を保存しました');
    } else {
      showToast('100〜100,000の値を入力してください');
    }
  }

  async function savePersonalSetting() {
    const stride = parseInt(DOM.strideInput.value);
    const weight = parseInt(DOM.weightInput.value);

    if (stride >= 30 && stride <= 150 && weight >= 20 && weight <= 200) {
      state.stride = stride;
      state.weight = weight;
      saveLocalState();
      updateUI();

      await API.post('settings', {
        goal: state.goal,
        stride: state.stride,
        weight: state.weight,
        sensitivity: state.sensitivity,
      });

      showToast('設定を保存しました');
    } else {
      showToast('入力値を確認してください');
    }
  }

  // ========== データリセット ==========
  async function resetAllData() {
    Object.values(LOCAL_KEYS).forEach(key => localStorage.removeItem(key));

    state.steps = 0;
    state.goal = 8000;
    state.stride = 70;
    state.weight = 60;
    state.sensitivity = 12;
    state.isCounting = false;
    state.startTime = null;

    DOM.goalInput.value = state.goal;
    DOM.strideInput.value = state.stride;
    DOM.weightInput.value = state.weight;
    DOM.sensitivityInput.value = state.sensitivity;
    DOM.sensitivityValue.textContent = state.sensitivity;

    DOM.btnStart.style.display = 'inline-flex';
    DOM.btnStop.style.display = 'none';

    window.removeEventListener('devicemotion', handleMotion);
    if (state._timerInterval) {
      clearInterval(state._timerInterval);
      state._timerInterval = null;
    }

    // サーバーの設定もリセット
    await API.post('settings', {
      goal: 8000,
      stride: 70,
      weight: 60,
      sensitivity: 12,
    });

    updateUI();
  }

  // ========== モーダル ==========
  let modalCallback = null;

  function showModal(message, onConfirm) {
    DOM.modalMessage.textContent = message;
    DOM.modalOverlay.classList.add('active');
    modalCallback = onConfirm;
    DOM.modalConfirm.onclick = () => {
      hideModal();
      if (modalCallback) modalCallback();
    };
  }

  function hideModal() {
    DOM.modalOverlay.classList.remove('active');
    modalCallback = null;
  }

  // ========== トースト ==========
  let toastTimeout = null;

  function showToast(message) {
    DOM.toast.textContent = message;
    DOM.toast.classList.add('show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => DOM.toast.classList.remove('show'), 2000);
  }

  // ========== 起動 ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
