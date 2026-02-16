const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config(); // Carrega variáveis locais se tiver arquivo .env

const app = express();
const port = process.env.PORT || 3000;

// Configuração da Conexão com o Postgres
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST, // No Easypanel, use o nome do serviço (ex: postgres)
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

app.use(cors());
app.use(express.json());

// Rota Principal (Página inicial)
app.get('/', (req, res) => {
  res.send(`
    <div style="font-family: sans-serif; text-align: center; padding: 50px;">
      <h1>ProsperaWeb está Online! 🚀</h1>
      <p>O servidor Node.js está rodando corretamente.</p>
      <br>
      <a href="/test-db" style="padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px;">Testar Conexão com Banco</a>
    </div>
  `);
});

// Rota para Testar o Banco de Dados
app.get('/test-db', async (req, res) => {
  try {
    // Tenta uma query simples para ver se o banco responde
    const result = await pool.query('SELECT NOW() as time');
    res.json({
      status: 'Sucesso!',
      mensagem: 'Conectado ao Postgres com sucesso.',
      horario_servidor_banco: result.rows[0].time
    });
  } catch (err) {
    console.error('Erro ao conectar:', err);
    res.status(500).json({
      status: 'Erro',
      mensagem: 'Não foi possível conectar ao banco.',
      detalhe: err.message
    });
  }
});

// Inicia o servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
