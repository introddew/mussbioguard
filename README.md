# MUSSBIO-GUARD Dashboard

## Deskripsi
Dashboard monitoring real-time untuk sistem MUSSBIO-GUARD (Matras Bambu Mussels Bio-Guard), sebuah inovasi perlindungan gerusan pilar jembatan yang mengintegrasikan matras bambu termally-modified, koloni kerang hijau (Perna viridis) sebagai agen bio-sementasi, dan sistem sensor cerdas berbasis piezoelektrik-FFT-ESP32.

## Arsitektur Sistem
```
Sensor MPU-6050
       |
    ESP32 (FFT + Klasifikasi)
       |
    MQTT Broker (broker.emqx.io)
       |
    Node.js Server (Express + Socket.io)
       |
    +-----------+----------+
    |                      |
Web Dashboard        Telegram Bot
(Real-time)         (Notifikasi)
```

## Fitur Utama
- **Monitoring Real-Time**: Data frekuensi dominan (fn), kedalaman gerusan (ds), dan amplitudo getaran ditampilkan langsung dari sensor.
- **Grafik Interaktif**: Grafik garis real-time dengan garis batas f1 dan f2.
- **Status 3 Level**: AMAN (hijau), WASPADA (kuning), KRITIS (merah + animasi berkedip).
- **Modal Darurat**: Pop-up peringatan kritis yang tidak bisa diabaikan.
- **Riwayat Peringatan**: Log semua kejadian WASPADA dan KRITIS.
- **Notifikasi Telegram**: Pesan otomatis ke HP pengelola.
- **Mode Simulasi**: Data simulasi built-in untuk demo tanpa sensor fisik.
- **Responsif**: Tampilan optimal di desktop, tablet, dan ponsel.

## Instalasi

### 1. Prasyarat
- Node.js v18 atau lebih baru
- npm v8 atau lebih baru

### 2. Install Dependensi
```bash
cd mussbio-dashboard
npm install
```

### 3. Konfigurasi Environment
```bash
cp .env.example .env
```
Edit `.env` sesuai kebutuhan (broker MQTT, threshold, Telegram token).

### 4. Jalankan Server
```bash
npm start
```

### 5. Akses Dashboard
Buka browser di: `http://localhost:3000`

## Konfigurasi Telegram Bot

1. Buka Telegram, cari `@BotFather`
2. Kirim perintah `/newbot` dan ikuti instruksi
3. Salin Bot Token yang diberikan
4. Cari `@userinfobot`, mulai chat untuk mendapatkan Chat ID
5. Isi `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` di file `.env`
6. Restart server

## Format Data dari ESP32

ESP32 mengirim data JSON setiap 5 detik ke topic MQTT `mussbio/sensor/data`:

```json
{
  "fn": 18.7,
  "ds": 0.8,
  "amplitude": 0.042,
  "status": "WASPADA",
  "timestamp": 1740165825000
}
```

## Library Arduino untuk ESP32
```
- PubSubClient (untuk MQTT)
- ArduinoJson (untuk serialisasi JSON)
- arduinoFFT (untuk FFT)
- MPU6050_tockn atau Wire (untuk sensor)
```

## REST API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/latest` | Data sensor terbaru |
| GET | `/api/history` | Riwayat 100 data terakhir |
| GET | `/api/alerts` | Riwayat 50 peringatan terakhir |
| GET | `/api/status` | Status server dan koneksi |
| POST | `/api/inject` | Inject data manual (testing) |
| POST | `/api/simulate` | Toggle mode simulasi |

### Contoh: Inject Data Manual
```bash
curl -X POST http://localhost:3000/api/inject \
  -H "Content-Type: application/json" \
  -d '{"fn": 18.5, "ds": 0.9, "amplitude": 0.038}'
```

### Contoh: Aktifkan Simulasi
```bash
curl -X POST http://localhost:3000/api/simulate \
  -H "Content-Type: application/json" \
  -d '{"active": true}'
```

## Deployment ke Render/Railway (Opsional)

1. Push ke GitHub repository
2. Buat akun di [Render](https://render.com) atau [Railway](https://railway.app)
3. Connect repository, pilih `server.js` sebagai entry point
4. Set environment variables sesuai `.env.example`
5. Deploy

## Klasifikasi Status

| Status | Ambang Batas fn | Kedalaman ds | Tindakan |
|--------|----------------|--------------|----------|
| AMAN | fn < 15.2 Hz | ds < 0.5 cm | Pemantauan rutin |
| WASPADA | 15.2 ≤ fn < 22.4 Hz | 0.5 ≤ ds < 1.5 cm | Inspeksi visual |
| KRITIS | fn ≥ 22.4 Hz | ds ≥ 1.5 cm | Tutup jembatan, darurat |

## Tim Penelitian
**MUSSBIO-GUARD** — Sistem Perlindungan Gerusan Pilar Jembatan Terintegrasi  
Jembatan Jepang, Kesesi, Pekalongan
