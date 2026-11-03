package sample;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
class RealController {
    @PostMapping("/items") String create() { return "ok"; }
    @GetMapping String base() { return "ok"; }
    @GetMapping("relative") String relative() { return "ok"; }
    public static void main(String... args) {}
    private /* public static */ void main(String args) {}
}
