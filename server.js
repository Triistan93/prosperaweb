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

// Inicialização das Tabelas (Com suporte a Multi-usuário)
const initDB = async () => {
  try {
    // 1. Usuários
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        pin VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Transações
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
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
    `);

    // 3. Metas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS goals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
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
        user_id INTEGER REFERENCES users(id),
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
        user_id INTEGER REFERENCES users(id),
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
        user_id INTEGER REFERENCES users(id),
        category VARCHAR(100) NOT NULL,
        limit_amount NUMERIC(15, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, category)
      );
    `);
    
    console.log("Banco de dados pronto para múltiplos usuários.");
  } catch (err) {
    console.error("Erro no banco:", err);
  }
};

initDB();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

// Middleware para pegar ID do usuário
const getUserId = (req) => {
    const uid = req.headers['user-id'];
    return uid ? parseInt(uid) : null;
};

// --- ROTAS ---

// AUTH
app.post('/api/auth/register', async (req, res) => {
  const { name, pin } = req.body;
  try {
    const check = await pool.query('SELECT id FROM users WHERE name = $1', [name]);
    if (check.rows.length > 0) return res.status(400).json({ error: 'Nome já em uso' });
    
    const result = await pool.query('INSERT INTO users (name, pin) VALUES ($1, $2) RETURNING *', [name, pin]);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Erro no registro' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { pin } = req.body;
  try {
    // Nota: Em produção idealmente pediria Nome + PIN. Aqui pega o primeiro PIN compativel.
    const result = await pool.query('SELECT * FROM users WHERE pin = $1 LIMIT 1', [pin]);
    if (result.rows.length > 0) res.json({ success: true, user: result.rows[0] });
    else res.status(401).json({ error: 'PIN incorreto' });
  } catch (err) { res.status(500).json({ error: 'Erro no login' }); }
});

// DADOS (Protegidos por user_id)
app.get('/api/transactions', async (req, res) => {
  const userId = getUserId(req); if(!userId) return res.status(401).json({error:'Auth required'});
  try { const r = await pool.query('SELECT * FROM transactions WHERE user_id=$1 ORDER BY date DESC', [userId]); 
  res.json(r.rows.map(row => ({...row, date: row.date.toISOString().split('T')[0], amount: parseFloat(row.amount)}))); } catch(e) { res.status(500).json([]); }
});

app.post('/api/transactions', async (req, res) => {
  const userId = getUserId(req); if(!userId) return res.status(401).json({error:'Auth required'});
  const { description, amount, type, category, subcategory, date, paymentMethod, isRecurring, cardId } = req.body;
  try { await pool.query('INSERT INTO transactions (user_id, description, amount, type, category, subcategory, date, payment_method, is_recurring, card_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [userId, description, amount, type, category, subcategory, date, paymentMethod, isRecurring, cardId || null]); res.json({success:true}); } catch(e) { res.status(500).json({error:'Erro'}); }
});

app.delete('/api/transactions/:id', async (req, res) => {
  const userId = getUserId(req); try { await pool.query('DELETE FROM transactions WHERE id=$1 AND user_id=$2', [req.params.id, userId]); res.json({success:true}); } catch(e) { res.status(500).json({error:'Erro'}); }
});

// (Repita o padrão para as outras rotas, filtrando por user_id)
app.get('/api/goals', async (req, res) => { const uid=getUserId(req); if(!uid) return res.status(401).send(); const r = await pool.query('SELECT * FROM goals WHERE user_id=$1', [uid]); res.json(r.rows.map(g=>({...g, target: parseFloat(g.target), current: parseFloat(g.current_amount)}))); });
app.post('/api/goals', async (req, res) => { const uid=getUserId(req); const {name, target, current, color} = req.body; await pool.query('INSERT INTO goals (user_id, name, target, current_amount, color) VALUES ($1, $2, $3, $4, $5)', [uid, name, target, current, color]); res.json({success:true}); });
app.put('/api/goals/:id', async (req, res) => { const uid=getUserId(req); const {name, target, current, color} = req.body; await pool.query('UPDATE goals SET name=$1, target=$2, current_amount=$3, color=$4 WHERE id=$5 AND user_id=$6', [name, target, current, color, req.params.id, uid]); res.json({success:true}); });
app.delete('/api/goals/:id', async (req, res) => { const uid=getUserId(req); await pool.query('DELETE FROM goals WHERE id=$1 AND user_id=$2', [req.params.id, uid]); res.json({success:true}); });

app.get('/api/cards', async (req, res) => { const uid=getUserId(req); if(!uid) return res.status(401).send(); const r = await pool.query('SELECT * FROM cards WHERE user_id=$1', [uid]); res.json(r.rows.map(c=>({...c, limit: parseFloat(c.limit_amount), used: parseFloat(c.used_amount)}))); });
app.post('/api/cards', async (req, res) => { const uid=getUserId(req); const {name, limit, used, dueDay, color} = req.body; await pool.query('INSERT INTO cards (user_id, name, limit_amount, used_amount, due_day, color) VALUES ($1, $2, $3, $4, $5, $6)', [uid, name, limit, used, dueDay, color]); res.json({success:true}); });
app.put('/api/cards/:id', async (req, res) => { const uid=getUserId(req); const {name, limit, used, dueDay, color} = req.body; await pool.query('UPDATE cards SET name=$1, limit_amount=$2, used_amount=$3, due_day=$4, color=$5 WHERE id=$6 AND user_id=$7', [name, limit, used, dueDay, color, req.params.id, uid]); res.json({success:true}); });
app.delete('/api/cards/:id', async (req, res) => { const uid=getUserId(req); await pool.query('DELETE FROM cards WHERE id=$1 AND user_id=$2', [req.params.id, uid]); res.json({success:true}); });

app.get('/api/investments', async (req, res) => { const uid=getUserId(req); if(!uid) return res.status(401).send(); const r = await pool.query('SELECT * FROM investments WHERE user_id=$1', [uid]); res.json(r.rows.map(i=>({...i, value: parseFloat(i.value_amount)}))); });
app.post('/api/investments', async (req, res) => { const uid=getUserId(req); const {name, type, value, returnRate} = req.body; await pool.query('INSERT INTO investments (user_id, name, type, value_amount, return_rate) VALUES ($1, $2, $3, $4, $5)', [uid, name, type, value, returnRate]); res.json({success:true}); });
app.put('/api/investments/:id', async (req, res) => { const uid=getUserId(req); const {name, type, value, returnRate} = req.body; await pool.query('UPDATE investments SET name=$1, type=$2, value_amount=$3, return_rate=$4 WHERE id=$5 AND user_id=$6', [name, type, value, returnRate, req.params.id, uid]); res.json({success:true}); });
app.delete('/api/investments/:id', async (req, res) => { const uid=getUserId(req); await pool.query('DELETE FROM investments WHERE id=$1 AND user_id=$2', [req.params.id, uid]); res.json({success:true}); });

app.get('/api/budgets', async (req, res) => { const uid=getUserId(req); if(!uid) return res.status(401).send(); const r = await pool.query('SELECT * FROM budgets WHERE user_id=$1', [uid]); res.json(r.rows.map(b=>({...b, limit: parseFloat(b.limit_amount)}))); });
app.post('/api/budgets', async (req, res) => { 
    const uid=getUserId(req); const {category, limit} = req.body; 
    const check = await pool.query('SELECT id FROM budgets WHERE category=$1 AND user_id=$2', [category, uid]);
    if(check.rows.length > 0) await pool.query('UPDATE budgets SET limit_amount=$1 WHERE category=$2 AND user_id=$3', [limit, category, uid]);
    else await pool.query('INSERT INTO budgets (user_id, category, limit_amount) VALUES ($1, $2, $3)', [uid, category, limit]);
    res.json({success:true});
});
app.put('/api/budgets/:category', async (req, res) => { const uid=getUserId(req); const {limit} = req.body; await pool.query('UPDATE budgets SET limit_amount=$1 WHERE category=$2 AND user_id=$3', [limit, req.params.category, uid]); res.json({success:true}); });
app.delete('/api/budgets/:category', async (req, res) => { const uid=getUserId(req); await pool.query('DELETE FROM budgets WHERE category=$1 AND user_id=$2', [req.params.category, uid]); res.json({success:true}); });

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(port, '0.0.0.0', () => console.log(`Rodando na porta ${port}`));
