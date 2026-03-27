// app.js — Main application: Firebase, form handling, gallery

import { generateScad, validatePitch } from './scad.js';
import { initPreview, updatePreview } from './preview.js';

// ── Firebase Setup ──────────────────────────────────────────

const firebaseConfig = {
    apiKey: "AIzaSyAgZKifbSpZkMjBEDspKjDLxOtmC_QYtBM",
    authDomain: "bottlecap-691da.firebaseapp.com",
    projectId: "bottlecap-691da",
    storageBucket: "bottlecap-691da.firebasestorage.app",
    messagingSenderId: "531741061891",
    appId: "1:531741061891:web:c4c6d432204b0c7ce52f36",
    measurementId: "G-G49Q93DKKR"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;

auth.signInAnonymously().catch(err => {
    console.warn('Anonymous auth failed:', err);
    showToast('Could not connect to cloud. Designs will not be saved.', 'error');
});

auth.onAuthStateChanged(user => {
    currentUser = user;
});

// ── DOM References ──────────────────────────────────────────

const saveModal = document.getElementById('save-modal');
const galleryModal = document.getElementById('gallery-modal');
const toastContainer = document.getElementById('toast-container');

// ── Form Data Collection ────────────────────────────────────

function getBottleData(prefix) {
    const get = (id) => {
        const el = document.getElementById(`${prefix}-${id}`);
        return el ? parseFloat(el.value) || 0 : 0;
    };
    const getInt = (id) => {
        const el = document.getElementById(`${prefix}-${id}`);
        return el ? parseInt(el.value) || 1 : 1;
    };
    const getStr = (id) => {
        const el = document.getElementById(`${prefix}-${id}`);
        return el ? el.value.trim() : '';
    };

    const measuredPitch = get('pitch');
    const threadWidth = get('thread-width');
    const valleyWidth = get('valley-width');

    const { pitch, warning } = validatePitch(measuredPitch, threadWidth, valleyWidth);

    const noteEl = document.getElementById(`${prefix}-pitch-note`);
    if (noteEl) {
        if (measuredPitch > 0 && threadWidth > 0 && valleyWidth > 0) {
            if (warning) {
                noteEl.textContent = warning;
                noteEl.className = 'pitch-note warn';
            } else {
                noteEl.textContent = `Measurements consistent -- pitch: ${pitch.toFixed(2)} mm`;
                noteEl.className = 'pitch-note ok';
            }
            noteEl.style.display = 'block';
        } else {
            noteEl.style.display = 'none';
        }
    }

    return {
        label: getStr('label') || (prefix === 'a' ? 'Bottle A' : 'Bottle B'),
        od: get('od'),
        pitch: pitch > 0 ? pitch : measuredPitch,
        threadWidth: threadWidth,
        valleyWidth: valleyWidth,
        starts: getInt('starts'),
        depth: get('depth'),
        turns: get('turns'),
        wall: get('wall'),
    };
}

function getFormData() {
    return {
        bottleA: getBottleData('a'),
        bottleB: getBottleData('b'),
        clearance: parseFloat(document.getElementById('clearance').value) || 0.3,
        connectorHeight: parseFloat(document.getElementById('connector-h').value) || 8.0,
    };
}

function isFormValid(data) {
    const isBottleValid = (b) => (
        b.od > 0 && b.pitch > 0 && b.threadWidth > 0 &&
        b.starts >= 1 && b.depth > 0 && b.turns > 0 && b.wall > 0
    );
    return isBottleValid(data.bottleA) && isBottleValid(data.bottleB);
}

// ── Preview Update ──────────────────────────────────────────

let previewDebounce = null;

function refreshPreview() {
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(() => {
        const data = getFormData();
        if (!isFormValid(data)) return;

        try {
            const info = updatePreview(
                data.bottleA, data.bottleB,
                data.clearance, data.connectorHeight
            );

            document.getElementById('stat-height').textContent = info.total_h.toFixed(1) + ' mm';
            document.getElementById('stat-od').textContent = (info.conn_r * 2).toFixed(1) + ' mm';
            document.getElementById('stat-bore').textContent = (info.flow_r * 2).toFixed(1) + ' mm';
            document.getElementById('stat-cap-a').textContent = info.a_cap_h.toFixed(1) + ' mm';
            document.getElementById('stat-cap-b').textContent = info.b_cap_h.toFixed(1) + ' mm';
        } catch (err) {
            console.error('Preview error:', err);
        }
    }, 300);
}

// Listen to all form inputs for live preview
document.querySelectorAll('.form-panel input').forEach(input => {
    input.addEventListener('input', refreshPreview);
});

// Generate button also refreshes preview
document.getElementById('btn-generate').addEventListener('click', () => {
    const data = getFormData();
    if (!isFormValid(data)) {
        showToast('Please fill in all measurements for both bottles.', 'error');
        return;
    }
    refreshPreview();
    showToast('Preview updated.', 'success');
});

// ── SCAD Download ───────────────────────────────────────────

document.getElementById('btn-download').addEventListener('click', () => {
    const data = getFormData();
    if (!isFormValid(data)) {
        showToast('Please fill in all measurements for both bottles.', 'error');
        return;
    }

    const scadCode = generateScad(
        data.bottleA, data.bottleB,
        data.clearance, data.connectorHeight
    );

    const blob = new Blob([scadCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'adapter.scad';
    a.click();
    URL.revokeObjectURL(url);

    showToast('OpenSCAD file downloaded. Open in OpenSCAD and press F6 to render.', 'success');
});

// ── Save Design ─────────────────────────────────────────────

document.getElementById('btn-save').addEventListener('click', () => {
    const data = getFormData();
    if (!isFormValid(data)) {
        showToast('Please fill in all measurements before saving.', 'error');
        return;
    }

    document.getElementById('save-name').value =
        `${data.bottleA.label} to ${data.bottleB.label}`;
    document.getElementById('save-desc').value = '';
    document.getElementById('save-image').value = '';

    saveModal.classList.add('open');
});

document.getElementById('save-cancel').addEventListener('click', () => {
    saveModal.classList.remove('open');
});

saveModal.addEventListener('click', (e) => {
    if (e.target === saveModal) saveModal.classList.remove('open');
});

document.getElementById('save-confirm').addEventListener('click', async () => {
    if (!currentUser) {
        showToast('Not connected to cloud. Please refresh and try again.', 'error');
        return;
    }

    const data = getFormData();
    const name = document.getElementById('save-name').value.trim();
    const description = document.getElementById('save-desc').value.trim();
    const imageUrl = document.getElementById('save-image').value.trim();

    if (!name) {
        showToast('Please enter a design name.', 'error');
        return;
    }

    const btn = document.getElementById('save-confirm');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        await db.collection('designs').add({
            name,
            description,
            imageUrl,
            bottleA: data.bottleA,
            bottleB: data.bottleB,
            clearance: data.clearance,
            connectorHeight: data.connectorHeight,
            createdBy: currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        saveModal.classList.remove('open');
        showToast('Design saved to community gallery!', 'success');
    } catch (err) {
        console.error('Save error:', err);
        showToast('Failed to save: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
    }
});

// ── Gallery (Modal) ─────────────────────────────────────────

let galleryCache = [];

document.getElementById('btn-load').addEventListener('click', () => {
    galleryModal.classList.add('open');
    loadGallery();
});

document.getElementById('gallery-close').addEventListener('click', () => {
    galleryModal.classList.remove('open');
});

galleryModal.addEventListener('click', (e) => {
    if (e.target === galleryModal) galleryModal.classList.remove('open');
});

async function loadGallery() {
    const grid = document.getElementById('gallery-grid');
    grid.innerHTML = '<div class="spinner"></div>';

    try {
        const snapshot = await db.collection('designs')
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();

        galleryCache = [];
        snapshot.forEach(doc => {
            galleryCache.push({ id: doc.id, ...doc.data() });
        });

        renderGallery(galleryCache);
    } catch (err) {
        console.error('Gallery load error:', err);
        grid.innerHTML = `<div class="empty-state">
            <p>Could not load designs. Check your connection and Firestore rules.</p>
        </div>`;
    }
}

function renderGallery(designs) {
    const grid = document.getElementById('gallery-grid');

    if (designs.length === 0) {
        grid.innerHTML = `<div class="empty-state">
            <p>No designs yet. Be the first to save one!</p>
        </div>`;
        return;
    }

    grid.innerHTML = designs.map(d => {
        const isMine = currentUser && d.createdBy === currentUser.uid;
        const aOD = d.bottleA?.od?.toFixed(1) || '?';
        const bOD = d.bottleB?.od?.toFixed(1) || '?';
        const dateStr = d.createdAt
            ? new Date(d.createdAt.seconds * 1000).toLocaleDateString()
            : '';

        return `<div class="design-card" data-id="${d.id}">
            <div class="card-image">
                ${d.imageUrl
                    ? `<img src="${sanitizeUrl(d.imageUrl)}" alt="${esc(d.name)}" loading="lazy"
                           onerror="this.parentElement.innerHTML='<span class=placeholder>&#x1f9f4;</span>'">`
                    : '<span class="placeholder">&#x1f9f4;</span>'}
            </div>
            <div class="card-body">
                <h4>${esc(d.name)}${isMine ? ' <span class="my-badge">mine</span>' : ''}</h4>
                <div class="card-specs">A: ${aOD}mm | B: ${bOD}mm</div>
            </div>
            <div class="card-footer">
                <span>${dateStr}</span>
                <div style="display:flex;gap:4px;">
                    <button class="btn btn-load" data-id="${d.id}">Load</button>
                    ${isMine ? `<button class="btn btn-danger btn-delete" data-id="${d.id}">Delete</button>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.btn-load').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            loadDesign(btn.dataset.id);
        });
    });

    grid.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm('Delete this design?')) {
                await deleteDesign(btn.dataset.id);
            }
        });
    });
}

function loadDesign(id) {
    const design = galleryCache.find(d => d.id === id);
    if (!design) return;

    populateBottle('a', design.bottleA);
    populateBottle('b', design.bottleB);

    document.getElementById('clearance').value = design.clearance ?? 0.3;
    document.getElementById('connector-h').value = design.connectorHeight ?? 8.0;

    galleryModal.classList.remove('open');
    refreshPreview();
    showToast(`Loaded "${design.name}"`, 'success');
}

function populateBottle(prefix, data) {
    if (!data) return;
    const set = (id, val) => {
        const el = document.getElementById(`${prefix}-${id}`);
        if (el && val != null) el.value = val;
    };

    set('label', data.label);
    set('od', data.od);
    set('pitch', data.pitch);
    set('thread-width', data.threadWidth);
    set('valley-width', data.valleyWidth);
    set('starts', data.starts);
    set('depth', data.depth);
    set('turns', data.turns);
    set('wall', data.wall);
}

async function deleteDesign(id) {
    try {
        await db.collection('designs').doc(id).delete();
        showToast('Design deleted.', 'success');
        loadGallery();
    } catch (err) {
        showToast('Delete failed: ' + err.message, 'error');
    }
}

document.getElementById('gallery-search').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    if (!query) {
        renderGallery(galleryCache);
        return;
    }
    const filtered = galleryCache.filter(d =>
        d.name?.toLowerCase().includes(query) ||
        d.description?.toLowerCase().includes(query) ||
        d.bottleA?.label?.toLowerCase().includes(query) ||
        d.bottleB?.label?.toLowerCase().includes(query)
    );
    renderGallery(filtered);
});

// ── Utilities ───────────────────────────────────────────────

function esc(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function sanitizeUrl(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.href;
        }
    } catch {}
    return '';
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ── Initialize ──────────────────────────────────────────────

initPreview(document.getElementById('preview-container'));
