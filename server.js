const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 
    `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
});

// --- RESET E CRIAÇÃO DE TABELAS (AGORA COM USER_ID) ---
const initDB = async () => {
  try {
    // Apaga tabelas antigas para recriar com a estrutura nova (user_id)
    // Se quiser preservar dados no futuro, remova os DROPs
    await pool.query(`
      DROP TABLE IF EXISTS transactions CASCADE;
      DROP TABLE IF EXISTS goals CASCADE;
      DROP TABLE IF EXISTS cards CASCADE;
      DROP TABLE IF EXISTS investments CASCADE;
      DROP TABLE IF EXISTS budgets CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `);

    await pool.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE, -- Nome único
        pin VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id), -- VÍNCULO COM O DONO
        description VARCHAR(255) NOT NULL,
        amount NUMERIC(15, 2) NOT NULL,
        type VARCHAR(10),
        category VARCHAR(50),
        subcategory VARCHAR(50),
        date DATE NOT NULL,
        payment_method VARCHAR(50),
        is_recurring BOOLEAN DEFAULT FALSE,
        card_id INTEGER, 
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE goals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        target NUMERIC(15, 2) NOT NULL,
        current_amount NUMERIC(15, 2) DEFAULT 0,
        color VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE cards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        limit_amount NUMERIC(15, 2) NOT NULL,
        used_amount NUMERIC(15, 2) DEFAULT 0,
        due_day INTEGER,
        color VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE investments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50),
        value_amount NUMERIC(15, 2) NOT NULL,
        return_rate VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE budgets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        category VARCHAR(100) NOT NULL,
        limit_amount NUMERIC(15, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, category) -- Cada usuário tem seu orçamento único por categoria
      );
    `);
    
    console.log("Banco de dados recriado para Múltiplos Usuários.");
  } catch (err) {
    console.error("Erro ao inicializar:", err);
  }
};

initDB();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

// --- MIDDLEWARE PARA PEGAR O ID DO USUÁRIO ---
const getUserId = (req) => {
    const uid = req.headers['user-id']; // O front vai mandar isso
    return uid ? parseInt(uid) : null;
};

// --- ROTAS DE AUTENTICAÇÃO ---

app.post('/api/auth/register', async (req, res) => {
  const { name, pin } = req.body;
  try {
    // Verifica se nome já existe
    const check = await pool.query('SELECT id FROM users WHERE name = $1', [name]);
    if (check.rows.length > 0) {
        return res.status(400).json({ error: 'Este nome já está em uso.' });
    }
    const result = await pool.query(
        'INSERT INTO users (name, pin) VALUES ($1, $2) RETURNING *', 
        [name, pin]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro no registro' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { pin } = req.body;
  try {
    // ATENÇÃO: Em produção real, o login deve pedir NOME e PIN, não só PIN. 
    // Como seu front só pede PIN, vamos assumir que o PIN é único globalmente ou 
    // pegar o primeiro que achar (simplificação). 
    // Melhoria futura: Mudar login para pedir Nome + PIN.
    
    const result = await pool.query('SELECT * FROM users WHERE pin = $1 LIMIT 1', [pin]);
    
    if (result.rows.length > 0) {
      res.json({ success: true, user: result.rows[0] });
    } else {
      res.status(401).json({ error: 'PIN não encontrado.' });
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro no login' }); }
});

// --- ROTAS DE DADOS (AGORA FILTRADAS POR USUÁRIO) ---

// TRANSAÇÕES
app.get('/api/transactions', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({error: 'Não autorizado'});
  try {
    const result = await pool.query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC', [userId]);
    const formatted = result.rows.map(row => ({
      id: row.id, description: row.description, amount: parseFloat(row.amount), type: row.type, category: row.category, subcategory: row.subcategory, date: row.date.toISOString().split('T')[0], paymentMethod: row.payment_method, isRecurring: row.is_recurring, cardId: row.card_id
    }));
    res.json(formatted);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/api/transactions', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({error: 'Não autorizado'});
  const { description, amount, type, category, subcategory, date, paymentMethod, isRecurring, cardId } = req.body;
  const safeCardId = (cardId === "" || cardId === "undefined") ? null : cardId;
  try {
    const result = await pool.query(
      `INSERT INTO transactions (user_id, description, amount, type, category, subcategory, date, payment_method, is_recurring, card_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [userId, description, amount, type, category, subcategory, date, paymentMethod, isRecurring, safeCardId]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }); }
});

app.delete('/api/transactions/:id', async (req, res) => {
  const userId = getUserId(req);
  try { await pool.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [req.params.id, userId]); res.json({ success: true }); } 
  catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// METAS
app.get('/api/goals', async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({error: 'Não autorizado'});
  try {
    const result = await pool.query('SELECT * FROM goals WHERE user_id = $1 ORDER BY id ASC', [userId]);
    res.json(result.rows.map(r => ({ id: r.id, name: r.name, target: parseFloat(r.target), current: parseFloat(r.current_amount), color: r.color })));
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/api/goals', async (req, res) => {
  const userId = getUserId(req);
  const { name, target, current, color } = req.body;
  try {
    const result = await pool.query('INSERT INTO goals (user_id, name, target, current_amount, color) VALUES ($1, $2, $3, $4, $5) RETURNING id', [userId, name, target, current || 0, color]);
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.put('/api/goals/:id', async (req, res) => {
  const userId = getUserId(req);
  const { name, target, current, color } = req.body;
  try { await pool.query('UPDATE goals SET name=$1, target=$2, current_amount=$3, color=$4 WHERE id=$5 AND user_id=$6', [name, target, current, color, req.params.id, userId]); res.json({ success: true }); } 
  catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.delete('/api/goals/:id', async (req, res) => {
  const userId = getUserId(req);
  try { await pool.query('DELETE FROM goals WHERE id=$1 AND user_id=$2', [req.params.id, userId]); res.json({ success: true }); } 
  catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// CARTÕES
app.get('/api/cards', async (req, res) => {
  const userId = getUserId(req);
  try {
    const result = await pool.query('SELECT * FROM cards WHERE user_id = $1 ORDER BY id ASC', [userId]);
    res.json(result.rows.map(r => ({ id: r.id, name: r.name, limit: parseFloat(r.limit_amount), used: parseFloat(r.used_amount), dueDay: r.due_day, color: r.color })));
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/api/cards', async (req, res) => {
  const userId = getUserId(req);
  const { name, limit, used, dueDay, color } = req.body;
  try {
    const result = await pool.query('INSERT INTO cards (user_id, name, limit_amount, used_amount, due_day, color) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [userId, name, limit, used || 0, dueDay, color]);
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.put('/api/cards/:id', async (req, res) => {
  const userId = getUserId(req);
  const { name, limit, used, dueDay, color } = req.body;
  try { await pool.query('UPDATE cards SET name=$1, limit_amount=$2, used_amount=$3, due_day=$4, color=$5 WHERE id=$6 AND user_id=$7', [name, limit, used, dueDay, color, req.params.id, userId]); res.json({ success: true }); } 
  catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.delete('/api/cards/:id', async (req, res) => {
  const userId = getUserId(req);
  try { await pool.query('DELETE FROM cards WHERE id=$1 AND user_id=$2', [req.params.id, userId]); res.json({ success: true }); } 
  catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// INVESTIMENTOS
app.get('/api/investments', async (req, res) => {
  const userId = getUserId(req);
  try {
    const result = await pool.query('SELECT * FROM investments WHERE user_id = $1 ORDER BY id ASC', [userId]);
    res.json(result.rows.map(r => ({ id: r.id, name: r.name, type: r.type, value: parseFloat(r.value_amount), returnRate: r.return_rate })));
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/api/investments', async (req, res) => {
  const userId = getUserId(req);
  const { name, type, value, returnRate } = req.body;
  try {
    const result = await pool.query('INSERT INTO investments (user_id, name, type, value_amount, return_rate) VALUES ($1, $2, $3, $4, $5) RETURNING id', [userId, name, type, value, returnRate]);
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.put('/api/investments/:id', async (req, res) => {
  const userId = getUserId(req);
  const { name, type, value, returnRate } = req.body;
  try { await pool.query('UPDATE investments SET name=$1, type=$2, value_amount=$3, return_rate=$4 WHERE id=$5 AND user_id=$6', [name, type, value, returnRate, req.params.id, userId]); res.json({ success: true }); } 
  catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.delete('/api/investments/:id', async (req, res) => {
  const userId = getUserId(req);
  try { await pool.query('DELETE FROM investments WHERE id=$1 AND user_id=$2', [req.params.id, userId]); res.json({ success: true }); } 
  catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// ORÇAMENTOS
app.get('/api/budgets', async (req, res) => {
  const userId = getUserId(req);
  try {
    const result = await pool.query('SELECT * FROM budgets WHERE user_id = $1 ORDER BY id ASC', [userId]);
    res.json(result.rows.map(r => ({ id: r.id, category: r.category, limit: parseFloat(r.limit_amount) })));
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/api/budgets', async (req, res) => {
  const userId = getUserId(req);
  const { category, limit } = req.body;
  try {
    const check = await pool.query('SELECT id FROM budgets WHERE category = $1 AND user_id = $2', [category, userId]);
    if (check.rows.length > 0) {
       await pool.query('UPDATE budgets SET limit_amount = $1 WHERE category = $2 AND user_id = $3', [limit, category, userId]);
       res.json({ success: true, id: check.rows[0].id });
    } else {
       const result = await pool.query('INSERT INTO budgets (user_id, category, limit_amount) VALUES ($1, $2, $3) RETURNING id', [userId, category, limit]);
       res.json({ success: true, id: result.rows[0].id });
    }
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.put('/api/budgets/:category', async (req, res) => {
  const userId = getUserId(req);
  const { limit } = req.body; const { category } = req.params;
  try { await pool.query('UPDATE budgets SET limit_amount=$1 WHERE category=$2 AND user_id=$3', [limit, category, userId]); res.json({ success: true }); } 
  catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.delete('/api/budgets/:category', async (req, res) => {
  const userId = getUserId(req);
  try { await pool.query('DELETE FROM budgets WHERE category = $1 AND user_id = $2', [req.params.category, userId]); res.json({ success: true }); } 
  catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.listen(port, '0.0.0.0', () => { console.log(`Servidor rodando na porta ${port}`); });
