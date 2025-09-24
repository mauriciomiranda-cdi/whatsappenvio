const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const app = express();
app.use(express.json());

let client;
let isReady = false;
let currentQR = null;

// Inicializar cliente WhatsApp
function initializeClient() {
    client = new Client({
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

    client.on('qr', async (qr) => {
        console.log('QR Code recebido');
        currentQR = await qrcode.toDataURL(qr);
    });

    client.on('ready', () => {
        console.log('WhatsApp conectado com sucesso!');
        isReady = true;
        currentQR = null; // Limpar QR quando conectado
    });

    client.on('authenticated', () => {
        console.log('WhatsApp autenticado!');
        currentQR = null; // Limpar QR quando autenticado
    });

    client.on('disconnected', (reason) => {
        console.log('WhatsApp desconectado:', reason);
        isReady = false;
        currentQR = null;
    });

    client.initialize();
}

// Rota principal
app.get('/', (req, res) => {
    res.json({ 
        message: 'API WhatsApp funcionando!',
        status: 'online'
    });
});

// Rota de status - CORRIGIDA
app.get('/api/status', (req, res) => {
    if (isReady) {
        // Se já está conectado, não mostrar QR
        res.json({
            status: 'connected',
            ready: true,
            qrCode: null,
            message: 'WhatsApp conectado e pronto para enviar mensagens'
        });
    } else if (currentQR) {
        // Se tem QR disponível mas não está conectado
        res.json({
            status: 'qr_ready',
            ready: false,
            qrCode: currentQR,
            message: 'Escaneie o QR Code para conectar'
        });
    } else {
        // Se não tem QR e não está conectado (inicializando)
        res.json({
            status: 'initializing',
            ready: false,
            qrCode: null,
            message: 'Inicializando WhatsApp Web...'
        });
    }
});

// Rota para enviar mensagem
app.post('/api/send-message', async (req, res) => {
    if (!isReady) {
        return res.status(400).json({
            success: false,
            message: 'WhatsApp não está conectado. Acesse /api/status para conectar.'
        });
    }

    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({
            success: false,
            message: 'Número e mensagem são obrigatórios'
        });
    }

    try {
        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
        await client.sendMessage(chatId, message);
        
        res.json({
            success: true,
            message: 'Mensagem enviada com sucesso!'
        });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao enviar mensagem',
            error: error.message
        });
    }
});

// Inicializar cliente ao iniciar servidor
initializeClient();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});