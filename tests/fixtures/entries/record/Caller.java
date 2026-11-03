package record;
class Caller {
    private final Service service = new Service();
    String start(Key key) { return service.get(key.id()); }
}
