from app.data.repository import OrderRepository

def create(name: str) -> str:
    repository = OrderRepository()
    return repository.save(name)

def recursive(n: int) -> int:
    return 0 if n <= 0 else recursive(n - 1)
