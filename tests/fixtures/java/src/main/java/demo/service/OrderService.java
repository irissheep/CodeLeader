package demo.service;
import demo.data.OrderRepository;
public class OrderService {
    private final OrderRepository repository = new OrderRepository();
    public int total(int count) { return repository.unitPrice() * count; }
    public String total(String label) { return label.trim(); }
    public int recursive(int n) { return n == 0 ? 0 : recursive(n - 1); }
}
