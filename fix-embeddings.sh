#!/bin/bash

# Fix Embeddings Script
# This script runs the necessary steps to fix the vector dimension mismatch
# and regenerate all embeddings in the database

echo "Starting embedding dimension fix process..."

# Step 1: Run the fix-vector-dimension migration
echo "Step 1: Running vector dimension fix migration..."
node --loader ts-node/esm src/db/migrations/fix-vector-dimension.ts
if [ $? -ne 0 ]; then
    echo "Error: Vector dimension fix migration failed!"
    exit 1
fi
echo "Vector dimension fix migration completed successfully."

# Step 2: Run the embedding regeneration script
echo "Step 2: Regenerating embeddings for all entities..."
node --loader ts-node/esm src/db/migrations/regenerate-embeddings-after-migration.ts
if [ $? -ne 0 ]; then
    echo "Error: Embedding regeneration failed!"
    exit 1
fi
echo "Embedding regeneration completed successfully."

# Step 3: Run the test-embeddings script to verify everything is working
echo "Step 3: Testing embeddings functionality..."
node --loader ts-node/esm src/db/test-embeddings.ts
if [ $? -ne 0 ]; then
    echo "Error: Embedding tests failed!"
    exit 1
fi
echo "Embedding tests completed successfully."

echo "All steps completed successfully! The vector dimension has been fixed and all embeddings have been regenerated."
echo "Your memory system should now be working correctly with the new embedding dimension (384)."