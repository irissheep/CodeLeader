import chromadb
class Store:
    def __init__(self):
        self.client = chromadb.PersistentClient(path="static-fixture")
        self.collection = self.client.get_or_create_collection("notes")
    def retrieve(self):
        return self.collection.query(query_embeddings=[])
    def index(self):
        self.collection.upsert(ids=[])
    def delete(self):
        self.collection.delete(ids=[])
class AgentOne:
    def __init__(self):
        self.store = Store()
    def answer(self):
        return self.store.retrieve()
class AgentTwo:
    def answer(self):
        return []
class Specialized(Store):
    pass

from langchain_openai import ChatOpenAI
class LocalSettings:
    ai_provider = "local"
class RemoteSettings:
    ai_provider = "openai"
class LocalModel:
    def __init__(self, settings: LocalSettings):
        if settings.ai_provider == "openai":
            model = ChatOpenAI()
            self.chain = prompt | model | parser
    def answer(self):
        return self.chain.invoke({})
class RemoteModel:
    def __init__(self, settings: RemoteSettings):
        if settings.ai_provider == "openai":
            model = ChatOpenAI()
            self.chain = prompt | model | parser
    def answer(self):
        return self.chain.invoke({})
