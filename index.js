const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração CORS
app.use(cors());
app.use(express.json());

// Caminho do arquivo de histórico
const HISTORICO_PATH = path.join(__dirname, 'historico.json');

// ========================================
// FUNÇÃO: Garantir que historico.json existe
// ========================================
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

// ========================================
// FUNÇÃO: Ler histórico
// ========================================
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

// ========================================
// FUNÇÃO: Salvar histórico
// ========================================
async function salvarHistorico(dados) {
    try {
        await fs.writeFile(HISTORICO_PATH, JSON.stringify(dados, null, 2));
        console.log('✅ Histórico salvo com sucesso');
    } catch (error) {
        console.error('❌ Erro ao salvar histórico:', error);
    }
}

// ========================================
// FUNÇÃO: Raspar dados do pizzint.watch
// ========================================
async function rasparDados() {
    let browser;
    try {
        console.log('🚀 Iniciando raspagem...');

        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.goto('https://www.pizzint.watch', { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });

        // Aguardar elementos carregarem
        await page.waitForSelector('.pizzaria-card', { timeout: 10000 });

        // Extrair dados
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

        // Detectar anomalias
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

// ========================================
// FUNÇÃO: Atualizar histórico
// ========================================
async function atualizarHistorico() {
    try {
        const novosDados = await rasparDados();
        if (!novosDados) {
            console.log('⚠️ Raspagem falhou, mantendo histórico atual');
            return;
        }

        const historico = await lerHistorico();
        historico.push(novosDados);

        // Manter apenas últimos 7 dias (288 registros = 7 dias * 24h * 12 coletas/hora)
        const LIMITE = 288;
        if (historico.length > LIMITE) {
            historico.splice(0, historico.length - LIMITE);
        }

        await salvarHistorico(historico);
        console.log(`✅ Histórico atualizado: ${historico.length} registros`);

    } catch (error) {
        console.error('❌ Erro ao atualizar histórico:', error);


