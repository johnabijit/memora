import handler from '../../server/scene-background.js'
import { pagesHandler } from '../../server/http.js'

export const onRequest = pagesHandler(handler)
