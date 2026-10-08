import handler from '../../server/open-music.js'
import { pagesHandler } from '../../server/http.js'

export const onRequest = pagesHandler(handler)
