import os
from loguru import logger
import uuid

from qdrant_client import QdrantClient
from qdrant_client.http import models
from sentence_transformers import SentenceTransformer

# Global model cache to avoid reloading
_encoder_cache = None

def get_encoder():
    """Get or create cached SentenceTransformer encoder"""
    global _encoder_cache
    if _encoder_cache is None:
        try:
            _encoder_cache = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
            logger.info("SentenceTransformer model loaded and cached")
        except Exception as e:
            logger.error(f"Failed to load SentenceTransformer: {e}")
            raise
    return _encoder_cache

class RAGEngine:
    def __init__(self, host="localhost", port=6333):
        self.use_qdrant = False
        self.use_inmemory = False
        
        # Try Qdrant first
        try:
            self.client = QdrantClient(host=host, port=port)
            self.collection_name = "weu_knowledge"
            # Use cached encoder to avoid reloading model
            self.encoder = get_encoder()
            self._init_collection()
            self.use_qdrant = True
            self.available = True
            logger.success("RAG Engine initialized with Qdrant")
        except Exception as e:
            logger.warning(f"Qdrant not available: {e}. Falling back to InMemoryRAG")
            
            # Fallback to InMemoryRAG
            try:
                from app.rag.inmemory_rag import InMemoryRAG
                self.inmemory_rag = InMemoryRAG()
                self.use_inmemory = True
                self.available = self.inmemory_rag.available
                logger.success("RAG Engine initialized with InMemoryRAG")
            except Exception as e2:
                logger.error(f"Failed to initialize InMemoryRAG: {e2}")
                self.available = False
                self.client = None
                self.encoder = None

    def _init_collection(self):
        try:
            collections = self.client.get_collections()
            exists = any(c.name == self.collection_name for c in collections.collections)
            
            if not exists:
                # Create collection with vector size 384 (MiniLM standard)
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=models.VectorParams(
                        size=384, 
                        distance=models.Distance.COSINE
                    )
                )
                logger.info(f"Created Qdrant collection: {self.collection_name}")
        except Exception as e:
             logger.error(f"Error initializing Qdrant collection: {e}")

    def add_text(self, text: str, source: str = "user_input"):
        """
        Add text to RAG (Qdrant or InMemory).
        """
        if not self.available:
            logger.warning("RAG unavailable, skipping add_text")
            return None

        # Use InMemoryRAG if available
        if self.use_inmemory:
            return self.inmemory_rag.add_text(text, source)

        # Use Qdrant
        doc_id = str(uuid.uuid4())
        logger.info(f"Adding text to RAG source={source} id={doc_id}")
        
        try:
            vector = self.encoder.encode(text).tolist()
            
            self.client.upsert(
                collection_name=self.collection_name,
                points=[
                    models.PointStruct(
                        id=doc_id,
                        vector=vector,
                        payload={"text": text, "source": source}
                    )
                ]
            )
            return doc_id
        except Exception as e:
            logger.error(f"Error adding to Qdrant: {e}")
            return None

    def query(self, query_text: str, n_results: int = 3):
        """
        Query RAG (Qdrant or InMemory).
        """
        logger.info(f"Querying RAG: {query_text}")
        if not self.available:
             return {'documents': [[]], 'metadatas': [[]]}

        # Use InMemoryRAG if available
        if self.use_inmemory:
            return self.inmemory_rag.query(query_text, n_results)

        try:
            query_vector = self.encoder.encode(query_text).tolist()
            
            # Use query_points method (search is deprecated)
            search_result = self.client.query_points(
                collection_name=self.collection_name,
                query=query_vector,
                limit=n_results
            ).points
            
            # Format to match previous interface
            documents = []
            metadatas = []
            
            for hit in search_result:
                # Payload is a dict
                documents.append(hit.payload.get("text", ""))
                metas = hit.payload.copy()
                if "text" in metas:
                    del metas["text"]
                metas["score"] = hit.score
                metadatas.append(metas)
                
            return {'documents': [documents], 'metadatas': [metadatas]}
            
        except Exception as e:
            logger.error(f"Error querying Qdrant: {e}")
            return {'documents': [[]], 'metadatas': [[]]}

    def get_documents(self, limit: int = 50):
        """
        Get recent documents from RAG - optimized with default limit.
        """
        if not self.available:
            return []
            
        if self.use_inmemory:
            # Limit in-memory documents for performance
            all_docs = self.inmemory_rag.get_all_documents()
            return all_docs[:limit]
            
        try:
            # Qdrant scroll - limit to avoid slow queries
            records, _ = self.client.scroll(
                collection_name=self.collection_name,
                limit=limit,
                with_payload=True,
                with_vectors=False
            )
            
            documents = []
            for record in records:
                payload = record.payload or {}
                documents.append({
                    "id": record.id,
                    "text": payload.get("text", ""),
                    "source": payload.get("source", "unknown"),
                    "score": None # Not applicable for listing
                })
            return documents
        except Exception as e:
            logger.error(f"Error getting documents from Qdrant: {e}")
            return []

    def add_file(self, file_path: str, filename: str, source: str = "file_upload"):
        """
        Add file content to RAG after processing.
        Uses FileProcessor to extract text from various file types.
        """
        if not self.available:
            logger.warning("RAG unavailable, skipping add_file")
            return None
        
        try:
            from app.utils.file_processor import FileProcessor
            result = FileProcessor.process_file(file_path, filename)
            
            if result['error'] or not result['text']:
                logger.warning(f"Failed to process file {filename}: {result.get('error', 'No text extracted')}")
                return None
            
            # Add extracted text to RAG
            doc_id = self.add_text(result['text'], source=f"{source}:{filename}")
            
            logger.info(f"Added file {filename} to RAG as doc_id={doc_id}")
            return doc_id
        except Exception as e:
            logger.error(f"Error adding file to RAG: {e}")
            return None
    
    def delete_document(self, doc_id: str) -> bool:
        """Remove a document by id. Returns True if removed."""
        if not self.available:
            return False
        if self.use_inmemory:
            return self.inmemory_rag.delete_document(doc_id)
        try:
            from qdrant_client.http import models as qmodels
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=qmodels.PointIdsList(points=[str(doc_id)])
            )
            logger.info(f"Deleted document {doc_id} from Qdrant")
            return True
        except Exception as e:
            logger.error(f"Error deleting from Qdrant: {e}")
            return False

    def reset_db(self):
        if self.available:
            if self.use_inmemory:
                self.inmemory_rag.reset_db()
            elif self.use_qdrant:
                try:
                    self.client.delete_collection(self.collection_name)
                    self._init_collection()
                except Exception as e:
                    logger.error(f"Error resetting Qdrant: {e}")
