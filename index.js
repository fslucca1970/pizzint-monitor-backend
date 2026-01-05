const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { getPopularTimes } = require("./popularTimes");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const HISTORICO_PATH = path.join(__dirname, "historico.json");

// Lista de pizzarias monitoradas
const PIZZARIAS = [
  {
    id: "domino_s_pizza",
    nome: "Domino's Pizza",
    place_id: "ChIJVcXB3xG3t4kRLW_u6TuJNew",
  },
  {
    id: "extreme_pizza",
    nome: "Extreme Pizza",
    place_id: "ChIJwQoN1hG3t4kRxwGkKNnYXFg",
  },
  {
    id: "district_pizza_palace",
    nome: "District Pizza Palace",
    place_id: "ChIJH8yqnhG3t4kRWHBTmYJGJgc",
  },
  {
    id: "we__the_pizza",
    nome: "We, the Pizza",
    place_id: "ChIJZzBtqxG3t4kRdLO-Gg6VJzk",
  },
  {
    id: "pizzato_pizza",
    nome: "Pizzato Pizza",
    place_id: "ChIJGQwYkRG3t4kRWNkr-Zy0Ixo",
  },
  {
    id: "papa_john_s_pizza",
    nome: "Papa John's Pizza",
    place_id: "ChIJe5LCoBG3t4kRhj7Rl0XUNLc",
  },
];

// Carrega histórico existente
function carregarHistorico() {
  try {
    if (fs.existsSync(HISTORICO_PATH)) {
      const data = fs.readFileSync(HISTORICO_PATH, "utf-8");
      return JSON.parse(data);
    }
  } catch (erro) {
    console.error("Erro ao carregar histórico:", erro);
  }
  return [];
}

// Salva histórico
function salvarHistorico(historico) {
  try {
    // Mantém apenas os últimos 200 registros no histórico
    const LIMITE = 200;

    if (historico.length > LIMITE) {
      historico.splice(0, historico.length - LIMITE);
    }

    fs.writeFileSync(HISTORICO_PATH, JSON.stringify(historico, null, 2));
    console.log(`✅ Histórico salvo com ${historico.length} registros`);
  } catch (erro) {
    console.error("❌ Erro ao salvar histórico:", erro);
  }
}

// Coleta dados de todas as pizzarias
async function coletarDados() {
  console.log("🔄 Iniciando coleta de dados...");

  const resultados = {};
  const timestamp = new Date().toISOString();

  for (const pizzaria of PIZZARIAS) {
    try {
      console.log(`📍 Coletando dados de ${pizzaria.nome}...`);

      const dados = await getPopularTimes(pizzaria.place_id);

      if (dados && dados.current_popularity !== undefined) {
        const baseline = dados.populartimes?.find(
          (day) => day.name === dados.time_spent?.[0]?.name
        );

        const horaAtual = new Date().getHours();
        const popularidadeBaseline =
          baseline?.data?.[horaAtual] || dados.current_popularity;

        // Determina status
        let status = "NOMINAL";
        if (dados.current_popularity < popularidadeBaseline * 0.7) {
          status = "QUIET";
        } else if (dados.current_popularity > popularidadeBaseline * 1.3) {
          status = "SPIKE";
        }

        resultados[pizzaria.id] = {
          nome: pizzaria.nome,
          place_id: pizzaria.place_id,
          status: status,
          movimento_atual: {
            hour: horaAtual,
            baseline_popularity: popularidadeBaseline,
            current_popularity: dados.current_popularity,
          },
          popular_times: dados.populartimes?.map((day) => ({
            name: day.name,
            data: day.data,
          })),
        };

        console.log(
          `✅ ${pizzaria.nome}: ${dados.current_popularity}% (${status})`
        );
      } else {
        console.log(`⚠️ ${pizzaria.nome}: Sem dados disponíveis`);
        resultados[pizzaria.id] = {
          nome: pizzaria.nome,
          place_id: pizzaria.place_id,
          status: "UNKNOWN",
          movimento_atual: null,
          popular_times: null,
        };
      }
    } catch (erro) {
      console.error(`❌ Erro ao coletar ${pizzaria.nome}:`, erro.message);
      resultados[pizzaria.id] = {
        nome: pizzaria.nome,
        place_id: pizzaria.place_id,
        status: "ERROR",
        movimento_atual: null,
        popular_times: null,
        erro: erro.message,
      };
    }
  }

  // Salva no histórico
  const historico = carregarHistorico();
  historico.push({
    timestamp,
    pizzarias: resultados,
  });
  salvarHistorico(historico);

  console.log("✅ Coleta concluída e salva no histórico");
  return { timestamp, pizzarias: resultados };
}

// Endpoint: dados atuais
app.get("/api/atual", (req, res) => {
  try {
    const historico = carregarHistorico();

    if (historico.length === 0) {
      return res.status(404).json({
        erro: "Nenhum dado disponível ainda",
      });
    }

    const ultimaColeta = historico[historico.length - 1];
    res.json(ultimaColeta);
  } catch (erro) {
    console.error("Erro ao buscar dados atuais:", erro);
    res.status(500).json({ erro: "Erro ao buscar dados" });
  }
});

// Endpoint: histórico completo
app.get("/api/historico", (req, res) => {
  try {
    const historico = carregarHistorico();
    res.json(historico);
  } catch (erro) {
    console.error("Erro ao buscar histórico:", erro);
    res.status(500).json({ erro: "Erro ao buscar histórico" });
  }
});

// Endpoint: health check
app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date().toISOString() });
});

// Inicia servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);

  // Coleta inicial
  coletarDados();

  // Coleta a cada 5 minutos
  setInterval(coletarDados, 5 * 60 * 1000);
});

