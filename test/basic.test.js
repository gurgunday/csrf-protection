'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const fastifyCookie = require('fastify-cookie')
const fastifySession = require('fastify-session')
const fastifySecureSession = require('fastify-secure-session')
const fastifyCsrf = require('../index')

const sodium = require('sodium-native')
const key = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES)
sodium.randombytes_buf(key)

test('Cookies', t => {
  async function load () {
    const fastify = Fastify()
    await fastify.register(fastifyCookie)
    await fastify.register(fastifyCsrf)
    return fastify
  }
  runTest(t, load, { property: '_csrf', place: 'query' })
  runTest(t, load, { property: '_csrf', place: 'body' }, 'preValidation')
  runTest(t, load, { property: 'csrf-token', place: 'headers' })
  runTest(t, load, { property: 'xsrf-token', place: 'headers' })
  runTest(t, load, { property: 'x-csrf-token', place: 'headers' })
  runTest(t, load, { property: 'x-xsrf-token', place: 'headers' })
  runCookieOpts(t, load)
  t.end()
})

test('Fastify Session', t => {
  async function load () {
    const fastify = Fastify()
    await fastify.register(fastifyCookie)
    await fastify.register(fastifySession, {
      secret: 'a'.repeat(32),
      cookie: { path: '/', secure: false }
    })
    await fastify.register(fastifyCsrf, { sessionPlugin: 'fastify-session' })
    return fastify
  }
  runTest(t, load, { property: '_csrf', place: 'query' }, 'preValidation')
  runTest(t, load, { property: '_csrf', place: 'body' }, 'preValidation')
  runTest(t, load, { property: 'csrf-token', place: 'headers' }, 'preValidation')
  runTest(t, load, { property: 'xsrf-token', place: 'headers' }, 'preValidation')
  runTest(t, load, { property: 'x-csrf-token', place: 'headers' }, 'preValidation')
  runTest(t, load, { property: 'x-xsrf-token', place: 'headers' }, 'preValidation')
  t.end()
})

test('Fastify Secure Session', t => {
  async function load () {
    const fastify = Fastify()
    await fastify.register(fastifySecureSession, { key, cookie: { path: '/', secure: false } })
    await fastify.register(fastifyCsrf, { sessionPlugin: 'fastify-secure-session' })
    return fastify
  }
  runTest(t, load, { property: '_csrf', place: 'query' })
  runTest(t, load, { property: '_csrf', place: 'body' }, 'preValidation')
  runTest(t, load, { property: 'csrf-token', place: 'headers' })
  runTest(t, load, { property: 'xsrf-token', place: 'headers' })
  runTest(t, load, { property: 'x-csrf-token', place: 'headers' })
  runTest(t, load, { property: 'x-xsrf-token', place: 'headers' })
  runCookieOpts(t, load)
  t.end()
})

test('Validation', t => {
  t.test('cookieKey', t => {
    t.plan(1)
    const fastify = Fastify()
    fastify.register(fastifyCookie)
    fastify.register(fastifyCsrf, { cookieKey: 42 })
    fastify.ready(err => {
      t.strictEqual(err.message, 'cookieKey should be a string')
    })
  })

  t.test('sessionKey', t => {
    t.plan(1)
    const fastify = Fastify()
    fastify.register(fastifyCookie)
    fastify.register(fastifyCsrf, { sessionKey: 42 })
    fastify.ready(err => {
      t.strictEqual(err.message, 'sessionKey should be a string')
    })
  })

  t.test('getToken', t => {
    t.plan(1)
    const fastify = Fastify()
    fastify.register(fastifyCookie)
    fastify.register(fastifyCsrf, { getToken: 42 })
    fastify.ready(err => {
      t.strictEqual(err.message, 'getToken should be a function')
    })
  })

  t.test('cookieOpts', t => {
    t.plan(1)
    const fastify = Fastify()
    fastify.register(fastifyCookie)
    fastify.register(fastifyCsrf, { cookieOpts: 42 })
    fastify.ready(err => {
      t.strictEqual(err.message, 'cookieOpts should be a object')
    })
  })

  t.test('sessionPlugin', t => {
    t.plan(1)
    const fastify = Fastify()
    fastify.register(fastifyCookie)
    fastify.register(fastifyCsrf, { sessionPlugin: 42 })
    fastify.ready(err => {
      t.strictEqual(err.message, "sessionPlugin should be one of the following: 'fastify-cookie', 'fastify-session', 'fastify-secure-session'")
    })
  })

  t.end()
})

function runTest (t, load, tkn, hook = 'onRequest') {
  t.test(`Token in ${tkn.place}`, async t => {
    const fastify = await load()

    fastify.get('/', async (req, reply) => {
      const token = await reply.generateCsrf()
      return { token }
    })

    fastify.post('/', { [hook]: fastify.csrfProtection }, async (req, reply) => {
      return req.body
    })

    let response = await fastify.inject({
      method: 'GET',
      path: '/'
    })

    t.strictEqual(response.statusCode, 200)
    const cookie = response.cookies[0]
    const token = response.json().token

    if (tkn.place === 'query') {
      response = await fastify.inject({
        method: 'POST',
        path: `/?${tkn.property}=${token}`,
        payload: { hello: 'world' },
        cookies: {
          [cookie.name]: cookie.value
        }
      })
    } else if (tkn.place === 'body') {
      response = await fastify.inject({
        method: 'POST',
        path: '/',
        payload: {
          hello: 'world',
          [tkn.property]: token
        },
        cookies: {
          [cookie.name]: cookie.value
        }
      })
    } else {
      response = await fastify.inject({
        method: 'POST',
        path: '/',
        payload: { hello: 'world' },
        headers: {
          [tkn.property]: token
        },
        cookies: {
          [cookie.name]: cookie.value
        }
      })
    }

    t.strictEqual(response.statusCode, 200)
    t.match(response.json(), { hello: 'world' })

    response = await fastify.inject({
      method: 'POST',
      path: '/',
      payload: { hello: 'world' }
    })

    t.strictEqual(response.statusCode, 403)
    t.match(response.json(), { message: 'Missing csrf secret' })

    response = await fastify.inject({
      method: 'POST',
      path: '/',
      payload: { hello: 'world' },
      cookies: {
        [cookie.name]: cookie.value
      }
    })

    t.strictEqual(response.statusCode, 403)
    t.match(response.json(), { message: 'Invalid csrf token' })
  })
}

function runCookieOpts (t, load) {
  t.test('Custom cookie options', async t => {
    const fastify = await load()

    fastify.get('/', async (req, reply) => {
      const token = await reply.generateCsrf({ path: '/hello' })
      return { token }
    })

    const response = await fastify.inject({
      method: 'GET',
      path: '/'
    })

    const cookie = response.cookies[0]
    t.match(cookie, { path: '/hello' })
  })
}
