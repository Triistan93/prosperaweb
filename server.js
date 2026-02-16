const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Configuração do Banco
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 
    `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
});

app.use(cors());
app.use(express.json());

// Servir o arquivo index.html (O seu Front-end)
app.use(express.static(path.join(__dirname, '/')));

// --- ROTAS DA API ---

// 1. Buscar todas as transações
app.get('/api/transactions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transactions ORDER BY date DESC');
    // Converte os nomes das colunas do banco (snake_case) para o front (camelCase)
    const formatted = result.rows.map(row => ({
      id: row.id,
      description: row.description,
      amount: parseFloat(row.amount),
      type: row.type,
      category: row.category,
      subcategory: row.subcategory,
      date: row.date.toISOString().split('T')[0], // Formato YYYY-MM-DD
      paymentMethod: row.payment_method,
      isRecurring: row.is_recurring
    }));
    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar transações' });
  }
});

// 2. Adicionar nova transação
app.post('/api/transactions', async (req, res) => {
  const { description, amount, type, category, subcategory, date, paymentMethod, isRecurring } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO transactions (description, amount, type, category, subcategory, date, payment_method, is_recurring) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [description, amount, type, category, subcategory, date, paymentMethod, isRecurring]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao salvar' });
  }
});

// 3. Deletar transação
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM transactions WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao deletar' });
  }
});

// Rota padrão para servir o site em qualquer outra URL (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
