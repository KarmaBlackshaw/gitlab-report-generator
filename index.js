require('dotenv').config()

const Koa = require('koa')
const Router = require('@koa/router')

const app = new Koa()
const router = new Router()

const { PORT } = require('./constants')
const reportService = require('./reportService')

router.get('/report/:email', async (ctx, next) => {
  const report = await reportService.generateReport({
    email: ctx.params.email,
    reset: ctx.request.query.reset,
    include_merge: ctx.request.query.include_merge,
    limit: ctx.request.query.limit
  })

  ctx.body = report || 'No commits as of today'
})

app.use(router.routes())

app.listen(PORT)

require('./jobs/fetch-projects')

console.log(`Listening to port ${PORT}`)
