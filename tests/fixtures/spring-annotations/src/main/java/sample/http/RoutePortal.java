package sample.http;
import org.springframework.web.bind.annotation.*;
import sample.constants.Segments;
import static sample.constants.Segments.PIECE;
import static org.springframework.web.bind.annotation.RequestMethod.POST;
import static org.springframework.web.bind.annotation.RequestMethod.GET;

@RestController
@RequestMapping(path = Segments.ROOT)
class RoutePortal {
    static final String PART = "/local", TAIL = PART + "/tail";
    @GetMapping({ "/literal" }) String literalArray() { return ""; }
    @GetMapping(path = PART + ("/" + "more")) String localConstant() { return ""; }
    @GetMapping(value = PIECE) String importedConstant() { return ""; }
    @GetMapping(Segments.Nested.TOKEN) String nestedConstant() { return ""; }
    @GetMapping(TAIL) String multipleFields() { return ""; }
    @GetMapping("/paren/(x)") String literalParentheses() { return ""; }
    @RequestMapping(path = "/imported", method = POST) String staticMethod() { return ""; }
    @RequestMapping(value = {"/many", "/other"}, method = {GET, POST}) String multipleMethods() { return ""; }
    @RequestMapping("/any") String unrestricted() { return ""; }
    @RequestMapping(path = "/empty", method = {}) String emptyMethods() { return ""; }
    @RequestMapping(path = "/qualified", method = org.springframework.web.bind.annotation.RequestMethod.DELETE) String qualifiedMethod() { return ""; }
    @RequestMapping(path = "/regular", method = RequestMethod.PATCH) String importedType() { return ""; }
    @GetMapping(path = "/same", value = "/same") String equalAliases() { return ""; }
    @GetMapping("/${service.path}") String configuredPath() { return ""; }
    @GetMapping(Segments.FIRST) String cyclicConstant() { return ""; }
}
