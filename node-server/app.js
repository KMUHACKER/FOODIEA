'use strict';

const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const imageRoot = path.join(__dirname, 'recipe_src');
const ingredientColumns = Array.from({ length: 29 }, (_, index) => `i.ingredient${index + 1} = ?`).join(' OR ');
const ingredientExists = `EXISTS (SELECT 1 FROM ingredientData AS i WHERE i.ID = r.ID AND (${ingredientColumns}))`;

function pagination({ page = '1', limit = '10' }) {
    if (typeof page !== 'string' || typeof limit !== 'string' ||
        !/^\d{1,4}$/.test(page) || !/^\d{1,2}$/.test(limit)) return null;

    const size = Number(limit);
    const offset = (Number(page) - 1) * size;
    return size >= 1 && size <= 50 && Number(page) >= 1 && offset <= 10000
        ? [size, offset]
        : null;
}

function ingredientList(value) {
    if (typeof value !== 'string' || value.length > 1500) return null;
    const items = [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
    return items.length <= 20 && items.every(item => item.length <= 64) ? items : null;
}

function createApp(db, { origins = [], publicUrl = '' } = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.use((req, res, next) => {
        res.set('X-Content-Type-Options', 'nosniff');
        next();
    });
    app.use(cors({ origin: origins, methods: ['GET', 'HEAD'], allowedHeaders: ['Content-Type'] }));

    function query(sql, values) {
        return db.execute({ sql, timeout: 5000 }, values).then(([rows]) => rows);
    }

    app.get('/images/:id/:filename', (req, res, next) => {
        const { id, filename } = req.params;
        if (!/^\d{1,10}$/.test(id) || !new RegExp(`^${id}_(?:main|step[1-9][0-9]{0,3})\\.jpg$`).test(filename)) {
            return res.sendStatus(404);
        }
        res.sendFile(path.join(id, filename), { root: imageRoot }, error => {
            if (error) next(error);
        });
    });

    app.get('/recipes', async (req, res) => {
        const search = req.query.query ?? '';
        const page = pagination(req.query);
        if (!page || typeof search !== 'string' || search.length > 100) {
            return res.status(400).json({ error: 'Invalid search or pagination' });
        }
        // Escape LIKE wildcards so the term is treated as literal text.
        const term = search.replace(/[!%_]/g, '!$&');
        const rows = search
            ? await query("SELECT ID, Name, Ingredients FROM recipe WHERE Name LIKE ? ESCAPE '!' ORDER BY ID LIMIT ? OFFSET ?", [`%${term}%`, ...page])
            : await query('SELECT ID, Name, Ingredients FROM recipe ORDER BY RAND() LIMIT ? OFFSET ?', page);
        res.json(rows);
    });

    app.get('/recipe/:id', async (req, res) => {
        const id = req.params.id;
        if (!/^\d{1,10}$/.test(id) || Number(id) === 0) {
            return res.status(400).json({ error: 'Invalid recipe ID' });
        }
        const [recipe] = await query('SELECT ID, Name, Ingredients FROM recipe WHERE ID = ?', [id]);
        if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

        const [steps] = await query('SELECT Recipe FROM recipetest WHERE ID = ?', [id]);
        if (typeof steps?.Recipe !== 'string') return res.status(404).json({ error: 'Recipe steps not found' });

        const imagePrefix = `${publicUrl}/images/${id}/${id}_`;
        res.json({ recipe: {
            id: recipe.ID,
            name: recipe.Name,
            ingredients: recipe.Ingredients,
            mainImage: `${imagePrefix}main.jpg`,
            steps: steps.Recipe.replace(/[\uFFFD\u2028\u2029]/g, '').split('@').map((step, index) => ({
                description: step.trim(),
                image: `${imagePrefix}step${index + 1}.jpg`,
            })),
        } });
    });

    app.get('/search', async (req, res) => {
        const page = pagination(req.query);
        const ingredients = ingredientList(req.query.ingredients);
        const excluded = ingredientList(req.query.not_ingredients ?? '');
        if (!page || !ingredients?.length || !excluded) {
            return res.status(400).json({ error: 'Invalid ingredients or pagination' });
        }

        const filters = [
            ...ingredients.map(() => ingredientExists),
            ...excluded.map(() => `NOT ${ingredientExists}`),
        ];
        const values = [...ingredients, ...excluded].flatMap(item => Array(29).fill(item));
        const recipes = await query(
            `SELECT r.ID, r.Name, r.Ingredients FROM recipe AS r WHERE ${filters.join(' AND ')} ORDER BY r.ID LIMIT ? OFFSET ?`,
            [...values, ...page],
        );
        res.json({ recipes });
    });

    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error.status === 400 || error.status === 404) {
            return res.status(error.status).json({ error: error.status === 404 ? 'Not found' : 'Invalid request' });
        }
        console.error('Recipe request failed:', error.code || error.name);
        res.status(500).json({ error: 'Internal server error' });
    });
    return app;
}

async function start() {
    const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_TLS_CA_FILE, PUBLIC_API_URL } = process.env;
    if (![DB_HOST, DB_USER, DB_PASSWORD, DB_NAME].every(Boolean)) {
        throw new Error('Set DB_HOST, DB_USER, DB_PASSWORD and DB_NAME before starting.');
    }

    let publicUrl = '';
    if (PUBLIC_API_URL) {
        const url = new URL(PUBLIC_API_URL);
        if (url.protocol !== 'https:' || url.username || url.password ||
            url.search || url.hash || url.pathname !== '/') {
            throw new Error('PUBLIC_API_URL must be an HTTPS origin.');
        }
        publicUrl = url.origin;
    }

    const localDatabase = ['localhost', '127.0.0.1', '::1'].includes(DB_HOST);
    const db = mysql.createPool({
        host: DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
        charset: 'utf8mb4',
        connectTimeout: 5000,
        connectionLimit: 5,
        queueLimit: 20,
        ssl: DB_TLS_CA_FILE || !localDatabase ? {
            rejectUnauthorized: true,
            verifyIdentity: true,
            ...(DB_TLS_CA_FILE ? { ca: fs.readFileSync(DB_TLS_CA_FILE) } : {}),
        } : undefined,
    }).promise();
    try {
        await db.execute('SELECT 1');
    } catch (error) {
        await db.end();
        throw new Error(`Database connection failed (${error.code || error.name}).`);
    }

    const origins = (process.env.CORS_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean);
    const port = Number(process.env.PORT || 8080);
    const host = process.env.HOST || '127.0.0.1';
    createApp(db, { origins, publicUrl }).listen(port, host, () => {
        console.log(`Recipe API listening on ${host}:${port}`);
    });
}

if (require.main === module) {
    start().catch(error => {
        // Configuration errors can carry the original input as part of their exception.
        console.error(error.code ? `Server startup failed (${error.code}).` : error.message);
        process.exitCode = 1;
    });
}

module.exports = { createApp };
