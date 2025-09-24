const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json());

// Configuração do multer para upload
const upload = multer({ dest: 'uploads/' });

// Cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

let qrCodeString = null;
let isReady = false;
let connectionStatus = 'disconnected';

// Eventos do WhatsApp
client.on('qr', async (qr) => {
    console.log('QR Code gerado');
    qrCodeString = await QRCode.toDataURL(qr);
    connectionStatus = 'qr_ready';
});

client.on('ready', () => {
    console.log('WhatsApp conectado!');
    isReady = true;
    connectionStatus = 'connected';
});

client.on('disconnected', () => {
    console.log('WhatsApp desconectado');
    isReady = false;
    connectionStatus = 'disconnected';
    qrCodeString = null;
});

// Rotas da API
app.get('/', (req, res) => {
    res.json({ message: 'WhatsApp Sender API funcionando!' });
});

app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        ready: isReady,
        qrCode: qrCodeString
    });
});

app.post('/api/upload-csv', upload.single('csv'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const contacts = [];
    
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (row) => {
            // Assumindo colunas: nome, numero
            if (row.nome && row.numero) {
                contacts.push({
                    nome: row.nome.trim(),
                    numero: row.numero.replace(/\D/g, '') // Remove caracteres não numéricos
                });
            }
        })
        .on('end', () => {
            // Remove arquivo temporário
            fs.unlinkSync(req.file.path);
            res.json({ contacts, total: contacts.length });
        })
        .on('error', (error) => {
            res.status(500).json({ error: 'Erro ao processar CSV' });
        });
});

app.post('/api/send-bulk', async (req, res) => {
    if (!isReady) {
        return res.status(400).json({ error: 'WhatsApp não conectado' });
    }

    const { contacts, messages, delay } = req.body;
    
    if (!contacts || !messages || !Array.isArray(contacts) || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Dados inválidos' });
    }

    res.json({ message: 'Envio iniciado', total: contacts.length });

    // Processar envios em background
    processMessages(contacts, messages, delay || 5000);
});

async function processMessages(contacts, messages, delay) {
    for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        
        // Substituir variáveis na mensagem
        const personalizedMessage = randomMessage
            .replace(/{nome}/g, contact.nome)
            .replace(/{numero}/g, contact.numero);

        try {
            const chatId = `55${contact.numero}@c.us`; // Formato brasileiro
            await client.sendMessage(chatId, personalizedMessage);
            console.log(`Mensagem enviada para ${contact.nome} (${contact.numero})`);
        } catch (error) {
            console.error(`Erro ao enviar para ${contact.nome}:`, error.message);
        }

        // Delay entre mensagens
        if (i < contacts.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    console.log('Envio em lote concluído');
}

app.post('/api/restart', (req, res) => {
    client.destroy();
    setTimeout(() => {
        client.initialize();
    }, 2000);
    res.json({ message: 'Reiniciando conexão...' });
});

// Inicializar cliente
client.initialize();

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});