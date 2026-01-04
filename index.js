const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const HISTORICO_PATH = path.join(__dirname, 'historico.json');

async function garantirHistorico() {
    try {
        await fs.access(HISTORICO_PATH);
        console.log('✅ historico.json encontrado');
    } catch {
        console.log('⚠️ historico.json não existe. Criando...');
        await fs.writeFile(HISTORICO_PATH, JSON.stringify([], null, 2));
        console.log('✅ historico.json criado com sucesso');
    }
}

async function lerHistorico() {
    try {
        await garantirHistorico();
        const data = await fs.readFile(HISTORICO_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error('❌ Erro ao ler histórico:', error);
        return [];
    }
}

async function salvarHistorico(dados) {
    try {
        await fs.writeFile(HISTORICO_PATH, JSON.stringify(dados, null, 2));
        console.log('✅ Histórico salvo com sucesso');
    } catch (error) {
        console.error('❌ Erro ao salvar histórico:', error);
    }
}

async function rasparDados() {
    let browser;
    try {
        console.log('🚀 Iniciando raspagem...');

        browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
    ]
});

        const page = await browser.newPage();
        await page.goto('https://www.pizzint.watch', { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });

        await page.waitForSelector('.pizzaria-card', { timeout: 10000 });

        const dados = await page.evaluate(() => {
            const pizzarias = {};
            const cards = document.querySelectorAll('.pizzaria-card');

            cards.forEach(card => {
                const nome = card.querySelector('h3')?.textContent.trim();
                const valorTexto = card.querySelector('.pizzaria-value')?.textContent.trim();
                const valor = parseInt(valorTexto);

                if (nome && !isNaN(valor)) {
                    const nomeNormalizado = nome.toLowerCase()
                        .replace(/[^a-z0-9]/g, '_')
                        .replace(/_+/g, '_');

                    pizzarias[nomeNormalizado] = {
                        valor: valor,
                        anomalia: false
                    };
                }
            });

            return pizzarias;
        });

        await browser.close();

        const valores = Object.values(dados).map(p => p.valor);
        const media = valores.reduce((a, b) => a + b, 0) / valores.length;
        const desvio = Math.sqrt(valores.reduce((sum, val) => sum + Math.pow(val - media, 2), 0) / valores.length);

        let temAnomalia = false;
        Object.keys(dados).forEach(key => {
            const diff = Math.abs(dados[key].valor - media);
            if (diff > 2 * desvio) {
                dados[key].anomalia = true;
                temAnomalia = true;
            }
        });

        const resultado = {
            timestamp: new Date().toISOString(),
            pizzarias: dados,
            temAnomalia: temAnomalia
        };

        console.log('✅ Raspagem concluída:', resultado);
        return resultado;

    } catch (error) {
        console.error('❌ Erro na raspagem:', error.message);
        if (browser) await browser.close();
        return null;
    }
}

async function atualizarHistorico() {
    try {
        const novosDados = await rasparDados();
        if (!novosDados) {
            console.log('⚠️ Raspagem falhou, mantendo histórico atual');
            return;
        }

        const historico = await lerHistorico();
        historico.push(novosDados);

        const LIMITE = 288;
        if (historico.length > LIMITE) {
            historico.splice(0, historico.length - LIMITE);
        }

        await salvarHistorico(historico);
        console.log(`✅ Histórico atualizado: ${historico.length} registros`);

    } catch (error) {
        console.error('❌ Erro ao atualizar histórico:', error);
    }
}

app.get('/api/status', async (req, res) => {
    try {
        const historico = await lerHistorico();
        const ultimaColeta = historico.length > 0 
            ? historico[historico.length - 1].timestamp 
            : null;

        res.json({
            status: 'online',
            ultima_coleta: ultimaColeta,
            total_historico: historico.length,
            periodo_historico_dias: 7,
            proximo_update: 'A cada 5 minutos'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/pizzas', async (req, res) => {
    try {
        const historico = await lerHistorico();

        if (historico.length === 0) {
            return res.status(404).json({ 
                error: 'Nenhum dado disponível ainda. Aguarde a primeira coleta.' 
            });
        }

        res.json(historico[historico.length - 1]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/historico', async (req, res) => {
    try {
        const historico = await lerHistorico();
        res.json({
            total: historico.length,
            registros: historico
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, async () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);

    await garantirHistorico();

    console.log('⏳ Iniciando primeira coleta...');
    await atualizarHistorico();

    setInterval(atualizarHistorico, 5 * 60 * 1000);
    console.log('✅ Coletas agendadas a cada 5 minutos');
});
