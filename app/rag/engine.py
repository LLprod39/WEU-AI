"""
RAG Engine — опционально при полной сборке (sentence-transformers, qdrant).
В мини-сборке RAG недоступен; импорты ленивые, чтобы не падать при отсутствии deps.
"""
import os
import uuid
from loguru import logger

# Ленивый кэш энкодера (только при полной сборке)
_encoder_cache = None


def get_encoder():
    """Энкодер для эмбеддингов. В мини-сборке возвращает None (sentence_transformers не установлен)."""
    global _encoder_cache
    if _encoder_cache is not None:
        return _encoder_cache
    try:
        from sentence_transformers import SentenceTransformer
        _encoder_cache = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
        logger.info("SentenceTransformer loaded and cached")
        return _encoder_cache
    except ImportError as e:
        logger.info("RAG (mini build): sentence_transformers not installed. Use full build for embeddings.")
        return None
    except Exception as e:
        logger.warning(f"RAG encoder failed: {e}")
        return None


def _rag_deps_available():
    """Проверка наличия зависимостей RAG без их загрузки."""
    try:
        from sentence_transformers import SentenceTransformer  # noqa: F401
        return True
    except ImportError:
        return False


class RAGEngine:
    """
    RAG: Qdrant или InMemory. В мини-сборке available=False, методы no-op/пустые ответы.
    """

    def __init__(self, host=None, port=6333):
        host = host or os.getenv("QDRANT_HOST", "localhost")
        self.use_qdrant = False
        self.use_inmemory = False
        self.available = False
        self.client = None
        self.encoder = None
        self.inmemory_rag = None
        self.collection_name = "weu_knowledge"
        self.rag_build = "full"

        # Qdrant + энкодер
        try:
            from qdrant_client import QdrantClient
            from qdrant_client.http import models as qmodels
            enc = get_encoder()
            if enc is None:
                raise RuntimeError("encoder not available (mini build)")
            self.client = QdrantClient(host=host, port=int(port))
            self.encoder = enc
            self._qdrant_models = qmodels
            self._init_collection()
            self.use_qdrant = True
            self.available = True
            logger.success("RAG Engine: Qdrant")
            return
        except Exception as e:
            logger.debug(f"Qdrant init skipped: {e}")

        # InMemory (тоже нужен энкодер)
        try:
            from app.rag.inmemory_rag import InMemoryRAG
            self.inmemory_rag = InMemoryRAG()
            self.available = getattr(self.inmemory_rag, "available", False)
            self.use_inmemory = self.available
            if self.available:
                logger.success("RAG Engine: InMemory")
                return
        except Exception as e:
            logger.debug(f"InMemoryRAG init skipped: {e}")

        self.rag_build = "mini"
        logger.info("RAG unavailable (mini build). Use full build: pip install -r requirements-full.txt")

    def _init_collection(self):
        if not self.client or not self.use_qdrant:
            return
        try:
            models = self._qdrant_models
            collections = self.client.get_collections()
            exists = any(c.name == self.collection_name for c in collections.collections)
            if not exists:
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE),
                )
                logger.info(f"Created Qdrant collection: {self.collection_name}")
        except Exception as e:
            logger.error(f"Error initializing Qdrant collection: {e}")

    def add_text(self, text: str, source: str = "user_input"):
        if not self.available:
            return None
        if self.use_inmemory:
            return self.inmemory_rag.add_text(text, source)
        doc_id = str(uuid.uuid4())
        try:
            vector = self.encoder.encode(text).tolist()
            self.client.upsert(
                collection_name=self.collection_name,
                points=[
                    self._qdrant_models.PointStruct(id=doc_id, vector=vector, payload={"text": text, "source": source})
                ],
            )
            return doc_id
        except Exception as e:
            logger.error(f"Error adding to Qdrant: {e}")
            return None

    def query(self, query_text: str, n_results: int = 3):
        if not self.available:
            return {"documents": [[]], "metadatas": [[]]}
        if self.use_inmemory:
            return self.inmemory_rag.query(query_text, n_results)
        try:
            qv = self.encoder.encode(query_text).tolist()
            result = self.client.query_points(
                collection_name=self.collection_name, query=qv, limit=n_results
            ).points
            documents = [h.payload.get("text", "") for h in result]
            metadatas = []
            for h in result:
                m = dict(h.payload or {})
                m.pop("text", None)
                m["score"] = getattr(h, "score", None)
                metadatas.append(m)
            return {"documents": [documents], "metadatas": [metadatas]}
        except Exception as e:
            logger.error(f"Error querying Qdrant: {e}")
            return {"documents": [[]], "metadatas": [[]]}

    def get_documents(self, limit: int = 50):
        if not self.available:
            return []
        if self.use_inmemory:
            return (self.inmemory_rag.get_all_documents() or [])[:limit]
        try:
            records, _ = self.client.scroll(
                collection_name=self.collection_name,
                limit=limit,
                with_payload=True,
                with_vectors=False,
            )
            return [
                {"id": r.id, "text": (r.payload or {}).get("text", ""), "source": (r.payload or {}).get("source", "unknown"), "score": None}
                for r in records
            ]
        except Exception as e:
            logger.error(f"Error getting documents: {e}")
            return []

    def add_file(self, file_path: str, filename: str, source: str = "file_upload"):
        if not self.available:
            return None
        try:
            from app.utils.file_processor import FileProcessor
            result = FileProcessor.process_file(file_path, filename)
            if result.get("error") or not result.get("text"):
                return None
            return self.add_text(result["text"], source=f"{source}:{filename}")
        except Exception as e:
            logger.error(f"Error adding file: {e}")
            return None

    def delete_document(self, doc_id: str) -> bool:
        if not self.available:
            return False
        if self.use_inmemory:
            return self.inmemory_rag.delete_document(doc_id)
        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=self._qdrant_models.PointIdsList(points=[str(doc_id)]),
            )
            return True
        except Exception as e:
            logger.error(f"Error deleting: {e}")
            return False

    def reset_db(self):
        if not self.available:
            return
        if self.use_inmemory:
            self.inmemory_rag.reset_db()
        elif self.use_qdrant:
            try:
                self.client.delete_collection(self.collection_name)
                self._init_collection()
            except Exception as e:
                logger.error(f"Error resetting Qdrant: {e}")
