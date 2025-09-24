const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js'); // Adicione MessageMedia aqui
const qrcode = require('qrcode');
const multer = require('multer'); // Importa multer para lidar com upload de arquivos
const csv = require('csv-parser'); // Importa csv-parser para ler CSV
const fs = require('fs'); // Importa fs para lidar com arquivos no sistema

const app = express();
app.use(express.json());

// Configuração do Multer para upload de CSV
// O arquivo será salvo temporariamente na pasta 'uploads/'
const upload = multer({ dest: 'uploads/' });

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
                '--disable-gpu',
                '--incognito', // Ajuda a evitar alguns problemas de cache
                '--unlimited-storage', // Permite mais espaço de armazenamento
                '--disable-features=site-per-process' // Ajuda em alguns cenários
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
        // Opcional: tentar reiniciar o cliente após desconexão
        // console.log('Tentando reiniciar o cliente WhatsApp...');
        // setTimeout(initializeClient, 5000);
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

// Rota de status
app.get('/api/status', (req, res) => {
    if (isReady) {
        res.json({
            status: 'connected',
            ready: true,
            qrCode: null,
            message: 'WhatsApp conectado e pronto para enviar mensagens'
        });
    } else if (currentQR) {
        res.json({
            status: 'qr_ready',
            ready: false,
            qrCode: currentQR,
            message: 'Escaneie o QR Code para conectar'
        });
    } else {
        res.json({
            status: 'initializing',
            ready: false,
            qrCode: null,
            message: 'Inicializando WhatsApp Web...'
        });
    }
});

// Rota para enviar mensagem individual (mantida)
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

// NOVA ROTA: Upload de CSV
app.post('/api/upload-csv', upload.single('csvFile'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'Nenhum arquivo CSV enviado.' });
    }

    const results = [];
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => {
            // Garantir que os dados do CSV estão no formato esperado (ex: { number: '...', name: '...' })
            // As chaves dependem do cabeçalho do seu CSV.
            // Exemplo: se seu CSV tem colunas 'Numero' e 'Nome', você pode ajustar:
            // results.push({ number: data.Numero, name: data.Nome });
            results.push(data); // Pega os dados como estão
        })
        .on('end', () => {
            // Remover o arquivo temporário após o processamento
            fs.unlinkSync(req.file.path);
            res.json({ success: true, contacts: results, message: `CSV processado, ${results.length} contatos encontrados.` });
        })
        .on('error', (error) => {
            if (fs.existsSync(req.file.path)) { // Verifica se o arquivo ainda existe antes de tentar apagar
                fs.unlinkSync(req.file.path);
            }
            console.error('Erro ao processar o CSV:', error);
            res.status(500).json({ success: false, message: 'Erro ao processar o CSV.', error: error.message });
        });
});

// NOVA ROTA: Enviar mensagens em massa com personalização, delay e imagem
app.post('/api/send-bulk', async (req, res) => {
    if (!isReady) {
        return res.status(400).json({
            success: false,
            message: 'WhatsApp não está conectado. Acesse /api/status para conectar.'
        });
    }

    const { contacts, messageTemplate, minDelayMs, maxDelayMs, imageUrl } = req.body;

    if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
        return res.status(400).json({ success: false, message: 'Lista de contatos é obrigatória.' });
    }
    if (!messageTemplate) {
        return res.status(400).json({ success: false, message: 'Modelo de mensagem é obrigatório.' });
    }
    if (isNaN(minDelayMs) || isNaN(maxDelayMs) || minDelayMs < 0 || maxDelayMs < minDelayMs) {
        return res.status(400).json({ success: false, message: 'Delays mínimos e máximos válidos são obrigatórios.' });
    }

    const results = [];
    let media = null;

    if (imageUrl) {
        try {
            console.log('Tentando carregar imagem da URL:', imageUrl);
            media = await MessageMedia.fromUrl(imageUrl);
            console.log('Imagem carregada com sucesso.');
        } catch (mediaError) {
            console.error('Erro ao carregar imagem da URL:', imageUrl, mediaError.message);
            // Continua sem imagem se houver erro ao carregar a imagem
            media = null;
        }
    }

    // Inicia o envio em background para não bloquear a requisição HTTP
    // O cliente pode monitorar o progresso em outra rota se necessário
    res.json({ success: true, message: 'Iniciando envio em massa. Verifique os logs para o progresso.' });

    for (const contact of contacts) {
        const number = contact.number;
        const name = contact.name || 'Cliente'; // Padrão 'Cliente' se não houver nome

        // Personalizar a mensagem - substitui {nome} pelo nome do contato
        let personalizedMessage = messageTemplate.replace(/{nome}/g, name);
        // Adicione outras personalizações aqui, se necessário (ex: {email}, {data})

        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;

        try {
            if (media) {
                 await client.sendMessage(chatId, media, { caption: personalizedMessage });
            } else {
                 await client.sendMessage(chatId, personalizedMessage);
            }
            results.push({ number, status: 'success', message: 'Enviado' });
            console.log(`Mensagem para ${name} (${number}) enviada com sucesso.`);
        } catch (error) {
            results.push({ number, status: 'failed', error: error.message });
            console.error(`Erro ao enviar mensagem para ${name} (${number}):`, error.message);
        }

        // Aplicar delay programável entre minDelayMs e maxDelayMs
        const delay = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
        console.log(`Aguardando ${delay / 1000} segundos antes do próximo envio...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    console.log('Envio em massa concluído para todos os contatos.');
    // Você pode querer logar ou persistir os resultados finais aqui.
});


// Inicializar cliente ao iniciar servidor
initializeClient();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});