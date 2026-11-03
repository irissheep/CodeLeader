package demo.api;
import demo.service.OrderService;
class 中文入口 {
    int invoke() { String label = "🌱"; return new OrderService().total(2); }
}
