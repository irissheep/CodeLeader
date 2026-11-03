package sample.shadow;
import org.springframework.web.bind.annotation.*;
class LocalPortal { @GetMapping("/not-spring") String hidden() { return ""; } }
