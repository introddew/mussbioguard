/* ================================================================
   MUSSBIO-GUARD Dashboard — script.js
   Real-Time Frontend Logic | Socket.io | Chart.js
   ================================================================ */

'use strict';

// ── Constants ─────────────────────────────────────────────────
const STATUS = {
  AMAN:     'AMAN',
  WASPADA:  'WASPADA',
  KRITIS:   'KRITIS',
};

const STATUS_CSS = {
  AMAN:    'status--aman',
  WASPADA: 'status--waspada',
  KRITIS:  'status--kritis',
};

const STATUS_DESCRIPTIONS = {
  AMAN:    'Kondisi pilar dalam keadaan normal. Pemantauan rutin berlanjut.',
  WASPADA: 'Terdeteksi indikasi gerusan awal. Lakukan inspeksi visual pada pilar segera.',
  KRITIS:  'Gerusan kritis terdeteksi! Tutup jembatan dan kirim tim darurat sekarang!',
};

const STATUS_ICONS = {
  AMAN:    'fa-circle-check',
  WASPADA: 'fa-triangle-exclamation',
  KRITIS:  'fa-circle-radiation',
};

const MAX_CHART_POINTS = 100;

// ── DOM Element References ────────────────────────────────────
const dom = {
  // Connection
  connDot:        document.getElementById('connDot'),
  connLabel:      document.getElementById('connLabel'),

  // Status badge (header)
  statusBadge:    document.getElementById('statusBadge'),
  statusIconEl:   document.getElementById('statusIconEl'),
  statusLabel:    document.getElementById('statusLabel'),
  lastUpdate:     document.getElementById('lastUpdate'),

  // Metric: fn
  fnValue:        document.getElementById('fnValue'),
  fnTrend:        document.getElementById('fnTrend'),
  fnProgress:     document.getElementById('fnProgress'),

  // Metric: ds
  dsValue:        document.getElementById('dsValue'),
  dsGaugeFill:    document.getElementById('dsGaugeFill'),
  dsThresholdChip: document.getElementById('dsThresholdChip'),

  // Metric: amplitude
  ampValue:       document.getElementById('ampValue'),
  amplitudeViz:   document.getElementById('amplitudeViz'),

  // Status card
  statusCardIcon:     document.getElementById('statusCardIcon'),
  statusSummary:      document.getElementById('card-status'),
  statusSummaryText:  document.getElementById('statusSummaryText'),
  statusDescription:  document.getElementById('statusDescription'),

  // Chart
  fnChart:        document.getElementById('fnChart'),
  simulationBtn:  document.getElementById('simulationBtn'),
  simBtnLabel:    document.getElementById('simBtnLabel'),
  clearChartBtn:  document.getElementById('clearChartBtn'),
  presetAman:     document.getElementById('presetAman'),
  presetWaspada:  document.getElementById('presetWaspada'),
  presetKritis:   document.getElementById('presetKritis'),

  // Alerts
  alertList:      document.getElementById('alertList'),
  alertEmpty:     document.getElementById('alertEmpty'),
  alertCount:     document.getElementById('alertCount'),
  clearAlertsBtn: document.getElementById('clearAlertsBtn'),

  // Info strip
  infoDataPoints: document.getElementById('infoDataPoints'),
  infoF1:         document.getElementById('infoF1'),
  infoF2:         document.getElementById('infoF2'),

  // Critical Modal
  criticalOverlay:    document.getElementById('criticalOverlay'),
  criticalModalData:  document.getElementById('criticalModalData'),
  criticalDismissBtn: document.getElementById('criticalDismissBtn'),

  // Toast container
  toastContainer: document.getElementById('toastContainer'),
};

// ── App State ─────────────────────────────────────────────────
const appState = {
  currentStatus:   STATUS.AMAN,
  prevFn:          null,
  alertCount:      0,
  simulationActive: false,
  thresholds:      { f1: 15.2, f2: 22.4 },
  criticalDismissed: false,
  chartDatasets:   [],
};

// ── Chart Setup ───────────────────────────────────────────────
let fnChartInstance = null;

function buildChart() {
  const ctx = dom.fnChart.getContext('2d');

  // Gradient fill under the line
  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(41, 121, 255, 0.25)');
  gradient.addColorStop(1, 'rgba(41, 121, 255, 0.00)');

  fnChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Frekuensi Dominan (Hz)',
          data: [],
          borderColor: '#2979ff',
          backgroundColor: gradient,
          borderWidth: 2.5,
          pointRadius: 2,
          pointHoverRadius: 5,
          pointBackgroundColor: '#2979ff',
          pointBorderColor: '#0d1520',
          pointBorderWidth: 1.5,
          fill: true,
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      animation: {
        duration: 300,
        easing: 'easeInOutQuart',
      },
      layout: {
        padding: { top: 8, right: 8, bottom: 0, left: 0 },
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(0, 212, 255, 0.05)',
            drawBorder: false,
          },
          ticks: {
            color: '#546278',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            maxRotation: 0,
            maxTicksLimit: 8,
          },
        },
        y: {
          grid: {
            color: 'rgba(0, 212, 255, 0.05)',
            drawBorder: false,
          },
          ticks: {
            color: '#546278',
            font: { family: "'JetBrains Mono', monospace", size: 10 },
            callback: (val) => `${val.toFixed(1)} Hz`,
          },
          min: 0,
          max: 35,
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(13, 21, 32, 0.95)',
          borderColor: 'rgba(0, 212, 255, 0.25)',
          borderWidth: 1,
          titleColor: '#8a9bb5',
          bodyColor: '#e8f0fe',
          titleFont: { family: "'Inter', sans-serif", size: 11 },
          bodyFont: { family: "'JetBrains Mono', monospace", size: 12 },
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              return `Waktu: ${items[0].label}`;
            },
            label: (item) => ` fn = ${item.raw.toFixed(2)} Hz`,
            afterBody: (items) => {
              if (!items.length) return [];
              const fn = items[0].raw;
              const { f1, f2 } = appState.thresholds;
              let statusText;
              if (fn >= f2)      statusText = 'Status: KRITIS';
              else if (fn >= f1) statusText = 'Status: WASPADA';
              else               statusText = 'Status: AMAN';
              return [statusText];
            },
          },
        },
        annotation: {
          annotations: {
            lineF1: {
              type: 'line',
              yMin: 15.2,
              yMax: 15.2,
              borderColor: '#ffd740',
              borderWidth: 1.5,
              borderDash: [6, 4],
              label: {
                display: true,
                content: 'f\u2081 = 15.2 Hz',
                position: 'end',
                backgroundColor: 'rgba(255, 215, 64, 0.15)',
                color: '#ffd740',
                font: { size: 10, family: "'JetBrains Mono', monospace" },
                padding: { x: 6, y: 3 },
                borderRadius: 4,
              },
            },
            lineF2: {
              type: 'line',
              yMin: 22.4,
              yMax: 22.4,
              borderColor: '#ff1744',
              borderWidth: 1.5,
              borderDash: [6, 4],
              label: {
                display: true,
                content: 'f\u2082 = 22.4 Hz',
                position: 'end',
                backgroundColor: 'rgba(255, 23, 68, 0.12)',
                color: '#ff1744',
                font: { size: 10, family: "'JetBrains Mono', monospace" },
                padding: { x: 6, y: 3 },
                borderRadius: 4,
              },
            },
          },
        },
      },
    },
  });
}

function appendChartData(fn, timestamp) {
  if (!fnChartInstance) return;

  const chart = fnChartInstance;
  const timeLabel = formatTime(timestamp);

  chart.data.labels.push(timeLabel);
  chart.data.datasets[0].data.push(parseFloat(fn.toFixed(2)));

  // Cap at MAX_CHART_POINTS
  if (chart.data.labels.length > MAX_CHART_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }

  chart.update('none'); // No animation on update for performance
}

function loadHistoryToChart(historyArr) {
  if (!fnChartInstance || !historyArr || !historyArr.length) return;
  const chart = fnChartInstance;

  chart.data.labels = historyArr.map((d) => formatTime(d.timestamp));
  chart.data.datasets[0].data = historyArr.map((d) => parseFloat(d.fn.toFixed(2)));
  chart.update();
}

function clearChart() {
  if (!fnChartInstance) return;
  fnChartInstance.data.labels = [];
  fnChartInstance.data.datasets[0].data = [];
  fnChartInstance.update();
  showToast('Grafik dibersihkan.', 'info', 'fa-eraser');
}

// ── UI Update Functions ───────────────────────────────────────

/**
 * Main update: called every time new sensor data arrives.
 */
function updateDashboard(data) {
  const { fn, ds, amplitude, status, timestamp } = data;

  // 1. Update Metric Cards
  updateFnCard(fn, timestamp);
  updateDsCard(ds, status);
  updateAmplitudeCard(amplitude);

  // 2. Update Status Badge (Header)
  updateStatusBadge(status, timestamp);

  // 3. Update Status Summary Card
  updateStatusCard(status);

  // 4. Append to chart
  appendChartData(fn, timestamp);

  // 5. Update info strip
  if (dom.infoDataPoints) {
    const histLen = fnChartInstance
      ? fnChartInstance.data.labels.length
      : 0;
    dom.infoDataPoints.textContent = `${histLen} / ${MAX_CHART_POINTS} titik`;
  }

  // 6. Store previous fn for trend calculation
  appState.prevFn = fn;
}

function updateFnCard(fn, timestamp) {
  dom.fnValue.textContent = fn.toFixed(2);

  // Trend arrow
  const trend = dom.fnTrend;
  trend.className = 'metric-trend';
  trend.querySelector('i').className = 'fa-solid fa-minus';

  if (appState.prevFn !== null) {
    if (fn > appState.prevFn + 0.05) {
      trend.classList.add('up');
      trend.querySelector('i').className = 'fa-solid fa-arrow-up';
    } else if (fn < appState.prevFn - 0.05) {
      trend.classList.add('down');
      trend.querySelector('i').className = 'fa-solid fa-arrow-down';
    }
  }

  // Progress bar (0 to 35 Hz scale)
  const pct = Math.min((fn / 35) * 100, 100);
  dom.fnProgress.style.width = `${pct}%`;
}

function updateDsCard(ds, status) {
  dom.dsValue.textContent = ds.toFixed(2);

  // Gauge: 0 to 2cm = 100%
  const pct = Math.min((ds / 2) * 100, 100);
  dom.dsGaugeFill.style.width = `${pct}%`;

  // Threshold chip
  const chip = dom.dsThresholdChip;
  chip.className = 'threshold-chip';
  if (status === STATUS.KRITIS) {
    chip.classList.add('kritis');
    chip.textContent = 'Kritis';
  } else if (status === STATUS.WASPADA) {
    chip.classList.add('waspada');
    chip.textContent = 'Waspada';
  } else {
    chip.textContent = 'Aman';
  }
}

function updateAmplitudeCard(amplitude) {
  dom.ampValue.textContent = amplitude.toFixed(4);

  // Animated bar visualizer
  const viz = dom.amplitudeViz;
  viz.innerHTML = '';
  const BAR_COUNT = 16;
  for (let i = 0; i < BAR_COUNT; i++) {
    const bar = document.createElement('div');
    bar.className = 'amp-bar';
    // Create wave-like random heights based on amplitude
    const noise = Math.random() * 0.5 + 0.5;
    const heightPct = Math.min(
      Math.round((amplitude * 800 * noise + Math.random() * 8 + 4)),
      100
    );
    bar.style.height = `${heightPct}%`;
    bar.style.opacity = `${0.4 + noise * 0.6}`;
    viz.appendChild(bar);
  }
}

function updateStatusBadge(status, timestamp) {
  const badge = dom.statusBadge;

  // Remove old status classes
  badge.classList.remove('status--aman', 'status--waspada', 'status--kritis');
  badge.classList.add(STATUS_CSS[status] || 'status--aman');

  dom.statusLabel.textContent = status;
  dom.statusIconEl.className = `fa-solid ${STATUS_ICONS[status] || 'fa-circle-check'}`;
  dom.lastUpdate.textContent = `Update: ${formatTime(timestamp)}`;
}

function updateStatusCard(status) {
  const card = dom.statusSummary;
  card.classList.remove('status--aman', 'status--waspada', 'status--kritis');
  card.classList.add(STATUS_CSS[status] || 'status--aman');

  dom.statusSummaryText.textContent = status;
  dom.statusDescription.textContent = STATUS_DESCRIPTIONS[status] || '';

  // Status card icon color
  const iconDiv = dom.statusCardIcon;
  iconDiv.style.background = '';
  iconDiv.style.color = '';
  iconDiv.style.boxShadow = '';

  if (status === STATUS.WASPADA) {
    iconDiv.style.background = 'rgba(255, 215, 64, 0.12)';
    iconDiv.style.color = 'var(--warn-color)';
    iconDiv.style.boxShadow = '0 0 12px rgba(255, 215, 64, 0.25)';
  } else if (status === STATUS.KRITIS) {
    iconDiv.style.background = 'rgba(255, 23, 68, 0.12)';
    iconDiv.style.color = 'var(--crit-color)';
    iconDiv.style.boxShadow = '0 0 12px rgba(255, 23, 68, 0.30)';
  }

  // Show critical modal if newly critical and not yet dismissed
  if (status === STATUS.KRITIS && appState.currentStatus !== STATUS.KRITIS) {
    appState.criticalDismissed = false;
  }

  appState.currentStatus = status;
}

// ── Alert Log ─────────────────────────────────────────────────

function addAlertEntry(alert) {
  // Remove empty state
  if (dom.alertEmpty && dom.alertEmpty.parentNode === dom.alertList) {
    dom.alertList.removeChild(dom.alertEmpty);
  }

  const entry = document.createElement('article');
  entry.className = `alert-entry entry--${alert.status.toLowerCase()}`;
  entry.setAttribute('role', 'listitem');

  const iconClass = alert.status === STATUS.KRITIS
    ? 'fa-circle-radiation'
    : 'fa-triangle-exclamation';

  entry.innerHTML = `
    <div class="alert-entry-icon">
      <i class="fa-solid ${iconClass}" aria-hidden="true"></i>
    </div>
    <div class="alert-entry-body">
      <div class="alert-entry-status">${alert.status}</div>
      <div class="alert-entry-time">${formatDateTime(alert.timestamp)}</div>
      <div class="alert-entry-data">
        <span class="alert-data-chip">fn = ${alert.fn.toFixed(2)} Hz</span>
        <span class="alert-data-chip">ds = ${alert.ds.toFixed(2)} cm</span>
      </div>
    </div>
  `;

  // Prepend (newest first)
  dom.alertList.insertBefore(entry, dom.alertList.firstChild);

  // Scroll to top
  dom.alertList.scrollTop = 0;

  // Update count
  appState.alertCount++;
  dom.alertCount.textContent = appState.alertCount;

  // Show toast for new alert
  if (alert.status === STATUS.KRITIS) {
    showToast(
      `Status KRITIS terdeteksi! fn = ${alert.fn.toFixed(2)} Hz`,
      'error',
      'fa-circle-radiation'
    );
    // Show critical modal
    if (!appState.criticalDismissed) {
      showCriticalModal(alert);
    }
  } else if (alert.status === STATUS.WASPADA) {
    showToast(
      `Peringatan WASPADA! fn = ${alert.fn.toFixed(2)} Hz`,
      'warn',
      'fa-triangle-exclamation'
    );
  }
}

function loadAlertHistory(alerts) {
  if (!alerts || !alerts.length) return;

  // Clear list first
  dom.alertList.innerHTML = '';
  appState.alertCount = 0;

  // Load in reverse (oldest first, so newest is at top after prepend)
  const sorted = [...alerts].sort((a, b) => b.timestamp - a.timestamp);
  sorted.forEach((alert) => {
    const entry = document.createElement('article');
    entry.className = `alert-entry entry--${alert.status.toLowerCase()}`;
    entry.setAttribute('role', 'listitem');

    const iconClass = alert.status === STATUS.KRITIS
      ? 'fa-circle-radiation'
      : 'fa-triangle-exclamation';

    entry.innerHTML = `
      <div class="alert-entry-icon">
        <i class="fa-solid ${iconClass}" aria-hidden="true"></i>
      </div>
      <div class="alert-entry-body">
        <div class="alert-entry-status">${alert.status}</div>
        <div class="alert-entry-time">${formatDateTime(alert.timestamp)}</div>
        <div class="alert-entry-data">
          <span class="alert-data-chip">fn = ${alert.fn.toFixed(2)} Hz</span>
          <span class="alert-data-chip">ds = ${alert.ds.toFixed(2)} cm</span>
        </div>
      </div>
    `;
    dom.alertList.appendChild(entry);
    appState.alertCount++;
  });

  dom.alertCount.textContent = appState.alertCount;
}

function clearAlerts() {
  dom.alertList.innerHTML = '';
  dom.alertList.appendChild(dom.alertEmpty);
  appState.alertCount = 0;
  dom.alertCount.textContent = '0';
  showToast('Riwayat peringatan dihapus.', 'info', 'fa-trash-can');
}

// ── Critical Modal ────────────────────────────────────────────

function showCriticalModal(data) {
  dom.criticalModalData.innerHTML = `
    <div class="critical-data-pill">fn = ${data.fn.toFixed(2)} Hz</div>
    <div class="critical-data-pill">ds = ${data.ds.toFixed(2)} cm</div>
    <div class="critical-data-pill">${formatDateTime(data.timestamp)}</div>
  `;
  dom.criticalOverlay.hidden = false;

  // Focus the dismiss button for accessibility
  setTimeout(() => dom.criticalDismissBtn.focus(), 100);
}

function hideCriticalModal() {
  dom.criticalOverlay.hidden = true;
  appState.criticalDismissed = true;
}

dom.criticalDismissBtn.addEventListener('click', hideCriticalModal);

// Dismiss on backdrop click
dom.criticalOverlay.addEventListener('click', (e) => {
  if (e.target === dom.criticalOverlay) hideCriticalModal();
});

// Dismiss on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dom.criticalOverlay.hidden) hideCriticalModal();
});

// ── Toast System ──────────────────────────────────────────────

function showToast(message, type = 'info', iconClass = 'fa-info-circle', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `
    <i class="fa-solid ${iconClass} toast-icon" aria-hidden="true"></i>
    <span class="toast-message">${message}</span>
  `;

  dom.toastContainer.appendChild(toast);

  // Auto dismiss
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 320);
  }, duration);
}

// ── Connection Status UI ──────────────────────────────────────

function setConnectionStatus(connected, reconnecting = false) {
  const dot = dom.connDot;
  const label = dom.connLabel;

  dot.className = 'conn-dot';

  if (connected) {
    dot.classList.add('connected');
    label.textContent = 'Terhubung';
    showToast('Terhubung ke server MQTT.', 'success', 'fa-plug');
  } else if (reconnecting) {
    dot.classList.add('reconnecting');
    label.textContent = 'Menyambung...';
  } else {
    dot.classList.add('disconnected');
    label.textContent = 'Terputus';
    showToast('Koneksi ke server terputus.', 'error', 'fa-plug-circle-xmark');
  }
}

// ── Simulation & Preset Toggle ────────────────────────────────

function setSimulationUI(active) {
  appState.simulationActive = active;
  dom.simulationBtn.classList.toggle('active', active);

  if (active) {
    dom.simBtnLabel.textContent = 'Hentikan Simulasi';
    showToast('Mode simulasi data aktif.', 'info', 'fa-flask');
  } else {
    dom.simBtnLabel.textContent = 'Mulai Simulasi';
    showToast('Simulasi data dihentikan.', 'info', 'fa-flask');
  }
}

dom.simulationBtn.addEventListener('click', () => {
  const newActive = !appState.simulationActive;
  socket.emit('toggle-simulation', { active: newActive });
  setSimulationUI(newActive);
});

// Quick Presets
async function triggerPreset(presetName) {
  try {
    const res = await fetch('/api/preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: presetName })
    });
    if (!res.ok) throw new Error('Network response was not ok');
    // The server will process the data and broadcast it via socket, so we don't need to do anything else here
  } catch (error) {
    console.error('Error triggering preset:', error);
    showToast(`Gagal menerapkan preset ${presetName}`, 'error', 'fa-triangle-exclamation');
  }
}

dom.presetAman.addEventListener('click', () => triggerPreset('AMAN'));
dom.presetWaspada.addEventListener('click', () => triggerPreset('WASPADA'));
dom.presetKritis.addEventListener('click', () => triggerPreset('KRITIS'));

dom.clearChartBtn.addEventListener('click', clearChart);
dom.clearAlertsBtn.addEventListener('click', clearAlerts);

// ── Utility Functions ─────────────────────────────────────────

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('id-ID', {
    day:    '2-digit',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// ── Socket.io Client ──────────────────────────────────────────

// Connect to the same origin (the Node.js server serves both HTTP and WS)
const socket = io(window.location.origin, {
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
  reconnectionDelayMax: 10000,
  timeout: 20000,
});

socket.on('connect', () => {
  console.log('[WS] Terhubung, ID:', socket.id);
  setConnectionStatus(true);
});

socket.on('disconnect', () => {
  console.log('[WS] Terputus dari server.');
  setConnectionStatus(false);
});

socket.on('connect_error', () => {
  console.warn('[WS] Error koneksi ke server.');
  setConnectionStatus(false, true);
});

// ── Initial Data (saat pertama terhubung) ─────────────────────
socket.on('initial-data', (payload) => {
  console.log('[WS] Data awal diterima:', payload);

  // Update thresholds dari server
  if (payload.thresholds) {
    appState.thresholds = payload.thresholds;
    if (dom.infoF1) dom.infoF1.textContent = `${payload.thresholds.f1} Hz`;
    if (dom.infoF2) dom.infoF2.textContent = `${payload.thresholds.f2} Hz`;
  }

  // Update chart dengan riwayat
  if (payload.history && payload.history.length > 0) {
    loadHistoryToChart(payload.history);
  }

  // Load alert history
  if (payload.alertHistory && payload.alertHistory.length > 0) {
    loadAlertHistory(payload.alertHistory);
  }

  // Update dashboard dengan data terbaru
  if (payload.latestData) {
    updateDashboard(payload.latestData);
  }

  // Update MQTT status
  if (payload.mqttConnected !== undefined) {
    const dot = dom.connDot;
    dot.className = 'conn-dot ' + (payload.mqttConnected ? 'connected' : 'disconnected');
    dom.connLabel.textContent = payload.mqttConnected ? 'Terhubung' : 'Menunggu MQTT';
  }

  // Update simulation status
  if (payload.simulationActive !== undefined) {
    setSimulationUI(payload.simulationActive);
  }
});

// ── Real-Time Sensor Data ─────────────────────────────────────
socket.on('sensor-data', (data) => {
  updateDashboard(data);
});

// ── New Alert from Server ─────────────────────────────────────
socket.on('new-alert', (alertEntry) => {
  addAlertEntry(alertEntry);
});

// ── MQTT Status Updates ───────────────────────────────────────
socket.on('mqtt-status', (payload) => {
  if (payload.connected) {
    setConnectionStatus(true);
  } else if (payload.reconnecting) {
    setConnectionStatus(false, true);
  } else {
    setConnectionStatus(false, false);
  }
});

// ── Simulation Status Updates ─────────────────────────────────
socket.on('simulation-status', (payload) => {
  setSimulationUI(payload.active);
});

// ── Initialization ────────────────────────────────────────────
function init() {
  console.log('[MUSSBIO-GUARD] Dashboard diinisialisasi.');

  // Build Chart.js chart
  buildChart();
  
  // Build Map & Contacts
  initMap();
  setupEmergencyActions();

  // Setup amplitude visualizer initial bars (placeholder)
  updateAmplitudeCard(0.025);

  // Show welcome toast
  setTimeout(() => {
    showToast('Dashboard MUSSBIO-GUARD siap. Menunggu data sensor...', 'info', 'fa-shield-halved', 5000);
  }, 800);
}

// ── Map & Emergency Actions ───────────────────────────────────
let emergencyMap = null;
let bridgeMarker = null;

function initMap() {
  // Koordinat Jembatan Jepang, Kesesi, Pekalongan
  const bridgeLat = -7.025;
  const bridgeLng = 109.497;
  
  emergencyMap = L.map('map').setView([bridgeLat, bridgeLng], 13);
  
  // Custom dark theme tiles using CartoDB Dark Matter
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(emergencyMap);
  
  // Custom icons
  const bridgeIcon = L.divIcon({
    html: '<div style="background:var(--crit-color); color:white; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid white; box-shadow: 0 0 10px red;"><i class="fa-solid fa-bridge" style="font-size:12px;"></i></div>',
    className: 'custom-leaflet-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
  
  const bpbdIcon = L.divIcon({
    html: '<div style="background:#2196f3; color:white; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid white; box-shadow: 0 0 10px blue;"><i class="fa-solid fa-truck-medical" style="font-size:12px;"></i></div>',
    className: 'custom-leaflet-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
  
  // Add markers
  bridgeMarker = L.marker([bridgeLat, bridgeLng], { icon: bridgeIcon })
    .addTo(emergencyMap)
    .bindPopup('<b>Jembatan Jepang Kesesi</b><br>Lokasi Sensor MUSSBIO-GUARD', { closeButton: false })
    .openPopup();
    
  L.marker([-7.032, 109.625], { icon: bpbdIcon })
    .addTo(emergencyMap)
    .bindPopup('<b>BPBD Kab. Pekalongan</b><br>Kajen', { closeButton: false });
    
  L.marker([-7.015, 109.505], { icon: bpbdIcon })
    .addTo(emergencyMap)
    .bindPopup('<b>Posko Relawan Kesesi</b><br>Jarak: ~1.5km', { closeButton: false });
}

function setupEmergencyActions() {
  const btnReportBPBD = document.getElementById('btnReportBPBD');
  const modalBtnWa = document.getElementById('modalBtnWa');
  const modalBtnMap = document.getElementById('modalBtnMap');
  
  const generateWaLink = () => {
    const fn = document.getElementById('fnValue').textContent;
    const ds = document.getElementById('dsValue').textContent;
    const status = document.getElementById('statusSummaryText').textContent;
    
    const message = `*LAPORAN DARURAT MUSSBIO-GUARD*%0A%0ATelah terdeteksi status *${status}* pada Jembatan Jepang, Kesesi.%0A%0A*Data Real-time:*%0A- Frekuensi Dominan: ${fn} Hz%0A- Estimasi Kedalaman Gerusan: ${ds} cm%0A%0AMohon segera tindak lanjuti indikasi gerusan pilar ini.`;
    
    // Menggunakan nomor darurat dummy (bisa diganti nomor asli BPBD)
    return `https://wa.me/6281234567890?text=${message}`;
  };

  if (btnReportBPBD) {
    btnReportBPBD.addEventListener('click', () => {
      window.open(generateWaLink(), '_blank');
    });
  }
  
  if (modalBtnWa) {
    modalBtnWa.addEventListener('click', () => {
      window.open(generateWaLink(), '_blank');
      hideCriticalModal(); // tutup modal setelah klik
    });
  }
  
  if (modalBtnMap) {
    modalBtnMap.addEventListener('click', () => {
      hideCriticalModal();
      document.getElementById('emergencySection').scrollIntoView({ behavior: 'smooth' });
    });
  }
}

// ── Run on DOM Ready ──────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
