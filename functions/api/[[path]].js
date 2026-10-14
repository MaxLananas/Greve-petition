import { handleApi } from '../../cloudflare/api.mjs'

// Seuls /api et /api/* passent par une Function (voir public/_routes.json).
export async function onRequest(context) {
  try {
    return await handleApi(context.request, context.env, context)
  } catch (error) {
    // Dernier filet : jamais de pile technique vers le navigateur.
    console.error('Pages Function error:', error?.message ?? error)
    return Response.json(
      { error: 'La base de signatures est momentanément indisponible. Merci de réessayer.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
