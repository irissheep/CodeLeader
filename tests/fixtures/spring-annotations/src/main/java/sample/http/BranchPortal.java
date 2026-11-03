package sample.http;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping(value = {"/first", "/second"})
class BranchPortal {
    @GetMapping(path = {"", "/{id}"}) String branches() { return ""; }
}
