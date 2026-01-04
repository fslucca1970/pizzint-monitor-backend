const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
app.use(cors());

let dadosCache = null;
let ultimoUpdate = null;

async function rasparDados() {
    console.log("Coletando dados do pizzint.watch…");

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        await page.goto("https://www.pizzint.watch", { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);

        const html = await page.content();

        function extrair(nome) {
            const regex = new RegExp(`${nome}.*?(\\d+)`, "i");
            const match = html.match(regex);
            return match ? Number(match[1]) : 50;
        }

        const pizzarias = {
            dominos: { valor: extrair("Domino") },
            extreme: { valor: extrair("Extreme Pizza") },
            district: { valor: extrair("District Pizza Palace") },
            we_the_pizza: { valor: extrair("We, The Pizza") },
            pizzero: { valor: extrair("Pizzero Pizza") },
            papa_johns: { valor: extrair("Papa Johns Pizza") }
        };

 await browser.close();

        dadosCache = {
            timestamp: new Date().toISOString(),
            pizzarias,
            temAnomalia: false   // por enquanto sem lógica de anomalia
        };

        ultimoUpdate = Date.now();
        console.log("Dados atualizados!");

    } catch (e) {
        await browser.close();
        console.log("Erro ao coletar:", e);
    }
}

// Coleta inicial
rasparDados();

// Atualiza a cada 5 minutos
setInterval(rasparDados, 5 * 60 * 1000);

// Endpoint principal
app.get("/api/pizzas", (req, res) => {
    if (!dadosCache) {
        return res.status(503).json({ erro: "Ainda coletando…" });
    }
    res.json(dadosCache);
});

// Status
app.get("/api/status", (req, res) => {
    res.json({
        status: "online",
        atualizado: dadosCache?.timestamp
    });
});

app.listen(3000, () => console.log("Backend rodando na porta 3000"));
