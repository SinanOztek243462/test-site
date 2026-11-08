const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'storage.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Tek kişilik sunucu ayarları
const MASTER_PASSWORD = process.env.SITE_PASSWORD || '123456'; // İsteğe göre değiştirilebilir
let activeSession = null; // Sadece 1 kişinin aktif oturumu olabilir
let sessionExpiry = null;
const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 saat geçerli

// Veri klasörünü ve dosyasını hazırla
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
        notes: [
            { id: 1, title: 'Hoş Geldin!', content: 'Bu sunucu ve internet sitesi sıfır maliyetle sadece senin için kuruldu. Senden başka kimse giremez.', date: new Date().toLocaleString('tr-TR') }
        ],
        tasks: [
            { id: 1, text: 'Şifreni server.js veya arayüzden güncelle', done: false },
            { id: 2, text: 'Yeni notlarını ekle', done: true }
        ]
    }, null, 2));
}

function readData() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    } catch (e) {
        return { notes: [], tasks: [] };
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function isSessionValid(token) {
    if (!token || !activeSession) return false;
    if (activeSession.token !== token) return false;
    if (Date.now() > sessionExpiry) {
        activeSession = null;
        sessionExpiry = null;
        return false;
    }
    // Oturumu uzat
    sessionExpiry = Date.now() + SESSION_DURATION_MS;
    return true;
}

function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        let [name, ...rest] = cookie.split('=');
        name = name?.trim();
        if (!name) return;
        const value = rest.join('=').trim();
        list[name] = decodeURIComponent(value);
    });
    return list;
}

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const cookies = parseCookies(req.headers.cookie);
    const clientToken = cookies.session_token || req.headers['x-session-token'];

    // CORS ve Güvenlik Başlıkları
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    // API: Durum Sorgulama (Oturum var mı, kim bağlı?)
    if (pathname === '/api/status' && req.method === 'GET') {
        const isAuth = isSessionValid(clientToken);
        const isOccupiedByAnother = activeSession !== null && activeSession.token !== clientToken && Date.now() <= sessionExpiry;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            occupied: isOccupiedByAnother,
            authenticated: isAuth,
            capacity: "1 Kişi (Maksimum)",
            activeUsers: activeSession ? 1 : 0,
            uptimeSeconds: Math.floor(process.uptime()),
            system: {
                platform: os.platform(),
                nodeVersion: process.version,
                freeMemMB: Math.round(os.freemem() / (1024 * 1024)),
                totalMemMB: Math.round(os.totalmem() / (1024 * 1024))
            }
        }));
    }

    // API: Giriş Yap (Login)
    if (pathname === '/api/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { password } = JSON.parse(body);

                // Tek kişilik kuralı kontrolü
                if (activeSession && Date.now() <= sessionExpiry && activeSession.token !== clientToken) {
                    res.writeHead(403, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({
                        error: 'Sunucu Dolu! Bu sunucu sadece 1 kişiliktir ve şu anda aktif bir kullanıcı içeride.'
                    }));
                }

                if (password === MASTER_PASSWORD) {
                    const newToken = crypto.randomBytes(32).toString('hex');
                    activeSession = {
                        token: newToken,
                        ip: req.socket.remoteAddress,
                        loginTime: new Date()
                    };
                    sessionExpiry = Date.now() + SESSION_DURATION_MS;

                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Set-Cookie': `session_token=${newToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`
                    });
                    return res.end(JSON.stringify({ success: true, token: newToken }));
                } else {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Geçersiz Şifre! Giriş reddedildi.' }));
                }
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Hatalı İstek' }));
            }
        });
        return;
    }

    // API: Çıkış Yap (Logout)
    if (pathname === '/api/logout' && req.method === 'POST') {
        if (clientToken && activeSession && activeSession.token === clientToken) {
            activeSession = null;
            sessionExpiry = null;
        }
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
        });
        return res.end(JSON.stringify({ success: true }));
    }

    // Korumalı Alanlar için Oturum Doğrulaması
    if (pathname.startsWith('/api/data')) {
        if (!isSessionValid(clientToken)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Yetkisiz erişim. Lütfen giriş yapın.' }));
        }

        const data = readData();

        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(data));
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body);
                    if (payload.action === 'add_note') {
                        data.notes.unshift({
                            id: Date.now(),
                            title: payload.title || 'Başlıksız Not',
                            content: payload.content || '',
                            date: new Date().toLocaleString('tr-TR')
                        });
                    } else if (payload.action === 'delete_note') {
                        data.notes = data.notes.filter(n => n.id !== payload.id);
                    } else if (payload.action === 'toggle_task') {
                        const t = data.tasks.find(t => t.id === payload.id);
                        if (t) t.done = !t.done;
                    } else if (payload.action === 'add_task') {
                        data.tasks.push({
                            id: Date.now(),
                            text: payload.text,
                            done: false
                        });
                    } else if (payload.action === 'delete_task') {
                        data.tasks = data.tasks.filter(t => t.id !== payload.id);
                    }
                    saveData(data);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify(data));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'İşlem hatası' }));
                }
            });
            return;
        }
    }

    // Statik Dosyaları Sunma
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    
    // Güvenlik: Path Traversal Koruması
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        return res.end('Yasaklı Dizin');
    }

    const extname = path.extname(filePath);
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml'
    };

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, fallback) => {
                    if (err2) {
                        res.writeHead(404);
                        return res.end('Sayfa Bulunamadı');
                    }
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(fallback);
                });
            } else {
                res.writeHead(500);
                res.end(`Sunucu Hatası: ${err.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': mimeTypes[extname] || 'application/octet-stream' });
            res.end(content);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🚀 Tek Kişilik Özel Web Sunucusu Başlatıldı!`);
    console.log(`📍 Yerel Erişim: http://localhost:${PORT}`);
    console.log(`🔐 Giriş Şifresi: ${MASTER_PASSWORD}`);
    console.log(`👤 Kapasite Sınırı: SADECE 1 KİŞİ`);
    console.log(`====================================================`);
});
