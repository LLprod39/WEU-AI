"""
Simple in-memory RAG engine as fallback when Qdrant is not available
"""
from loguru import logger
import numpy as np
from typing import List, Dict
import uuid

# Import cached encoder from engine
try:
    from app.rag.engine import get_encoder
except ImportError:
    # Fallback if import fails
    from sentence_transformers import SentenceTransformer
    _encoder_cache = None
    def get_encoder():
        global _encoder_cache
        if _encoder_cache is None:
            _encoder_cache = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
        return _encoder_cache


class InMemoryRAG:
    """Simple in-memory RAG using cosine similarity"""
    
    def __init__(self):
        try:
            # Use cached encoder to avoid reloading model
            self.encoder = get_encoder()
            self.documents = []  # List of {id, text, source, vector}
            self.available = True
            logger.info("InMemoryRAG initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize InMemoryRAG: {e}")
            self.available = False
            self.encoder = None
    
    def add_text(self, text: str, source: str = "user_input") -> str:
        """Add text to in-memory storage"""
        if not self.available or not self.encoder:
            logger.warning("InMemoryRAG not available or encoder not loaded")
            return None
        
        try:
            doc_id = str(uuid.uuid4())
            vector = self.encoder.encode(text)
            
            self.documents.append({
                'id': doc_id,
                'text': text,
                'source': source,
                'vector': vector
            })
            
            logger.info(f"Added document {doc_id} from {source}")
            return doc_id
        except Exception as e:
            logger.error(f"Error adding text: {e}")
            return None
    
    def query(self, query_text: str, n_results: int = 3) -> Dict:
        """Query documents using cosine similarity"""
        if not self.available or not self.encoder or not self.documents:
            return {'documents': [[]], 'metadatas': [[]]}
        
        try:
            query_vector = self.encoder.encode(query_text)
            
            # Calculate cosine similarity with all documents
            similarities = []
            for doc in self.documents:
                similarity = self._cosine_similarity(query_vector, doc['vector'])
                similarities.append((doc, similarity))
            
            # Sort by similarity (highest first)
            similarities.sort(key=lambda x: x[1], reverse=True)
            
            # Get top n results
            top_results = similarities[:n_results]
            
            documents = [doc['text'] for doc, _ in top_results]
            metadatas = [{
                'source': doc['source'],
                'score': float(score)
            } for doc, score in top_results]
            
            return {'documents': [documents], 'metadatas': [metadatas]}
            
        except Exception as e:
            logger.error(f"Error querying: {e}")
            return {'documents': [[]], 'metadatas': [[]]}
    
    def _cosine_similarity(self, vec1, vec2):
        """Calculate cosine similarity between two vectors"""
        return np.dot(vec1, vec2) / (np.linalg.norm(vec1) * np.linalg.norm(vec2))
    
    def get_all_documents(self) -> List[Dict]:
        """Get all documents"""
        return [{
            'id': doc['id'],
            'text': doc['text'],
            'source': doc['source']
        } for doc in self.documents]
    
    def delete_document(self, doc_id: str) -> bool:
        """Remove a document by id. Returns True if removed."""
        if not self.available:
            return False
        before = len(self.documents)
        self.documents = [d for d in self.documents if d.get('id') != doc_id]
        removed = len(self.documents) < before
        if removed:
            logger.info(f"Deleted document {doc_id}")
        return removed

    def reset_db(self):
        """Clear all documents"""
        self.documents = []
        logger.info("Database reset")
