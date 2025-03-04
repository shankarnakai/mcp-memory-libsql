# Vector Embeddings for MCP Memory Server

This document describes the vector embedding capabilities added to the MCP Memory Server.

## Overview

The MCP Memory Server now supports true vector embeddings for semantic search using the [Transformers.js](https://github.com/xenova/transformers.js) library. This enables more powerful and accurate semantic search capabilities, allowing the memory system to find related entities based on the meaning of text rather than just keyword matching.

## Features

- **Automatic Embedding Generation**: When creating entities, embeddings are automatically generated from the entity's observations if not explicitly provided.
- **Semantic Search**: Text queries are converted to embeddings for semantic similarity search.
- **Fallback to Text Search**: If semantic search doesn't yield results, the system falls back to traditional text search.
- **Configurable Model**: The embedding model can be configured to use different models from the Hugging Face model hub.
- **Arbitrary Vector Dimensions**: The system now supports arbitrary vector dimensions, not just the fixed 4D vectors used for testing.

## Default Configuration

- **Default Model**: `Xenova/bge-small-en-v1.5` (384-dimensional embeddings)
- **Default Dimension**: 384

## Usage

### Creating Entities with Embeddings

Entities can be created with or without explicit embeddings:

```typescript
// With explicit embedding
await db.create_entities([
  {
    name: "Entity1",
    entityType: "concept",
    observations: ["This is an observation"],
    embedding: [0.1, 0.2, 0.3, ...] // Optional: 384-dimensional vector
  }
]);

// Without embedding (will be generated automatically)
await db.create_entities([
  {
    name: "Entity2",
    entityType: "concept",
    observations: ["This is another observation"]
  }
]);
```

### Searching with Semantic Queries

The `search_nodes` function now supports semantic search:

```typescript
// Text query (will be converted to embedding for semantic search)
const results = await db.search_nodes("What is the meaning of life?");

// Direct vector query
const embedding = await generateEmbedding("What is the meaning of life?");
const results = await db.search_nodes(embedding);
```

## Migration

If you're upgrading from a previous version, you'll need to run the migration script to update the database schema:

```bash
npm run migrate:vector-dimension
```

This will:
1. Create a backup of your entities table
2. Update the schema to support the new vector dimensions
3. Restore your data (note that existing embeddings will be lost and need to be regenerated)

## Regenerating Embeddings

To regenerate embeddings for all entities in the database, you can use the provided script:

```bash
npm run regenerate:embeddings
```

This is useful in the following scenarios:
1. After migrating from a previous version without embeddings
2. When changing the embedding model
3. When fixing corrupted embeddings
4. When you want to ensure all entities have up-to-date embeddings

The script will:
1. Retrieve all entities from the database
2. For each entity, combine its observations into text
3. Generate an embedding for that text using the Xenova/bge-small-en-v1.5 model
4. Update the entity with the new embedding

Progress will be logged to the console, showing how many entities have been processed and how many succeeded or failed.

## Technical Details

### Embedding Generation

Embeddings are generated using the Transformers.js library, which provides access to state-of-the-art transformer models from the Hugging Face model hub. The default model is `Xenova/bge-small-en-v1.5`, which is a small but powerful embedding model that produces 384-dimensional vectors.

### Vector Storage

Vectors are stored in the SQLite database using the `vector32` function, which creates a binary blob of 32-bit floating-point numbers. The database schema has been updated to support arbitrary vector dimensions.

### Search Algorithm

The search algorithm uses cosine similarity to find the most similar vectors in the database. The `vector_distance_cos` function is used to calculate the distance between vectors.

## Customization

To use a different embedding model, modify the `DEFAULT_EMBEDDING_MODEL` constant in `src/db/embedding-service.ts`:

```typescript
export const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
export const DEFAULT_EMBEDDING_DIMENSION = 384;
```

Make sure to also update the `DEFAULT_EMBEDDING_DIMENSION` to match the output dimension of the new model.