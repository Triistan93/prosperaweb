const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURAÇÃO DO BANCO ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 
    `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`,
});

// --- INICIALIZAÇÃO SEGURA (SEM PERGUNTAS DE SEGURANÇA) ---
const initDB = async () => {
  try {
    // 1. Tabela de Usuários (APENAS NOME E PIN)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        pin VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Transações
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

    // 3. Metas
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

    // 4. Cartões
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

    // 6. Orçamentos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id SERIAL PRIMARY KEY,
        category VARCHAR(100) NOT NULL UNIQUE,
        limit_amount NUMERIC(15, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log("Banco de dados conectado.");
  } catch (err) {
    console.error("Erro ao inicializar:", err);
  }
};

initDB();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

// --- ROTAS DE AUTENTICAÇÃO (LIMPAS) ---

// Registro (Sem pergunta secreta)
app.post('/api/auth/register', async (req, res) => {
  const { name, pin } = req.body;
  try {
    const check = await pool.query('SELECT * FROM users LIMIT 1');
    if (check.rows.length > 0) {
        // Se já tem usuário, atualiza
        await pool.query('UPDATE users SET name=$1, pin=$2 WHERE id=$3', [name, pin, check.rows[0].id]);
        return res.json({ success: true, user: { name, pin } });
    }
    // Se não tem, cria
    const result = await pool.query(
        'INSERT INTO users (name, pin) VALUES ($1, $2) RETURNING *', 
        [name, pin]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro no registro' }); }
});

// Login
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

// --- RESTO DAS ROTAS (Transações, etc...) ---
// (Mantenha igual ao que já estava funcionando, vou colocar resumido aqui para facilitar o copy-paste completo)

app.get('/api/transactions', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM transactions ORDER BY date DESC');
    const formatted = result.rows.map(row => ({
      id: row.id, description: row.description, amount: parseFloat(row.amount), type: row.type, category: row.category, subcategory: row.subcategory, date: row.date.toISOString().split('T')[0], paymentMethod: row.payment_method, isRecurring: row.is_recurring, cardId: row.card_id
    }));
    res.json(formatted);
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/api/transactions', async (req, res) => {
  const { description, amount, type, category, subcategory, date, paymentMethod, isRecurring, cardId } = req.body;
  const safeCardId = (cardId === "" || cardId === "undefined") ? null : cardId;
  try {
    const result = await pool.query(
      `INSERT INTO transactions (description, amount, type, category, subcategory, date, payment_method, is_recurring, card_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [description, amount, type, category, subcategory, date, paymentMethod, isRecurring, safeCardId]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try { await pool.query('DELETE FROM transactions WHERE id = $1', [req.params.id]); res.json({ success: true }); } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// (Repetindo rotas de Goals, Cards, Investments, Budgets para garantir que não falte nada)
app.get('/api/goals', async (req, res) => { try { const r = await pool.query('SELECT * FROM goals ORDER BY id ASC'); res.json(r.rows.map(row => ({ id: row.id, name: row.name, target: parseFloat(row.target), current: parseFloat(row.current_amount), color: row.color }))); } catch (e) { res.status(500).json({ error: 'Erro' }); } });
app.post('/api/goals', async (req, res) => { const { name, target, current, color } = req.body; try { const r = await pool.query('INSERT INTO goals (name, target, current_amount, color) VALUES ($1, $2, $3, $4) RETURNING id', [name, target, current || 0, color]); res.json({ success: true, id: r.rows[0].id }); } catch (e) { res.status(500).json({ error: 'Erro' }); } });
app.put('/api/goals/:id', async (req, res) => { const { name, target, current, color } = req.body; try { await pool.query('UPDATE goals SET name=$1, target=$2, current_amount=$3, color=$4 WHERE id=$5', [name, target, current, color, req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: 'Erro' }); } });
app.delete('/api/goals/:id', async (req, res) => { try { await pool.query('DELETE FROM goals WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: 'Erro' }); } });

app.get('/api/cards', async (req, res) => { try { const r = await pool.query('SELECT * FROM cards ORDER BY id ASC'); res.json(r.rows.map(row => ({ id: row.id, name: row.name, limit: parseFloat(row.limit_amount), used: parseFloat(row.used_amount), dueDay: row.due_day, color: row.color }))); } catch (e) { res.status(500).json({ error: 'Erro' }); } });
app.post('/api/cards', async (req, res) => { const { name, limit, used, dueDay, color } = req.body; try { const r = await pool.query('INSERT INTO cards (name, limit_amount, used_amount, due_day, color) VALUES ($1, $2, $3, $4, $5) RETURNING id', [name, limit, used || 0, dueDay, color]); res.json({ success: true, id: r.rows[0].id }); } catch (e) { res.status(500).json({ error: 'Erro' }); } });
app.put('/api/cards/:id', async (req, res) => { const { name, limit, used, dueDay, color } = req.body; try { await pool.query('UPDATE cards SET name=$1, limit_amount=$2, used_amount=$3, due_day=$4, color=$5 WHERE id=$6', [name, limit, used, dueDay, color, req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: 'Erro' }); } });
app.delete('/api/cards/:id', async (req, res) => { try { await pool.query('DELETE FROM cards WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: 'Erro' }); } });

app.get('/api/investments', async (req, res) => { try { const r = await pool.query('SELECT * FROM investments ORDER BY id ASC'); res.json(r.rows.map(row => ({ id: row.id, name: row.name, type: row.type, value: parseFloat(row.value_amount), returnRate: row.return_rate }))); } catch (e) { res.status(500).json({ error: 'Erro' }); } });
app.post('/api/investments', async (req, res) => { const { name, type, value, returnRate } = req.body; try { const r = await pool.query('INSERT INTO investments (name, type, value_amount, return_rate) VALUES ($1, $2, $3, $4) RETURNING id', [name, type, value, returnRate]); res.json({ success: true, id: r.rows[0].id }); } catch (e) { res.status(500).json({ error: 'Erro' }); } });
app.put('/api/investments/:id', async (req, res) => { const { name, type, value, returnRate } = req.body; try { await pool.query('UPDATE investments SET name=$1, type=$2, value_amount=$3, return_rate=$4 WHERE id=$5', [name, type, value, returnRate, req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: 'Erro' }); } });
app.delete('/api/investments/:id', async (req, res) => { try { await pool.query('DELETE FROM investments WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: 'Erro' }); } });

app.get('/api/budgets', async (req, res) => { try { const r = await pool.query('SELECT * FROM budgets ORDER BY id ASC'); res.json(r.rows.map(row => ({ id: row.id, category: row.category, limit: parseFloat(row.limit_amount) }))); } catch (e) { res.status(500).json({ error: 'Erro' }); } });
app.post('/api/budgets', async (req, res) => { const { category, limit } = req.body; try { const c = await pool.query('SELECT id FROM budgets WHERE category=$1', [category]); if(c.rows.length>0) { await pool.query('UPDATE budgets SET limit_amount=$1 WHERE category=$2', [limit, category]); res.json({success:true, id:c.rows[0].id}); } else { const r = await pool.query('INSERT INTO budgets (category, limit_amount) VALUES ($1, $2) RETURNING id', [category, limit]); res.json({success:true, id:r.rows[0].id}); } } catch(e) { res.status(500).json({error:'Erro'}); } });
app.put('/api/budgets/:category', async (req, res) => { const { limit } = req.body; try { await pool.query('UPDATE budgets SET limit_amount=$1 WHERE category=$2', [limit, req.params.category]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: 'Erro' }); } });
app.delete('/api/budgets/:category', async (req, res) => { try { await pool.query('DELETE FROM budgets WHERE category=$1', [req.params.category]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: 'Erro' }); } });

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
app.listen(port, '0.0.0.0', () => { console.log(`Servidor rodando na porta ${port}`); });
