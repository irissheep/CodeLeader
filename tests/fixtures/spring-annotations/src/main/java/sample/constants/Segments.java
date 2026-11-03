package sample.constants;
public class Segments {
    public static final String ROOT = "/" + "sample";
    public static final String LEAF = "/leaf";
    public static final String PIECE = LEAF + "/detail";
    public static final String FIRST = SECOND;
    public static final String SECOND = FIRST;
    public interface Nested { String TOKEN = "/inside"; }
}
