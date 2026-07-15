// Nitro server route — demonstrates Nuxt's built-in server functionality.
// Available at GET /api/hello
export default defineEventHandler(() => {
  return {
    message: 'Hello world from the Nuxt (Nitro) server!',
    timestamp: new Date().toISOString()
  }
})
