package shared;
public class Service {
    public int execute() { return 2; }
    public int self() { return execute(); }
}
