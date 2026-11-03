package shadow;
import org.springframework.web.bind.annotation.*;
class Lookalike { @GetMapping("/not-spring") String fake() { return ""; } }
