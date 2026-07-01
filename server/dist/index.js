import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/env.js';
import { healthRoute } from './routes/health.js';
import { wsManager } from './websocket/manager.js';
// 1. Initialize Fastify with structured build-in logging
const server = Fastify({
    logger: {
        level: 'info',
        serializers: {
            req(request) {
                return {
                    method: request.method,
                    url: request.url,
                    hostname: request.hostname,
                    remoteAddress: request.ip,
                };
            },
        },
    },
});
/**
 * Register core plugins and websocket gateway handlers.
 */
async function startServer() {
    try {
        // 2. Register fastify-websocket plugin
        await server.register(fastifyWebsocket, {
            options: {
                maxPayload: 10 * 1024 * 1024, // 10MB limit for future audio buffering compatibility
            },
        });
        console.log('[Server] Registered fastify-websocket plugin successfully.');
        // 3. Register HTTP REST Routes
        await server.register(healthRoute);
        console.log('[Server] Registered health check route.');
        // 4. Register WebSocket Gateway Route
        // Shorthand syntax supported by @fastify/websocket
        server.get('/ws', { websocket: true }, (connection, req) => {
            // Safely resolve the raw WebSocket depending on the Fastify plugin version
            const rawSocket = connection.socket || connection;
            wsManager.handleConnection(rawSocket, req.raw);
        });
        console.log('[Server] Registered /ws websocket route.');
        // 5. Start listening
        await server.listen({ port: config.PORT, host: config.HOST });
        console.log(`\n🚀 Real-Time Voice AI Gateway Server is running!`);
        console.log(`   - HTTP Health: http://${config.HOST}:${config.PORT}/health`);
        console.log(`   - WebSocket URI: ws://${config.HOST}:${config.PORT}/ws\n`);
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
}
// Global exception safety logging
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Critical Error] Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('[Critical Error] Uncaught Exception thrown:', error);
    process.exit(1);
});
startServer();
