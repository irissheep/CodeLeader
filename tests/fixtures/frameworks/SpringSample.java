package example;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.stereotype.Service;
import org.springframework.stereotype.Repository;

@RestController
@RequestMapping("/orders")
class SpringSample {
    @GetMapping(path = "/{id}")
    String find(String id) { return id; }
}
@Service class OrderService {}
@Repository class OrderRepository {}
