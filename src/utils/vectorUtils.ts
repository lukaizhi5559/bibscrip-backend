/**
 * Utility functions for vector operations and normalization
 */

/**
 * Normalize a vector to have unit length (L2 norm)
 * This is important for cosine similarity calculations in Pinecone
 * 
 * @param vector The vector to normalize
 * @returns Normalized vector with unit length
 */
export function normalizeVector(vector: number[]): number[] {
  // Calculate the magnitude (L2 norm)
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  
  // Avoid division by zero
  if (magnitude === 0) {
    return vector;
  }
  
  // Normalize each component
  return vector.map(val => val / magnitude);
}

/**
 * Ensure vector has the correct dimension by truncating or padding
 * 
 * @param vector The input vector
 * @param dimension The target dimension
 * @returns Vector with correct dimension
 */
export function ensureVectorDimension(vector: number[], dimension: number): number[] {
  if (vector.length === dimension) {
    return vector;
  }
  
  if (vector.length > dimension) {
    // Truncate if too long
    return vector.slice(0, dimension);
  }
  
  // Pad with zeros if too short
  return [...vector, ...Array(dimension - vector.length).fill(0)];
}

/**
 * Prepare a vector for Pinecone by ensuring it has the correct dimension and is normalized
 * 
 * @param vector The input vector
 * @param dimension The target dimension (typically 1024 for OpenAI ada embeddings)
 * @returns Prepared vector ready for Pinecone
 */
export function prepareVectorForPinecone(vector: number[], dimension: number = 1024): number[] {
  // Ensure correct dimension first
  const correctDimension = ensureVectorDimension(vector, dimension);
  
  // Then normalize
  return normalizeVector(correctDimension);
}
