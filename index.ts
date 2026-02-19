import express from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import PocketBase from 'pocketbase';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const pb = new PocketBase(process.env.POCKETBASE_URL || 'http://127.0.0.1:8090');

// Autenticación si se proporcionan credenciales
async function authenticate() {
    if (process.env.POCKETBASE_EMAIL && process.env.POCKETBASE_PASSWORD) {
        try {
            await pb.admins.authWithPassword(
                process.env.POCKETBASE_EMAIL,
                process.env.POCKETBASE_PASSWORD
            );
            console.error("Autenticado en PocketBase como admin");
        } catch (error) {
            console.error("Error de autenticación en PocketBase:", error);
        }
    }
}

const app = express();


// Helper para obtener ID de PB desde Supabase ID
// Si no existe, lo crea automáticamente (sincronización on-the-fly)
async function getPbUserId(supabaseId: string): Promise<string> {
    try {
        const user = await pb.collection('users').getFirstListItem(`supabase_id="${supabaseId}"`);
        return user.id;
    } catch (e: any) {
        if (e.status === 404) {
            // El usuario existe en Supabase pero no en PB, lo creamos
            // Usamos una contraseña aleatoria ya que la autenticación la maneja Supabase/Aplicación principal
            // El email es requerido, usaremos un dummy si no se provee (idealmente deberíamos recibirlo)
            const newUser = await pb.collection('users').create({
                supabase_id: supabaseId,
                email: `${supabaseId}@placeholder.local`, // Dummy email, required by PB Auth
                password: Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8),
                passwordConfirm: Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8),
                verified: true
            });
            return newUser.id;
        }
        throw e;
    }
}

const SCHEMA_PATH = path.join(__dirname, '..', 'pb_schema.json');

// Función factory para crear servidor MCP
// Necesitamos una nueva instancia por cada conexión SSE
function createMcpServer() {
    const server = new Server(
        {
            name: "pocketbase-mcp",
            version: "1.0.0",
        },
        {
            capabilities: {
                tools: {},
                resources: {},
            },
        }
    );

    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        return {
            resources: [
                {
                    uri: "pocketbase://schema",
                    name: "PocketBase Schema",
                    mimeType: "application/json",
                    description: "Esquema completo de la base de datos PocketBase (colecciones, campos, reglas)",
                },
            ],
        };
    });

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const { uri } = request.params;

        if (uri === "pocketbase://schema") {
            try {
                const schemaContent = fs.readFileSync(SCHEMA_PATH, "utf-8");
                return {
                    contents: [
                        {
                            uri,
                            mimeType: "application/json",
                            text: schemaContent,
                        },
                    ],
                };
            } catch (error) {
                throw new Error(`No se pudo leer el archivo de esquema en ${SCHEMA_PATH}: ${error}`);
            }
        }

        throw new Error(`Recurso no encontrado: ${uri}`);
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: "list_collections",
                    description: "Lista todas las colecciones de PocketBase",
                    inputSchema: {
                        type: "object",
                        properties: {},
                    },
                },
                {
                    name: "get_records",
                    description: "Obtiene registros de una colección específica",
                    inputSchema: {
                        type: "object",
                        properties: {
                            collection: { type: "string", description: "Nombre de la colección" },
                            user_id: { type: "string", description: "ID del usuario de Supabase (UUID)" },
                            page: { type: "number", description: "Número de página" },
                            perPage: { type: "number", description: "Registros por página" },
                            filter: { type: "string", description: "Filtro de PocketBase (ej: 'status = true')" },
                            sort: { type: "string", description: "Orden (ej: '-created')" },
                        },
                        required: ["collection", "user_id"],
                    },
                },
                {
                    name: "create_record",
                    description: "Crea un nuevo registro en una colección",
                    inputSchema: {
                        type: "object",
                        properties: {
                            collection: { type: "string", description: "Nombre de la colección" },
                            user_id: { type: "string", description: "ID del usuario de Supabase (UUID)" },
                            data: { type: "object", description: "Datos del registro" },
                        },
                        required: ["collection", "user_id", "data"],
                    },
                },
                {
                    name: "update_record",
                    description: "Actualiza un registro existente",
                    inputSchema: {
                        type: "object",
                        properties: {
                            collection: { type: "string", description: "Nombre de la colección" },
                            id: { type: "string", description: "ID del registro" },
                            user_id: { type: "string", description: "ID del usuario de Supabase (UUID)" },
                            data: { type: "object", description: "Datos a actualizar" },
                        },
                        required: ["collection", "id", "user_id", "data"],
                    },
                },
                {
                    name: "delete_record",
                    description: "Elimina un registro",
                    inputSchema: {
                        type: "object",
                        properties: {
                            collection: { type: "string", description: "Nombre de la colección" },
                            id: { type: "string", description: "ID del registro" },
                            user_id: { type: "string", description: "ID del usuario de Supabase (UUID)" },
                        },
                        required: ["collection", "id", "user_id"],
                    },
                },
                {
                    name: "apply_schema",
                    description: "Aplica el esquema local (pb_schema.json) a la instancia de PocketBase. Crea las colecciones si no existen.",
                    inputSchema: {
                        type: "object",
                        properties: {},
                    },
                },
            ],
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        console.log(`[MCP Tool Request] Tool: ${name}`, JSON.stringify(args, null, 2));

        try {
            switch (name) {
                case "list_collections": {
                    const collections = await pb.collections.getFullList();
                    return {
                        content: [{ type: "text", text: JSON.stringify(collections, null, 2) }],
                    };
                }

                case "get_records": {
                    const { collection, user_id: supabaseId, page = 1, perPage = 50, filter = "", sort = "" } = args as any;

                    // Resolver ID interno de PB
                    const pbUserId = await getPbUserId(supabaseId);

                    // Construir filtro de seguridad
                    let securityFilter = `user = "${pbUserId}"`;
                    // Si el usuario especifica filtro adicional, combinarlo
                    const finalFilter = filter ? `(${filter}) && ${securityFilter}` : securityFilter;

                    const records = await pb.collection(collection).getList(page, perPage, {
                        filter: finalFilter,
                        sort,
                    });
                    return {
                        content: [{ type: "text", text: JSON.stringify(records, null, 2) }],
                    };
                }

                case "create_record": {
                    const { collection, user_id: supabaseId, data } = args as any;

                    // Resolver ID interno de PB
                    const pbUserId = await getPbUserId(supabaseId);

                    // Inyectar user_id en los datos
                    const dataWithUser = { ...data, user: pbUserId };

                    const record = await pb.collection(collection).create(dataWithUser);
                    return {
                        content: [{ type: "text", text: JSON.stringify(record, null, 2) }],
                    };
                }

                case "update_record": {
                    const { collection, id, user_id: supabaseId, data } = args as any;

                    // Resolver ID interno de PB
                    const pbUserId = await getPbUserId(supabaseId);

                    // Verificar propiedad antes de actualizar
                    try {
                        await pb.collection(collection).getFirstListItem(`id="${id}" && user="${pbUserId}"`);
                    } catch (e) {
                        throw new Error("Registro no encontrado o no pertenece al usuario.");
                    }

                    const record = await pb.collection(collection).update(id, data);
                    return {
                        content: [{ type: "text", text: JSON.stringify(record, null, 2) }],
                    };
                }

                case "delete_record": {
                    const { collection, id, user_id: supabaseId } = args as any;

                    // Resolver ID interno de PB
                    const pbUserId = await getPbUserId(supabaseId);

                    // Verificar propiedad antes de eliminar
                    try {
                        await pb.collection(collection).getFirstListItem(`id="${id}" && user="${pbUserId}"`);
                    } catch (e) {
                        throw new Error("Registro no encontrado o no pertenece al usuario.");
                    }

                    await pb.collection(collection).delete(id);
                    return {
                        content: [{ type: "text", text: `Registro ${id} eliminado de ${collection}` }],
                    };
                }

                case "apply_schema": {
                    try {
                        const schemaContent = fs.readFileSync(SCHEMA_PATH, "utf-8");
                        const collections = JSON.parse(schemaContent);

                        if (!Array.isArray(collections)) {
                            throw new Error("El archivo de esquema no contiene un array de colecciones válido.");
                        }

                        const results = [];

                        try {
                            // Usamos la función import del SDK para manejar dependencias y colecciones del sistema
                            // El segundo argumento 'false' evita borrar colecciones que no estén en el esquema
                            await pb.collections.import(collections, false); // false = deleteMissing
                            results.push("Esquema importado exitosamente.");
                        } catch (importError: any) {
                            // Si falla la importación nativa (quizás versión antigua), reportamos el error
                            // Podríamos intentar fallback manual aquí, pero import es lo ideal para pb_schema.json
                            throw new Error(`Error al importar esquema usando pb.collections.import: ${importError.message}\nVerifique que su versión de PocketBase sea compatible.`);
                        }

                        return {
                            content: [{ type: "text", text: results.join("\n") }],
                        };
                    } catch (error: any) {
                        return {
                            isError: true,
                            content: [{ type: "text", text: `Fallo al aplicar esquema: ${error.message}` }],
                        };
                    }
                }

                default:
                    throw new Error(`Herramienta no encontrada: ${name}`);
            }
        } catch (error: any) {
            return {
                isError: true,
                content: [{ type: "text", text: error.message || String(error) }],
            };
        };
    });

    return server;
}

// Configuración de Express para SSE con soporte multi-sesión

import { v4 as uuidv4 } from 'uuid';

// Mapa para almacenar las sesiones activas
// Key: sessionId, Value: { transport, server }
const sessions = new Map<string, { transport: SSEServerTransport, server: Server }>();

async function run() {
    await authenticate();

    // Middleware para parsear JSON bodies
    app.use(express.json());

    // Endpoint para iniciar la conexión SSE
    // Este endpoint crea una nueva sesión, instancia un servidor MCP y devuelve el endpoint para enviar mensajes
    app.get("/sse", async (req, res) => {
        const sessionId = uuidv4();

        console.log(`Nueva conexión SSE iniciada. SessionID: ${sessionId}`);

        // El transporte SSE escribe en la respuesta HTTP directamente
        // Le pasamos el endpoint donde el cliente debe enviar sus mensajes POST
        // Este endpoint debe incluir el sessionId para que podamos enrutar el mensaje
        const transport = new SSEServerTransport(`/messages?sessionId=${sessionId}`, res);

        const server = createMcpServer();

        // Almacenamos la sesión
        sessions.set(sessionId, { transport, server });

        // Limpieza cuando la conexión se cierra
        req.on("close", () => {
            console.log(`Conexión SSE cerrada. SessionID: ${sessionId}`);
            sessions.delete(sessionId);
        });

        await server.connect(transport);
    });

    // Endpoint para recibir mensajes del cliente (JSON-RPC)
    app.post("/messages", async (req, res) => {
        const sessionId = req.query.sessionId as string;

        if (!sessionId) {
            res.status(400).send("Falta sessionId");
            return;
        }

        const session = sessions.get(sessionId);

        if (!session) {
            console.warn(`[SSE Warning] Session not found: ${sessionId}`);
            res.status(404).send("Sesión no encontrada o expirada");
            return;
        }

        console.log(`[SSE Message] Received ${req.method} for session ${sessionId}`);

        try {
            // Pasamos el mensaje al transporte de la sesión correspondiente
            // handlePostMessage procesa el cuerpo JSON y lo inyecta en el servidor MCP
            await session.transport.handlePostMessage(req, res);
        } catch (error) {
            console.error(`Error al manejar mensaje para sesión ${sessionId}:`, error);
            // Si el transporte no manejó la respuesta (ej: error interno), enviamos 500
            if (!res.headersSent) {
                res.status(500).json({ error: "Internal Server Error" });
            }
        }
    });

    // Endpoint de health check para Easypanel
    app.get("/health", (req, res) => {
        res.status(200).send("OK");
    });

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`PocketBase MCP Server running on port ${PORT}`);
        console.log(`SSE endpoint: http://localhost:${PORT}/sse`);
    });
}

run().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
