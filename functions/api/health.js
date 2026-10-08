import handler from '../../server/health.js'
import { pagesHandler } from '../../server/http.js'

export const onRequest = pagesHandler(handler)
