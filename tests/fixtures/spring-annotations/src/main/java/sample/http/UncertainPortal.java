package sample.http;
import org.springframework.web.bind.annotation.*;
import static sample.constants.Segments.*;
import static sample.other.Names.*;
import static missing.library.Verbs.CHOSEN;
@RestController
class UncertainPortal {
    @GetMapping(ROOT) String ambiguousConstant() { return ""; }
    @GetMapping(path="/one",value="/two") String conflictingAliases() { return ""; }
    @RequestMapping(path="/method", method=CHOSEN) String unknownMethod() { return ""; }
}
