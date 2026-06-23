// ============================================================
// MUSSBIO-GUARD: Server Backend
// Node.js + Express + Socket.io + MQTT
// Real-Time Scour Monitoring Dashboard
// ============================================================

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');
const https = require('https');
const path = require('path');

// ─── App Setup ───────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Configuration ────────────────────────────────────────────
const CONFIG = {
  PORT: process.env.PORT || 3000,
  MQTT_BROKER: process.env.MQTT_BROKER || 'mqtt://broker.emqx.io:1883',
  MQTT_TOPIC: process.env.MQTT_TOPIC || 'mussbio/sensor/data',
  MQTT_CLIENT_ID: `mussbio-server-${Math.random().toString(16).slice(2, 8)}`,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  THRESHOLD_F1: parseFloat(process.env.THRESHOLD_F1 || '15.2'), // Hz - Warning
  THRESHOLD_F2: parseFloat(process.env.THRESHOLD_F2 || '22.4'), // Hz - Critical
  DATA_HISTORY_SIZE: 100,  // Jumlah data point yang disimpan
  ALERT_HISTORY_SIZE: 50,  // Jumlah riwayat alert yang disimpan
  TELEGRAM_REPEAT_INTERVAL: 5 * 60 * 1000, // 5 menit
};

// ─── State Management ─────────────────────────────────────────
let state = {
  latestData: null,
  dataHistory: [],         // Array 100 data point terakhir
  alertHistory: [],        // Array 50 alert terakhir
  lastStatus: 'AMAN',
  lastCriticalAlertTime: 0,
  mqttConnected: false,
  clientCount: 0,
  simulationInterval: null,  // Untuk mode simulasi
};

// ─── MQTT Client ──────────────────────────────────────────────
console.log(`[MQTT] Menghubungkan ke broker: ${CONFIG.MQTT_BROKER}`);

const mqttClient = mqtt.connect(CONFIG.MQTT_BROKER, {
  clientId: CONFIG.MQTT_CLIENT_ID,
  clean: true,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
  keepalive: 60,
});

mqttClient.on('connect', () => {
  state.mqttConnected = true;
  console.log(`[MQTT] Terhubung ke broker: ${CONFIG.MQTT_BROKER}`);
  mqttClient.subscribe(CONFIG.MQTT_TOPIC, { qos: 1 }, (err) => {
    if (err) {
      console.error('[MQTT] Gagal subscribe:', err.message);
    } else {
      console.log(`[MQTT] Subscribe berhasil ke topic: ${CONFIG.MQTT_TOPIC}`);
    }
  });
  io.emit('mqtt-status', { connected: true });
});

mqttClient.on('error', (err) => {
  state.mqttConnected = false;
  console.error('[MQTT] Error koneksi:', err.message);
  io.emit('mqtt-status', { connected: false });
});

mqttClient.on('reconnect', () => {
  console.log('[MQTT] Mencoba menyambung ulang...');
  io.emit('mqtt-status', { connected: false, reconnecting: true });
});

mqttClient.on('offline', () => {
  state.mqttConnected = false;
  console.log('[MQTT] Broker offline.');
  io.emit('mqtt-status', { connected: false });
});

// ─── Proses Pesan Masuk dari MQTT ─────────────────────────────
mqttClient.on('message', (topic, message) => {
  try {
    const raw = message.toString();
    const data = JSON.parse(raw);

    // Validasi field wajib
    if (
      typeof data.fn === 'undefined' ||
      typeof data.ds === 'undefined'
    ) {
      console.warn('[MQTT] Data tidak valid, field wajib tidak ada:', raw);
      return;
    }

    processIncomingData(data);
  } catch (err) {
    console.error('[MQTT] Gagal parse pesan JSON:', err.message);
  }
});

// ─── Fungsi Pemrosesan Data ────────────────────────────────────
function processIncomingData(data) {
  const timestamp = data.timestamp || Date.now();
  const fn = parseFloat(data.fn);
  const ds = parseFloat(data.ds);
  const amplitude = parseFloat(data.amplitude || 0);

  // Tentukan status berdasarkan ambang batas frekuensi
  let status;
  if (fn >= CONFIG.THRESHOLD_F2) {
    status = 'KRITIS';
  } else if (fn >= CONFIG.THRESHOLD_F1) {
    status = 'WASPADA';
  } else {
    status = 'AMAN';
  }

  // Buat objek data yang diproses
  const processedData = {
    fn: parseFloat(fn.toFixed(2)),
    ds: parseFloat(ds.toFixed(3)),
    amplitude: parseFloat(amplitude.toFixed(4)),
    status,
    timestamp,
    f1Threshold: CONFIG.THRESHOLD_F1,
    f2Threshold: CONFIG.THRESHOLD_F2,
  };

  // Simpan sebagai data terbaru
  state.latestData = processedData;

  // Tambahkan ke riwayat data (batasi 100 titik)
  state.dataHistory.push({
    fn: processedData.fn,
    ds: processedData.ds,
    amplitude: processedData.amplitude,
    status: processedData.status,
    timestamp: processedData.timestamp,
  });
  if (state.dataHistory.length > CONFIG.DATA_HISTORY_SIZE) {
    state.dataHistory.shift();
  }

  // Kirim data ke semua klien web
  io.emit('sensor-data', {
    ...processedData,
    history: state.dataHistory,
    alertHistory: state.alertHistory,
  });

  // ── Logika Notifikasi ──────────────────────────────────────
  const now = Date.now();
  const statusChanged = status !== state.lastStatus;

  if (statusChanged) {
    // Status berubah
    if (status === 'WASPADA' || status === 'KRITIS') {
      // Catat alert ke riwayat
      addAlertToHistory(processedData, status);
      // Kirim notifikasi Telegram
      sendTelegramAlert(processedData, status, false);
    }
    state.lastStatus = status;

    // Broadcast status change ke dashboard
    io.emit('status-change', { status, previous: state.lastStatus });
  } else if (
    status === 'KRITIS' &&
    now - state.lastCriticalAlertTime >= CONFIG.TELEGRAM_REPEAT_INTERVAL
  ) {
    // Status tetap KRITIS, kirim ulang setiap 5 menit
    sendTelegramAlert(processedData, status, true);
    state.lastCriticalAlertTime = now;
  }

  console.log(
    `[DATA] fn=${fn.toFixed(2)} Hz | ds=${ds.toFixed(3)} cm | Status=${status}`
  );
}

// ─── Tambah Alert ke Riwayat ───────────────────────────────────
function addAlertToHistory(data, status) {
  const alertEntry = {
    id: Date.now(),
    timestamp: data.timestamp,
    status,
    fn: data.fn,
    ds: data.ds,
    amplitude: data.amplitude,
  };

  state.alertHistory.unshift(alertEntry); // Tambahkan di awal
  if (state.alertHistory.length > CONFIG.ALERT_HISTORY_SIZE) {
    state.alertHistory.pop();
  }

  // Broadcast ke semua klien
  io.emit('new-alert', alertEntry);
}

// ─── Telegram Notification ─────────────────────────────────────
function sendTelegramAlert(data, status, isRepeat) {
  if (!CONFIG.TELEGRAM_BOT_TOKEN || !CONFIG.TELEGRAM_CHAT_ID) {
    console.log('[TELEGRAM] Token/Chat ID tidak dikonfigurasi, skip notifikasi.');
    return;
  }

  const timeStr = new Date(data.timestamp).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  let message = '';

  if (status === 'WASPADA') {
    message = `
[PERINGATAN DINI - MUSSBIO-GUARD]

Lokasi: Jembatan Jepang, Kesesi, Pekalongan
Waktu: ${timeStr}

STATUS: WASPADA
Frekuensi Dominan: ${data.fn} Hz
Kedalaman Gerusan Est.: ${data.ds} cm

TINDAKAN YANG DISARANKAN:
1. Lakukan inspeksi visual pada pilar
2. Periksa kondisi matras bambu
3. Siapkan tim untuk kemungkinan perbaikan

---
Sistem Monitoring MUSSBIO-GUARD
    `.trim();
  } else if (status === 'KRITIS') {
    const repeatNote = isRepeat ? '\n[PENGINGAT - Status masih KRITIS]' : '';
    message = `
[PERINGATAN KRITIS! - MUSSBIO-GUARD]${repeatNote}

Lokasi: Jembatan Jepang, Kesesi, Pekalongan
Waktu: ${timeStr}

STATUS: KRITIS!
Frekuensi Dominan: ${data.fn} Hz
Kedalaman Gerusan Est.: ${data.ds} cm

TINDAKAN DARURAT:
1. TUTUP JEMBATAN UNTUK KENDARAAN!
2. Hubungi Dinas Pekerjaan Umum segera!
3. Kirim tim untuk penanganan darurat!

---
Sistem Monitoring MUSSBIO-GUARD
    `.trim();
  }

  if (!message) return;

  // Kirim via HTTPS ke Telegram Bot API
  const body = JSON.stringify({
    chat_id: CONFIG.TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'HTML',
  });

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = https.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => { responseData += chunk; });
    res.on('end', () => {
      const parsed = JSON.parse(responseData);
      if (parsed.ok) {
        console.log(`[TELEGRAM] Notifikasi ${status} berhasil dikirim.`);
      } else {
        console.error('[TELEGRAM] Gagal kirim:', parsed.description);
      }
    });
  });

  req.on('error', (err) => {
    console.error('[TELEGRAM] Error HTTP:', err.message);
  });

  req.write(body);
  req.end();
}

// ─── REST API Endpoints ───────────────────────────────────────
// Ambil data terbaru
app.get('/api/latest', (req, res) => {
  if (!state.latestData) {
    return res.json({ status: 'NO_DATA', message: 'Belum ada data dari sensor' });
  }
  res.json(state.latestData);
});

// Ambil riwayat data
app.get('/api/history', (req, res) => {
  res.json({
    data: state.dataHistory,
    count: state.dataHistory.length,
  });
});

// Ambil riwayat alert
app.get('/api/alerts', (req, res) => {
  res.json({
    alerts: state.alertHistory,
    count: state.alertHistory.length,
  });
});

// Status server dan koneksi
app.get('/api/status', (req, res) => {
  res.json({
    serverTime: new Date().toISOString(),
    mqttConnected: state.mqttConnected,
    mqttBroker: CONFIG.MQTT_BROKER,
    mqttTopic: CONFIG.MQTT_TOPIC,
    connectedClients: state.clientCount,
    dataPointsStored: state.dataHistory.length,
    alertsStored: state.alertHistory.length,
    thresholds: {
      f1: CONFIG.THRESHOLD_F1,
      f2: CONFIG.THRESHOLD_F2,
    },
  });
});

// Endpoint: Inject data manual (untuk testing/demo)
app.post('/api/inject', (req, res) => {
  const { fn, ds, amplitude, status } = req.body;
  if (typeof fn === 'undefined') {
    return res.status(400).json({ error: 'Field fn wajib ada' });
  }

  const data = {
    fn: parseFloat(fn),
    ds: parseFloat(ds || 0),
    amplitude: parseFloat(amplitude || 0),
    status: status || 'AMAN',
    timestamp: Date.now(),
  };

  processIncomingData(data);
  res.json({ success: true, message: 'Data berhasil diproses', data });
});

// Endpoint: Toggle simulasi data
app.post('/api/simulate', (req, res) => {
  const { active } = req.body;

  if (active && !state.simulationInterval) {
    simPhase = 0; // Reset fase saat mulai ulang
    startSimulation();
    res.json({ success: true, message: 'Simulasi data diaktifkan (siklus ~24 detik per fase)' });
  } else if (!active && state.simulationInterval) {
    stopSimulation();
    res.json({ success: true, message: 'Simulasi data dinonaktifkan' });
  } else {
    res.json({ success: false, message: 'Tidak ada perubahan status simulasi' });
  }
});

// Endpoint: Preset status instan (untuk demo/testing cepat)
// POST /api/preset  body: { "preset": "AMAN" | "WASPADA" | "KRITIS" }
app.post('/api/preset', (req, res) => {
  const { preset } = req.body;
  const presets = {
    AMAN: {
      fn: 8.5 + Math.random() * 4,
      ds: 0.1 + Math.random() * 0.3,
      amplitude: 0.018 + Math.random() * 0.008,
    },
    WASPADA: {
      fn: 16.5 + Math.random() * 4,
      ds: 0.6 + Math.random() * 0.6,
      amplitude: 0.038 + Math.random() * 0.01,
    },
    KRITIS: {
      fn: 23.5 + Math.random() * 3,
      ds: 1.6 + Math.random() * 0.5,
      amplitude: 0.065 + Math.random() * 0.015,
    },
  };

  if (!presets[preset]) {
    return res.status(400).json({ error: 'Preset tidak valid. Pilih: AMAN, WASPADA, atau KRITIS' });
  }

  const data = presets[preset];
  processIncomingData({
    fn: parseFloat(data.fn.toFixed(2)),
    ds: parseFloat(data.ds.toFixed(3)),
    amplitude: parseFloat(data.amplitude.toFixed(4)),
    timestamp: Date.now(),
  });

  res.json({ success: true, message: `Preset ${preset} diterapkan`, data });
});

// ─── Simulasi Data (untuk Demo tanpa Sensor Fisik) ────────────
// Siklus: ~75 detik total (AMAN ~25s → WASPADA ~25s → KRITIS ~25s)
let simPhase = 0;

function startSimulation() {
  console.log('[SIM] Simulasi data diaktifkan. Siklus: AMAN (25s) → WASPADA (25s) → KRITIS (25s)');
  state.simulationInterval = setInterval(() => {
    // Increment besar (0.4) + interval pendek (1s) = siklus cepat
    // Satu siklus penuh (Math.PI * 3) selesai dalam ~24 detik per fase
    simPhase += 0.4;

    let fn, ds, amplitude;
    // Siklus total: Math.PI * 3 ≈ 9.42
    // Dengan increment 0.4 setiap 1 detik: 9.42 / 0.4 = ~24 detik per siklus penuh
    // Setiap fase 1/3 siklus = ~8 detik
    const CYCLE_LENGTH = Math.PI * 3;
    const cycle = simPhase % CYCLE_LENGTH;
    const phaseRatio = cycle / CYCLE_LENGTH;

    if (phaseRatio < 0.33) {
      // Fase AMAN: fn = 6-14 Hz (≈8 detik)
      const t = phaseRatio / 0.33;
      fn = 8 + 5 * Math.sin(t * Math.PI) + (Math.random() - 0.5) * 1.2;
      ds = Math.max(0, 0.15 + 0.18 * Math.sin(t * Math.PI) + (Math.random() - 0.5) * 0.04);
    } else if (phaseRatio < 0.66) {
      // Fase WASPADA: fn = 15-22 Hz (≈8 detik)
      const t = (phaseRatio - 0.33) / 0.33;
      fn = 17 + 4 * Math.sin(t * Math.PI) + (Math.random() - 0.5) * 1.5;
      ds = Math.max(0, 0.7 + 0.5 * Math.sin(t * Math.PI) + (Math.random() - 0.5) * 0.08);
    } else {
      // Fase KRITIS: fn = 23-28 Hz (≈8 detik)
      const t = (phaseRatio - 0.66) / 0.34;
      fn = 24 + 3 * Math.sin(t * Math.PI) + (Math.random() - 0.5) * 1.2;
      ds = Math.max(0, 1.6 + 0.4 * Math.sin(t * Math.PI) + (Math.random() - 0.5) * 0.1);
    }

    amplitude = 0.015 + (fn / 120) + (Math.random() - 0.5) * 0.008;

    processIncomingData({
      fn: parseFloat(fn.toFixed(2)),
      ds: parseFloat(ds.toFixed(3)),
      amplitude: parseFloat(Math.abs(amplitude).toFixed(4)),
      timestamp: Date.now(),
    });
  }, 1000); // Kirim setiap 1 detik untuk demo yang responsif
}

function stopSimulation() {
  if (state.simulationInterval) {
    clearInterval(state.simulationInterval);
    state.simulationInterval = null;
    console.log('[SIM] Simulasi data dinonaktifkan.');
  }
}

// ─── Socket.io Connection Handler ────────────────────────────
io.on('connection', (socket) => {
  state.clientCount++;
  console.log(`[WS] Klien terhubung: ${socket.id} | Total: ${state.clientCount}`);

  // Kirim data awal ke klien yang baru terhubung
  socket.emit('initial-data', {
    latestData: state.latestData,
    history: state.dataHistory,
    alertHistory: state.alertHistory,
    mqttConnected: state.mqttConnected,
    thresholds: {
      f1: CONFIG.THRESHOLD_F1,
      f2: CONFIG.THRESHOLD_F2,
    },
    simulationActive: !!state.simulationInterval,
  });

  socket.on('disconnect', () => {
    state.clientCount--;
    console.log(`[WS] Klien terputus: ${socket.id} | Total: ${state.clientCount}`);
  });

  // Klien meminta toggle simulasi
  socket.on('toggle-simulation', (data) => {
    if (data.active) {
      if (!state.simulationInterval) startSimulation();
    } else {
      stopSimulation();
    }
    io.emit('simulation-status', { active: !!state.simulationInterval });
  });
});

// ─── Start Server ─────────────────────────────────────────────
server.listen(CONFIG.PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        MUSSBIO-GUARD DASHBOARD SERVER AKTIF         ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Akses Dashboard: http://localhost:${CONFIG.PORT}             ║`);
  console.log(`║  MQTT Broker    : ${CONFIG.MQTT_BROKER.substring(0, 30)}  ║`);
  console.log(`║  MQTT Topic     : ${CONFIG.MQTT_TOPIC}         ║`);
  console.log(`║  Ambang Batas   : f1=${CONFIG.THRESHOLD_F1} Hz | f2=${CONFIG.THRESHOLD_F2} Hz     ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  Tekan Ctrl+C untuk menghentikan server             ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
});

// ─── Graceful Shutdown ────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[SERVER] Mematikan server...');
  stopSimulation();
  mqttClient.end(() => {
    server.close(() => {
      console.log('[SERVER] Server berhasil dimatikan.');
      process.exit(0);
    });
  });
});

process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[SERVER] Unhandled Promise Rejection:', reason);
});
