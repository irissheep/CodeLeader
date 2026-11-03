package demo.api;

import demo.service.OrderService;
import demo.domain.PricePolicy;
import demo.domain.DefaultPricePolicy;

public class OrderController {
    private final OrderService service = new OrderService();
    public String submit(String name) {
        // 中文与 emoji 🌱，用于核对 UTF-16 源码范围。
        int total = service.total(3);
        String description = service.total("three");
        PricePolicy policy = new DefaultPricePolicy();
        return description + policy.price(total);
    }
    public static void main(String[] args) {
        new OrderController().submit("订单");
    }
}
