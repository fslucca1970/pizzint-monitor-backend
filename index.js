const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const HISTORICO_PATH = path.join(__dirname, 'historico.json');

// Mapeamento das 6 pizzarias
const PIZZARIAS = {
  dominos: {
    nome: "Domino's Pizza",
    placeId: 'ChIJI6ACK7q2t4kRFcPtFhUuYhU',
    url: 'https://www.pizzint.watch/api/chart-data?placeId=ChIJI6ACK7q2t4kRFcPtFhUuYhU&dayOfWeek=0'
  },
  extreme: {
    nome: 'Extreme Pizza',
    placeId: 'ChIJcYireCe3t4kR4d9trEbGYjc',
    url: 'https://www.pizzint.watch/api/chart-data?placeId=ChIJcYireCe3t4kR4d9trEbGYjc&dayOfWeek=0'
  },
  district: {
    nome: 'District Pizza Palace',
    placeId: 'ChIJ42QeLXu3t4kRnArvcaz2o3A',
    url: 'https://www.pizzint.watch/api/chart-data?placeId=ChIJ42QeLXu3t4kRnArvcaz2o3A&dayOfWeek=0'
  },
  we_the_pizza: {
    nome: 'We, the Pizza',
    placeId: 'ChIJS1rpOC-3t4kRsLyM6aftM8k',
    url: 'https://www.pizzint.watch/api/chart-data?placeId=ChIJS1rpOC-3t4kRsLyM6aftM8k&dayOfWeek=0'
  },
  pizzato: {
    nome: 'Pizzato Pizza',
    placeId: 'ChIJrbin_Qm3t4kRVSytw_2DM1g',
    url: 'https://www.pizzint.watch/api/chart-data?placeId=ChIJrbin_Qm3t4kRVSytw_2DM1g&dayOfWeek=0'
  },
  papa_johns: {
    nome: "Papa John's Pizza",
    placeId: 'ChIJo03BaX-3t4kRbyhPM0rTuqM',
    url: 'https://www.pizzint.watch/api/chart-data?placeId=ChIJo03BaX-3t4kRbyhPM0rTuqM&dayOfWeek=0'
  }
};

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

async function coletarDadosPizzaria(pizzaria) {
  try {
    console.log(`📡 Coletando dados de ${pizzaria.nome}...`);

    const response = await axios.get(pizzaria.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const dados = response.data;

    return {
      nome: pizzaria.nome,
      placeId: pizzaria.placeId,
      status: dados.status || 'UNKNOWN',
      movimento_atual: dados.currentPopularity || 0,
      popular_times: dados.popularTimes || [],
      aberto: dados.isOpen !== false,
      horario_abre: dados.openingHours?.weekday_text?.[0] || 'N/A',
      timestamp: new Date().toISOString(),
      sucesso: true
    };

  } catch (error) {
    console.error(`❌ Erro ao coletar ${pizzaria.nome}:`, error.message);

    return {
      nome: pizzaria.nome,
      placeId: pizzaria.placeId,
      status: 'ERROR',
      movimento_atual: 0,
      popular_times: [],
      aberto: null,
      horario_abre: 'N/A',
      timestamp: new Date().toISOString(),
      sucesso: false,
      erro: error.message
    };
  }
}

async function atualizarDados() {
  try {
    console.log('\n🚀 Iniciando coleta de dados...');
    console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

    const coleta = {
      timestamp: new Date().toISOString(),
      pizzarias: {}
    };

    // Coleta dados de todas as 6 pizzarias em paralelo
    const promises = Object.values(PIZZARIAS).map(pizzaria => 
      coletarDadosPizzaria(pizzaria)
    );

    const resultados = await Promise.all(promises);

    // Organiza os resultados
    resultados.forEach(resultado => {
      const chave = resultado.nome.toLowerCase().replace(/[^a-z0-9]/g, '_');
      coleta.pizzarias[chave] = resultado;
    });

    // Detecta anomalias (SPIKE)
    const comSpike = resultados.filter(p => p.status === 'SPIKE');
    if (comSpike.length > 0) {
      coleta.anomalias = {
        detectadas: true,
        pizzarias_em_spike: comSpike.map(p => p.nome)
      };
      console.log(`⚠️ SPIKE DETECTADO EM: ${comSpike.map(p => p.nome).join(', ')}`);
    }

    // Salva no histórico
    const historico = await lerHistorico();
    historico.push(coleta);

    // Mantém apenas 7 dias de histórico (2016 coletas = 7 dias * 288 coletas/dia)
    const LIMITE = 2016;
    if (historico.length > LIMITE) {
      historico.splice(0, historico.length - LIMITE);
    }

    await salvarHistorico(historico);
    console.log(`✅ Coleta concluída: ${historico.length} registros no histórico`);

    return coleta;

  } catch (error) {
    console.error('❌ Erro ao atualizar dados:', error);
    return null;
  }
}

// ============ ROTAS DA API ============

app.get('/api/status', async (req, res) => {
  try {
    const historico = await lerHistorico();
    const ultimaColeta = historico.length > 0 
      ? historico[historico.length - 1].timestamp 
      : null;

    res.json({
      status: 'online',
      ultima_coleta: ultimaColeta,
      total_registros_historico: historico.length,
      periodo_historico_dias: 7,
      proxima_coleta: 'A cada 5 minutos',
      pizzarias_monitoradas: Object.keys(PIZZARIAS).length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/atual', async (req, res) => {
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

app.get('/api/historico/:pizzaria', async (req, res) => {
  try {
    const { pizzaria } = req.params;
    const historico = await lerHistorico();

    const dados = historico
      .map(coleta => ({
        timestamp: coleta.timestamp,
        dados: coleta.pizzarias[pizzaria]
      }))
      .filter(item => item.dados);

    if (dados.length === 0) {
      return res.status(404).json({ 
        error: `Nenhum dado encontrado para ${pizzaria}` 
      });
    }

    res.json({
      pizzaria: pizzaria,
      total_registros: dados.length,
      registros: dados
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/spike', async (req, res) => {
  try {
    const historico = await lerHistorico();

    const spikes = historico
      .filter(coleta => coleta.anomalias?.detectadas)
      .map(coleta => ({
        timestamp: coleta.timestamp,
        pizzarias_em_spike: coleta.anomalias.pizzarias_em_spike
      }));

    res.json({
      total_spikes_detectados: spikes.length,
      spikes: spikes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ INICIALIZAÇÃO ============

app.listen(PORT, async () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📍 URL: https://pizzint-monitor-backend.onrender.com`);

  await garantirHistorico();

  console.log('⏳ Iniciando primeira coleta...');
  await atualizarDados();

  // Coleta a cada 5 minutos
  setInterval(atualizarDados, 5 * 60 * 1000);
  console.log('✅ Coletas agendadas a cada 5 minutos');
});

