class OrderRepository:
    def save(self, name: str) -> str:
        return name.strip()
