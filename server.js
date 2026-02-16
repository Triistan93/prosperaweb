const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURAÇÃO DO BANCO DE DADOS ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 
    `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
});

// --- INICIALIZAÇÃO SEGURA (NÃO APAGA DADOS) ---
const initDB = async () => {
  try {
    // 1. Tabela de Usuários
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        pin VARCHAR(50) NOT NULL,
        security_question VARCHAR(255),
        security_answer VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Tabela de Transações
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        description VARCHAR(255) NOT NULL,
        amount NUMERIC(15, 2) NOT NULL,
        type VARCHAR(10) CHECK (type IN ('income', 'expense')),
        category VARCHAR(50),
        subcategory VARCHAR(50),
        date DATE NOT NULL,
        payment_method VARCHAR(50),
        is_recurring BOOLEAN DEFAULT FALSE,
        card_id INTEGER, 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Metas (Goals)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS goals (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        target NUMERIC(15, 2) NOT NULL,
        current_amount NUMERIC(15, 2) DEFAULT 0,
        color VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Cartões (Cards)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cards (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        limit_amount NUMERIC(15, 2) NOT NULL,
        used_amount NUMERIC(15, 2) DEFAULT 0,
        due_day INTEGER,
        color VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. Investimentos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS investments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50),
        value_amount NUMERIC(15, 2) NOT NULL,
        return_rate VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6. Orçamentos (Budgets)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id SERIAL PRIMARY KEY,
        category VARCHAR(100) NOT NULL UNIQUE,
        limit_amount NUMERIC(15, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log("Banco de dados conectado e tabelas verificadas.");
  } catch (err) {
    console.error("Erro ao inicializar tabelas:", err);
  }
};

// Inicializa tabelas
initDB();

// --- MIDDLEWARES ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

// ==========================================
//               ROTAS DA API
// ==========================================

// --- USUÁRIOS ---
app.post('/api/auth/register', async (req, res) => {
  const { name, pin, question, answer } = req.body;
  try {
    const result = await pool.query(
        'INSERT INTO users (name, pin, security_question, security_answer) VALUES ($1, $2, $3, $4) RETURNING *', 
        [name, pin, question, answer]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro no registro' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { pin } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE pin = $1', [pin]);
    if (result.rows.length > 0) {
      res.json({ success: true, user: result.rows[0] });
    } else {
      res.status(401).json({ error: 'PIN incorreto' });
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro no login' }); }
});

app.post('/api/auth/reset', async (req, res) => {
  const { name, answer, newPin } = req.body;
  try {
    const result = await pool.query(
        'SELECT * FROM users WHERE name = $1 AND LOWER(security_answer) = LOWER($2)', 
        [name, answer]
    );
    if (result.rows.length > 0) {
      await pool.query('UPDATE users SET pin = $1 WHERE id = $2', [newPin, result.rows[0].id]);
      res.json({ success: true });
    } else {
      res.status(401).json({ error: 'Dados incorretos.' });
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao resetar' }); }
});

// --- TRANSAÇÕES ---
app.get('/api/transactions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transactions ORDER BY date DESC');
    const formatted = result.rows.map(row => ({
      id: row.id,
      description: row.description,
      amount: parseFloat(row.amount),
      type: row.type,
      category: row.category,
      subcategory: row.subcategory,
      date: row.date.toISOString().split('T')[0],
      paymentMethod: row.payment_method,
      isRecurring: row.is_recurring,
      cardId: row.card_id
    }));
    res.json(formatted);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar' }); }
});

app.post('/api/transactions', async (req, res) => {
  const { description, amount, type, category, subcategory, date, paymentMethod, isRecurring, cardId } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO transactions (description, amount, type, category, subcategory, date, payment_method, is_recurring, card_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [description, amount, type, category, subcategory, date, paymentMethod, isRecurring, cardId]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao salvar' }); }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM transactions WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao deletar' }); }
});

// --- METAS (GOALS) ---
app.get('/api/goals', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM goals ORDER BY id ASC');
    const formatted = result.rows.map(r => ({
      id: r.id, name: r.name, target: parseFloat(r.target), current: parseFloat(r.current_amount), color: r.color
    }));
    res.json(formatted);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar metas' }); }
});

app.post('/api/goals', async (req, res) => {
  const { name, target, current, color } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO goals (name, target, current_amount, color) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, target, current || 0, color]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao criar meta' }); }
});

app.put('/api/goals/:id', async (req, res) => {
  const { name, target, current, color } = req.body;
  const { id } = req.params;
  try {
    await pool.query(
      'UPDATE goals SET name=$1, target=$2, current_amount=$3, color=$4 WHERE id=$5',
      [name, target, current, color, id]
    );
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao atualizar meta' }); }
});

app.delete('/api/goals/:id', async (req, res) => {
  try { await pool.query('DELETE FROM goals WHERE id = $1', [req.params.id]); res.json({ success: true }); } 
  catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao deletar' }); }
});

// --- CARTÕES (CARDS) ---
app.get('/api/cards', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cards ORDER BY id ASC');
    const formatted = result.rows.map(r => ({
      id: r.id, name: r.name, limit: parseFloat(r.limit_amount), used: parseFloat(r.used_amount), dueDay: r.due_day, color: r.color
    }));
    res.json(formatted);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar cartões' }); }
});

app.post('/api/cards', async (req, res) => {
  const { name, limit, used, dueDay, color } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO cards (name, limit_amount, used_amount, due_day, color) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, limit, used || 0, dueDay, color]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao criar cartão' }); }
});

app.put('/api/cards/:id', async (req, res) => {
  const { name, limit, used, dueDay, color } = req.body;
  const { id } = req.params;
  try {
    await pool.query(
      'UPDATE cards SET name=$1, limit_amount=$2, used_amount=$3, due_day=$4, color=$5 WHERE id=$6',
      [name, limit, used, dueDay, color, id]
    );
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao atualizar cartão' }); }
});

app.delete('/api/cards/:id', async (req, res) => {
  try { await pool.query('DELETE FROM cards WHERE id = $1', [req.params.id]); res.json({ success: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao deletar cartão' }); }
});

// --- INVESTIMENTOS ---
app.get('/api/investments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM investments ORDER BY id ASC');
    const formatted = result.rows.map(r => ({
      id: r.id, name: r.name, type: r.type, value: parseFloat(r.value_amount), returnRate: r.return_rate
    }));
    res.json(formatted);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar investimentos' }); }
});

app.post('/api/investments', async (req, res) => {
  const { name, type, value, returnRate } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO investments (name, type, value_amount, return_rate) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, type, value, returnRate]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao criar investimento' }); }
});

app.put('/api/investments/:id', async (req, res) => {
  const { name, type, value, returnRate } = req.body;
  const { id } = req.params;
  try {
    await pool.query(
      'UPDATE investments SET name=$1, type=$2, value_amount=$3, return_rate=$4 WHERE id=$5',
      [name, type, value, returnRate, id]
    );
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao atualizar investimento' }); }
});

app.delete('/api/investments/:id', async (req, res) => {
  try { await pool.query('DELETE FROM investments WHERE id = $1', [req.params.id]); res.json({ success: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao deletar investimento' }); }
});

// --- ORÇAMENTOS (BUDGETS) ---
app.get('/api/budgets', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM budgets ORDER BY id ASC');
    const formatted = result.rows.map(r => ({
      id: r.id, category: r.category, limit: parseFloat(r.limit_amount)
    }));
    res.json(formatted);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar orçamentos' }); }
});

app.post('/api/budgets', async (req, res) => {
  const { category, limit } = req.body;
  try {
    const check = await pool.query('SELECT id FROM budgets WHERE category = $1', [category]);
    if (check.rows.length > 0) {
       await pool.query('UPDATE budgets SET limit_amount = $1 WHERE category = $2', [limit, category]);
       res.json({ success: true, id: check.rows[0].id });
    } else {
       const result = await pool.query(
         'INSERT INTO budgets (category, limit_amount) VALUES ($1, $2) RETURNING id',
         [category, limit]
       );
       res.json({ success: true, id: result.rows[0].id });
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao criar orçamento' }); }
});

app.put('/api/budgets/:category', async (req, res) => {
  const { limit } = req.body;
  const { category } = req.params;
  try {
    await pool.query('UPDATE budgets SET limit_amount=$1 WHERE category=$2', [limit, category]);
    res.json({ success: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao atualizar orçamento' }); }
});

app.delete('/api/budgets/:category', async (req, res) => {
  try { await pool.query('DELETE FROM budgets WHERE category = $1', [req.params.category]); res.json({ success: true }); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao deletar orçamento' }); }
});

// --- ROTA FINAL (SPA) ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Inicia o servidor (0.0.0.0 para Docker)
app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${port}`);
});
