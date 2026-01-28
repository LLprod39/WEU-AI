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

    def _collection_for_user(self, user_id):
        """Per-user Qdrant collection name."""
        return f"weu_knowledge_u{user_id}" if user_id is not None else self.collection_name

    def _init_collection(self, collection_name=None):
        if not self.client or not self.use_qdrant:
            return
        name = collection_name or self.collection_name
        try:
            models = self._qdrant_models
            collections = self.client.get_collections()
            exists = any(c.name == name for c in collections.collections)
            if not exists:
                self.client.create_collection(
                    collection_name=name,
                    vectors_config=models.VectorParams(size=384, distance=models.Distance.COSINE),
                )
                logger.info(f"Created Qdrant collection: {name}")
        except Exception as e:
            logger.error(f"Error initializing Qdrant collection: {e}")

    def add_text(self, text: str, source: str = "user_input", user_id=None):
        if not self.available or user_id is None:
            return None
        if self.use_inmemory:
            return self.inmemory_rag.add_text(text, source, user_id=user_id)
        coll = self._collection_for_user(user_id)
        self._init_collection(coll)
        doc_id = str(uuid.uuid4())
        try:
            vector = self.encoder.encode(text).tolist()
            self.client.upsert(
                collection_name=coll,
                points=[
                    self._qdrant_models.PointStruct(id=doc_id, vector=vector, payload={"text": text, "source": source})
                ],
            )
            return doc_id
        except Exception as e:
            logger.error(f"Error adding to Qdrant: {e}")
            return None

    def query(self, query_text: str, n_results: int = 3, user_id=None):
        if not self.available or user_id is None:
            return {"documents": [[]], "metadatas": [[]]}
        if self.use_inmemory:
            return self.inmemory_rag.query(query_text, n_results, user_id=user_id)
        coll = self._collection_for_user(user_id)
        self._init_collection(coll)
        try:
            qv = self.encoder.encode(query_text).tolist()
            result = self.client.query_points(
                collection_name=coll, query=qv, limit=n_results
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

    def get_documents(self, limit: int = 50, user_id=None):
        if not self.available or user_id is None:
            return []
        if self.use_inmemory:
            return (self.inmemory_rag.get_all_documents(user_id=user_id) or [])[:limit]
        coll = self._collection_for_user(user_id)
        self._init_collection(coll)
        try:
            records, _ = self.client.scroll(
                collection_name=coll,
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

    def add_file(self, file_path: str, filename: str, source: str = "file_upload", user_id=None):
        if not self.available or user_id is None:
            return None
        try:
            from app.utils.file_processor import FileProcessor
            result = FileProcessor.process_file(file_path, filename)
            if result.get("error") or not result.get("text"):
                return None
            return self.add_text(result["text"], source=f"{source}:{filename}", user_id=user_id)
        except Exception as e:
            logger.error(f"Error adding file: {e}")
            return None

    def delete_document(self, doc_id: str, user_id=None) -> bool:
        if not self.available or user_id is None:
            return False
        if self.use_inmemory:
            return self.inmemory_rag.delete_document(doc_id, user_id=user_id)
        coll = self._collection_for_user(user_id)
        try:
            self.client.delete(
                collection_name=coll,
                points_selector=self._qdrant_models.PointIdsList(points=[str(doc_id)]),
            )
            return True
        except Exception as e:
            logger.error(f"Error deleting: {e}")
            return False

    def reset_db(self, user_id=None):
        if not self.available or user_id is None:
            return
        if self.use_inmemory:
            self.inmemory_rag.reset_db(user_id=user_id)
        elif self.use_qdrant:
            coll = self._collection_for_user(user_id)
            try:
                self.client.delete_collection(coll)
                self._init_collection(coll)
            except Exception as e:
                logger.error(f"Error resetting Qdrant: {e}")
