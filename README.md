# PocketBase MCP Server

Este servidor MCP (Model Context Protocol) permite a los agentes de IA interactuar de forma completa con una instancia de [PocketBase](https://pocketbase.io/), incluyendo la gestión de datos y la administración de esquemas.

## 🤖 Capacidades del Agente

A través de este MCP, un agente puede realizar las siguientes acciones:

### 1. Gestión de Esquemas e Inicialización
- **Leer la Estructura de la BD**: El agente puede acceder al recurso `pocketbase://schema` para leer el archivo `pb_schema.json` completo. Esto le permite entender:
    - Qué colecciones existen (ej: `users`, `products`, `orders`).
    - Los tipos de campos (texto, fecha, relación, archivo, etc.).
    - Las reglas de acceso (API rules) y validaciones.
- **Aplicar Cambios de Esquema**: Mediante la herramienta `apply_schema`, el agente puede importar automáticamente el esquema definido en `pb_schema.json` a la instancia de PocketBase. Esto es ideal para:
    - Despliegues iniciales en entornos vacíos.
    - Restaurar la estructura de la base de datos.
    - Actualizar colecciones existentes sin perder datos (gracias al modo de importación no destructivo).

### 2. Manipulación de Datos (CRUD)
El agente tiene control total sobre los registros de cualquier colección:

- **Consultar Datos (`get_records`)**:
    - Obtener listas de registros.
    - **Filtrar**: Usar la sintaxis nativa de PocketBase (ej: `status = 'active' && created > '2023-01-01'`).
    - **Ordenar**: Ordenar resultados (ej: `-created`, `name`).
    - **Paginación**: Controlar `page` y `perPage` para manejar grandes volúmenes de datos.
- **Crear Datos (`create_record`)**: Insertar nuevos registros en cualquier colección validando los datos contra el esquema.
- **Actualizar Datos (`update_record`)**: Modificar campos específicos de un registro existente mediante su ID.
- **Eliminar Datos (`delete_record`)**: Borrar registros individuales.

### 3. Exploración
- **Listar Colecciones (`list_collections`)**: Obtener una lista rápida de todas las colecciones disponibles en la instancia actual para exploración inicial.

---

## 🚀 Despliegue en Easypanel

Este repositorio está listo para ser desplegado como un servicio en Easypanel.

1. **Nuevo Servicio**: Crea un servicio tipo "App" o importando desde Git.
2. **Variables de Entorno**:
   - `POCKETBASE_URL`: URL de tu instancia de PocketBase (ej: `https://pb.tu-dominio.com` o interna `http://pocketbase:8090`).
   - `POCKETBASE_EMAIL`: Email del administrador.
   - `POCKETBASE_PASSWORD`: Contraseña del administrador.
3. **Docker**: Easypanel detectará automáticamente el `Dockerfile`.

## 🛠️ Desarrollo Local

1. `npm install`
2. Copia `.env.example` a `.env` y ajusta tus credenciales.
3. `npm run build`
4. `npm start`
