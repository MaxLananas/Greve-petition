import { handleApi } from '../../cloudflare/api.mjs'

// Seuls /api et /api/* passent par une Function (voir public/_routes.json).
export function onRequest(context) {
  return handleApi(context.request, context.env, context)
}
