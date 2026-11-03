package shared;
public class Service {
    public int execute() { return 1; }
    public int self() { return execute(); }
}
