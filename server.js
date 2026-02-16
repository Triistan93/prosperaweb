const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

/**
 * --------------------
 * Postgres (cloud-friendly)
 * --------------------
 * Use:
 *  - DATABASE_URL=postgresql://user:pass@host:port/db
 * Optional:
 *  - DATABASE_SSL=true   (very common in managed/cloud Postgres)
 */
const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

const useSSL =
  String(process.env.DATABASE_SSL || '').toLowerCase() === 'true' ||
  /sslmode=require/i.test(connectionString);

const pool = new Pool({
  connectionString,
  ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {}),
});

/**
 * --------------------
 * Middlewares
 * --------------------
 */
app.use(cors());
app.use(express.json());

// Static (index.html + assets)
app.use(express.static(path.join(__dirname, '/')));

/**
 * --------------------
 * Helpers / Auth (multi-user via header x-user-id)
 * --------------------
 * The updated index.html sends x-user-id automatically after login.
 */
function requireUserId(req, res, next) {
  const raw = req.header('x-user-id');
  const userId = Number(raw);

  if (!raw || !Number.isFinite(userId) || userId <= 0) {
    return res.status(401).json({ error: 'missing_user' });
  }

  req.userId = userId;
  next();
}

/**
 * --------------------
 * Healthcheck
 * --------------------
 */
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'db_error' });
  }
});

/**
 * --------------------
 * Init DB + Safe migrations for multi-user
 * --------------------
 * - Adds user_id columns to data tables
 * - Creates indexes + per-user unique constraints
 * - Tries to backfill old data if there is exactly 1 user
 */
async function ensureColumn(table, columnSql) {
  await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${columnSql};`);
}

// NOTE: Fixed! CREATE INDEX requires "ON <table> (...)".
// We accept a full SQL statement (without the trailing semicolon) to avoid mistakes.
async function ensureIndex(sql) {
  await pool.query(sql.endsWith(';') ? sql : `${sql};`);
}

const initDB = async () => {
  try {
    // 1) Users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        pin VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Unique PIN per user (recommended for your current login model)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'users_pin_unique'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_pin_unique UNIQUE (pin);
        END IF;
      END $$;
    `);

    // 2) Transactions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
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
    await ensureColumn('transactions', 'user_id INTEGER');
    await ensureIndex('CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions (user_id, date DESC, id DESC)');

    // 3) Goals
    await pool.query(`
      CREATE TABLE IF NOT EXISTS goals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        name VARCHAR(255) NOT NULL,
        target NUMERIC(15, 2) NOT NULL,
        current_amount NUMERIC(15, 2) DEFAULT 0,
        color VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await ensureColumn('goals', 'user_id INTEGER');
    await ensureIndex('CREATE INDEX IF NOT EXISTS idx_goals_user ON goals (user_id, id ASC)');

    // 4) Cards
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        name VARCHAR(255) NOT NULL,
        limit_amount NUMERIC(15, 2) NOT NULL,
        used_amount NUMERIC(15, 2) DEFAULT 0,
        due_day INTEGER,
        color VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await ensureColumn('cards', 'user_id INTEGER');
    await ensureIndex('CREATE INDEX IF NOT EXISTS idx_cards_user ON cards (user_id, id ASC)');

    // 5) Investments
    await pool.query(`
      CREATE TABLE IF NOT EXISTS investments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50),
        value_amount NUMERIC(15, 2) NOT NULL,
        return_rate VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await ensureColumn('investments', 'user_id INTEGER');
    await ensureIndex('CREATE INDEX IF NOT EXISTS idx_investments_user ON investments (user_id, id ASC)');

    // 6) Budgets (unique per user+category)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        category VARCHAR(100) NOT NULL,
        limit_amount NUMERIC(15, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await ensureColumn('budgets', 'user_id INTEGER');

    // Replace old global UNIQUE(category) with UNIQUE(user_id, category) safely (best-effort)
    await pool.query(`
      DO $$
      DECLARE
        has_old_unique BOOLEAN;
      BEGIN
        SELECT EXISTS(
          SELECT 1
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'budgets'
            AND c.contype = 'u'
            AND c.conname = 'budgets_category_key'
        ) INTO has_old_unique;

        IF has_old_unique THEN
          ALTER TABLE budgets DROP CONSTRAINT budgets_category_key;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'budgets_user_category_unique'
        ) THEN
          ALTER TABLE budgets ADD CONSTRAINT budgets_user_category_unique UNIQUE (user_id, category);
        END IF;
      END $$;
    `);

    await ensureIndex('CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets (user_id, id ASC)');

    // Foreign keys (optional, but helps integrity). Best-effort.
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_user_fk') THEN
          ALTER TABLE transactions
            ADD CONSTRAINT transactions_user_fk
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goals_user_fk') THEN
          ALTER TABLE goals
            ADD CONSTRAINT goals_user_fk
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cards_user_fk') THEN
          ALTER TABLE cards
            ADD CONSTRAINT cards_user_fk
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'investments_user_fk') THEN
          ALTER TABLE investments
            ADD CONSTRAINT investments_user_fk
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budgets_user_fk') THEN
          ALTER TABLE budgets
            ADD CONSTRAINT budgets_user_fk
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // Backfill old rows if there is exactly ONE user (helps migrations from your current single-user DB)
    await pool.query(`
      DO $$
      DECLARE
        uid INTEGER;
        ucount INTEGER;
      BEGIN
        SELECT COUNT(*) INTO ucount FROM users;

        IF ucount = 1 THEN
          SELECT id INTO uid FROM users ORDER BY id LIMIT 1;

          UPDATE transactions SET user_id = uid WHERE user_id IS NULL;
          UPDATE goals SET user_id = uid WHERE user_id IS NULL;
          UPDATE cards SET user_id = uid WHERE user_id IS NULL;
          UPDATE investments SET user_id = uid WHERE user_id IS NULL;
          UPDATE budgets SET user_id = uid WHERE user_id IS NULL;
        END IF;
      END $$;
    `);

    // Enforce NOT NULL if possible (only when there are no nulls)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM transactions WHERE user_id IS NULL LIMIT 1) THEN
          ALTER TABLE transactions ALTER COLUMN user_id SET NOT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM goals WHERE user_id IS NULL LIMIT 1) THEN
          ALTER TABLE goals ALTER COLUMN user_id SET NOT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM cards WHERE user_id IS NULL LIMIT 1) THEN
          ALTER TABLE cards ALTER COLUMN user_id SET NOT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM investments WHERE user_id IS NULL LIMIT 1) THEN
          ALTER TABLE investments ALTER COLUMN user_id SET NOT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM budgets WHERE user_id IS NULL LIMIT 1) THEN
          ALTER TABLE budgets ALTER COLUMN user_id SET NOT NULL;
        END IF;
      EXCEPTION WHEN others THEN
        NULL;
      END $$;
    `);

    console.log('Banco de dados conectado e migrações multiusuário aplicadas (best-effort).');
  } catch (err) {
    console.error('Erro ao inicializar:', err);
  }
};

initDB();

/**
 * --------------------
 * AUTH (multi-user)
 * --------------------
 * - register: creates a new user with unique PIN
 * - login: finds user by PIN
 */
app.post('/api/auth/register', async (req, res) => {
  const { name, pin } = req.body;

  if (!name || !pin) return res.status(400).json({ error: 'missing_fields' });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE pin=$1', [pin]);
    if (exists.rows.length > 0) return res.status(409).json({ error: 'pin_already_exists' });

    const result = await pool.query(
      'INSERT INTO users (name, pin) VALUES ($1, $2) RETURNING id, name, pin, created_at',
      [name, pin]
    );

    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no registro' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.status(400).json({ error: 'missing_fields' });

  try {
    const result = await pool.query('SELECT id, name, pin, created_at FROM users WHERE pin = $1', [pin]);
    if (result.rows.length > 0) {
      res.json({ success: true, user: result.rows[0] });
    } else {
      res.status(401).json({ error: 'PIN incorreto' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro no login' });
  }
});

/**
 * --------------------
 * Transactions (multi-user)
 * --------------------
 */
app.get('/api/transactions', requireUserId, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE user_id=$1 ORDER BY date DESC, id DESC',
      [req.userId]
    );

    const formatted = result.rows.map((row) => ({
      id: row.id,
      description: row.description,
      amount: parseFloat(row.amount),
      type: row.type,
      category: row.category,
      subcategory: row.subcategory,
      date: row.date.toISOString().split('T')[0],
      paymentMethod: row.payment_method,
      isRecurring: row.is_recurring,
      cardId: row.card_id,
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro' });
  }
});

app.post('/api/transactions', requireUserId, async (req, res) => {
  const { description, amount, type, category, subcategory, date, paymentMethod, isRecurring, cardId } = req.body;
  const safeCardId = cardId === '' || cardId === 'undefined' ? null : cardId;

  try {
    const result = await pool.query(
      `INSERT INTO transactions
        (user_id, description, amount, type, category, subcategory, date, payment_method, is_recurring, card_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [req.userId, description, amount, type, category, subcategory, date, paymentMethod, isRecurring, safeCardId]
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro' });
  }
});

app.put('/api/transactions/:id', requireUserId, async (req, res) => {
  const { description, amount, type, category, subcategory, date, paymentMethod, isRecurring, cardId } = req.body;
  const safeCardId = cardId === '' || cardId === 'undefined' ? null : cardId;

  try {
    const updated = await pool.query(
      `UPDATE transactions
       SET description=$1, amount=$2, type=$3, category=$4, subcategory=$5, date=$6,
           payment_method=$7, is_recurring=$8, card_id=$9
       WHERE id=$10 AND user_id=$11`,
      [description, amount, type, category, subcategory, date, paymentMethod, isRecurring, safeCardId, req.params.id, req.userId]
    );

    if (updated.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro' });
  }
});

app.delete('/api/transactions/:id', requireUserId, async (req, res) => {
  try {
    const del = await pool.query('DELETE FROM transactions WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
    if (del.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * --------------------
 * Goals (multi-user)
 * --------------------
 */
app.get('/api/goals', requireUserId, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM goals WHERE user_id=$1 ORDER BY id ASC', [req.userId]);
    res.json(
      r.rows.map((row) => ({
        id: row.id,
        name: row.name,
        target: parseFloat(row.target),
        current: parseFloat(row.current_amount),
        color: row.color,
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

app.post('/api/goals', requireUserId, async (req, res) => {
  const { name, target, current, color } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO goals (user_id, name, target, current_amount, color) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.userId, name, target, current || 0, color]
    );
    res.json({ success: true, id: r.rows[0].id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

app.put('/api/goals/:id', requireUserId, async (req, res) => {
  const { name, target, current, color } = req.body;
  try {
    const u = await pool.query(
      'UPDATE goals SET name=$1, target=$2, current_amount=$3, color=$4 WHERE id=$5 AND user_id=$6',
      [name, target, current, color, req.params.id, req.userId]
    );
    if (u.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

app.delete('/api/goals/:id', requireUserId, async (req, res) => {
  try {
    const d = await pool.query('DELETE FROM goals WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
    if (d.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * --------------------
 * Cards (multi-user)
 * --------------------
 */
app.get('/api/cards', requireUserId, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM cards WHERE user_id=$1 ORDER BY id ASC', [req.userId]);
    res.json(
      r.rows.map((row) => ({
        id: row.id,
        name: row.name,
        limit: parseFloat(row.limit_amount),
        used: parseFloat(row.used_amount),
        dueDay: row.due_day,
        color: row.color,
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

app.post('/api/cards', requireUserId, async (req, res) => {
  const { name, limit, used, dueDay, color } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO cards (user_id, name, limit_amount, used_amount, due_day, color) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [req.userId, name, limit, used || 0, dueDay, color]
    );
    res.json({ success: true, id: r.rows[0].id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

app.put('/api/cards/:id', requireUserId, async (req, res) => {
  const { name, limit, used, dueDay, color } = req.body;
  try {
    const u = await pool.query(
      'UPDATE cards SET name=$1, limit_amount=$2, used_amount=$3, due_day=$4, color=$5 WHERE id=$6 AND user_id=$7',
      [name, limit, used, dueDay, color, req.params.id, req.userId]
    );
    if (u.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

app.delete('/api/cards/:id', requireUserId, async (req, res) => {
  try {
    const d = await pool.query('DELETE FROM cards WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
    if (d.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * --------------------
 * Investments (multi-user)
 * --------------------
 */
app.get('/api/investments', requireUserId, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM investments WHERE user_id=$1 ORDER BY id ASC', [req.userId]);
    res.json(
      r.rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        value: parseFloat(row.value_amount),
        returnRate: row.return_rate,
      }))
    );
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

app.post('/api/investments', requireUserId, async (req, res) => {
  const { name, type, value, returnRate } = req.body;
  try {
    const r = await pool.query(
      'INSERT INTO investments (user_id, name, type, value_amount, return_rate) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [req.userId, name, type, value, returnRate]
    );
    res.json({ success: true, id: r.rows[0].id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

app.put('/api/investments/:id', requireUserId, async (req, res) => {
  const { name, type, value, returnRate } = req.body;
  try {
    const u = await pool.query(
      'UPDATE investments SET name=$1, type=$2, value_amount=$3, return_rate=$4 WHERE id=$5 AND user_id=$6',
      [name, type, value, returnRate, req.params.id, req.userId]
    );
    if (u.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

app.delete('/api/investments/:id', requireUserId, async (req, res) => {
  try {
    const d = await pool.query('DELETE FROM investments WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
    if (d.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * --------------------
 * Budgets (multi-user, upsert by category)
 * --------------------
 */
app.get('/api/budgets', requireUserId, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM budgets WHERE user_id=$1 ORDER BY id ASC', [req.userId]);
    res.json(r.rows.map((row) => ({ id: row.id, category: row.category, limit: parseFloat(row.limit_amount) })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

// Upsert by category (per user)
app.post('/api/budgets', requireUserId, async (req, res) => {
  const { category, limit } = req.body;
  if (!category) return res.status(400).json({ error: 'missing_fields' });

  try {
    const c = await pool.query('SELECT id FROM budgets WHERE user_id=$1 AND category=$2', [req.userId, category]);

    if (c.rows.length > 0) {
      await pool.query('UPDATE budgets SET limit_amount=$1 WHERE id=$2 AND user_id=$3', [limit, c.rows[0].id, req.userId]);
      return res.json({ success: true, id: c.rows[0].id });
    }

    const r = await pool.query(
      'INSERT INTO budgets (user_id, category, limit_amount) VALUES ($1,$2,$3) RETURNING id',
      [req.userId, category, limit]
    );
    res.json({ success: true, id: r.rows[0].id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

app.put('/api/budgets/:category', requireUserId, async (req, res) => {
  const { limit } = req.body;
  const { category } = req.params;

  try {
    const u = await pool.query('UPDATE budgets SET limit_amount=$1 WHERE user_id=$2 AND category=$3', [
      limit,
      req.userId,
      category,
    ]);
    if (u.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

app.delete('/api/budgets/:category', requireUserId, async (req, res) => {
  try {
    const d = await pool.query('DELETE FROM budgets WHERE user_id=$1 AND category=$2', [req.userId, req.params.category]);
    if (d.rowCount === 0) return res.status(404).json({ error: 'not_found' });
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro' });
  }
});

/**
 * --------------------
 * SPA fallback
 * --------------------
 */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${port}`);
});
