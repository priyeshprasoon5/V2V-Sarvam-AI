/**
 * Health check endpoint for monitoring setups.
 * Returns HTTP 200 OK.
 */
export async function healthRoute(fastify, options) {
    fastify.get('/health', async (request, reply) => {
        return {
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            connections: fastify.server.connections,
        };
    });
}
