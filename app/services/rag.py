from pathlib import Path

import logging

try:
    import chromadb
    from chromadb.utils import embedding_functions
except ImportError:  # pragma: no cover — install chromadb for vector RAG
    chromadb = None
    embedding_functions = None

from app.config import CHROMA_DIR, RAG_PLAYBOOKS_DIR, settings

logger = logging.getLogger(__name__)

_COLLECTION = "nuvoletro_playbooks"
_client: chromadb.ClientAPI | None = None
_collection: chromadb.Collection | None = None


def _embedding_fn():
    if settings.has_openai:
        return embedding_functions.OpenAIEmbeddingFunction(
            api_key=settings.openai_api_key,
            model_name="text-embedding-3-small",
        )
    return embedding_functions.DefaultEmbeddingFunction()


def _fallback_playbooks() -> list[str]:
    return [p.read_text(encoding="utf-8").strip() for p in sorted(RAG_PLAYBOOKS_DIR.glob("*.md"))]


def _get_collection() -> "chromadb.Collection":
    global _client, _collection
    if chromadb is None:
        raise RuntimeError("chromadb is not installed. Run: pip install chromadb")
    if _collection is None:
        logger.info(f"Initializing Chroma vector store: {CHROMA_DIR}")
        _client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        _collection = _client.get_or_create_collection(
            name=_COLLECTION,
            embedding_function=_embedding_fn(),
        )
        _seed_playbooks(_collection)
        logger.info("Chroma RAG store initialized and ready")
    return _collection


def _seed_playbooks(collection: chromadb.Collection) -> None:
    docs: list[str] = []
    ids: list[str] = []
    metadatas: list[dict] = []

    for path in sorted(RAG_PLAYBOOKS_DIR.glob("*.md")):
        doc_id = path.stem
        if collection.get(ids=[doc_id])["ids"]:
            continue
        text = path.read_text(encoding="utf-8").strip()
        platform = "general"
        if "linkedin" in doc_id:
            platform = "linkedin"
        elif "instagram" in doc_id:
            platform = "instagram"
        elif "youtube" in doc_id:
            platform = "youtube"
        docs.append(text)
        ids.append(doc_id)
        metadatas.append({"platform": platform, "source": path.name})

    if docs:
        collection.add(documents=docs, ids=ids, metadatas=metadatas)


def init_rag_store() -> None:
    if chromadb is None:
        return
    _get_collection()


def retrieve_context(transcript: str, niche: str | None, n_results: int = 4) -> list[str]:
    """RAG retrieval: platform playbooks + transcript-aware query."""
    if chromadb is None:
        logger.info("Chromadb not available, using fallback playbooks")
        return _fallback_playbooks()[:n_results]
    collection = _get_collection()
    query = f"{niche or 'content creator'} video transcript repurposing:\n{transcript[:2000]}"
    logger.debug(f"RAG query: niche={niche}, query_length={len(query)}")
    results = collection.query(query_texts=[query], n_results=n_results)
    documents = results.get("documents") or []
    if not documents or not documents[0]:
        logger.debug("RAG retrieval returned no results, using fallback")
        return []
    retrieved = [doc for doc in documents[0] if doc]
    logger.info(f"RAG retrieval: {len(retrieved)} context chunks ({niche})")
    return retrieved
