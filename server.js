const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, serverTimestamp, query, where, getDocs, limit } = require('firebase/firestore');

// --- KONFIGURASI ---
// GANTI DENGAN SECRET KEY XENDIT ANDA
const XENDIT_API_KEY = 'xnd_development_Mqah4sSt1fb3nX6FbsX1IlhrLes9q3lBDflJbH6s6rPpK8qRwi2dlnLTirXN1'; 
// GANTI DENGAN TOKEN VERIFIKASI DARI DASHBOARD XENDIT WEBHOOK ANDA
const XENDIT_WEBHOOK_TOKEN = 'uslDAwsDPqK8thybOq6QVgzzDQ8cthkxuwrE9nh7h8Sx6sGr'; 

// PASTE KONFIGURASI FIREBASE BARU ANDA DI SINI
const firebaseConfig = {
  apiKey: "AIzaSyCN5vDFv2vHHwIDN6aLezQcsDSyIEvdWpM",
  authDomain: "wreda-assalam.firebaseapp.com",
  projectId: "wreda-assalam",
  storageBucket: "wreda-assalam.firebasestorage.app",
  messagingSenderId: "1051904934369",
  appId: "1:1051904934369:web:2047f406dad5d1958fd2a0",
  measurementId: "G-S2L0JK0J98"
};

// --- INISIALISASI ---
const app = express();
app.use(cors());
// PENTING: Gunakan express.json() SEBELUM semua endpoint yang membutuhkannya
app.use(express.json()); 
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const XENDIT_API_URL = 'https://api.xendit.co/v2/invoices';

// --- ENDPOINTS ---

// Endpoint untuk MEMBUAT INVOICE
app.post('/create-invoice', async (req, res) => {
    try {
        const { amount, name, email } = req.body;
        if (!amount || !name || !email) {
            return res.status(400).json({ error: 'Data tidak lengkap.' });
        }
        const externalId = `panti-donation-${Date.now()}`;
        
        const invoiceData = {
            external_id: externalId,
            amount,
            payer_email: email,
            description: `Donasi dari ${name} untuk Panti Wreda Assalam`,
            invoice_duration: 60,
            success_redirect_url: `https://milhtnndaa.github.io/panti-wreda-website/terima-kasih.html?external_id=${externalId}`,
            failure_redirect_url: 'https://milhtnndaa.github.io/panti-wreda-website/gagal.html',
        };

        const response = await axios.post(XENDIT_API_URL, invoiceData, {
            headers: {
                'Authorization': `Basic ${Buffer.from(XENDIT_API_KEY + ':').toString('base64')}`,
            }
        });
        res.json({ invoice_url: response.data.invoice_url });
    } catch (error) {
        console.error('Error creating invoice:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Gagal membuat invoice' });
    }
});

// Endpoint untuk MENGAMBIL DETAIL INVOICE
app.get('/get-invoice', async (req, res) => {
    try {
        const { id } = req.query; 
        if (!id) return res.status(400).json({ error: 'ID Eksternal tidak ditemukan.' });
        
        const response = await axios.get(`https://api.xendit.co/v2/invoices?external_id=${id}`, {
             headers: { 'Authorization': `Basic ${Buffer.from(XENDIT_API_KEY + ':').toString('base64')}` }
        });

        if (response.data.length === 0) return res.status(404).json({ error: 'Invoice tidak ditemukan.' });
        
        res.json(response.data[0]);
    } catch (error) {
        console.error('Error getting invoice:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Gagal mengambil detail invoice' });
    }
});

// Endpoint WEBHOOK dari Xendit
app.post('/xendit-webhook', async (req, res) => {
    console.log('--- [LOG] Webhook Diterima! ---');
    console.log('[LOG] Raw Body:', JSON.stringify(req.body, null, 2)); // Log Body mentah
    console.log(`[LOG] Header Token: ${req.headers['x-callback-token']}`);
    console.log(`[LOG] Expected Token: ${XENDIT_WEBHOOK_TOKEN}`);

    try {
        if (req.headers['x-callback-token'] !== XENDIT_WEBHOOK_TOKEN) {
            console.error('[ERROR] TOKEN WEBHOOK TIDAK VALID!');
            return res.status(403).send('Forbidden - Invalid Token');
        }
        console.log('[LOG] Token webhook valid.');

        // PERBAIKAN: Gunakan req.body langsung, karena Xendit mungkin tidak selalu mengirim 'event' dan 'data'
        const webhookData = req.body; 

        if (webhookData && webhookData.status === 'PAID') {
            console.log(`[LOG] Status PAID terdeteksi untuk ID: ${webhookData.external_id}`);
            const { amount, payer_email, description, paid_at } = webhookData;
            
            const nameMatch = description.match(/Donasi dari (.*) untuk/);
            const donaturName = nameMatch ? nameMatch[1] : (payer_email || 'Hamba Allah');
            
            const paidDate = new Date(paid_at);
            const bulanTahunPaid = paidDate.toLocaleString('id-ID', { month: 'long', year: 'numeric' });

            console.log(`[LOG] Mencari laporan untuk bulan: "${bulanTahunPaid}"`);

            const laporanQuery = query(collection(db, "laporanBulanan"), where("bulanTahun", "==", bulanTahunPaid), limit(1));
            const laporanSnapshot = await getDocs(laporanQuery);

            if (!laporanSnapshot.empty) {
                const laporanId = laporanSnapshot.docs[0].id;
                console.log(`[LOG] Laporan ditemukan (ID: ${laporanId}). Menyimpan transaksi...`);

                await addDoc(collection(db, "transaksi"), {
                    laporanId,
                    tipe: 'pemasukan',
                    kategori: 'Donasi Online',
                    deskripsi: donaturName,
                    jumlah: amount,
                    tanggal: paidDate,
                    createdAt: serverTimestamp()
                });

                console.log(`--- [SUKSES] Donasi dari ${donaturName} berhasil dicatat. ---`);
            } else {
                 console.warn(`--- [PERINGATAN] Laporan untuk bulan "${bulanTahunPaid}" tidak ditemukan. Donasi ${webhookData.external_id} belum tercatat. ---`);
            }
        } else {
            console.log(`[LOG] Event diterima, tetapi status bukan PAID. Status: ${webhookData ? webhookData.status : 'Tidak diketahui'}`);
        }
        res.status(200).send('Webhook Processed');
    } catch (error) {
        console.error('!!! [ERROR FATAL PADA WEBHOOK]:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(3000, () => {
    console.log('Server backend berjalan di http://localhost:3000');
});
