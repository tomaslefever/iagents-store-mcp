import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

const SCHEMA_PATH = path.join(__dirname, '..', 'pb_schema.json');

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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

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
    }
});

async function run() {
    await authenticate();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("PocketBase MCP Server running on stdio");
}

run().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
