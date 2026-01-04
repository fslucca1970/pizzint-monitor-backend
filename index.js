const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Arquivo para armazenar histórico
const HISTORICO_FILE = path.join(__dirname, 'historico.json');

// Carregar histórico do arquivo (se existir)
let historico = [];
if (fs.existsSync(HISTORICO_FILE)) {
    try {
        const data = fs.readFileSync(HISTORICO_FILE, 'utf8');
        historico = JSON.parse(data);
        console.log(`✅ Histórico carregado: ${historico.length} registros`);
    } catch (erro) {
        console.error('❌ Erro ao carregar histórico:', erro);
        historico = [];
    }
}

let dadosCache = null;

// Função para salvar histórico no arquivo
function salvarHistorico() {
    try {
        fs.writeFileSync(HISTORICO_FILE, JSON.stringify(historico, null, 2));
        console.log('💾 Histórico salvo no arquivo');
    } catch (erro) {
        console.error('❌ Erro ao salvar histórico:', erro);
    }
}

// Função para limpar registros antigos (mais de 7 dias)
function limparHistoricoAntigo() {
    const seteDiasAtras = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const tamanhoAntes = historico.length;

    historico = historico.filter(registro => {
        const timestamp = new Date(registro.timestamp).getTime();
        return timestamp > seteDiasAtras;
    });

    if (historico.length < tamanhoAntes) {
        console.log(`🗑️ Removidos ${tamanhoAntes - historico.length} registros antigos`);
        salvarHistorico();
    }
}

// Função para raspar dados
async function rasparDados() {
    console.log('🔍 Coletando dados do pizzint.watch...');

    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    try {
        await page.goto('https://www.pizzint.watch', { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });

        await page.waitForTimeout(3000);

        const html = await page.content();

        // Função auxiliar para extrair valores
        function extrair(nome) {
            const regex = new RegExp(`${nome}.*?(\\d+)`, 'i');
            const match = html.match(regex);
            return match ? Number(match[1]) : 50;
        }

        // Extrair dados das 6 pizzarias
        const pizzarias = {
            dominos: { 
                valor: extrair('Domino'),
                anomalia: false 
            },
            extreme: { 
                valor: extrair('Extreme Pizza'),
                anomalia: false 
            },
            district: { 
                valor: extrair('District Pizza Palace'),
                anomalia: false 
            },
            we_the_pizza: { 
                valor: extrair('We, The Pizza'),
                anomalia: false 
            },
            pizzero: { 
                valor: extrair('Pizzero Pizza'),
                anomalia: false 
            },
            papa_johns: { 
                valor: extrair('Papa Johns Pizza'),
                anomalia: false 
            }
        };

        await browser.close();

        // Detectar anomalias
        let temAnomalia = false;
        for (const [key, pizzaria] of Object.entries(pizzarias)) {
            const anomalia = detectarAnomalia(key, pizzaria.valor);
            pizzarias[key].anomalia = anomalia;
            if (anomalia) temAnomalia = true;
        }

        // Criar registro atual
        const registroAtual = {
            timestamp: new Date().toISOString(),
            pizzarias,
            temAnomalia
        };

        // Atualizar cache
        dadosCache = registroAtual;

        // Adicionar ao histórico
        historico.push(registroAtual);

        // Limpar registros antigos
        limparHistoricoAntigo();

        // Salvar no arquivo
        salvarHistorico();

        console.log(`✅ Dados coletados com sucesso! Total no histórico: ${historico.length}`);

    } catch (erro) {
        console.error('❌ Erro ao raspar dados:', erro);
        await browser.close();
        throw erro;
    }
}

// Função para detectar anomalia
function detectarAnomalia(pizzaria, valorAtual) {
    // Pegar os últimos 20 valores dessa pizzaria
    const valoresAnteriores = historico
        .map(h => h.pizzarias[pizzaria]?.valor)
        .filter(v => v !== undefined)
        .slice(-20);

    if (valoresAnteriores.length < 5) return false;

    // Calcular média
    const media = valoresAnteriores.reduce((a, b) => a + b, 0) / valoresAnteriores.length;

    // Calcular desvio padrão
    const variancia = valoresAnteriores.reduce((sum, val) => 
        sum + Math.pow(val - media, 2), 0) / valoresAnteriores.length;
    const desvio = Math.sqrt(variancia);

    if (desvio === 0) return false;

    // Calcular Z-Score
    const zScore = Math.abs((valorAtual - media) / desvio);

    // Anomalia se Z-Score > 2.5
    return zScore > 2.5;
}

// ========================================
// ROTAS DA API
// ========================================

// Rota principal: dados atuais
app.get('/api/pizzas', (req, res) => {
    if (!dadosCache && historico.length === 0) {
        return res.status(503).json({ 
            erro: 'Dados ainda não disponíveis. Aguarde a primeira coleta.' 
        });
    }

    // Se não tem cache mas tem histórico, retorna o último registro
    const dados = dadosCache || historico[historico.length - 1];

    res.json(dados);
});

// Rota: histórico completo (últimos 7 dias)
app.get('/api/historico', (req, res) => {
    res.json({
        total: historico.length,
        registros: historico
    });
});

// Rota: histórico resumido (últimas 50 leituras)
app.get('/api/historico/resumido', (req, res) => {
    const ultimos50 = historico.slice(-50);
    res.json({
        total: ultimos50.length,
        registros: ultimos50
    });
});

// Rota: histórico por dia
app.get('/api/historico/dia/:data', (req, res) => {
    const dataRequisitada = req.params.data; // formato: YYYY-MM-DD

    const registrosDoDia = historico.filter(registro => {
        const dataRegistro = new Date(registro.timestamp).toISOString().split('T')[0];
        return dataRegistro === dataRequisitada;
    });

    res.json({
        data: dataRequisitada,
        total: registrosDoDia.length,
        registros: registrosDoDia
    });
});

// Rota: estatísticas
app.get('/api/estatisticas', (req, res) => {
    if (historico.length === 0) {
        return res.json({ erro: 'Sem dados históricos' });
    }

    // Calcular estatísticas por pizzaria
    const stats = {};

    for (const pizzaria of ['dominos', 'extreme', 'district', 'we_the_pizza', 'pizzero', 'papa_johns']) {
        const valores = historico
            .map(h => h.pizzarias[pizzaria]?.valor)
            .filter(v => v !== undefined);

        if (valores.length > 0) {
            const media = valores.reduce((a, b) => a + b, 0) / valores.length;
            const max = Math.max(...valores);
            const min = Math.min(...valores);

            stats[pizzaria] = {
                media: media.toFixed(2),
                max,
                min,
                total_leituras: valores.length
            };
        }
    }

    res.json({
        periodo: {
            inicio: historico[0].timestamp,
            fim: historico[historico.length - 1].timestamp
        },
        total_registros: historico.length,
        pizzarias: stats
    });
});

// Rota: status do sistema
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        ultima_coleta: dadosCache?.timestamp,
        total_historico: historico.length,
        periodo_historico_dias: 7,
        proximo_update: 'A cada 5 minutos'
    });
});

// Rota: forçar coleta manual
app.post('/api/coletar', async (req, res) => {
    try {
        await rasparDados();
        res.json({ 
            sucesso: true, 
            mensagem: 'Coleta realizada com sucesso',
            dados: dadosCache 
        });
    } catch (erro) {
        res.status(500).json({ 
            sucesso: false, 
            erro: erro.message 
        });
    }
});

// ========================================
// INICIALIZAÇÃO
// ========================================

// Coleta inicial
rasparDados().catch(console.error);

// Agendar coleta a cada 5 minutos
setInterval(() => {
    rasparDados().catch(console.error);
}, 5 * 60 * 1000);

// Limpar histórico antigo a cada 1 hora
setInterval(() => {
    limparHistoricoAntigo();
}, 60 * 60 * 1000);

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Backend rodando na porta ${PORT}`);
    console.log(`📊 Histórico: ${historico.length} registros`);
    console.log(`⏰ Coleta automática a cada 5 minutos`);
});

