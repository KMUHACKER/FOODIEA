'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const { createApp } = require('./app');

async function serve(t, execute) {
    const server = createApp({ execute }, { origins: ['https://app.example.test'] }).listen(0, '127.0.0.1');
    t.after(() => new Promise(resolve => server.close(resolve)));
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
}

test('invalid and duplicate request parameters are rejected before the database', async t => {
    let calls = 0;
    const origin = await serve(t, async () => { calls += 1; return [[]]; });
    for (const path of ['/search', '/search?ingredients=onion&limit=51', '/recipes?page=1&page=2', '/recipe/abc']) {
        assert.equal((await fetch(origin + path)).status, 400, path);
    }
    assert.equal(calls, 0);
});

test('search binds included and excluded ingredients and paginates matching recipes', async t => {
    const origin = await serve(t, async ({ sql }, values) => {
        assert.match(sql, /WHERE EXISTS .* AND NOT EXISTS .* ORDER BY r.ID LIMIT \? OFFSET \?/);
        assert.ok(!sql.includes('onion') && !sql.includes('garlic'));
        assert.deepEqual(values, [...Array(29).fill('onion'), ...Array(29).fill('garlic'), 10, 10]);
        return [[{ ID: 1, Name: 'Onion soup' }]];
    });
    const response = await fetch(origin + '/search?ingredients=onion&not_ingredients=garlic&page=2');
    assert.deepEqual(await response.json(), { recipes: [{ ID: 1, Name: 'Onion soup' }] });
});

test('detail links are relative and CORS grants access only to configured origins', async t => {
    const origin = await serve(t, async ({ sql }) => [
        sql.includes('recipetest') ? [{ Recipe: 'Mix@Serve' }] : [{ ID: 3, Name: 'Salad', Ingredients: 'Carrot' }],
    ]);
    const response = await fetch(origin + '/recipe/3', { headers: { Origin: 'https://app.example.test' } });
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example.test');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const { recipe } = await response.json();
    assert.equal(recipe.mainImage, '/images/3/3_main.jpg');
    assert.equal(recipe.steps[1].image, '/images/3/3_step2.jpg');

    const other = await fetch(origin + '/recipe/3', { headers: { Origin: 'https://other.example.test' } });
    assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('database errors are returned without internal details', async t => {
    const origin = await serve(t, async () => { throw new Error('internal database details'); });
    const response = await fetch(origin + '/recipes');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error' });
});
