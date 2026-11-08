// DOM Elemanları
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const passwordInput = document.getElementById('password-input');
const btnLogin = document.getElementById('btn-login');
const loginError = document.getElementById('login-error');
const occupiedWarning = document.getElementById('occupied-warning');
const loginFormArea = document.getElementById('login-form-area');

const btnLogout = document.getElementById('btn-logout');
const uptimeBadge = document.getElementById('uptime-badge');
const ramInfo = document.getElementById('ram-info');
const nodeInfo = document.getElementById('node-info');

const taskList = document.getElementById('task-list');
const newTaskInput = document.getElementById('new-task-input');
const btnAddTask = document.getElementById('btn-add-task');

const notesContainer = document.getElementById('notes-container');
const btnShowNoteModal = document.getElementById('btn-show-note-modal');
const noteModal = document.getElementById('note-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCancelNote = document.getElementById('btn-cancel-note');
const btnSaveNote = document.getElementById('btn-save-note');
const noteTitleInput = document.getElementById('note-title-input');
const noteContentInput = document.getElementById('note-content-input');

let currentStatus = null;
let uptimeTimer = null;

// Durum Kontrolü
async function checkStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        currentStatus = data;

        if (data.system) {
            nodeInfo.textContent = data.system.nodeVersion;
            ramInfo.textContent = `${data.system.freeMemMB} MB boş / ${data.system.totalMemMB} MB`;
        }

        if (data.occupied) {
            occupiedWarning.classList.remove('hidden');
            loginFormArea.style.opacity = '0.5';
            loginError.textContent = 'Şu an başka bir kullanıcı bağlı. Kapasite 1/1 doludur.';
        } else {
            occupiedWarning.classList.add('hidden');
            loginFormArea.style.opacity = '1';
        }

        if (data.authenticated) {
            showDashboard();
            loadUserData();
        } else {
            showLogin();
        }
    } catch (err) {
        console.error('Durum sorgulanamadı:', err);
    }
}

function showLogin() {
    authScreen.classList.remove('hidden');
    appScreen.classList.add('hidden');
    if (uptimeTimer) clearInterval(uptimeTimer);
}

function showDashboard() {
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    startUptimeCounter();
}

function startUptimeCounter() {
    if (uptimeTimer) clearInterval(uptimeTimer);
    let sec = currentStatus ? currentStatus.uptimeSeconds : 0;
    uptimeBadge.textContent = `Uptime: ${formatUptime(sec)}`;
    uptimeTimer = setInterval(() => {
        sec++;
        uptimeBadge.textContent = `Uptime: ${formatUptime(sec)}`;
    }, 1000);
}

function formatUptime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}dk ${s}sn`;
}

// Giriş İşlemi
btnLogin.addEventListener('click', handleLogin);
passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
});

async function handleLogin() {
    loginError.textContent = '';
    const password = passwordInput.value.trim();
    if (!password) {
        loginError.textContent = 'Lütfen şifrenizi girin.';
        return;
    }

    try {
        btnLogin.disabled = true;
        btnLogin.textContent = 'Giriş yapılıyor...';

        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (res.ok && data.success) {
            passwordInput.value = '';
            await checkStatus();
        } else {
            loginError.textContent = data.error || 'Giriş başarısız.';
        }
    } catch (err) {
        loginError.textContent = 'Sunucuya bağlanılamadı.';
    } finally {
        btnLogin.disabled = false;
        btnLogin.innerHTML = '<span>Güvenli Giriş Yap</span><span class="arrow">→</span>';
    }
}

// Çıkış İşlemi
btnLogout.addEventListener('click', async () => {
    try {
        await fetch('/api/logout', { method: 'POST' });
        showLogin();
        checkStatus();
    } catch (err) {
        console.error('Çıkış hatası:', err);
    }
});

// Verileri Yükle (Notlar & Görevler)
async function loadUserData() {
    try {
        const res = await fetch('/api/data');
        if (!res.ok) return;
        const data = await res.json();
        renderNotes(data.notes || []);
        renderTasks(data.tasks || []);
    } catch (err) {
        console.error('Veri yüklenemedi:', err);
    }
}

// Görev Render & İşlemleri
function renderTasks(tasks) {
    taskList.innerHTML = '';
    if (tasks.length === 0) {
        taskList.innerHTML = '<li class="task-item text-muted">Henüz görev eklenmedi.</li>';
        return;
    }
    tasks.forEach(task => {
        const li = document.createElement('li');
        li.className = 'task-item';
        li.innerHTML = `
            <div class="task-content">
                <input type="checkbox" ${task.done ? 'checked' : ''} data-id="${task.id}">
                <span class="${task.done ? 'task-done' : ''}">${escapeHtml(task.text)}</span>
            </div>
            <button class="btn-del" data-id="${task.id}">&times;</button>
        `;
        taskList.appendChild(li);
    });

    // Checkbox event
    taskList.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        chk.addEventListener('change', async (e) => {
            const id = Number(e.target.dataset.id);
            await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'toggle_task', id })
            });
            loadUserData();
        });
    });

    // Silme event
    taskList.querySelectorAll('.btn-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = Number(e.target.dataset.id);
            await fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete_task', id })
            });
            loadUserData();
        });
    });
}

btnAddTask.addEventListener('click', handleAddTask);
newTaskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddTask();
});

async function handleAddTask() {
    const text = newTaskInput.value.trim();
    if (!text) return;
    newTaskInput.value = '';
    await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_task', text })
    });
    loadUserData();
}

// Not Render & İşlemleri
function renderNotes(notes) {
    notesContainer.innerHTML = '';
    if (notes.length === 0) {
        notesContainer.innerHTML = '<p class="text-secondary">Henüz not yok. "+ Yeni Not" butonuna tıklayarak ilk notunu ekle!</p>';
        return;
    }
    notes.forEach(note => {
        const div = document.createElement('div');
        div.className = 'note-card';
        div.innerHTML = `
            <div>
                <h4 class="note-title">${escapeHtml(note.title)}</h4>
                <p class="note-body">${escapeHtml(note.content)}</p>
            </div>
            <div class="note-footer">
                <span class="note-date">${escapeHtml(note.date)}</span>
                <button class="btn-del" data-id="${note.id}" title="Notu Sil">🗑️ Sil</button>
            </div>
        `;
        notesContainer.appendChild(div);
    });

    notesContainer.querySelectorAll('.btn-del').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = Number(e.target.dataset.id);
            if (confirm('Bu notu silmek istediğine emin misin?')) {
                await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'delete_note', id })
                });
                loadUserData();
            }
        });
    });
}

// Modal Kontrolleri
btnShowNoteModal.addEventListener('click', () => {
    noteTitleInput.value = '';
    noteContentInput.value = '';
    noteModal.classList.remove('hidden');
    noteTitleInput.focus();
});

btnCloseModal.addEventListener('click', () => noteModal.classList.add('hidden'));
btnCancelNote.addEventListener('click', () => noteModal.classList.add('hidden'));

btnSaveNote.addEventListener('click', async () => {
    const title = noteTitleInput.value.trim();
    const content = noteContentInput.value.trim();
    if (!title && !content) return;

    await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_note', title, content })
    });

    noteModal.classList.add('hidden');
    loadUserData();
});

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// İlk yükleme
checkStatus();
setInterval(checkStatus, 10000); // 10 saniyede bir durumu güncelle
