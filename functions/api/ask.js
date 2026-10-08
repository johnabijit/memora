import handler from '../../server/ask.js'
import { pagesHandler } from '../../server/http.js'

export const onRequest = pagesHandler(handler)
